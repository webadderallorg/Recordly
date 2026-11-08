import { afterEach, beforeEach, expect, it, vi } from "vitest";

type AuthStorage = {
	getItem: (key: string) => Promise<string | null>;
	setItem: (key: string, value: string) => Promise<void>;
	removeItem: (key: string) => Promise<void>;
};
const captured = vi.hoisted(() => ({ storage: undefined as AuthStorage | undefined }));
vi.mock("@supabase/supabase-js", () => ({
	createClient: (_url: string, _key: string, options: { auth: { storage: AuthStorage } }) => {
		captured.storage = options.auth.storage;
		return { auth: {} };
	},
}));
const project = "sb-auth-auth-token";
let values: Map<string, string>;
let local: Storage;
function bridge() {
	return {
		authStorageAvailable: vi.fn(async () => true),
		authStorageMigrate: vi.fn(async (_snapshot: Record<string, string>) => undefined),
		authStorageGetItem: vi.fn(async (_key: string): Promise<string | null> => null),
		authStorageSetItem: vi.fn(async (_key: string, _value: string) => undefined),
		authStorageRemoveItem: vi.fn(async (_key: string) => undefined),
	};
}
async function storage(api?: Partial<ReturnType<typeof bridge>>) {
	vi.stubGlobal("window", api === undefined ? {} : { electronAPI: api });
	await import("./recordlyAuth");
	return captured.storage!;
}
beforeEach(() => {
	vi.resetModules();
	vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
	vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "public-key");
	values = new Map();
	local = {
		get length() {
			return values.size;
		},
		key: (index) => [...values.keys()][index] ?? null,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
		clear: () => values.clear(),
	};
	vi.stubGlobal("localStorage", local);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

it.each([
	"unavailable",
	"throws",
	"incomplete",
	"migration fails",
])("keeps desktop session and PKCE values only in memory when native storage %s", async (failure) => {
	const native = bridge();
	if (failure === "unavailable") native.authStorageAvailable.mockResolvedValue(false);
	if (failure === "throws")
		native.authStorageAvailable.mockRejectedValue(new Error("OS store locked"));
	if (failure === "migration fails")
		native.authStorageMigrate.mockRejectedValue(new Error("Could not unlock"));
	const flow = `${project}-flow-0123456789abcdef-code-verifier`;
	const owned = [
		project,
		`${project}-code-verifier`,
		`${project}-user`,
		`${project}-flows-code-verifier`,
		flow,
	];
	for (const key of owned) values.set(key, "legacy-plaintext");
	values.set("sb-other-auth-token", "other-project-session");
	values.set(`${project}-signup-consent-choice`, "consent");
	const auth = await storage(failure === "incomplete" ? {} : native);
	expect(await auth.getItem(project)).toBeNull();
	for (const key of owned) {
		expect(values.has(key)).toBe(false);
		await auth.setItem(key, "memory-only");
		expect(await auth.getItem(key)).toBe("memory-only");
		expect(values.has(key)).toBe(false);
		await auth.removeItem(key);
		expect(await auth.getItem(key)).toBeNull();
	}
	expect(values.get("sb-other-auth-token")).toBe("other-project-session");
	expect(values.get(`${project}-signup-consent-choice`)).toBe("consent");
	expect(native.authStorageSetItem).not.toHaveBeenCalled();
});

it("migrates recognized project sessions and pending flows into available native storage", async () => {
	const native = bridge();
	const legacy = {
		[project]: "legacy-session",
		[`${project}-flows-code-verifier`]: '["0123456789abcdef"]',
		[`${project}-flow-0123456789abcdef-code-verifier`]: '"verifier"',
	};
	for (const [key, value] of Object.entries(legacy)) values.set(key, value);
	values.set("sb-other-auth-token", "other");
	native.authStorageGetItem.mockResolvedValue("native-session");
	const auth = await storage(native);
	expect(await auth.getItem(project)).toBe("native-session");
	expect(native.authStorageMigrate).toHaveBeenCalledExactlyOnceWith(legacy);
	for (const key of Object.keys(legacy)) expect(values.has(key)).toBe(false);
	expect(values.get("sb-other-auth-token")).toBe("other");
	await auth.setItem(project, "new-session");
	await auth.removeItem(project);
	expect(native.authStorageSetItem).toHaveBeenCalledWith(project, "new-session");
	expect(native.authStorageRemoveItem).toHaveBeenCalledWith(project);
});

it("keeps normal browser-preview persistence when no desktop bridge exists", async () => {
	values.set(project, "browser-session");
	const auth = await storage();
	expect(await auth.getItem(project)).toBe("browser-session");
	await auth.setItem(project, "new-browser-session");
	expect(values.get(project)).toBe("new-browser-session");
	await auth.removeItem(project);
	expect(values.has(project)).toBe(false);
});

it("still supports desktop memory-only sign-in if browser storage is inaccessible", async () => {
	const native = bridge();
	native.authStorageAvailable.mockResolvedValue(false);
	const fail = () => {
		throw new Error("Storage blocked");
	};
	vi.stubGlobal("localStorage", {
		get length() {
			return fail();
		},
		getItem: fail,
		setItem: fail,
		removeItem: fail,
	});
	const auth = await storage(native);
	await auth.setItem(project, "memory-session");
	expect(await auth.getItem(project)).toBe("memory-session");
	await auth.removeItem(project);
	expect(await auth.getItem(project)).toBeNull();
});
