import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, request } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuthFlowRelay, encryptFlowCallback, parseFlowCallback } from "./authFlowRelay";

type Owner = { id: string; alive: boolean; allowed: boolean };
let directory: string;
const relays: ReturnType<typeof createAuthFlowRelay<Owner>>[] = [];
const key = randomBytes(32);
function encrypt(value: string): Buffer {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
}
function decrypt(value: Buffer): string {
	const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
	decipher.setAuthTag(value.subarray(-16));
	return Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString(
		"utf8",
	);
}
const callback = (id: string, code = "private-code") =>
	`recordly://auth/callback?code=${code}&sb_flow_id=${id}`;
const owner = (id: string): Owner => ({ id, alive: true, allowed: true });

beforeEach(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-auth-relay-"));
});
afterEach(async () => {
	await Promise.all(relays.splice(0).map((relay) => relay.close()));
	vi.restoreAllMocks();
	await fs.rm(directory, { recursive: true, force: true });
});

function relay() {
	const deliver = vi.fn((_owner: Owner, _url: string) => true);
	const hasVerifier = vi.fn(async (_key: string) => true);
	const secureAvailable = vi.fn(() => true);
	const instance = createAuthFlowRelay({
		directory,
		protocol: "recordly",
		secureAvailable,
		encrypt,
		decrypt,
		ownerAvailable: (candidate: Owner) => candidate.alive && candidate.allowed,
		hasVerifier,
		deliver,
	});
	relays.push(instance);
	return { instance, deliver, hasVerifier, secureAvailable };
}

async function record(flowId: string) {
	const names = await fs.readdir(path.join(directory, "flows"));
	const name = names.find((name) => name.startsWith(`recordly.${flowId}.`))!;
	const file = path.join(directory, "flows", name);
	return { file, value: JSON.parse(decrypt(await fs.readFile(file))) };
}

function post(
	port: number,
	body: string,
	headers: Record<string, string>,
	method = "POST",
	requestPath = "/v1/callback",
): Promise<number> {
	return new Promise((resolve, reject) => {
		const outgoing = request(
			{
				hostname: "127.0.0.1",
				port,
				method,
				path: requestPath,
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(Buffer.byteLength(body)),
					...headers,
				},
			},
			(response) => {
				response.resume();
				response.on("end", () => resolve(response.statusCode!));
			},
		);
		outgoing.on("error", reject);
		outgoing.end(body);
	});
}

it("routes simultaneous flows from a third controller only to each exact owner", async () => {
	const a = relay();
	const b = relay();
	const launcher = relay();
	const alice = owner("alice");
	const bob = owner("bob");
	await a.instance.register("flow_alice", "alice-verifier", alice);
	await b.instance.register("flow_bob00", "bob-verifier", bob);
	expect(
		await Promise.all([
			launcher.instance.route(callback("flow_bob00", "bob-private")),
			launcher.instance.route(callback("flow_alice", "alice-private")),
		]),
	).toEqual(["forwarded", "forwarded"]);
	expect(a.deliver).toHaveBeenCalledExactlyOnceWith(
		alice,
		callback("flow_alice", "alice-private"),
	);
	expect(b.deliver).toHaveBeenCalledExactlyOnceWith(bob, callback("flow_bob00", "bob-private"));
	expect(a.hasVerifier).toHaveBeenCalledWith("alice-verifier");
	expect(b.hasVerifier).toHaveBeenCalledWith("bob-verifier");
	expect(launcher.deliver).not.toHaveBeenCalled();
	for (const name of await fs.readdir(path.join(directory, "flows"))) {
		const bytes = await fs.readFile(path.join(directory, "flows", name));
		expect(bytes.toString()).not.toMatch(/private|verifier|callback/);
		const metadata = JSON.parse(decrypt(bytes));
		expect(Object.keys(metadata).sort()).toEqual([
			"capability",
			"flowId",
			"instance",
			"nonce",
			"pid",
			"port",
			"protocol",
			"version",
		]);
	}
});

it("does not try a different verifier for unknown or missing exact flows", async () => {
	const a = relay();
	const launcher = relay();
	await a.instance.register("flow_alice", "exact-verifier", owner("a"));
	a.hasVerifier.mockResolvedValue(false);
	expect(await launcher.instance.route(callback("flow_alice"))).toBe("unavailable");
	expect(await launcher.instance.route(callback("unknown00"))).toBe("unavailable");
	expect(await launcher.instance.route("recordly://auth/callback?code=unmatched")).toBe(
		"invalid",
	);
	expect(a.hasVerifier).toHaveBeenCalledExactlyOnceWith("exact-verifier");
	expect(a.deliver).not.toHaveBeenCalled();
	expect(launcher.hasVerifier).not.toHaveBeenCalled();
});

it("requires authenticated queued acceptance before returning a successful handoff", async () => {
	const a = relay();
	const launcher = relay();
	await a.instance.register("flow_alice", "exact-verifier", owner("a"));
	a.deliver.mockReturnValue(false);
	expect(await launcher.instance.route(callback("flow_alice"))).toBe("unavailable");
	a.deliver.mockReturnValue(true);
	expect(await launcher.instance.route(callback("flow_alice"))).toBe("forwarded");
});

it("rechecks a destroyed or foreign owner after asynchronously reading its verifier", async () => {
	const a = relay();
	const current = owner("a");
	await a.instance.register("flow_alice", "exact-verifier", current);
	let release!: (value: boolean) => void;
	a.hasVerifier.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const pending = a.instance.route(callback("flow_alice"));
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	current.alive = false;
	release(true);
	expect(await pending).toBe("unavailable");
	expect(a.deliver).not.toHaveBeenCalled();
	current.alive = true;
	current.allowed = false;
	expect(await a.instance.route(callback("flow_alice"))).toBe("unavailable");
});

it("keeps a live flow valid despite a changed clock and releases only its own generation", async () => {
	const a = relay();
	const b = relay();
	const current = owner("a");
	const oldRollback = await a.instance.register("flow_alice", "a-verifier", current);
	await b.instance.register("flow_bob00", "b-verifier", owner("b"));
	const old = await record("flow_alice");
	await fs.utimes(old.file, new Date(0), new Date(0));
	vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
	expect(await b.instance.route(callback("flow_alice"))).toBe("forwarded");
	await a.instance.release("flow_alice", current);
	await a.instance.register("flow_alice", "a-verifier", current);
	const next = await record("flow_alice");
	expect(next.file).not.toBe(old.file);
	await oldRollback();
	expect(await b.instance.route(callback("flow_alice"))).toBe("forwarded");
	await a.instance.close();
	expect(await b.instance.route(callback("flow_bob00"))).toBe("local");
	expect(await b.instance.route(callback("flow_alice"))).toBe("unavailable");
});

it.each([
	"wrong capability",
	"origin",
	"host",
	"method",
	"path",
	"oversized",
	"duplicate flow",
	"tampered flow",
	"tampered request",
])("rejects %s without delivering codes", async (variant) => {
	const a = relay();
	await a.instance.register("flow_alice", "verifier", owner("a"));
	const { value } = await record("flow_alice");
	const headers: Record<string, string> = {};
	const envelope = encryptFlowCallback(
		variant === "wrong capability" ? { ...value, capability: "b".repeat(32) } : value,
		variant === "duplicate flow"
			? `${callback("flow_alice")}&sb_flow_id=flow_bob00`
			: callback("flow_alice"),
	);
	if (variant === "tampered flow") envelope.flowId = "flow_bob00";
	if (variant === "tampered request") envelope.requestId = "b".repeat(32);
	let body = JSON.stringify(envelope);
	if (variant === "origin") headers.Origin = "https://attacker.example";
	if (variant === "host") headers.Host = "attacker.example";
	if (variant === "oversized") body = "x".repeat(16385);
	const status = await post(
		value.port,
		body,
		headers,
		variant === "method" ? "OPTIONS" : "POST",
		variant === "path" ? "/other" : "/v1/callback",
	);
	expect(status).toBeGreaterThanOrEqual(400);
	expect(a.deliver).not.toHaveBeenCalled();
	expect(a.hasVerifier).not.toHaveBeenCalled();
});

it("keeps code and capability secret from a stale-live-PID port's unrelated listener and rejects its forged ACK", async () => {
	const a = relay();
	const launcher = relay();
	await a.instance.register("flow_alice", "verifier", owner("a"));
	const { file, value } = await record("flow_alice");
	let observed = "";
	const unrelated = createServer(async (incoming, response) => {
		observed = JSON.stringify(incoming.headers);
		for await (const chunk of incoming) observed += chunk.toString();
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ accepted: true, proof: "0".repeat(64) }));
	});
	await new Promise<void>((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
	try {
		const address = unrelated.address();
		if (!address || typeof address === "string") throw new Error("Missing fixture port");
		// PID reuse is conservatively live; an old ephemeral port may be unrelated.
		await fs.writeFile(
			file,
			encrypt(JSON.stringify({ ...value, pid: process.pid, port: address.port })),
		);
		expect(await launcher.instance.route(callback("flow_alice", "HIGHLY_PRIVATE_CODE"))).toBe(
			"unavailable",
		);
		expect(observed).not.toContain("HIGHLY_PRIVATE_CODE");
		expect(observed).not.toContain(value.capability);
		expect(observed).not.toContain("Bearer");
		expect(observed).not.toContain("recordly://auth/callback");
		expect(a.deliver).not.toHaveBeenCalled();
		await fs.writeFile(file, encrypt(JSON.stringify(value)));
		expect(await launcher.instance.route(callback("flow_alice"))).toBe("forwarded");
	} finally {
		await new Promise<void>((resolve) => unrelated.close(() => resolve()));
	}
});

it("does not overwrite encrypted malformed or unknown-live registry metadata", async () => {
	const a = relay();
	const b = relay();
	await a.instance.register("flow_alice", "verifier", owner("a"));
	const { file, value } = await record("flow_alice");
	const malformed = encrypt(JSON.stringify({ ...value, pid: 0 }));
	await fs.writeFile(file, malformed);
	expect(await b.instance.route(callback("flow_alice"))).toBe("unavailable");
	await expect(b.instance.register("flow_alice", "other", owner("b"))).rejects.toThrow("unlock");
	expect(await fs.readFile(file)).toEqual(malformed);
});

it("rejects ownership takeover and concurrent registrations beyond the fixed bound", async () => {
	const a = relay();
	const current = owner("a");
	await a.instance.register("flow_alice", "verifier", current);
	await expect(a.instance.register("flow_alice", "verifier", owner("b"))).rejects.toThrow(
		"another window",
	);
	const attempts = await Promise.allSettled(
		Array.from({ length: 10 }, (_, index) =>
			a.instance.register(`flow_num${index}`, "verifier", current),
		),
	);
	expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(7);
	expect(await fs.readdir(path.join(directory, "flows"))).toHaveLength(8);
});

it("prevents registration or routing when secure storage is unavailable", async () => {
	const a = relay();
	a.secureAvailable.mockReturnValue(false);
	await expect(a.instance.register("flow_alice", "verifier", owner("a"))).rejects.toThrow(
		"Secure",
	);
	expect(await a.instance.route(callback("flow_alice"))).toBe("unavailable");
	await expect(fs.access(path.join(directory, "flows"))).rejects.toMatchObject({
		code: "ENOENT",
	});
});

it.each([
	"recordly://auth/callback?code=a",
	"recordly://auth/callback?code=a&sb_flow_id=../escape",
	"recordly://auth/callback?code=a&sb_flow_id=flow_alice&sb_flow_id=flow_bob00",
	"recordly://auth/callback?code=a&code=b&sb_flow_id=flow_alice",
	"recordly://auth/callback?code=a&error=denied&sb_flow_id=flow_alice",
	"recordly://auth/callback?code=a&sb_flow_id=flow_alice#private",
	"recordly://user:password@auth/callback?code=a&sb_flow_id=flow_alice",
	"https://auth/callback?code=a&sb_flow_id=flow_alice",
])("rejects invalid callback before registry/relay lookup: %s", (url) => {
	expect(parseFlowCallback(url, "recordly")).toBeNull();
});
