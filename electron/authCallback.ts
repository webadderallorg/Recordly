import { createServer, type Server } from "node:http";
import { app, BrowserWindow, ipcMain } from "electron";

const DEV_CALLBACK_HOST = "127.0.0.1:43821";
const DEV_CALLBACK_ORIGIN = `http://${DEV_CALLBACK_HOST}`;
const CALLBACK_PATH = "/callback";
const LOOPBACK_CALLBACK_PATH = "/auth/callback";
const MAX_CALLBACK_URL_LENGTH = 8192;
const CALLBACK_PARAMETERS = new Set(["code", "error", "error_code", "error_description"]);

type AuthCallbackOptions = {
	isDev: boolean;
	focusApp: () => void;
};

function callbackHeaders(contentType: string) {
	return {
		"Cache-Control": "no-store",
		"Content-Security-Policy":
			"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
		"Content-Type": contentType,
		"Referrer-Policy": "no-referrer",
		"X-Content-Type-Options": "nosniff",
	};
}

export function createAuthCallbackController({ isDev, focusApp }: AuthCallbackOptions) {
	const protocol = isDev ? "recordly-dev" : "recordly";
	let pendingUrl: string | null = null;
	let server: Server | null = null;

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
		pendingUrl = url.href;
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("auth:callback", url.href);
		}
		if (app.isReady()) focusApp();
		return true;
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

			dispatch(appUrl.href);
			response.writeHead(200, callbackHeaders("text/html; charset=utf-8"));
			response.end(
				'<!doctype html><meta charset="utf-8"><title>Return to Recordly</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090a;color:#ededef;font:16px "Helvetica Neue",Helvetica,Arial,sans-serif}.card{max-width:420px;padding:32px;text-align:center}h1{font-size:22px;font-weight:500}p{color:#8b8b8e;line-height:1.6}</style><main class="card"><h1>Return to Recordly</h1><p>Your sign-in link has been received. Return to the app to finish signing in.</p></main>',
			);
		});
		server.on("error", (error) => {
			console.error("[auth] Could not start local callback server", error);
			server = null;
		});
		server.listen(43821, "127.0.0.1");
	}

	function close() {
		server?.close();
		server = null;
	}

	app.on("open-url", (event, url) => {
		event.preventDefault();
		dispatch(url);
	});

	ipcMain.handle("auth:get-pending-callback", () => pendingUrl);
	ipcMain.handle("auth:ack-callback", (_, url: string) => {
		if (pendingUrl === url) pendingUrl = null;
	});

	return { close, dispatch, find, protocol, startDevServer };
}
