import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { safeStorage } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

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
	expect(prepared).toHaveBeenCalledWith(event, `${storageKey}-flow-${flowId}-code-verifier`);
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
