import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import path from "node:path";

// Recordly allows several app instances, so on Windows/Linux a browser link such
// as `recordly://app/open` starts a brand-new process instead of reaching the
// running one (macOS delivers `open-url` to the running app instead). Each
// normal instance therefore exposes a tiny loopback endpoint that only brings
// its window forward. A link-launched process asks the most recently focused
// instance to do that and exits without opening a window of its own.
//
// Only a focus request travels over this channel: never a URL, auth code or
// other data. Sign-in callbacks keep using the per-flow relay in authFlowRelay.

const TOKEN = /^[0-9a-f]{32}$/;
const MAX_RECORD_BYTES = 1024;
const REQUEST_TIMEOUT_MS = 2000;

/** "recordly" or "recordly-dev"; matches the protocol the app registered. */
export type AppLinkProtocol = string;

type InstanceRecord = {
	version: 1;
	protocol: AppLinkProtocol;
	pid: number;
	port: number;
	token: string;
	focusedAt: number;
};

/** True for the data-free links that only ask Recordly to come forward. */
export function isActivationLink(rawUrl: string, protocol: AppLinkProtocol): boolean {
	if (typeof rawUrl !== "string" || rawUrl.length > 256) return false;
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== `${protocol}:` || url.username || url.password || url.port)
			return false;
		const route = `${url.hostname}${url.pathname}`;
		// Query strings and fragments are ignored: these routes never carry data.
		return route === "app/open" || route === "billing/return";
	} catch {
		return false;
	}
}

/**
 * Windows and Linux start a new process for every click on the app's shortcut.
 * A packaged launch there asks the running instance to come forward instead,
 * matching macOS, where the OS reuses the running app. Headless smoke-export
 * runs always start their own process.
 */
export function shouldForwardPlainLaunch(options: {
	platform: NodeJS.Platform;
	isPackaged: boolean;
	smokeExport: boolean;
}): boolean {
	return options.platform !== "darwin" && options.isPackaged && !options.smokeExport;
}

export function findActivationLink(
	args: readonly string[],
	protocol: AppLinkProtocol,
): string | null {
	return args.find((arg) => isActivationLink(arg, protocol)) ?? null;
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to someone else.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function sameToken(actual: unknown, expected: string): boolean {
	if (typeof actual !== "string" || !TOKEN.test(actual)) return false;
	return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function parseRecord(text: string, protocol: AppLinkProtocol): InstanceRecord | null {
	try {
		const value = JSON.parse(text) as InstanceRecord;
		if (
			!value ||
			typeof value !== "object" ||
			value.version !== 1 ||
			value.protocol !== protocol ||
			!Number.isSafeInteger(value.pid) ||
			value.pid <= 0 ||
			!Number.isInteger(value.port) ||
			value.port < 1 ||
			value.port > 65535 ||
			typeof value.token !== "string" ||
			!TOKEN.test(value.token) ||
			!Number.isFinite(value.focusedAt)
		)
			return null;
		return value;
	} catch {
		return null;
	}
}

export function createAppLinkRelay(options: {
	directory: string;
	protocol: AppLinkProtocol;
	pid?: number;
	isAlive?: (pid: number) => boolean;
	now?: () => number;
}) {
	const pid = options.pid ?? process.pid;
	const isAlive = options.isAlive ?? alive;
	const now = options.now ?? Date.now;
	const recordPath = path.join(options.directory, `${options.protocol}.${pid}.json`);
	let server: Server | undefined;
	let record: InstanceRecord | undefined;
	let closed = false;
	let writing: Promise<void> = Promise.resolve();

	function write(): Promise<void> {
		const current = record;
		if (!current || closed) return writing;
		writing = writing
			.then(async () => {
				await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
				const temporary = `${recordPath}.${randomBytes(6).toString("hex")}.tmp`;
				await fs.writeFile(temporary, JSON.stringify(current), { mode: 0o600 });
				await fs.rename(temporary, recordPath).catch(async (error) => {
					await fs.unlink(temporary).catch(() => undefined);
					throw error;
				});
				if (closed) await fs.unlink(recordPath).catch(() => undefined);
			})
			.catch(() => undefined);
		return writing;
	}

	/** Start accepting focus requests from link-launched processes. */
	function listen(onActivate: () => void): Promise<void> {
		if (server || closed) return writing;
		const token = randomBytes(16).toString("hex");
		return new Promise<void>((resolve) => {
			const instance = createServer((request, response) => {
				request.resume();
				const address = instance.address();
				const accepted =
					!closed &&
					!!address &&
					typeof address !== "string" &&
					request.method === "POST" &&
					request.url === "/v1/activate" &&
					request.headers.host === `127.0.0.1:${address.port}` &&
					// Browsers always send Origin on cross-site POSTs; the launcher never does.
					!request.headers.origin &&
					sameToken(request.headers["x-recordly-token"], token);
				response.writeHead(accepted ? 204 : 404, { "Cache-Control": "no-store" });
				response.end();
				if (accepted) onActivate();
			});
			instance.headersTimeout = REQUEST_TIMEOUT_MS;
			instance.requestTimeout = REQUEST_TIMEOUT_MS;
			instance.on("error", () => resolve());
			instance.listen(0, "127.0.0.1", () => {
				const address = instance.address();
				if (closed || !address || typeof address === "string") {
					instance.close();
					resolve();
					return;
				}
				instance.unref();
				server = instance;
				record = {
					version: 1,
					protocol: options.protocol,
					pid,
					port: address.port,
					token,
					focusedAt: now(),
				};
				void write().then(resolve);
			});
		});
	}

	/** Mark this instance as the one a link should bring forward. */
	function markFocused(): Promise<void> {
		if (!record) return writing;
		record = { ...record, focusedAt: now() };
		return write();
	}

	async function candidates(): Promise<InstanceRecord[]> {
		const names = await fs.readdir(options.directory).catch(() => [] as string[]);
		const found: InstanceRecord[] = [];
		for (const name of names) {
			if (!name.startsWith(`${options.protocol}.`) || !name.endsWith(".json")) continue;
			const filePath = path.join(options.directory, name);
			try {
				const stat = await fs.lstat(filePath);
				if (!stat.isFile() || stat.size > MAX_RECORD_BYTES) continue;
				const value = parseRecord(await fs.readFile(filePath, "utf8"), options.protocol);
				if (!value || value.pid === pid) continue;
				if (name !== `${options.protocol}.${value.pid}.json`) continue;
				if (!isAlive(value.pid)) {
					await fs.unlink(filePath).catch(() => undefined);
					continue;
				}
				found.push(value);
			} catch {
				// Unreadable or concurrently removed records are skipped.
			}
		}
		return found.sort((a, b) => b.focusedAt - a.focusedAt);
	}

	function activate(target: InstanceRecord): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			let settled = false;
			const settle = (value: boolean) => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			const request = httpRequest(
				{
					hostname: "127.0.0.1",
					port: target.port,
					method: "POST",
					path: "/v1/activate",
					headers: { "X-Recordly-Token": target.token, "Content-Length": 0 },
					timeout: REQUEST_TIMEOUT_MS,
				},
				(response) => {
					response.resume();
					settle(response.statusCode === 204);
				},
			);
			request.on("timeout", () => {
				settle(false);
				request.destroy();
			});
			request.on("error", () => settle(false));
			request.end();
		});
	}

	/**
	 * Ask an already-running instance to come forward. Resolves true only when
	 * one acknowledged, so the caller can exit instead of opening a new window.
	 */
	async function forward(): Promise<boolean> {
		for (const target of await candidates()) {
			if (await activate(target)) return true;
		}
		return false;
	}

	async function close(): Promise<void> {
		closed = true;
		server?.close();
		server = undefined;
		await writing;
		await fs.unlink(recordPath).catch(() => undefined);
	}

	return { listen, markFocused, forward, close };
}
