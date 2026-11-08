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

it.each([
	[false, "{broken"],
	[false, "[]"],
	[false, "null"],
	[false, "3"],
	[true, "{broken"],
	[true, "[]"],
	[true, "null"],
	[true, "3"],
] as const)("replaces corrupt browser share links after a successful share, native settings=%s, cache=%s", (native, corrupt) => {
	const key = "recordly.project-share-links.v1";
	const settings = native ? installNativeSettings() : null;
	const values = new Map([[key, corrupt]]);
	vi.stubGlobal("localStorage", {
		getItem: (name: string) => values.get(name) ?? null,
		setItem: (name: string, value: string) => values.set(name, value),
	});
	expect(() =>
		saveProjectShareLink("current", "https://example.test/current", { accountId: "owner" }),
	).not.toThrow();
	expect(getProjectShareLinkStrict("missing")).toBeUndefined();
	expect(getProjectShare("current", "owner")).toMatchObject({
		url: "https://example.test/current",
		accountId: "owner",
	});
	expect(JSON.parse(values.get(key)!)).toEqual({
		current: {
			url: "https://example.test/current",
			accountId: "owner",
			sharedAt: expect.any(Number),
		},
	});
	if (settings) expect(settings.get(key)).toEqual(JSON.parse(values.get(key)!));
});

it("does not treat a failed native read as permission to replace corrupt browser history", () => {
	const nativeWrite = vi.fn(() => true);
	const browserRead = vi.fn(() => "{broken");
	const browserWrite = vi.fn();
	vi.stubGlobal("electronAPI", {
		getAppSetting: () => null,
		getAppSettingWithStatus: () => ({ success: false }),
		setAppSetting: nativeWrite,
	});
	vi.stubGlobal("localStorage", { getItem: browserRead, setItem: browserWrite });
	expect(() => saveProjectShareLink("current", "https://example.test/current")).toThrow(
		"desktop settings",
	);
	expect(nativeWrite).not.toHaveBeenCalled();
	expect(browserRead).not.toHaveBeenCalled();
	expect(browserWrite).not.toHaveBeenCalled();
});

it("keeps browser storage access failures fatal for strict eligibility and mutations", () => {
	const browserWrite = vi.fn();
	vi.stubGlobal("localStorage", {
		getItem: () => {
			throw new Error("Browser storage unavailable");
		},
		setItem: browserWrite,
	});
	expect(() => getProjectShareLinkStrict("current")).toThrow("Browser storage unavailable");
	expect(() => saveProjectShareLink("current", "https://example.test/current")).toThrow(
		"Browser storage unavailable",
	);
	expect(browserWrite).not.toHaveBeenCalled();
});

// Exercise the actual early caller expressions without inventing a React/UI harness.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { invalidateCloudBillingReads, readCloudBilling } from "./cloudBillingReads";
import { notifyShareCapacityChanged, subscribeShareCapacityChanges } from "./shareCapacity";

function callerExpression(file: string, name: string, kind: "call" | "value"): string | undefined {
	const tree = ts.createSourceFile(
		file,
		readFileSync(new URL(file, import.meta.url), "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	let expression: ts.Expression | undefined;
	const visit = (node: ts.Node) => {
		if (
			kind === "call" &&
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			node.expression.text === name
		)
			expression = node;
		if (
			kind === "value" &&
			ts.isVariableDeclaration(node) &&
			ts.isIdentifier(node.name) &&
			node.name.text === name
		)
			expression = node.initializer;
		ts.forEachChild(node, visit);
	};
	visit(tree);
	return expression?.getText(tree);
}
function invokeCaller(expression: string, values: Record<string, unknown>) {
	const js = ts.transpileModule(`const __callerProbeResult = ${expression};`, {
		compilerOptions: { target: ts.ScriptTarget.ES2022 },
	}).outputText;
	return new Function(...Object.keys(values), `${js}\nreturn __callerProbeResult;`)(
		...Object.values(values),
	);
}

it("keeps actual upload and dashboard callers scoped across account changes", () => {
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	const upload = callerExpression("./CloudShareButton.tsx", "saveProjectShareLink", "call");
	const card = callerExpression("../dashboard/ProjectCard.tsx", "shareUrl", "value");
	const identity = callerExpression("../dashboard/ProjectCard.tsx", "accountId", "value");
	expect(upload).toBeDefined();
	expect(card).toBeDefined();
	const projectPath = "caller-account-switch.recordly";
	const save = (accountId: string, shareUrl: string) =>
		invokeCaller(upload!, {
			saveProjectShareLink,
			projectPath,
			result: { shareUrl },
			accountId,
		});
	const read = (activeId?: string) => {
		const accountId = identity
			? invokeCaller(identity, {
					useContext: () => (activeId ? { id: activeId } : null),
					AccountProfileContext: {},
				})
			: undefined;
		return invokeCaller(card!, {
			getProjectShare,
			getProjectShareLink,
			entry: { path: projectPath },
			accountId,
		});
	};
	save("owner-a", "https://example.test/s/caller-owner-a");
	expect(read("owner-a")).toBe("https://example.test/s/caller-owner-a");
	expect(read("owner-b")).toBeUndefined();
	expect(read()).toBeUndefined();
	save("owner-b", "https://example.test/s/caller-owner-b");
	expect(read("owner-b")).toBe("https://example.test/s/caller-owner-b");
	expect(read("owner-a")).toBeUndefined();
});

it("invalidates cached dashboard usage from the actual successful-upload notification", async () => {
	const endpoint = "https://example.test/caller-capacity";
	const status = (recordings: number) => ({
		success: true,
		billing: {
			plan: "free",
			subscriptionStatus: null,
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
			checkoutAvailable: false,
			checkoutIntervals: [],
			portalAvailable: false,
			prices: [],
		},
		usage: {
			recordings,
			recordingLimit: 5,
			maxRecordingBytes: 1e9,
			storageBytes: 100,
			storageLimitBytes: 1e11,
		},
	});
	const billing = vi.fn().mockResolvedValue(status(4));
	vi.stubGlobal("window", { electronAPI: { cloudBilling: billing } });
	const refreshed = vi.fn();
	const unsubscribe = subscribeShareCapacityChanges(refreshed);
	try {
		expect((await readCloudBilling(endpoint, "status", "caller-token")).usage?.recordings).toBe(
			4,
		);
		billing.mockResolvedValue(status(5));
		expect((await readCloudBilling(endpoint, "status", "caller-token")).usage?.recordings).toBe(
			4,
		);
		const notify = callerExpression(
			"./CloudShareButton.tsx",
			"notifyShareCapacityChanged",
			"call",
		);
		if (notify) invokeCaller(notify, { notifyShareCapacityChanged });
		expect((await readCloudBilling(endpoint, "status", "caller-token")).usage?.recordings).toBe(
			5,
		);
		expect(refreshed).toHaveBeenCalledOnce();
	} finally {
		unsubscribe();
		invalidateCloudBillingReads();
	}
});
