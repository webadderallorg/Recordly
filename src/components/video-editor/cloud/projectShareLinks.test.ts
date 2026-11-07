import { afterEach, expect, it, vi } from "vitest";
import {
	getProjectShare,
	getProjectShareLink,
	getProjectShareLinkStrict,
	moveProjectShareLink,
	removeProjectShareLinks,
	removeProjectShareLinksByUrl,
	subscribeDeletedProjectShareLinks,
	saveProjectShareLink,
} from "./projectShareLinks";

afterEach(() => vi.unstubAllGlobals());
it("retains share links across renames and clears obsolete paths", () => {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) || null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	saveProjectShareLink("old", "https://example.com/share");
	moveProjectShareLink("old", "new");
	expect(getProjectShareLink("new")).toBe("https://example.com/share");
	expect(getProjectShareLink("old")).toBeUndefined();
	removeProjectShareLinks(["new"]);
	expect(getProjectShareLink("new")).toBeUndefined();
});

function installNativeSettings() {
	const settings = new Map<string, unknown>();
	vi.stubGlobal("electronAPI", {
		getAppSetting: (key: string) => settings.get(key) ?? null,
		getAppSettingWithStatus: (key: string) => ({
			success: true,
			found: settings.has(key),
			value: settings.get(key) ?? null,
		}),
		setAppSetting: (key: string, value: unknown) => {
			settings.set(key, structuredClone(value));
			return true;
		},
	});
	return settings;
}

it("retains links, account ownership and revisions when the packaged origin changes", () => {
	installNativeSettings();
	const oldOrigin = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => oldOrigin.get(key) ?? null,
		setItem: (key: string, value: string) => oldOrigin.set(key, value),
	});
	saveProjectShareLink("project", "https://example.test/share", {
		accountId: "owner",
		revision: "revision",
	});
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	expect(getProjectShare("project", "owner")).toMatchObject({
		url: "https://example.test/share",
		revision: "revision",
		accountId: "owner",
	});
	expect(getProjectShare("project", "other")).toBeUndefined();
	moveProjectShareLink("project", "renamed");
	expect(getProjectShareLink("project")).toBeUndefined();
	expect(getProjectShareLink("renamed")).toBe("https://example.test/share");
});

it("migrates legacy browser links without resurrecting deleted native entries", () => {
	const settings = installNativeSettings();
	const legacy = JSON.stringify({ project: "https://example.test/legacy" });
	vi.stubGlobal("localStorage", { getItem: () => legacy, setItem: vi.fn() });
	expect(getProjectShareLink("project")).toBe("https://example.test/legacy");
	expect(settings.get("recordly.project-share-links.v1")).toMatchObject({
		project: { url: "https://example.test/legacy", sharedAt: 0 },
	});
	removeProjectShareLinks(["project"]);
	// This simulates returning to an older origin with its stale browser snapshot.
	expect(getProjectShareLink("project")).toBeUndefined();
});

it("keeps native links usable when browser storage is unavailable", () => {
	installNativeSettings();
	vi.stubGlobal("localStorage", {
		getItem: () => null,
		setItem: () => {
			throw new Error("storage unavailable");
		},
	});
	expect(() => saveProjectShareLink("project", "https://example.test/share")).not.toThrow();
	expect(getProjectShareLink("project")).toBe("https://example.test/share");
});

it("recognizes saved revisions, preserves legacy links, and scopes new links to their account", async () => {
	const { getProjectShare, getProjectShareRevision, isProjectShareStale } = await import(
		"./projectShareLinks"
	);
	const values = new Map<string, string>([
		["recordly.project-share-links.v1", JSON.stringify({ legacy: "https://example.test/old" })],
	]);
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	expect(getProjectShareLink("legacy")).toBe("https://example.test/old");
	expect(isProjectShareStale(getProjectShare("legacy"), "current")).toBe(true);
	const project = {
		version: 1,
		videoPath: "/video.mp4",
		editor: { padding: 10, borderRadius: 5 },
	} as Parameters<typeof getProjectShareRevision>[0];
	const revision = getProjectShareRevision(project);
	expect(getProjectShareRevision({ ...project!, editor: { borderRadius: 5, padding: 10 } })).toBe(
		revision,
	);
	expect(
		getProjectShareRevision({ ...project!, editor: { padding: 20, borderRadius: 5 } }),
	).not.toBe(revision);
	saveProjectShareLink("project", "https://example.test/new", { revision, accountId: "owner" });
	expect(isProjectShareStale(getProjectShare("project", "owner"), revision)).toBe(false);
	expect(isProjectShareStale(getProjectShare("project", "owner"), "edited")).toBe(true);
	expect(getProjectShare("project", "other")).toBeUndefined();
	moveProjectShareLink("project", "renamed");
	expect(getProjectShare("renamed", "owner")?.revision).toBe(revision);
});

it("clears every deleted URL alias from native storage without removing a regenerated link", () => {
	installNativeSettings();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	const deleted = "https://example.test/s/deleted";
	saveProjectShareLink("original", deleted, { accountId: "owner", revision: "old" });
	saveProjectShareLink("renamed", deleted, { accountId: "owner", revision: "old" });
	saveProjectShareLink("regenerated", deleted, { accountId: "owner", revision: "old" });
	saveProjectShareLink("regenerated", "https://example.test/s/new", {
		accountId: "owner",
		revision: "new",
	});
	saveProjectShareLink("other-account", "https://example.test/s/other", { accountId: "other" });
	removeProjectShareLinksByUrl(deleted);
	expect(getProjectShare("original", "owner")).toBeUndefined();
	expect(getProjectShare("renamed", "owner")).toBeUndefined();
	expect(getProjectShare("regenerated", "owner")).toMatchObject({
		url: "https://example.test/s/new",
		revision: "new",
	});
	expect(getProjectShare("other-account", "other")?.url).toBe("https://example.test/s/other");
	// A new packaged origin still uses the cleared native map.
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	expect(getProjectShare("original", "owner")).toBeUndefined();
	expect(getProjectShare("regenerated", "owner")?.url).toBe("https://example.test/s/new");
});

it("announces a confirmed deletion even when its link has no project mapping", () => {
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	const listener = vi.fn();
	const unsubscribe = subscribeDeletedProjectShareLinks(listener);
	try {
		removeProjectShareLinksByUrl("https://example.test/s/unsaved");
		expect(listener).toHaveBeenCalledExactlyOnceWith("https://example.test/s/unsaved");
		unsubscribe();
		removeProjectShareLinksByUrl("https://example.test/s/another");
		expect(listener).toHaveBeenCalledTimes(1);
	} finally {
		unsubscribe();
	}
});

it("clears active deleted URLs even when both persistence stores fail", () => {
	const deleted = "https://example.test/s/storage-unavailable";
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => ({ project: { url: deleted, sharedAt: 1 } }),
		getAppSettingWithStatus: () => ({
			success: true,
			found: true,
			value: { project: { url: deleted, sharedAt: 1 } },
		}),
		setAppSetting: () => false,
	});
	vi.stubGlobal("localStorage", {
		getItem: () => null,
		setItem: () => {
			throw new Error("storage unavailable");
		},
	});
	const listener = vi.fn();
	const unsubscribe = subscribeDeletedProjectShareLinks(listener);
	try {
		expect(() => removeProjectShareLinksByUrl(deleted)).toThrow("storage unavailable");
		expect(listener).toHaveBeenCalledExactlyOnceWith(deleted);
	} finally {
		unsubscribe();
	}
});

it("does not resurrect deleted aliases when native writes fail but browser storage works", () => {
	const deleted = "https://example.test/s/native-write-failed";
	const newer = "https://example.test/s/regenerated-before-deletion";
	const native = {
		original: { url: deleted, sharedAt: 1 },
		alias: { url: deleted, sharedAt: 1 },
		regenerated: { url: newer, sharedAt: 2 },
	};
	const values = new Map<string, string>();
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => structuredClone(native),
		getAppSettingWithStatus: () => ({
			success: true,
			found: true,
			value: structuredClone(native),
		}),
		setAppSetting: () => false,
	});
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	// Capture the explicit warning after the successful remote deletion.
	let warning: unknown;
	try {
		removeProjectShareLinksByUrl(deleted);
	} catch (cause) {
		warning = cause;
	}
	expect(getProjectShareLink("original")).toBeUndefined();
	expect(getProjectShareLink("alias")).toBeUndefined();
	expect(getProjectShareLink("regenerated")).toBe(newer);
	expect(warning).toBeInstanceOf(Error);
	expect(String(warning)).toContain("desktop settings");
	expect(JSON.parse(values.get("recordly.project-share-links.v1")!)).toEqual({
		regenerated: native.regenerated,
	});
});

it.each([
	"failed",
	"throws",
	"legacyGetter",
	"missingFound",
])("does not migrate or write a browser snapshot after an uncertain native read: %s", (mode) => {
	const write = vi.fn(() => true);
	const browserRead = vi.fn(() => JSON.stringify({ old: "https://example.test/stale" }));
	const browserWrite = vi.fn();
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => null,
		getAppSettingWithStatus:
			mode === "legacyGetter"
				? undefined
				: () => {
						if (mode === "throws") throw new Error("Storage failed");
						if (mode === "missingFound") return { success: true, value: null };
						return { success: false, value: null };
					},
		setAppSetting: write,
	});
	vi.stubGlobal("localStorage", { getItem: browserRead, setItem: browserWrite });
	expect(getProjectShare("old", "owner")).toBeUndefined();
	expect(getProjectShareLink("old")).toBeUndefined();
	expect(() => saveProjectShareLink("new", "https://example.test/new")).toThrow(
		"desktop settings",
	);
	expect(() => moveProjectShareLink("old", "renamed")).toThrow("desktop settings");
	expect(() => removeProjectShareLinks(["old"])).toThrow("desktop settings");
	expect(write).not.toHaveBeenCalled();
	expect(browserRead).not.toHaveBeenCalled();
	expect(browserWrite).not.toHaveBeenCalled();
});

it("treats a present null native map as cleared without resurrecting browser links", () => {
	const write = vi.fn(() => true);
	const browserRead = vi.fn(() => JSON.stringify({ old: "https://example.test/stale" }));
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => null,
		getAppSettingWithStatus: () => ({ success: true, found: true, value: null }),
		setAppSetting: write,
	});
	vi.stubGlobal("localStorage", { getItem: browserRead, setItem: vi.fn() });
	expect(getProjectShareLink("old")).toBeUndefined();
	expect(write).not.toHaveBeenCalled();
	expect(browserRead).not.toHaveBeenCalled();
	saveProjectShareLink("new", "https://example.test/new");
	expect(write).toHaveBeenCalledExactlyOnceWith("recordly.project-share-links.v1", {
		new: { url: "https://example.test/new", sharedAt: expect.any(Number) },
	});
});

it("keeps a genuinely missing native and browser key available as an empty cache", () => {
	const settings = installNativeSettings();
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	expect(getProjectShareLinkStrict("missing")).toBeUndefined();
	expect(settings.get("recordly.project-share-links.v1")).toEqual({});
});

it("never bases native writes on an invalid existing map", () => {
	const write = vi.fn(() => true);
	const browserRead = vi.fn(() => JSON.stringify({ old: "https://example.test/stale" }));
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => [],
		getAppSettingWithStatus: () => ({ success: true, found: true, value: [] }),
		setAppSetting: write,
	});
	vi.stubGlobal("localStorage", { getItem: browserRead, setItem: vi.fn() });
	expect(getProjectShareLink("old")).toBeUndefined();
	expect(() => saveProjectShareLink("new", "https://example.test/new")).toThrow(
		"could not be read",
	);
	expect(write).not.toHaveBeenCalled();
	expect(browserRead).not.toHaveBeenCalled();
});
