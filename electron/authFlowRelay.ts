import {
	createCipheriv,
	createDecipheriv,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import fs from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import path from "node:path";
import { withAuthStorageTransaction } from "./authStorageTransactionLock";

const FLOW_ID = /^[A-Za-z0-9_-]{8,64}$/;
const NONCE = /^[0-9a-f]{32}$/;
const MAX_URL_LENGTH = 8192;
const MAX_RECORD_BYTES = 4096;
const MAX_BODY_BYTES = 16384;
const MAX_OWNED_FLOWS = 8;

type Registration = {
	version: 1;
	protocol: string;
	flowId: string;
	pid: number;
	instance: string;
	nonce: string;
	capability: string;
	port: number;
};

export type FlowRelayResult = "local" | "forwarded" | "unavailable" | "invalid";

type Envelope = {
	flowId: string;
	instance: string;
	nonce: string;
	requestId: string;
	iv: string;
	data: string;
	tag: string;
};

function associatedData(record: Registration, envelope: Pick<Envelope, "requestId">): Buffer {
	return Buffer.from(
		JSON.stringify([
			1,
			record.protocol,
			record.flowId,
			record.instance,
			record.nonce,
			envelope.requestId,
		]),
	);
}

function transportKey(record: Registration, purpose: string): Buffer {
	return createHmac("sha256", Buffer.from(record.capability, "hex"))
		.update(`recordly-flow-${purpose}-v1`)
		.digest();
}

export function encryptFlowCallback(record: Registration, url: string): Envelope {
	const iv = randomBytes(12);
	const envelope = {
		flowId: record.flowId,
		instance: record.instance,
		nonce: record.nonce,
		requestId: randomBytes(16).toString("hex"),
		iv: iv.toString("hex"),
		data: "",
		tag: "",
	};
	const cipher = createCipheriv("aes-256-gcm", transportKey(record, "encryption"), iv);
	cipher.setAAD(associatedData(record, envelope));
	envelope.data = Buffer.concat([cipher.update(url, "utf8"), cipher.final()]).toString(
		"base64url",
	);
	envelope.tag = cipher.getAuthTag().toString("hex");
	return envelope;
}

function decryptFlowCallback(record: Registration, envelope: Envelope): string {
	const decipher = createDecipheriv(
		"aes-256-gcm",
		transportKey(record, "encryption"),
		Buffer.from(envelope.iv, "hex"),
	);
	decipher.setAAD(associatedData(record, envelope));
	decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
	return Buffer.concat([
		decipher.update(Buffer.from(envelope.data, "base64url")),
		decipher.final(),
	]).toString("utf8");
}

function validEnvelope(value: unknown): value is Envelope {
	if (!value || typeof value !== "object" || Object.keys(value).length !== 7) return false;
	const item = value as Envelope;
	return (
		typeof item.flowId === "string" &&
		FLOW_ID.test(item.flowId) &&
		typeof item.instance === "string" &&
		NONCE.test(item.instance) &&
		typeof item.nonce === "string" &&
		NONCE.test(item.nonce) &&
		typeof item.requestId === "string" &&
		NONCE.test(item.requestId) &&
		typeof item.iv === "string" &&
		/^[0-9a-f]{24}$/.test(item.iv) &&
		typeof item.tag === "string" &&
		NONCE.test(item.tag) &&
		typeof item.data === "string" &&
		/^[A-Za-z0-9_-]{1,12000}$/.test(item.data)
	);
}

function acknowledgement(record: Registration, envelope: Envelope, accepted: boolean): string {
	return createHmac("sha256", transportKey(record, "acknowledgement"))
		.update(associatedData(record, envelope))
		.update(JSON.stringify([envelope.iv, envelope.data, envelope.tag, accepted]))
		.digest("hex");
}

export function parseFlowCallback(
	rawUrl: string,
	protocol: string,
): { flowId: string; url: string } | null {
	if (typeof rawUrl !== "string" || rawUrl.length > MAX_URL_LENGTH) return null;
	try {
		const url = new URL(rawUrl);
		const flowId = url.searchParams.get("sb_flow_id");
		if (
			url.protocol !== `${protocol}:` ||
			url.hostname !== "auth" ||
			url.port ||
			url.pathname !== "/callback" ||
			url.username ||
			url.password ||
			url.hash ||
			!flowId ||
			!FLOW_ID.test(flowId) ||
			url.searchParams.getAll("sb_flow_id").length !== 1 ||
			url.searchParams.getAll("code").length > 1 ||
			url.searchParams.getAll("error").length > 1 ||
			url.searchParams.getAll("error_description").length > 1 ||
			url.searchParams.has("code") === url.searchParams.has("error") ||
			(url.searchParams.has("code") && !url.searchParams.get("code"))
		)
			return null;
		return url.href.length <= MAX_URL_LENGTH ? { flowId, url: url.href } : null;
	} catch {
		return null;
	}
}

function sameProof(actual: unknown, expected: string): boolean {
	if (typeof actual !== "string" || !/^[0-9a-f]{64}$/.test(actual)) return false;
	const provided = Buffer.from(actual ?? "");
	const correct = Buffer.from(expected);
	return provided.length === correct.length && timingSafeEqual(provided, correct);
}

function dead(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ESRCH";
	}
}

export function createAuthFlowRelay<Owner>(options: {
	directory: string;
	protocol: "recordly" | "recordly-dev";
	secureAvailable: () => boolean;
	encrypt: (value: string) => Buffer;
	decrypt: (value: Buffer) => string;
	ownerAvailable: (owner: Owner) => boolean;
	hasVerifier: (key: string) => Promise<boolean>;
	deliver: (owner: Owner, url: string) => boolean;
}) {
	const instance = randomBytes(16).toString("hex");
	const owned = new Map<string, { owner: Owner; verifierKey: string; record: Registration }>();
	let server: Server | undefined;
	let starting: Promise<number> | undefined;
	let closed = false;
	const recordsDirectory = path.join(options.directory, "flows");
	const lockDirectory = path.join(options.directory, "flow-transactions");

	function recordName(record: Registration) {
		return `${record.protocol}.${record.flowId}.${record.nonce}.enc`;
	}

	async function readRecord(name: string): Promise<Registration | null> {
		try {
			const filePath = path.join(recordsDirectory, name);
			const stat = await fs.lstat(filePath);
			if (!stat.isFile() || stat.size > MAX_RECORD_BYTES)
				throw new Error("Invalid flow registry");
			const value = JSON.parse(options.decrypt(await fs.readFile(filePath))) as Registration;
			if (
				!value ||
				Object.keys(value).length !== 8 ||
				value.version !== 1 ||
				value.protocol !== options.protocol ||
				typeof value.flowId !== "string" ||
				!FLOW_ID.test(value.flowId) ||
				!Number.isSafeInteger(value.pid) ||
				value.pid <= 0 ||
				value.pid > 0x7fffffff ||
				typeof value.instance !== "string" ||
				!NONCE.test(value.instance) ||
				typeof value.nonce !== "string" ||
				!NONCE.test(value.nonce) ||
				typeof value.capability !== "string" ||
				!NONCE.test(value.capability) ||
				!Number.isInteger(value.port) ||
				value.port < 1 ||
				value.port > 65535 ||
				recordName(value) !== name
			)
				throw new Error("Invalid flow registry");
			return value;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw new Error("Could not unlock the sign-in return route.");
		}
	}

	async function lookup(flowId: string): Promise<Registration | null> {
		const prefix = `${options.protocol}.${flowId}.`;
		const names = await fs.readdir(recordsDirectory).catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return [];
			throw error;
		});
		const matches: Registration[] = [];
		for (const name of names.filter((name) => name.startsWith(prefix))) {
			const record = await readRecord(name);
			if (!record) continue;
			if (dead(record.pid)) {
				// Unique generation names are never reused by a later registration.
				await fs
					.unlink(path.join(recordsDirectory, name))
					.catch((error: NodeJS.ErrnoException) => {
						if (error.code !== "ENOENT") throw error;
					});
			} else matches.push(record);
		}
		if (matches.length > 1) throw new Error("Ambiguous sign-in return route.");
		return matches[0] ?? null;
	}

	async function deliver(flowId: string, rawUrl: string): Promise<boolean> {
		const flow = owned.get(flowId);
		if (!flow || closed || !options.ownerAvailable(flow.owner)) return false;
		if (!(await options.hasVerifier(flow.verifierKey))) return false;
		// Recheck after the asynchronous disk read, before delivering any code.
		return (
			owned.get(flowId) === flow &&
			options.ownerAvailable(flow.owner) &&
			options.deliver(flow.owner, rawUrl)
		);
	}

	function start(): Promise<number> {
		starting ??= new Promise<number>((resolve, reject) => {
			server = createServer(async (request, response) => {
				response.setHeader("Cache-Control", "no-store");
				response.setHeader("Content-Type", "application/json");
				const address = server?.address();
				if (
					!address ||
					typeof address === "string" ||
					closed ||
					request.method !== "POST" ||
					request.url !== "/v1/callback" ||
					request.headers.host !== `127.0.0.1:${address.port}` ||
					request.headers.origin ||
					request.headers["content-type"] !== "application/json" ||
					Number(request.headers["content-length"] ?? 0) > MAX_BODY_BYTES
				) {
					response.writeHead(404);
					response.end("{}");
					request.resume();
					return;
				}
				try {
					const chunks: Buffer[] = [];
					let size = 0;
					for await (const chunk of request) {
						size += chunk.length;
						if (size > MAX_BODY_BYTES) {
							response.writeHead(413);
							response.end("{}");
							return;
						}
						chunks.push(Buffer.from(chunk));
					}
					const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
					if (!validEnvelope(body)) {
						response.writeHead(403);
						response.end("{}");
						return;
					}
					const flow = owned.get(body.flowId);
					if (
						!flow ||
						body.instance !== flow.record.instance ||
						body.nonce !== flow.record.nonce
					) {
						response.writeHead(403);
						response.end("{}");
						return;
					}
					const callback = parseFlowCallback(
						decryptFlowCallback(flow.record, body),
						options.protocol,
					);
					if (!callback || callback.flowId !== body.flowId) {
						response.writeHead(403);
						response.end("{}");
						return;
					}
					const accepted = await deliver(callback.flowId, callback.url);
					response.writeHead(accepted ? 200 : 409);
					response.end(
						JSON.stringify({
							accepted,
							proof: acknowledgement(flow.record, body, accepted),
						}),
					);
				} catch {
					if (!response.headersSent) response.writeHead(400);
					response.end("{}");
				}
			});
			server.headersTimeout = 3000;
			server.requestTimeout = 5000;
			server.once("error", () =>
				reject(new Error("Could not prepare the sign-in return route.")),
			);
			server.listen(0, "127.0.0.1", () => {
				const address = server?.address();
				if (!address || typeof address === "string")
					reject(new Error("Invalid sign-in return port."));
				else {
					server?.unref();
					resolve(address.port);
				}
			});
		});
		return starting;
	}

	async function register(
		flowId: string,
		verifierKey: string,
		owner: Owner,
	): Promise<() => Promise<void>> {
		if (
			!FLOW_ID.test(flowId) ||
			closed ||
			!options.secureAvailable() ||
			!options.ownerAvailable(owner)
		)
			throw new Error("Secure sign-in return routing is unavailable.");
		const existing = owned.get(flowId);
		if (existing) {
			if (existing.owner !== owner || existing.verifierKey !== verifierKey)
				throw new Error("This sign-in flow already belongs to another window.");
			return async () => undefined;
		}
		if (owned.size >= MAX_OWNED_FLOWS) throw new Error("Too many pending sign-in flows.");
		const port = await start();
		const record: Registration = {
			version: 1,
			protocol: options.protocol,
			flowId,
			pid: process.pid,
			instance,
			nonce: randomBytes(16).toString("hex"),
			capability: randomBytes(16).toString("hex"),
			port,
		};
		await withAuthStorageTransaction(lockDirectory, async () => {
			if (closed || !options.ownerAvailable(owner) || owned.size >= MAX_OWNED_FLOWS)
				throw new Error("Sign-in return owner is unavailable.");
			await fs.mkdir(recordsDirectory, { recursive: true, mode: 0o700 });
			if (process.platform !== "win32") await fs.chmod(recordsDirectory, 0o700);
			if (await lookup(flowId))
				throw new Error("This sign-in flow already has a return route.");
			let live = 0;
			for (const name of await fs.readdir(recordsDirectory)) {
				if (!name.startsWith(`${options.protocol}.`) || !name.endsWith(".enc")) continue;
				let prior: Registration | null;
				try {
					prior = await readRecord(name);
				} catch {
					// Unreadable unrelated generations still occupy capacity. Preserve
					// them without blocking a different, verifiable sign-in flow.
					live++;
					continue;
				}
				if (!prior) continue;
				if (dead(prior.pid))
					await fs
						.unlink(path.join(recordsDirectory, name))
						.catch((error: NodeJS.ErrnoException) => {
							if (error.code !== "ENOENT") throw error;
						});
				else live++;
			}
			if (live >= 128) throw new Error("Too many sign-in return routes.");
			const encrypted = options.encrypt(JSON.stringify(record));
			const filePath = path.join(recordsDirectory, recordName(record));
			const temporary = path.join(
				recordsDirectory,
				`.pending-${randomBytes(16).toString("hex")}`,
			);
			try {
				await fs.writeFile(temporary, encrypted, { flag: "wx", mode: 0o600 });
				await fs.rename(temporary, filePath);
			} finally {
				await fs.unlink(temporary).catch(() => undefined);
			}
			if (closed || !options.ownerAvailable(owner)) {
				await fs.unlink(filePath).catch(() => undefined);
				throw new Error("Sign-in return owner is unavailable.");
			}
			owned.set(flowId, { owner, verifierKey, record });
		});
		return async () => {
			if (owned.get(flowId)?.record === record) await release(flowId, owner);
		};
	}

	async function release(flowId: string, owner: Owner): Promise<void> {
		const flow = owned.get(flowId);
		if (!flow || flow.owner !== owner) return;
		await withAuthStorageTransaction(lockDirectory, async () => {
			await fs
				.unlink(path.join(recordsDirectory, recordName(flow.record)))
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
				});
			if (owned.get(flowId) === flow) owned.delete(flowId);
		});
	}

	async function route(rawUrl: string): Promise<FlowRelayResult> {
		const callback = parseFlowCallback(rawUrl, options.protocol);
		if (!callback) return "invalid";
		if (closed || !options.secureAvailable()) return "unavailable";
		try {
			if (owned.has(callback.flowId))
				return (await deliver(callback.flowId, callback.url)) ? "local" : "unavailable";
			const record = await withAuthStorageTransaction(lockDirectory, () =>
				lookup(callback.flowId),
			);
			if (!record || record.instance === instance) return "unavailable";
			return await new Promise<FlowRelayResult>((resolve) => {
				// A dead process's PID and port can be reused. Only the actual owner
				// can decrypt this envelope and prove it accepted the exact request.
				const envelope = encryptFlowCallback(record, callback.url);
				const payload = JSON.stringify(envelope);
				const request = httpRequest(
					{
						hostname: "127.0.0.1",
						port: record.port,
						method: "POST",
						path: "/v1/callback",
						headers: {
							"Content-Type": "application/json",
							"Content-Length": Buffer.byteLength(payload),
						},
					},
					(response) => {
						let body = "";
						response.on("data", (chunk) => {
							body += chunk;
							if (body.length > 256) response.destroy();
						});
						response.on("error", () => resolve("unavailable"));
						response.on("aborted", () => resolve("unavailable"));
						response.on("end", () => {
							try {
								const reply = JSON.parse(body);
								resolve(
									response.statusCode === 200 &&
										reply.accepted === true &&
										sameProof(
											reply.proof,
											acknowledgement(record, envelope, true),
										)
										? "forwarded"
										: "unavailable",
								);
							} catch {
								resolve("unavailable");
							}
						});
					},
				);
				request.setTimeout(5000, () => request.destroy());
				request.on("error", () => resolve("unavailable"));
				request.end(payload);
			});
		} catch {
			return "unavailable";
		}
	}

	async function close() {
		closed = true;
		server?.close();
		await Promise.all([...owned].map(([flowId, flow]) => release(flowId, flow.owner)));
	}

	return { register, release, route, close };
}
