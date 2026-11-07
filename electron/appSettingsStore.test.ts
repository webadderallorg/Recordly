import { beforeEach, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: files.read, writeFileSync: files.write }));
vi.mock("./ipc/constants", () => ({ APP_SETTINGS_FILE: "/test/app-settings.json" }));
vi.mock("./ipc/utils", () => ({ parseJsonWithByteOrderMark: JSON.parse }));

import {
	readAppSetting,
	readAppSettingsStore,
	readAppSettingsStoreWithStatus,
	writeAppSetting,
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

it.each([
	"{broken",
	"[]",
	"null",
	"3",
])("never overwrites malformed settings through a preference writer: %s", (content) => {
	files.read.mockReturnValue(content);
	expect(() => writeAppSetting("theme", "dark")).toThrow(
		"Could not read app settings before saving",
	);
	expect(files.write).not.toHaveBeenCalled();
});

it.each([
	"EACCES",
	"EBUSY",
	"EIO",
])("never overwrites settings when the preference writer cannot read: %s", (code) => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("unavailable"), { code });
	});
	expect(() => writeAppSetting("theme", "dark")).toThrow(
		"Could not read app settings before saving",
	);
	expect(files.write).not.toHaveBeenCalled();
});

it("creates a first-run setting when the file is confirmed missing", () => {
	files.read.mockImplementation(() => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	});
	writeAppSetting("theme", "dark");
	expect(files.write).toHaveBeenCalledExactlyOnceWith(
		"/test/app-settings.json",
		JSON.stringify({ theme: "dark" }, null, 2),
		"utf-8",
	);
});

it("preserves unrelated settings when a preference writer updates a valid file", () => {
	files.read.mockReturnValue('{"history":{"project:old":123}}');
	writeAppSetting("theme", "dark");
	expect(files.write).toHaveBeenCalledExactlyOnceWith(
		"/test/app-settings.json",
		JSON.stringify({ history: { "project:old": 123 }, theme: "dark" }, null, 2),
		"utf-8",
	);
});
