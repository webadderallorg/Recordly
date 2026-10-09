import { timingSafeEqual } from "node:crypto";
import {
	createServer,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import {
	createMcpHandler,
	type McpHttpHandler,
	type McpServer,
} from "@modelcontextprotocol/server";

export const MCP_PATH = "/mcp";
const MAX_BODY_BYTES = 1024 * 1024;

type McpHttpServerOptions = {
	port: number;
	getToken: () => string;
	buildServer: () => McpServer;
};

function securityHeaders() {
	return {
		"cache-control": "no-store",
		"content-type": "text/plain; charset=utf-8",
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
	};
}

function reject(
	response: ServerResponse,
	status: number,
	message: string,
	extraHeaders?: Record<string, string>,
) {
	response.writeHead(status, { ...securityHeaders(), ...extraHeaders });
	response.end(message);
}

export function isAuthorized(header: string | undefined, token: string): boolean {
	if (!token || !header?.startsWith("Bearer ")) return false;
	const given = Buffer.from(header.slice("Bearer ".length));
	const expected = Buffer.from(token);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

function toHeaders(incoming: IncomingHttpHeaders): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming)) {
		if (value === undefined) continue;
		headers.set(name, Array.isArray(value) ? value.join(", ") : value);
	}
	return headers;
}

function readBody(request: IncomingMessage): Promise<Buffer | null> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		request.on("data", (chunk: Buffer) => {
			if (size > MAX_BODY_BYTES) return;
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				chunks.length = 0;
				resolve(null);
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});
}

export function createMcpHttpServer({ port, getToken, buildServer }: McpHttpServerOptions) {
	const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
	let server: Server | null = null;
	let handler: McpHttpHandler | null = null;
	let starting: Promise<void> | null = null;

	async function handle(mcp: McpHttpHandler, request: IncomingMessage, response: ServerResponse) {
		if (!allowedHosts.has(request.headers.host ?? "") || request.headers.origin !== undefined) {
			reject(response, 403, "Forbidden");
			return;
		}
		if (!isAuthorized(request.headers.authorization, getToken())) {
			reject(response, 401, "Unauthorized", { "WWW-Authenticate": "Bearer" });
			return;
		}
		if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== MCP_PATH) {
			reject(response, 404, "Not found");
			return;
		}

		const body = request.method === "POST" ? await readBody(request) : undefined;
		if (body === null) {
			reject(response, 413, "Payload too large", { connection: "close" });
			return;
		}

		const abort = new AbortController();
		response.on("close", () => abort.abort());
		const webResponse = await mcp.fetch(
			new Request(`http://${request.headers.host}${request.url}`, {
				method: request.method,
				headers: toHeaders(request.headers),
				body: body?.toString("utf8"),
				signal: abort.signal,
			}),
		);

		response.writeHead(webResponse.status, {
			...securityHeaders(),
			...Object.fromEntries(webResponse.headers),
		});
		if (webResponse.body) {
			const reader = webResponse.body.getReader();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				response.write(value);
			}
		}
		response.end();
	}

	function start(): Promise<void> {
		if (server) return Promise.resolve();
		starting ??= new Promise<void>((resolve, rejectStart) => {
			const mcp = createMcpHandler(() => buildServer(), {
				maxRequestBodySize: MAX_BODY_BYTES,
				onerror: (error) => console.warn("[mcp-server]", error.message),
			});
			const instance = createServer((request, response) => {
				handle(mcp, request, response).catch((error: unknown) => {
					console.warn("[mcp-server] Request failed", error);
					if (!response.headersSent) reject(response, 500, "Internal error");
					else response.end();
				});
			});
			instance.once("error", rejectStart);
			instance.listen(port, "127.0.0.1", () => {
				instance.off("error", rejectStart);
				instance.on("error", (error) => console.warn("[mcp-server]", error));
				server = instance;
				handler = mcp;
				resolve();
			});
		}).finally(() => {
			starting = null;
		});
		return starting;
	}

	async function close() {
		await starting?.catch(() => undefined);
		const instance = server;
		const mcp = handler;
		server = null;
		handler = null;
		if (!instance) return;
		await new Promise<void>((resolve) => {
			instance.close(() => resolve());
			instance.closeAllConnections();
		});
		await mcp?.close();
	}

	return { start, close, isRunning: () => server !== null };
}
