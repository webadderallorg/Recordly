import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { safeStorage } from "electron";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";

const native = vi.hoisted(() => ({
	directory: "",
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
	app: { getPath: () => native.directory, getAppPath: () => native.directory },
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => unknown) =>
			native.handlers.set(name, handler),
	},
	safeStorage: {
		isEncryptionAvailable: () => true,
		getSelectedStorageBackend: () => "test",
		encryptString: (value: string) => Buffer.from(value),
		decryptString: (value: Buffer) => value.toString(),
	},
}));
vi.mock("./rendererServer", () => ({
	getPackagedRendererBaseUrl: () => "http://127.0.0.1:49152/",
}));

const mainFrame = { url: "http://127.0.0.1:49152/?windowType=onboarding" };
const event = { senderFrame: mainFrame, sender: { mainFrame } };
const invoke = (name: string, ...args: unknown[]) =>
	native.handlers.get(`auth-storage:${name}`)!(event, ...args);

beforeEach(async () => {
	vi.resetModules();
	native.handlers.clear();
	native.directory = await fs.mkdtemp(path.join(os.tmpdir(), "recordly-auth-storage-"));
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers();
});
afterEach(async () => {
	await fs.rm(native.directory, { recursive: true, force: true });
});

it("does not check Keychain on macOS until there are credentials to store", async () => {
	const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
	Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
	const checkEncryption = vi.spyOn(safeStorage, "isEncryptionAvailable");
	onTestFinished(() => {
		checkEncryption.mockRestore();
		Object.defineProperty(process, "platform", platform);
	});
	const key = "sb-recordlytest-auth-token";
	expect(await invoke("available")).toBe(true);
	await invoke("migrate", {});
	expect(await invoke("get", key)).toBeNull();
	await invoke("remove", key);
	expect(checkEncryption).not.toHaveBeenCalled();
	checkEncryption.mockReturnValue(false);
	await expect(invoke("set", key, "session")).rejects.toThrow("Secure authentication storage");
	await expect(
		fs.stat(path.join(native.directory, "private-auth", "session.enc")),
	).rejects.toMatchObject({ code: "ENOENT" });
	checkEncryption.mockReturnValue(true);
	await invoke("set", key, "session");
	expect(await invoke("get", key)).toBe("session");
});

it("freshly reads another process's generation before reading, writing or migrating", async () => {
	const key = "sb-recordlytest-auth-token";
	await invoke("set", key, "old-session");
	const file = path.join(native.directory, "private-auth", "session.enc");
	await fs.writeFile(
		file,
		JSON.stringify({
			version: 1,
			entries: {
				[key]: "other-session",
				[`${key}-user`]: "other-user",
			},
		}),
	);
	expect(await invoke("get", key)).toBe("other-session");
	await invoke("migrate", { [key]: "stale-browser-session" });
	await invoke("set", `${key}-flow-worker000-code-verifier`, "new-verifier");
	expect(JSON.parse(await fs.readFile(file, "utf8")).entries).toEqual({
		[key]: "other-session",
		[`${key}-user`]: "other-user",
		[`${key}-flow-worker000-code-verifier`]: "new-verifier",
	});
	await fs.writeFile(file, "unreadable external generation");
	await expect(invoke("set", key, "must-not-replace")).rejects.toThrow("Could not unlock");
	expect(await fs.readFile(file, "utf8")).toBe("unreadable external generation");
});

it("keeps overlapping module instances and reads from replacing an in-flight writer's generation", async () => {
	const firstHandlers = new Map(native.handlers);
	const key = "sb-recordlytest-auth-token";
	const first = (name: string, ...args: unknown[]) =>
		firstHandlers.get(`auth-storage:${name}`)!(event, ...args);
	await first("set", key, "session");
	vi.resetModules();
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers();
	await invoke("get", key);
	let release!: () => void;
	let reached!: () => void;
	const held = new Promise<void>((resolve) => {
		reached = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const originalRename = fs.rename.bind(fs);
	const rename = vi
		.spyOn(fs, "rename")
		.mockImplementationOnce(async (oldPath, newPath) => {
			// The lock's choosing -> numbered publication is itself a rename.
			return originalRename(oldPath, newPath);
		})
		.mockImplementationOnce(async (oldPath, newPath) => {
			reached();
			await blocked;
			return originalRename(oldPath, newPath);
		});
	try {
		const writing = first("set", `${key}-user`, "first-user");
		await held;
		const reading = invoke("get", `${key}-user`);
		const secondWrite = invoke("set", `${key}-flow-worker000-code-verifier`, "verifier");
		release();
		await writing;
		expect(await reading).toBe("first-user");
		await secondWrite;
		expect(await first("get", `${key}-flow-worker000-code-verifier`)).toBe("verifier");
		expect(await first("get", `${key}-user`)).toBe("first-user");
	} finally {
		release();
		rename.mockRestore();
	}
});

it("persists the installed Supabase SDK's concurrent OAuth verifiers across a main-process restart", async () => {
	const storageKey = "sb-recordlytest-auth-token";
	const client = createClient("https://recordlytest.supabase.co", "test-publishable-key", {
		auth: {
			storageKey,
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
			flowType: "pkce",
			storage: {
				getItem: async (key) => (await invoke("get", key)) as string | null,
				setItem: async (key, value) => {
					await invoke("set", key, value);
				},
				removeItem: async (key) => {
					await invoke("remove", key);
				},
			},
		},
	});
	for (let i = 0; i < 7; i++) {
		const result = await client.auth.signInWithOAuth({
			provider: "google",
			options: { redirectTo: "recordly://auth/callback", skipBrowserRedirect: true },
		});
		expect(result.error).toBeNull();
		expect(result.data.url).toContain("code_challenge=");
	}
	await invoke("set", storageKey, "session-fixture");
	await invoke("set", `${storageKey}-user`, "user-fixture");
	await invoke("set", `${storageKey}-completed-callback`, "a".repeat(64));
	for (const letter of ["a", "b", "c", "d", "e"])
		await invoke("set", `${storageKey}-signup-consent-${letter.repeat(43)}`, "{}");
	const nextFlow = await client.auth.signInWithOAuth({
		provider: "apple",
		options: { redirectTo: "recordly://auth/callback", skipBrowserRedirect: true },
	});
	expect(nextFlow.error).toBeNull();
	expect(await invoke("get", storageKey)).toBe("session-fixture");
	expect(await invoke("get", `${storageKey}-user`)).toBe("user-fixture");
	const indexKey = `${storageKey}-flows-code-verifier`;
	const flows = JSON.parse((await invoke("get", indexKey)) as string) as string[];
	expect(flows).toHaveLength(5);
	const key = `${storageKey}-flow-${flows[0]}-code-verifier`;
	const verifier = await invoke("get", key);
	expect(verifier).toBeTruthy();
	vi.resetModules();
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers();
	expect(await invoke("get", key)).toBe(verifier);
	await invoke("remove", key);
	expect(await invoke("get", key)).toBeNull();
});

it("binds the installed SDK's actual redirect flow ID to its trusted initiating storage sender", async () => {
	const prepared = vi.fn(async (_event: unknown, _key: string) => undefined);
	const removed = vi.fn(async () => undefined);
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers({ prepareSet: prepared, didRemove: removed });
	const storageKey = "sb-recordlytest-auth-token";
	const client = createClient("https://recordlytest.supabase.co", "public-fixture", {
		auth: {
			storageKey,
			flowType: "pkce",
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
			experimental: { appendPkceFlowIdToRedirects: true },
			storage: {
				getItem: async (key) => (await invoke("get", key)) as string | null,
				setItem: async (key, value) => {
					await invoke("set", key, value);
				},
				removeItem: async (key) => {
					await invoke("remove", key);
				},
			},
		},
	});
	const result = await client.auth.signInWithOAuth({
		provider: "apple",
		options: {
			redirectTo: "recordly://auth/callback",
			skipBrowserRedirect: true,
		},
	});
	expect(result.error).toBeNull();
	const redirect = new URL(new URL(result.data.url!).searchParams.get("redirect_to")!);
	const flowId = redirect.searchParams.get("sb_flow_id");
	expect(flowId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
	expect(prepared).toHaveBeenCalledWith(
		event,
		`${storageKey}-flow-${flowId}-code-verifier`,
		expect.any(Array),
	);
	expect(await invoke("get", `${storageKey}-flow-${flowId}-code-verifier`)).toBeTruthy();
	await invoke("remove", `${storageKey}-flow-${flowId}-code-verifier`);
	expect(removed).toHaveBeenCalledWith(event, `${storageKey}-flow-${flowId}-code-verifier`);
});

it("rolls back new return-route registration after failed writes and tolerates cleanup failure after verifier removal", async () => {
	const rollback = vi.fn(async () => undefined);
	const prepare = vi.fn(async () => rollback);
	const removed = vi.fn(async () => {
		throw new Error("Optional route cleanup busy");
	});
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers({ prepareSet: prepare, didRemove: removed });
	const key = "sb-recordlytest-auth-token-flow-worker000-code-verifier";
	const encrypt = vi.spyOn(safeStorage, "encryptString").mockImplementationOnce(() => {
		throw new Error("Save failed");
	});
	try {
		await expect(invoke("set", key, '"verifier"')).rejects.toThrow("Save failed");
		expect(rollback).toHaveBeenCalledOnce();
		expect(await invoke("get", key)).toBeNull();
		await invoke("set", key, '"verifier"');
		await expect(invoke("remove", key)).resolves.toBeUndefined();
		expect(await invoke("get", key)).toBeNull();
	} finally {
		encrypt.mockRestore();
	}
});

it.each([
	"unrelated-key",
	"sb-recordlytest-auth-token-flow-short-code-verifier",
	`sb-recordlytest-auth-token-flow-${"x".repeat(65)}-code-verifier`,
	"sb-recordlytest-auth-token-flow-../../secret-code-verifier",
])("rejects unsupported authentication keys: %s", (key) => {
	expect(() => invoke("set", key, "value")).toThrow("Invalid authentication storage key");
});

it("continues rejecting a child frame even for a valid PKCE key", () => {
	expect(() =>
		native.handlers.get("auth-storage:set")!(
			{
				senderFrame: { url: mainFrame.url },
				sender: { mainFrame },
			},
			"sb-recordlytest-auth-token-flows-code-verifier",
			"[]",
		),
	).toThrow("main frame");
});

it("bounds pending acknowledgement records without evicting sessions or PKCE verifiers", async () => {
	const storageKey = "sb-recordlytest-auth-token";
	const verifierKey = `${storageKey}-flow-0123456789abcdef-code-verifier`;
	await invoke("set", storageKey, "session-fixture");
	await invoke("set", verifierKey, '"verifier-fixture"');
	for (const letter of ["a", "b", "c", "d", "e", "f"]) {
		await invoke(
			"set",
			`${storageKey}-signup-consent-${letter.repeat(43)}`,
			JSON.stringify({ legal_accepted: true }),
		);
	}
	expect(await invoke("get", `${storageKey}-signup-consent-${"a".repeat(43)}`)).toBeNull();
	for (const letter of ["b", "c", "d", "e", "f"])
		expect(
			await invoke("get", `${storageKey}-signup-consent-${letter.repeat(43)}`),
		).toBeTruthy();
	expect(await invoke("get", storageKey)).toBe("session-fixture");
	expect(await invoke("get", verifierKey)).toBe('"verifier-fixture"');
});

it.each([
	"sb-recordlytest-auth-token-signup-consent-short",
	`sb-recordlytest-auth-token-signup-consent-${"a".repeat(44)}`,
	"sb-recordlytest-auth-token-signup-consent-../../private-file",
])("rejects malformed pending acknowledgement key %s", (key) => {
	expect(() => invoke("set", key, "value")).toThrow("Invalid authentication storage key");
});

it("rejects oversized acknowledgement metadata without replacing authentication entries", async () => {
	const key = `sb-recordlytest-auth-token-signup-consent-${"a".repeat(43)}`;
	expect(() => invoke("set", key, "x".repeat(8193))).toThrow("acknowledgement is too large");
	expect(await invoke("get", key)).toBeNull();
});

it.each([
	"raw-code",
	"recordly://auth/callback?code=private",
	"a".repeat(63),
	"a".repeat(65),
])("rejects non-fingerprint callback bookkeeping: %s", (value) => {
	expect(() => invoke("set", "sb-recordlytest-auth-token-completed-callback", value)).toThrow(
		"Invalid completed callback fingerprint",
	);
});

it("keeps one completion marker in memory when optional persistence fails", async () => {
	const key = "sb-recordlytest-auth-token-completed-callback";
	await invoke("set", "sb-recordlytest-auth-token", "session-fixture");
	const encrypt = vi.spyOn(safeStorage, "encryptString").mockImplementationOnce(() => {
		throw new Error("Temporary storage failure");
	});
	try {
		await expect(invoke("set", key, "b".repeat(64))).rejects.toThrow(
			"Temporary storage failure",
		);
		expect(await invoke("get", key)).toBe("b".repeat(64));
		expect(await invoke("get", "sb-recordlytest-auth-token")).toBe("session-fixture");
	} finally {
		encrypt.mockRestore();
	}
});

it("keeps only the latest project completion marker without evicting credentials", async () => {
	const first = "sb-first-auth-token-completed-callback";
	const second = "sb-second-auth-token-completed-callback";
	await invoke("set", "sb-first-auth-token", "session-fixture");
	await invoke("set", first, "a".repeat(64));
	await invoke("set", second, "b".repeat(64));
	expect(await invoke("get", first)).toBeNull();
	expect(await invoke("get", second)).toBe("b".repeat(64));
	expect(await invoke("get", "sb-first-auth-token")).toBe("session-fixture");
});

it("stores a bounded encrypted consent retry receipt independently of per-flow acknowledgements", async () => {
	const key = "sb-recordlytest-auth-token-signup-consent-retry:account-a";
	const receipt = JSON.stringify([{ userId: "account-a", metadata: { legal_accepted: true } }]);
	await invoke("set", key, receipt);
	expect(await invoke("get", key)).toBe(receipt);
	expect(() => invoke("set", key, "x".repeat(8193))).toThrow("acknowledgement is too large");
	expect(await invoke("get", key)).toBe(receipt);
	await invoke("remove", key);
	expect(await invoke("get", key)).toBeNull();
});

it("bounds per-account consent retries without evicting sessions, verifiers, or flow acknowledgements", async () => {
	const prefix = "sb-recordlytest-auth-token";
	const entries = new Map<string, string>([
		[prefix, "session"],
		[`${prefix}-user`, "user"],
		[`${prefix}-code-verifier`, "legacy-verifier"],
		[`${prefix}-flows-code-verifier`, "flow-index"],
		[`${prefix}-completed-callback`, "a".repeat(64)],
	]);
	for (let n = 0; n < 5; n++) {
		entries.set(`${prefix}-flow-pending0${n}-code-verifier`, `verifier-${n}`);
		entries.set(
			`${prefix}-signup-consent-${String.fromCharCode(97 + n).repeat(43)}`,
			`consent-${n}`,
		);
	}
	for (const [key, value] of entries) await invoke("set", key, value);
	for (let n = 0; n < 6; n++)
		await invoke("set", `${prefix}-signup-consent-retry:account-${n}`, `retry-${n}`);
	expect(await invoke("get", `${prefix}-signup-consent-retry:account-0`)).toBeNull();
	for (let n = 1; n < 6; n++)
		expect(await invoke("get", `${prefix}-signup-consent-retry:account-${n}`)).toBe(
			`retry-${n}`,
		);
	for (const [key, value] of entries) {
		if (key === `${prefix}-flows-code-verifier`)
			expect(JSON.parse((await invoke("get", key)) as string)).toEqual([
				"pending00",
				"pending01",
				"pending02",
				"pending03",
				"pending04",
			]);
		else expect(await invoke("get", key)).toBe(value);
	}
	// Repair is read-only: the original bookkeeping value was not replaced.
	expect(
		JSON.parse(
			await fs.readFile(path.join(native.directory, "private-auth/session.enc"), "utf8"),
		).entries[`${prefix}-flows-code-verifier`],
	).toBe("flow-index");
});

it.each([
	"sb-recordlytest-auth-token-signup-consent-retry:",
	"sb-recordlytest-auth-token-signup-consent-retry:../other",
	`sb-recordlytest-auth-token-signup-consent-retry:${"a".repeat(129)}`,
	"sb-recordlytest-auth-token-signup-consent-retry",
])("rejects an unbounded or unscoped consent retry key %s", (key) => {
	expect(() => invoke("set", key, "value")).toThrow("Invalid authentication storage key");
});

it("fails closed on an externally corrupted retry count without replacing the encrypted store", async () => {
	const prefix = "sb-recordlytest-auth-token";
	await invoke("set", prefix, "saved-session");
	const file = path.join(native.directory, "private-auth", "session.enc");
	const corrupt = JSON.stringify({
		version: 1,
		entries: {
			[prefix]: "saved-session",
			...Object.fromEntries(
				Array.from({ length: 6 }, (_, n) => [
					`${prefix}-signup-consent-retry:account-${n}`,
					"receipt",
				]),
			),
		},
	});
	await fs.writeFile(file, corrupt);
	await expect(invoke("set", prefix, "must-not-replace")).rejects.toThrow("Could not unlock");
	expect(await fs.readFile(file, "utf8")).toBe(corrupt);
});

it("repairs a lost flow-index update from exact persisted slots without deleting active verifiers", async () => {
	const prefix = "sb-recordlytest-auth-token";
	const first = `${prefix}-flow-flow_alice-code-verifier`;
	const second = `${prefix}-flow-flow_bob00-code-verifier`;
	const other = "sb-other-auth-token-flow-flow_other-code-verifier";
	await invoke("set", first, '"alice-verifier"');
	await invoke("set", second, '"bob-verifier"');
	await invoke("set", other, '"other-verifier"');
	await invoke(
		"set",
		`${prefix}-flows-code-verifier`,
		JSON.stringify(["flow_bob00", "flow_absent", "flow_bob00"]),
	);
	expect(JSON.parse((await invoke("get", `${prefix}-flows-code-verifier`)) as string)).toEqual([
		"flow_bob00",
		"flow_alice",
	]);
	expect(await invoke("get", first)).toBe('"alice-verifier"');
	expect(await invoke("get", second)).toBe('"bob-verifier"');
	expect(await invoke("get", other)).toBe('"other-verifier"');
	await invoke("set", `${prefix}-flows-code-verifier`, "invalid JSON");
	expect(JSON.parse((await invoke("get", `${prefix}-flows-code-verifier`)) as string)).toEqual([
		"flow_alice",
		"flow_bob00",
	]);
});

it("keeps nested project namespaces out of another project's repaired flow index", async () => {
	const prefix = "sb-a-auth-token";
	const nestedPrefix = `${prefix}-flow-nested-auth-token`;
	const ownKey = `${prefix}-flow-current0-code-verifier`;
	const nestedKey = `${nestedPrefix}-flow-abcdefgh-code-verifier`;
	await invoke("set", ownKey, '"own-verifier"');
	await invoke("set", nestedKey, '"nested-project-verifier"');
	// The broad flow-ID grammar could treat this whole suffix as one ID. Use
	// the same full greedy project-prefix parser as native route ownership.
	await invoke(
		"set",
		`${prefix}-flows-code-verifier`,
		JSON.stringify(["current0", "nested-auth-token-flow-abcdefgh"]),
	);
	expect(JSON.parse((await invoke("get", `${prefix}-flows-code-verifier`)) as string)).toEqual([
		"current0",
	]);
	expect(
		JSON.parse((await invoke("get", `${nestedPrefix}-flows-code-verifier`)) as string),
	).toEqual(["abcdefgh"]);
	expect(await invoke("get", nestedKey)).toBe('"nested-project-verifier"');
	expect(await invoke("get", ownKey)).toBe('"own-verifier"');
});

it("does not register against an empty snapshot when saved auth cannot be read", async () => {
	const prepare = vi.fn(async () => undefined);
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers({ prepareSet: prepare, didRemove: async () => undefined });
	const prefix = "sb-recordlytest-auth-token";
	await invoke("set", prefix, "session");
	prepare.mockClear();
	const file = path.join(native.directory, "private-auth/session.enc");
	await fs.writeFile(file, "corrupt saved credentials");
	await expect(
		invoke("set", `${prefix}-flow-flow_alice-code-verifier`, '"verifier"'),
	).rejects.toThrow("Could not unlock");
	expect(prepare).not.toHaveBeenCalled();
	expect(await fs.readFile(file, "utf8")).toBe("corrupt saved credentials");
});

it("holds the local registration queue through verifier commit before providing the next snapshot", async () => {
	const prepare = vi.fn(
		async (_event: unknown, _key: string, _keys?: readonly string[]) => undefined,
	);
	const { registerAuthStorageHandlers } = await import("./authStorage");
	registerAuthStorageHandlers({ prepareSet: prepare, didRemove: async () => undefined });
	const firstKey = "sb-recordlytest-auth-token-flow-flow_alice-code-verifier";
	const secondKey = "sb-recordlytest-auth-token-flow-flow_bob00-code-verifier";
	let release!: () => void;
	let entered!: () => void;
	const committing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	const rename = fs.rename.bind(fs);
	let paused = false;
	vi.spyOn(fs, "rename").mockImplementation(async (...args) => {
		if (
			!paused &&
			String(args[1]) === path.join(native.directory, "private-auth/session.enc")
		) {
			paused = true;
			entered();
			await held;
		}
		return rename(...args);
	});
	const first = invoke("set", firstKey, '"alice-verifier"');
	await committing;
	const second = invoke("set", secondKey, '"bob-verifier"');
	try {
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(prepare).toHaveBeenCalledOnce();
		expect(prepare.mock.calls[0][2]).toEqual([]);
		release();
		await Promise.all([first, second]);
		expect(prepare.mock.calls[1][2]).toContain(firstKey);
		expect(await invoke("get", firstKey)).toBe('"alice-verifier"');
	} finally {
		release();
		await Promise.allSettled([first, second]);
	}
});

it.each([
	"same-client",
	"two-renderers",
])("keeps actual SDK concurrent starts in the native effective index (%s)", async (mode) => {
	const prefix = "sb-recordlytest-auth-token",
		indexKey = `${prefix}-flows-code-verifier`;
	let held = false,
		reads = 0,
		release!: () => void,
		gate: Promise<void>;
	const makeClient = () =>
		createClient("https://recordlytest.supabase.co", "public-fixture", {
			auth: {
				storageKey: prefix,
				flowType: "pkce",
				persistSession: true,
				autoRefreshToken: false,
				detectSessionInUrl: false,
				experimental: { appendPkceFlowIdToRedirects: true },
				storage: {
					getItem: async (key) => {
						const snapshot = (await invoke("get", key)) as string | null;
						if (held && key === indexKey) {
							if (++reads === 2) {
								held = false;
								release();
							}
							await gate;
						}
						return snapshot;
					},
					setItem: async (key, value) => {
						await invoke("set", key, value);
					},
					removeItem: async (key) => {
						await invoke("remove", key);
					},
				},
			},
		});
	const a = makeClient(),
		b = mode === "same-client" ? a : makeClient();
	await Promise.all([a.auth.initialize(), b.auth.initialize()]);
	for (let pair = 0; pair < 5; pair++) {
		reads = 0;
		gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		held = true;
		const results = await Promise.all(
			[a, b].map((client) =>
				client.auth.signInWithOAuth({
					provider: "apple",
					options: { redirectTo: "recordly://auth/callback", skipBrowserRedirect: true },
				}),
			),
		);
		expect(results.every((result) => result.error === null)).toBe(true);
		const entries = JSON.parse(
			await fs.readFile(path.join(native.directory, "private-auth/session.enc"), "utf8"),
		).entries;
		const slots = Object.keys(entries).filter((key) => key.startsWith(`${prefix}-flow-`));
		const index = JSON.parse((await invoke("get", indexKey)) as string);
		expect(index).toHaveLength(slots.length);
		expect(index.length).toBeLessThanOrEqual(5);
		for (const key of slots)
			expect(index).toContain(key.slice(`${prefix}-flow-`.length, -"-code-verifier".length));
	}
});
