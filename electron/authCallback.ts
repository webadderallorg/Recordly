import { createServer, type Server } from "node:http";
import path from "node:path";
import { app, BrowserWindow, ipcMain, safeStorage, type WebContents } from "electron";
import { renderReturnPage } from "../services/browser-pages/render-return-page.mjs";
import { oauthFlowIdRedirectsEnabled } from "../src/lib/auth/oauthFlowRedirects";
import { createAuthFlowRelay, type FlowRelayResult } from "./authFlowRelay";
import {
	type AuthFlowStorageHooks,
	encryptionAvailable,
	readNativeAuthStorageValue,
} from "./authStorage";
import { isTrustedRenderer, isTrustedRendererDocument } from "./trustedRenderer";

const DEV_CALLBACK_HOST = "127.0.0.1:43821";
const DEV_CALLBACK_ORIGIN = `http://${DEV_CALLBACK_HOST}`;
const CALLBACK_PATH = "/callback";
const LOOPBACK_CALLBACK_PATH = "/auth/callback";
const MAX_CALLBACK_URL_LENGTH = 8192;
const CALLBACK_PARAMETERS = new Set([
	"code",
	"sb_flow_id",
	"error",
	"error_code",
	"error_description",
]);

type AuthCallbackOptions = {
	isDev: boolean;
	focusApp: () => void;
	flowRoutingEnabled?: boolean;
};

function callbackHeaders(contentType: string) {
	return {
		"Cache-Control": "no-store",
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; frame-ancestors 'none'",
		"Content-Type": contentType,
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	};
}

export function createAuthCallbackController({
	isDev,
	focusApp,
	flowRoutingEnabled = oauthFlowIdRedirectsEnabled,
}: AuthCallbackOptions) {
	const protocol = isDev ? "recordly-dev" : "recordly";
	let pendingUrl: string | null = null;
	let server: Server | null = null;
	let closed = false;
	let startupFinished = false;
	let startupDropped = false;
	let startupRouting: Promise<FlowRelayResult> | undefined;
	const startupUrls: string[] = [];
	const startupSeen = new Set<string>();
	const pendingByOwner = new Map<WebContents, string[]>();
	const flowOwners = new Map<string, { owner: WebContents; verifierKey: string }>();
	const observedOwners = new WeakSet<WebContents>();
	const relay = flowRoutingEnabled
		? createAuthFlowRelay<WebContents>({
				directory: path.join(app.getPath("userData"), "private-auth"),
				protocol,
				secureAvailable: encryptionAvailable,
				encrypt: (value) => safeStorage.encryptString(value),
				decrypt: (value) => safeStorage.decryptString(value),
				ownerAvailable: (owner) =>
					!owner.isDestroyed() &&
					(isTrustedRendererDocument(owner.getURL()) ||
						["", "about:blank"].includes(owner.getURL())),
				hasVerifier: async (key) => (await readNativeAuthStorageValue(key)) !== null,
				deliver: (owner, url) => {
					if (closed || owner.isDestroyed()) return false;
					const pending = pendingByOwner.get(owner) ?? [];
					if (!pending.includes(url)) {
						if (pending.length >= 8) return false;
						pending.push(url);
						pendingByOwner.set(owner, pending);
					}
					// A reload may temporarily leave the registered owner about:blank. Keep
					// its code private until the same webContents has a trusted app document.
					if (isTrustedRendererDocument(owner.getURL())) owner.send("auth:callback", url);
					if (app.isReady()) focusApp();
					return true;
				},
			})
		: undefined;

	const flowKey = (key: string) =>
		/^sb-[a-z0-9-]{1,100}-auth-token-flow-([A-Za-z0-9_-]{8,64})-code-verifier$/.exec(key)?.[1];
	const flowStorageHooks: AuthFlowStorageHooks | undefined = relay
		? {
				prepareSet: async (event, key, persistedKeys) => {
					const flowId = flowKey(key);
					if (!flowId) return;
					if (persistedKeys) {
						const present = new Set(persistedKeys);
						for (const [id, flow] of flowOwners) {
							if (present.has(flow.verifierKey)) continue;
							// A peer SDK may have explicitly evicted this verifier. Index
							// absence alone never proves inactivity; exact slot absence does.
							try {
								await relay.release(id, flow.owner);
								if (flowOwners.get(id) === flow) flowOwners.delete(id);
							} catch {
								// Keep failed housekeeping for retry; registration below
								// still enforces ownership, storage access and capacity.
							}
						}
					}
					const owner = event.sender;
					const alreadyOwned = flowOwners.get(flowId)?.owner === owner;
					const rollback = await relay.register(flowId, key, owner);
					flowOwners.set(flowId, { owner, verifierKey: key });
					if (!observedOwners.has(owner)) {
						observedOwners.add(owner);
						owner.once("destroyed", () => {
							pendingByOwner.delete(owner);
							for (const [id, candidate] of flowOwners)
								if (candidate.owner === owner) {
									flowOwners.delete(id);
									void relay.release(id, owner).catch(() => undefined);
								}
						});
					}
					return async () => {
						await rollback();
						if (!alreadyOwned && flowOwners.get(flowId)?.owner === owner)
							flowOwners.delete(flowId);
					};
				},
				didRemove: async (_event, key) => {
					const flowId = flowKey(key);
					const flow = flowId && flowOwners.get(flowId);
					if (flowId && flow && flow.verifierKey === key) {
						flowOwners.delete(flowId);
						await relay.release(flowId, flow.owner);
					}
				},
			}
		: undefined;

	function parseCallback(rawUrl: string): URL | null {
		if (rawUrl.length > MAX_CALLBACK_URL_LENGTH) return null;
		try {
			const url = new URL(rawUrl);
			if (url.protocol !== `${protocol}:` || url.hostname !== "auth") return null;
			if (url.pathname !== CALLBACK_PATH || url.username || url.password) return null;
			return url;
		} catch {
			return null;
		}
	}

	function find(args: readonly string[]) {
		return args.find((arg) => parseCallback(arg) !== null) ?? null;
	}

	function dispatch(rawUrl: string) {
		const url = parseCallback(rawUrl);
		if (!url) return false;
		if (relay) {
			void route(rawUrl);
			return true;
		}
		pendingUrl = url.href;
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed() && isTrustedRendererDocument(window.webContents.getURL()))
				window.webContents.send("auth:callback", url.href);
		}
		if (app.isReady()) focusApp();
		return true;
	}

	async function route(rawUrl: string): Promise<FlowRelayResult> {
		if (closed) return "unavailable";
		if (!parseCallback(rawUrl)) return "invalid";
		if (!relay) return dispatch(rawUrl) ? "local" : "invalid";
		const result = await relay.route(rawUrl);
		if (closed) return "unavailable";
		if (result === "unavailable" || result === "invalid") {
			// Existing error presentation only; never queue the unmatched code or
			// broadcast it to a renderer that may hold a different PKCE verifier.
			pendingUrl = `${protocol}://auth/callback?error=flow_unavailable`;
			for (const window of BrowserWindow.getAllWindows()) {
				if (!window.isDestroyed() && isTrustedRendererDocument(window.webContents.getURL()))
					window.webContents.send("auth:callback", pendingUrl);
			}
			if (app.isReady()) focusApp();
		}
		return result;
	}

	function queueStartup(rawUrl: string) {
		const callback = parseCallback(rawUrl);
		if (!callback) return false;
		if (startupSeen.has(callback.href)) return true;
		if (startupSeen.size >= 8) {
			startupDropped = true;
			return false;
		}
		startupSeen.add(callback.href);
		startupUrls.push(callback.href);
		return true;
	}

	function routeStartup(rawArg: string | null): Promise<FlowRelayResult> {
		if (!relay) return rawArg ? route(rawArg) : Promise.resolve("invalid");
		if (startupRouting) return startupRouting;
		if (rawArg && !queueStartup(rawArg)) startupDropped = true;
		startupRouting = (async (): Promise<FlowRelayResult> => {
			try {
				const results: FlowRelayResult[] = [];
				// Events arriving while a remote handoff is in flight join the same
				// bounded startup drain. No ordinary window is created before its ACK.
				while (startupUrls.length && !closed) {
					const batch = startupUrls.splice(0);
					results.push(...(await Promise.all(batch.map(route))));
				}
				startupFinished = true;
				startupSeen.clear();
				if (closed) return "unavailable";
				if (startupDropped) {
					await route(`${protocol}://auth/callback?error=flow_unavailable`);
					return "unavailable";
				}
				if (!results.length) return "invalid";
				if (results.every((result) => result === "forwarded")) return "forwarded";
				return results.includes("local") ? "local" : "unavailable";
			} catch {
				if (!closed)
					await route(`${protocol}://auth/callback?error=flow_unavailable`).catch(
						() => undefined,
					);
				return "unavailable";
			} finally {
				startupFinished = true;
				startupSeen.clear();
				startupUrls.length = 0;
			}
		})();
		return startupRouting;
	}

	function startDevServer() {
		if (!isDev || server) return;
		server = createServer((request, response) => {
			if (
				request.method !== "GET" ||
				request.headers.host !== DEV_CALLBACK_HOST ||
				(request.url?.length ?? 0) > MAX_CALLBACK_URL_LENGTH
			) {
				response.writeHead(404, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Not found");
				return;
			}

			const requestUrl = new URL(request.url ?? "/", DEV_CALLBACK_ORIGIN);
			if (requestUrl.pathname !== LOOPBACK_CALLBACK_PATH) {
				response.writeHead(404, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Not found");
				return;
			}

			const appUrl = new URL(`${protocol}://auth${CALLBACK_PATH}`);
			for (const key of CALLBACK_PARAMETERS) {
				for (const value of requestUrl.searchParams.getAll(key)) {
					appUrl.searchParams.append(key, value);
				}
			}
			if (!appUrl.searchParams.has("code") && !appUrl.searchParams.has("error")) {
				response.writeHead(400, callbackHeaders("text/plain; charset=utf-8"));
				response.end("Invalid authentication callback");
				return;
			}

			const finish = (failed: boolean) => {
				response.writeHead(200, callbackHeaders("text/html; charset=utf-8"));
				response.end(
					renderReturnPage(
						failed || appUrl.searchParams.has("error") ? "auth-error" : "auth-received",
						protocol,
					),
				);
			};
			if (relay)
				void route(appUrl.href).then(
					(result) => finish(result === "unavailable" || result === "invalid"),
					() => finish(true),
				);
			else {
				dispatch(appUrl.href);
				finish(false);
			}
		});
		server.on("error", (error) => {
			console.error("[auth] Could not start local callback server", error);
			server = null;
		});
		server.listen(43821, "127.0.0.1");
	}

	function close() {
		closed = true;
		startupUrls.length = 0;
		startupSeen.clear();
		server?.close();
		server = null;
		void relay?.close().catch(() => undefined);
		pendingByOwner.clear();
		flowOwners.clear();
	}

	app.on("open-url", (event, url) => {
		event.preventDefault();
		// Reopen from a handoff page without replacing the pending PKCE callback.
		if (url === `${protocol}://app/open`) {
			if (app.isReady()) focusApp();
			return;
		}
		if (relay && !startupFinished) {
			queueStartup(url);
			return;
		}
		if (relay) void app.whenReady().then(() => route(url));
		else dispatch(url);
	});

	ipcMain.handle("auth:get-pending-callback", (event) =>
		isTrustedRenderer(event)
			? relay
				? (pendingByOwner.get(event.sender)?.[0] ?? pendingUrl)
				: pendingUrl
			: null,
	);
	ipcMain.handle("auth:ack-callback", (event, url: string) => {
		if (!isTrustedRenderer(event)) return;
		if (relay) {
			const pending = pendingByOwner.get(event.sender);
			if (pending)
				pendingByOwner.set(
					event.sender,
					pending.filter((candidate) => candidate !== url),
				);
		}
		if (pendingUrl === url) pendingUrl = null;
	});

	return {
		close,
		dispatch,
		route,
		routeStartup,
		find,
		protocol,
		startDevServer,
		flowStorageHooks,
	};
}
