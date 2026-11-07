import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	type CachedCloudUsage,
	readUsageCache,
	usageCacheKey,
	writeUsageCache,
} from "./usageCache";

const endpoint = "https://share.example.test";
const snapshot: CachedCloudUsage = {
	version: 1,
	updatedAt: 1_800_000_000_000,
	plan: "free",
	usage: { recordings: 2, storageBytes: 450, recordingLimit: 5, storageLimitBytes: null },
};
let values: Map<string, string>;
beforeEach(() => {
	values = new Map();
	vi.spyOn(Date, "now").mockReturnValue(snapshot.updatedAt);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("persists usage for a later renderer without sharing it across accounts or services", () => {
	writeUsageCache(endpoint, "first", snapshot);
	expect(readUsageCache(endpoint, "first")).toEqual(snapshot);
	expect(readUsageCache(endpoint, "second")).toBeNull();
	expect(readUsageCache("https://other.example.test", "first")).toBeNull();
});

it.each([
	"not json",
	JSON.stringify(null),
	JSON.stringify({ ...snapshot, version: 2 }),
	JSON.stringify({ ...snapshot, usage: { ...snapshot.usage, recordings: -1 } }),
	JSON.stringify({ ...snapshot, usage: { ...snapshot.usage, storageBytes: 1.5 } }),
	JSON.stringify({
		...snapshot,
		plan: "pro",
		usage: { ...snapshot.usage, recordingLimit: null, storageLimitBytes: -1 },
	}),
])("ignores corrupt, incompatible or invalid saved metrics: %s", (raw) => {
	values.set(usageCacheKey(endpoint, "first"), raw);
	expect(readUsageCache(endpoint, "first")).toBeNull();
});

it("rejects expired and future-dated snapshots", () => {
	writeUsageCache(endpoint, "first", {
		...snapshot,
		updatedAt: snapshot.updatedAt - 31 * 86400_000,
	});
	expect(readUsageCache(endpoint, "first")).toBeNull();
	writeUsageCache(endpoint, "first", { ...snapshot, updatedAt: snapshot.updatedAt + 3600_000 });
	expect(readUsageCache(endpoint, "first")).toBeNull();
});

it.each([null, 1e11])("reads only display metrics from a Cloud snapshot with limit %s", (storageLimitBytes) => {
	values.set(
		usageCacheKey(endpoint, "first"),
		JSON.stringify({
			...snapshot,
			plan: "pro",
			billing: { checkoutAvailable: true },
			usage: { ...snapshot.usage, recordingLimit: null, storageLimitBytes },
		}),
	);
	const cached = readUsageCache(endpoint, "first");
	expect(cached?.plan).toBe("pro");
	expect(cached).not.toHaveProperty("billing");
	expect(Object.keys(cached?.usage ?? {})).toEqual([
		"recordings",
		"storageBytes",
		"recordingLimit",
		"storageLimitBytes",
	]);
});

it("tolerates disabled or full local storage", () => {
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("disabled");
		},
		setItem: () => {
			throw new Error("full");
		},
	});
	expect(readUsageCache(endpoint, "first")).toBeNull();
	expect(() => writeUsageCache(endpoint, "first", snapshot)).not.toThrow();
});

it("restores native settings even when the renderer has a different browser store", () => {
	const disk = new Map<string, unknown>();
	vi.stubGlobal("electronAPI", {
		getAppSetting: (key: string) => disk.get(key) ?? null,
		setAppSetting: (key: string, value: unknown) => {
			disk.set(key, value);
			return true;
		},
	});
	writeUsageCache(endpoint, "first", snapshot);
	values.clear();
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("new renderer origin");
		},
	});
	expect(readUsageCache(endpoint, "first")).toEqual(snapshot);
	expect(readUsageCache(endpoint, "second")).toBeNull();
});

it.each([
	{ ...snapshot, updatedAt: snapshot.updatedAt - 31 * 86400_000 },
	{ ...snapshot, version: 2 },
])("uses a valid browser snapshot when the native snapshot is invalid: %j", (native) => {
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => native,
		setAppSetting: () => false,
	});
	writeUsageCache(endpoint, "first", snapshot);
	expect(readUsageCache(endpoint, "first")).toEqual(snapshot);
});
