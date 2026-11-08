import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http";
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

it.each([
	"decrypt",
	"JSON",
	"shape",
])("preserves unrelated %s failures while registering a new exact route", async (failure) => {
	const a = relay();
	const launcher = relay();
	const records = path.join(directory, "flows");
	await fs.mkdir(records, { recursive: true });
	const damagedId = "flow_broken";
	const damaged = path.join(records, `recordly.${damagedId}.${"a".repeat(32)}.enc`);
	const bytes =
		failure === "decrypt"
			? Buffer.from("unreadable ciphertext")
			: failure === "JSON"
				? encrypt("{invalid JSON")
				: encrypt(JSON.stringify({ version: 1, protocol: "recordly" }));
	await fs.writeFile(damaged, bytes);
	const current = owner("new-owner");
	await a.instance.register("flow_alice", "exact-verifier", current);
	expect(await launcher.instance.route(callback("flow_alice"))).toBe("forwarded");
	expect(a.deliver).toHaveBeenCalledExactlyOnceWith(current, callback("flow_alice"));
	expect(await launcher.instance.route(callback(damagedId))).toBe("unavailable");
	await expect(
		launcher.instance.register(damagedId, "must-not-replace", owner("other")),
	).rejects.toThrow("unlock");
	expect(await fs.readFile(damaged)).toEqual(bytes);
	expect(a.hasVerifier).toHaveBeenCalledExactlyOnceWith("exact-verifier");
	expect(launcher.deliver).not.toHaveBeenCalled();
});

it("counts unreadable generations toward the 128-route limit without deleting them", async () => {
	const a = relay();
	const launcher = relay();
	const records = path.join(directory, "flows");
	await fs.mkdir(records, { recursive: true });
	const bytes = Buffer.from("unreadable ciphertext");
	const files = Array.from({ length: 127 }, (_, n) =>
		path.join(records, `recordly.corrupt_${String(n).padStart(3, "0")}.${"a".repeat(32)}.enc`),
	);
	await Promise.all(files.map((file) => fs.writeFile(file, bytes)));
	await a.instance.register("flow_alice", "exact-verifier", owner("a"));
	expect(await fs.readdir(records)).toHaveLength(128);
	expect(await launcher.instance.route(callback("flow_alice"))).toBe("forwarded");
	await expect(
		launcher.instance.register("flow_bob00", "other-verifier", owner("b")),
	).rejects.toThrow("Too many sign-in return routes");
	expect(await fs.readdir(records)).toHaveLength(128);
	for (const file of files) expect(await fs.readFile(file)).toEqual(bytes);
});

it("still removes only readable proven-dead generations while preserving ancient live and unreadable records", async () => {
	const a = relay();
	const b = relay();
	await a.instance.register("flow_alice", "alice-verifier", owner("a"));
	const live = await record("flow_alice");
	const liveBytes = await fs.readFile(live.file);
	await fs.utimes(live.file, new Date(0), new Date(0));
	const deadPid = 2147483647;
	const deadNonce = "b".repeat(32);
	const deadRecord = { ...live.value, flowId: "flow_dead0", pid: deadPid, nonce: deadNonce };
	const deadFile = path.join(directory, "flows", `recordly.flow_dead0.${deadNonce}.enc`);
	await fs.writeFile(deadFile, encrypt(JSON.stringify(deadRecord)));
	const damaged = path.join(directory, "flows", `recordly.flow_broken.${"c".repeat(32)}.enc`);
	const damagedBytes = Buffer.from("unreadable ciphertext");
	await fs.writeFile(damaged, damagedBytes);
	const realKill = process.kill.bind(process);
	vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
		if (pid === deadPid)
			throw Object.assign(new Error("Exited fixture process"), { code: "ESRCH" });
		return realKill(pid, signal);
	});
	await b.instance.register("flow_bob00", "bob-verifier", owner("b"));
	await expect(fs.access(deadFile)).rejects.toMatchObject({ code: "ENOENT" });
	expect(await fs.readFile(live.file)).toEqual(liveBytes);
	expect(await fs.readFile(damaged)).toEqual(damagedBytes);
	expect(await b.instance.route(callback("flow_alice"))).toBe("forwarded");
});

async function foreignRoute(
	handler: (incoming: IncomingMessage, response: ServerResponse) => void,
) {
	const a = relay();
	const launcher = relay();
	await a.instance.register("flow_alice", "exact-verifier", owner("a"));
	const original = await record("flow_alice");
	const listener = createServer(handler);
	await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
	const address = listener.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture port");
	await fs.writeFile(
		original.file,
		encrypt(JSON.stringify({ ...original.value, port: address.port })),
	);
	return {
		a,
		launcher,
		value: original.value,
		close: async () => {
			listener.closeAllConnections();
			await new Promise<void>((resolve) => listener.close(() => resolve()));
		},
	};
}

it("bounds forwarding by five seconds even while an unrelated listener keeps sending response bytes", async () => {
	let received!: (response: ServerResponse) => void;
	const receiving = new Promise<ServerResponse>((resolve) => {
		received = resolve;
	});
	let observed = "";
	const fixture = await foreignRoute((incoming, response) => {
		incoming.on("data", (chunk) => {
			observed += chunk.toString();
		});
		incoming.on("end", () => {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.write("{");
			received(response);
		});
	});
	try {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const completed = vi.fn();
		const forwarding = fixture.launcher.instance
			.route(callback("flow_alice", "SLOW_PRIVATE_AUTH_CODE"))
			.then((result) => {
				completed(result);
				return result;
			});
		const response = await receiving;
		const disconnected = new Promise<void>((resolve) => response.once("close", resolve));
		for (let second = 0; second < 4; second++) {
			response.write(" ");
			await new Promise<void>((resolve) => setImmediate(resolve));
			await vi.advanceTimersByTimeAsync(1000);
			expect(completed).not.toHaveBeenCalled();
		}
		response.write(" ");
		await new Promise<void>((resolve) => setImmediate(resolve));
		await vi.advanceTimersByTimeAsync(999);
		expect(completed).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(completed).toHaveBeenCalledExactlyOnceWith("unavailable");
		expect(await forwarding).toBe("unavailable");
		await disconnected;
		expect(response.destroyed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(5000);
		expect(completed).toHaveBeenCalledOnce();
		expect(observed).not.toContain("SLOW_PRIVATE_AUTH_CODE");
		expect(observed).not.toContain(fixture.value.capability);
		expect(fixture.a.deliver).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
		await fixture.close();
	}
});

it.each([
	"aborted response",
	"invalid response",
	"oversized response",
	"request error",
])("clears the forwarding deadline after %s", async (failure) => {
	const fixture = await foreignRoute((incoming, response) => {
		if (failure === "request error") {
			incoming.socket.destroy();
			return;
		}
		incoming.resume();
		incoming.on("end", () => {
			response.writeHead(200, { "Content-Type": "application/json" });
			if (failure === "aborted response") {
				response.write("{");
				setImmediate(() => response.destroy());
			} else if (failure === "oversized response") response.write("x".repeat(257));
			else response.end("invalid JSON");
		});
	});
	try {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		expect(await fixture.launcher.instance.route(callback("flow_alice"))).toBe("unavailable");
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fixture.a.deliver).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
		await fixture.close();
	}
});

it("clears the forwarding deadline after a valid authenticated acknowledgement", async () => {
	const a = relay();
	const launcher = relay();
	await a.instance.register("flow_alice", "exact-verifier", owner("a"));
	try {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		expect(await launcher.instance.route(callback("flow_alice"))).toBe("forwarded");
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(5000);
		expect(a.deliver).toHaveBeenCalledOnce();
	} finally {
		vi.useRealTimers();
	}
});
