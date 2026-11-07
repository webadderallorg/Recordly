import { beforeEach, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: files.read, writeFileSync: files.write }));
vi.mock("./ipc/constants", () => ({ APP_SETTINGS_FILE: "/test/app-settings.json" }));
vi.mock("./ipc/utils", () => ({ parseJsonWithByteOrderMark: JSON.parse }));

import {
	readAppSetting,
	readAppSettingsStore,
	readAppSettingsStoreWithStatus,
} from "./appSettingsStore";

beforeEach(() => vi.clearAllMocks());

it("treats a missing settings file as a valid first-run empty store", () => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	});
	expect(readAppSettingsStoreWithStatus()).toEqual({ success: true, store: {} });
});

it.each(["EACCES", "EIO", "EISDIR"])("reports unreadable settings as unavailable: %s", (code) => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("unavailable"), { code });
	});
	expect(readAppSettingsStoreWithStatus()).toEqual({ success: false });
	// Normal preference callers retain their previous resilient fallback.
	expect(readAppSettingsStore()).toEqual({});
	expect(readAppSetting("theme")).toBeNull();
});

it.each([
	"{broken",
	"[]",
	"null",
	"3",
])("does not report malformed settings as empty: %s", (content) => {
	files.read.mockReturnValue(content);
	expect(readAppSettingsStoreWithStatus()).toEqual({ success: false });
	expect(readAppSettingsStore()).toEqual({});
});

it("retains a valid history and distinguishes a missing key", () => {
	files.read.mockReturnValue('{"history":{"project:old":123}}');
	expect(readAppSettingsStoreWithStatus()).toEqual({
		success: true,
		store: { history: { "project:old": 123 } },
	});
	expect(readAppSetting("history")).toEqual({ "project:old": 123 });
	expect(readAppSetting("missing")).toBeNull();
});
