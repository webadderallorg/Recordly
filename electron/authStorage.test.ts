import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
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
