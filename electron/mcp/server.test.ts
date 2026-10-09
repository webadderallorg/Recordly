import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { createMcpHttpServer, isAuthorized } from "./server";

const TOKEN = "test-token-123";

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createNetServer();
		probe.once("error", reject);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address ? address.port : 0;
			probe.close(() => resolve(port));
		});
	});
}

function buildServer() {
	const server = new McpServer({ name: "recordly-test", version: "0.0.0" });
	server.registerTool(
		"echo",
		{ description: "Echo text", inputSchema: z.object({ text: z.string() }) },
		async ({ text }) => ({ content: [{ type: "text" as const, text }] }),
	);
	return server;
}

type Reply = {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
};

function send(
	port: number,
	options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<Reply> {
	return new Promise((resolve, reject) => {
		const req = request(
			{
				host: "127.0.0.1",
				port,
				method: options.method ?? "POST",
				path: options.path ?? "/mcp",
				headers: options.headers,
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () =>
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						body: Buffer.concat(chunks).toString("utf8"),
					}),
				);
			},
		);
		req.on("error", reject);
		if (options.body) req.write(options.body);
		req.end();
	});
}

function rpcBody(reply: Reply) {
	const contentType = String(reply.headers["content-type"] ?? "");
	if (!contentType.includes("text/event-stream")) return JSON.parse(reply.body);
	const dataLine = reply.body
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.at(-1);
	return JSON.parse(dataLine?.slice("data:".length) ?? "null");
}

describe("isAuthorized", () => {
	it("accepts only the exact bearer token", () => {
		expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
		expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
		expect(isAuthorized(TOKEN, TOKEN)).toBe(false);
		expect(isAuthorized(undefined, TOKEN)).toBe(false);
		expect(isAuthorized("Bearer ", "")).toBe(false);
	});
});

describe("createMcpHttpServer", () => {
	let port: number;
	let server: ReturnType<typeof createMcpHttpServer>;
	let headers: Record<string, string>;

	beforeEach(async () => {
		port = await freePort();
		server = createMcpHttpServer({ port, getToken: () => TOKEN, buildServer });
		await server.start();
		headers = {
			Host: `127.0.0.1:${port}`,
			Authorization: `Bearer ${TOKEN}`,
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		};
	});

	afterEach(async () => {
		await server.close();
	});

	it("rejects a foreign Host header (DNS rebinding)", async () => {
		const reply = await send(port, { headers: { ...headers, Host: `evil.example:${port}` } });
		expect(reply.status).toBe(403);
	});

	it("rejects any request carrying an Origin header", async () => {
		const reply = await send(port, {
			headers: { ...headers, Origin: "https://example.com" },
			body: "{}",
		});
		expect(reply.status).toBe(403);
	});

	it("requires the bearer token", async () => {
		const { Authorization: _omit, ...withoutToken } = headers;
		const missing = await send(port, { headers: withoutToken, body: "{}" });
		expect(missing.status).toBe(401);
		expect(missing.headers["www-authenticate"]).toBe("Bearer");

		const wrong = await send(port, {
			headers: { ...headers, Authorization: "Bearer nope" },
			body: "{}",
		});
		expect(wrong.status).toBe(401);
	});

	it("serves only /mcp", async () => {
		const reply = await send(port, { path: "/other", headers, body: "{}" });
		expect(reply.status).toBe(404);
	});

	it("refuses bodies over 1 MB", async () => {
		const reply = await send(port, { headers, body: "x".repeat(1024 * 1024 + 1) });
		expect(reply.status).toBe(413);
	});

	it("answers a 2025-era initialize handshake", async () => {
		const reply = await send(port, {
			headers,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-11-25",
					capabilities: {},
					clientInfo: { name: "vitest", version: "1.0.0" },
				},
			}),
		});
		expect(reply.status).toBe(200);
		expect(reply.headers["x-content-type-options"]).toBe("nosniff");
		const message = rpcBody(reply);
		expect(message.result.serverInfo.name).toBe("recordly-test");
		expect(message.result.capabilities.tools).toBeDefined();
	});

	it("lists and calls tools on the 2025-era path", async () => {
		const legacyHeaders = { ...headers, "MCP-Protocol-Version": "2025-11-25" };
		const list = rpcBody(
			await send(port, {
				headers: legacyHeaders,
				body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
			}),
		);
		expect(list.result.tools.map((tool: { name: string }) => tool.name)).toContain("echo");

		const call = rpcBody(
			await send(port, {
				headers: legacyHeaders,
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 3,
					method: "tools/call",
					params: { name: "echo", arguments: { text: "hello" } },
				}),
			}),
		);
		expect(call.result.content).toEqual([{ type: "text", text: "hello" }]);
	});

	it("answers 2026-07-28 server/discover", async () => {
		const reply = await send(port, {
			headers: {
				...headers,
				"MCP-Protocol-Version": "2026-07-28",
				"Mcp-Method": "server/discover",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 4,
				method: "server/discover",
				params: {
					_meta: {
						"io.modelcontextprotocol/protocolVersion": "2026-07-28",
						"io.modelcontextprotocol/clientInfo": { name: "vitest", version: "1.0.0" },
						"io.modelcontextprotocol/clientCapabilities": {},
					},
				},
			}),
		});
		expect(reply.status).toBe(200);
		expect(rpcBody(reply).result.supportedVersions).toContain("2026-07-28");
	});

	it("does not serve GET streams", async () => {
		const { "Content-Type": _omit, ...getHeaders } = headers;
		const reply = await send(port, { method: "GET", headers: getHeaders });
		expect(reply.status).toBe(405);
	});

	it("stops listening on close and serves requests again after a restart", async () => {
		await server.close();
		expect(server.isRunning()).toBe(false);
		await expect(send(port, { headers, body: "{}" })).rejects.toThrow();
		await server.start();
		await server.start();
		expect(server.isRunning()).toBe(true);
		const reply = await send(port, {
			headers: { ...headers, "MCP-Protocol-Version": "2025-11-25" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
		});
		expect(reply.status).toBe(200);
		expect(rpcBody(reply).result.tools).toHaveLength(1);
	});

	it("ends up stopped when close races a pending start", async () => {
		await server.close();
		const starting = server.start();
		await server.close();
		await starting.catch(() => undefined);
		expect(server.isRunning()).toBe(false);
		await expect(send(port, { headers, body: "{}" })).rejects.toThrow();
	});

	it("reports a busy port instead of crashing", async () => {
		const second = createMcpHttpServer({ port, getToken: () => TOKEN, buildServer });
		await expect(second.start()).rejects.toMatchObject({ code: "EADDRINUSE" });
		expect(second.isRunning()).toBe(false);
	});
});
