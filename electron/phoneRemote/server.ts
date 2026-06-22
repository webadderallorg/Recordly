import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { getPhoneRemoteMobilePage } from "./mobilePage";
import {
	addPhoneSignal,
	getLaptopSignalsSince,
	getPhoneRemoteSessionByCode,
	pruneExpiredPhoneRemoteSessions,
	toPublicSession,
	updatePhoneRemoteStatus,
} from "./sessionStore";
import type {
	PhoneRemoteJoinUrls,
	PhoneRemoteSignalMessage,
	PhoneRemoteStatusMessage,
} from "./types";

const JSON_LIMIT_BYTES = 256 * 1024;
const TUNNEL_READY_TIMEOUT_MS = 8000;
const TRY_CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const PHONE_REMOTE_STATUSES = new Set<PhoneRemoteStatusMessage["status"]>([
	"waiting",
	"phone-connected",
	"preview-live",
	"mic-active",
	"reconnecting",
	"disconnected",
	"camera-permission-denied",
	"microphone-permission-denied",
	"no-audio-track",
	"phone-backgrounded",
	"phone-sleeping",
	"error",
]);

let serverBasePort: number | null = null;
let phoneRemoteServerStartPromise: Promise<number> | null = null;
let tunnelProcess: ChildProcessWithoutNullStreams | null = null;
let tunnelBaseUrl: string | null = null;
let tunnelError: string | null = null;
let tunnelStartPromise: Promise<string | null> | null = null;
let pruneTimer: NodeJS.Timeout | null = null;

function getLanHost(): string {
	const interfaces = os.networkInterfaces();

	for (const addresses of Object.values(interfaces)) {
		for (const address of addresses ?? []) {
			if (address.family === "IPv4" && !address.internal) {
				return address.address;
			}
		}
	}

	return "127.0.0.1";
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
	response.writeHead(statusCode, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Cache-Control": "no-store",
		"Content-Type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(payload));
}

function writeText(response: ServerResponse, statusCode: number, message: string) {
	response.writeHead(statusCode, {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Cache-Control": "no-store",
		"Content-Type": "text/plain; charset=utf-8",
	});
	response.end(message);
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let totalBytes = 0;
		const chunks: Buffer[] = [];

		request.on("data", (chunk: Buffer) => {
			totalBytes += chunk.byteLength;
			if (totalBytes > JSON_LIMIT_BYTES) {
				reject(new Error("Request body is too large"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});

		request.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}

			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(new Error("Request body must be valid JSON"));
			}
		});

		request.on("error", reject);
	});
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parsePhoneRemoteSignal(value: unknown): PhoneRemoteSignalMessage | null {
	const record = asRecord(value);
	if (!record || typeof record.type !== "string") {
		return null;
	}

	if (record.type === "offer" || record.type === "answer") {
		const description = asRecord(record.description);
		if (
			!description ||
			typeof description.type !== "string" ||
			typeof description.sdp !== "string"
		) {
			return null;
		}
		if (description.type !== "offer" && description.type !== "answer") {
			return null;
		}
		if (description.type !== record.type) {
			return null;
		}
		return {
			type: record.type,
			description: {
				type: description.type,
				sdp: description.sdp,
			},
		};
	}

	if (record.type === "ice-candidate") {
		if (record.candidate === null) {
			return {
				type: "ice-candidate",
				candidate: null,
			};
		}

		const candidate = asRecord(record.candidate);
		if (!candidate || typeof candidate.candidate !== "string") {
			return null;
		}

		return {
			type: "ice-candidate",
			candidate: {
				candidate: candidate.candidate,
				sdpMid: typeof candidate.sdpMid === "string" ? candidate.sdpMid : null,
				sdpMLineIndex:
					typeof candidate.sdpMLineIndex === "number" ? candidate.sdpMLineIndex : null,
				usernameFragment:
					typeof candidate.usernameFragment === "string"
						? candidate.usernameFragment
						: undefined,
			},
		};
	}

	return null;
}

function parsePhoneRemoteStatus(value: unknown): PhoneRemoteStatusMessage | null {
	const record = asRecord(value);
	if (!record || typeof record.status !== "string") {
		return null;
	}

	if (!PHONE_REMOTE_STATUSES.has(record.status as PhoneRemoteStatusMessage["status"])) {
		return null;
	}

	return {
		status: record.status as PhoneRemoteStatusMessage["status"],
		detail: typeof record.detail === "string" ? record.detail : undefined,
		hasAudio: typeof record.hasAudio === "boolean" ? record.hasAudio : undefined,
		hasVideo: typeof record.hasVideo === "boolean" ? record.hasVideo : undefined,
		facingMode:
			record.facingMode === "user" || record.facingMode === "environment"
				? record.facingMode
				: undefined,
	};
}

function getCodeFromUrl(url: URL): string | null {
	const code = url.searchParams.get("code");
	return code && code.trim().length > 0 ? code.trim().toUpperCase() : null;
}

async function resolveSessionFromRequest(
	request: IncomingMessage,
	url: URL,
): Promise<ReturnType<typeof getPhoneRemoteSessionByCode> | null> {
	let code = getCodeFromUrl(url);

	if (!code && request.method === "POST") {
		const body = asRecord(await readJsonBody(request));
		code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : null;
		(request as IncomingMessage & { parsedJsonBody?: Record<string, unknown> }).parsedJsonBody =
			body ?? {};
	}

	return code ? getPhoneRemoteSessionByCode(code) : null;
}

function getParsedJsonBody(request: IncomingMessage): Record<string, unknown> {
	return (
		(request as IncomingMessage & { parsedJsonBody?: Record<string, unknown> })
			.parsedJsonBody ?? {}
	);
}

async function handlePhoneRemoteRequest(request: IncomingMessage, response: ServerResponse) {
	try {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");

		if (request.method === "OPTIONS") {
			writeText(response, 204, "");
			return;
		}

		if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/phone")) {
			response.writeHead(url.pathname === "/" ? 302 : 200, {
				...(url.pathname === "/" ? { Location: "/phone" } : {}),
				"Cache-Control": "no-store",
				"Content-Type": "text/html; charset=utf-8",
			});
			response.end(url.pathname === "/" ? "" : getPhoneRemoteMobilePage());
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/phone-remote/session") {
			const session = getCodeFromUrl(url)
				? getPhoneRemoteSessionByCode(getCodeFromUrl(url) ?? "")
				: null;
			if (!session) {
				writeText(response, 404, "Phone session was not found or has expired.");
				return;
			}

			writeJson(response, 200, {
				session: toPublicSession(session),
			});
			return;
		}

		if (request.method === "GET" && url.pathname === "/api/phone-remote/signals") {
			const session = await resolveSessionFromRequest(request, url);
			if (!session) {
				writeText(response, 404, "Phone session was not found or has expired.");
				return;
			}

			const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
			const afterIndex = Number.isFinite(after) ? Math.max(0, after) : 0;
			const signals = getLaptopSignalsSince(session, afterIndex);
			const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
			writeJson(response, 200, {
				signals,
				nextIndex: lastSignal?.index ?? afterIndex,
			});
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/phone-remote/signal") {
			const session = await resolveSessionFromRequest(request, url);
			if (!session) {
				writeText(response, 404, "Phone session was not found or has expired.");
				return;
			}

			const body = getParsedJsonBody(request);
			const message = parsePhoneRemoteSignal(body.message);
			if (!message) {
				writeText(response, 400, "Invalid phone signal payload.");
				return;
			}

			addPhoneSignal(session, message);
			writeJson(response, 200, { success: true });
			return;
		}

		if (request.method === "POST" && url.pathname === "/api/phone-remote/status") {
			const session = await resolveSessionFromRequest(request, url);
			if (!session) {
				writeText(response, 404, "Phone session was not found or has expired.");
				return;
			}

			const status = parsePhoneRemoteStatus(getParsedJsonBody(request));
			if (!status) {
				writeText(response, 400, "Invalid phone status payload.");
				return;
			}

			updatePhoneRemoteStatus(session, status);
			writeJson(response, 200, { success: true });
			return;
		}

		writeText(response, 404, "Not Found");
	} catch (error) {
		writeText(response, 500, error instanceof Error ? error.message : String(error));
	}
}

async function ensurePhoneRemoteServerPort(): Promise<number> {
	if (serverBasePort) {
		return serverBasePort;
	}

	if (phoneRemoteServerStartPromise) {
		return phoneRemoteServerStartPromise;
	}

	phoneRemoteServerStartPromise = new Promise((resolve, reject) => {
		const server = createServer((request, response) => {
			void handlePhoneRemoteRequest(request, response);
		});

		server.once("error", reject);
		server.listen(0, "0.0.0.0", () => {
			const address = server.address() as AddressInfo | null;
			if (!address) {
				reject(new Error("Phone remote server did not expose a TCP address"));
				return;
			}

			serverBasePort = address.port;
			console.log(`[phone-remote] Listening on port ${serverBasePort}`);
			if (!pruneTimer) {
				pruneTimer = setInterval(() => {
					pruneExpiredPhoneRemoteSessions();
				}, 60_000);
				pruneTimer.unref?.();
			}
			resolve(serverBasePort);
		});
	});

	return phoneRemoteServerStartPromise;
}

async function startQuickTunnel(localBaseUrl: string): Promise<string | null> {
	if (tunnelBaseUrl || tunnelError) {
		return tunnelBaseUrl;
	}

	if (tunnelStartPromise) {
		return tunnelStartPromise;
	}

	tunnelStartPromise = new Promise((resolve) => {
		let settled = false;
		const settle = (value: string | null) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(value);
		};

		try {
			tunnelProcess = spawn(
				"cloudflared",
				["tunnel", "--url", localBaseUrl, "--no-autoupdate"],
				{ windowsHide: true },
			);
		} catch (error) {
			tunnelError = error instanceof Error ? error.message : String(error);
			settle(null);
			return;
		}

		const spawnedProcess = tunnelProcess;
		const timeout = setTimeout(() => {
			tunnelError = "Secure tunnel did not become ready in time.";
			if (!spawnedProcess.killed) {
				spawnedProcess.kill();
			}
			if (tunnelProcess === spawnedProcess) {
				tunnelProcess = null;
			}
			settle(null);
		}, TUNNEL_READY_TIMEOUT_MS);

		const inspectOutput = (chunk: Buffer) => {
			const output = chunk.toString("utf8");
			const match = output.match(TRY_CLOUDFLARE_URL_PATTERN);
			if (match) {
				tunnelBaseUrl = match[0].replace(/\/$/, "");
				clearTimeout(timeout);
				settle(tunnelBaseUrl);
			}
		};

		spawnedProcess.stdout.on("data", inspectOutput);
		spawnedProcess.stderr.on("data", inspectOutput);
		spawnedProcess.once("error", (error) => {
			tunnelError = error.message;
			clearTimeout(timeout);
			settle(null);
		});
		spawnedProcess.once("exit", (code) => {
			if (!settled) {
				tunnelError =
					typeof code === "number"
						? `Secure tunnel exited with code ${code}.`
						: "Secure tunnel exited before it became ready.";
				clearTimeout(timeout);
				settle(null);
			}
			if (tunnelProcess === spawnedProcess) {
				tunnelProcess = null;
			}
		});
	});

	return tunnelStartPromise;
}

export async function getPhoneRemoteJoinUrls(): Promise<PhoneRemoteJoinUrls> {
	const port = await ensurePhoneRemoteServerPort();
	const lanBaseUrl = `http://${getLanHost()}:${port}`;
	const localBaseUrl = `http://127.0.0.1:${port}`;
	const secureTunnelBaseUrl = await startQuickTunnel(localBaseUrl);
	const buildJoinUrl = (baseUrl: string) => `${baseUrl}/phone`;

	if (secureTunnelBaseUrl) {
		return {
			joinUrl: buildJoinUrl(secureTunnelBaseUrl),
			localJoinUrl: buildJoinUrl(localBaseUrl),
			lanJoinUrl: buildJoinUrl(lanBaseUrl),
			tunnelJoinUrl: buildJoinUrl(secureTunnelBaseUrl),
			urlMode: "secure-tunnel",
		};
	}

	return {
		joinUrl: buildJoinUrl(lanBaseUrl),
		localJoinUrl: buildJoinUrl(localBaseUrl),
		lanJoinUrl: buildJoinUrl(lanBaseUrl),
		urlMode: "lan",
		tunnelError: tunnelError ?? "Secure tunnel is unavailable.",
	};
}

export function cleanupPhoneRemoteServer() {
	if (tunnelProcess) {
		tunnelProcess.kill();
		tunnelProcess = null;
	}

	if (pruneTimer) {
		clearInterval(pruneTimer);
		pruneTimer = null;
	}
}
