import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settingsFiles = vi.hoisted(() => {
	const separator = process.platform === "win32" ? "\\" : "/";
	const base = `${process.env.TEMP ?? process.cwd()}${separator}recordly-settings-ipc-${process.pid}`;
	return {
		base,
		appSettings: `${base}${separator}app-settings.json`,
		countdown: `${base}${separator}countdown-settings.json`,
		recordings: `${base}${separator}recordings-settings.json`,
		shortcuts: `${base}${separator}shortcuts.json`,
	};
});

const ipcListeners = vi.hoisted(() => ({
	on: new Map<string, (...args: unknown[]) => void>(),
}));

vi.mock("electron", () => ({
	app: { getVersion: () => "0.0.0-test" },
	ipcMain: {
		handle: vi.fn(),
		on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
			ipcListeners.on.set(channel, listener);
		}),
	},
}));

vi.mock("../constants", () => ({
	APP_SETTINGS_FILE: settingsFiles.appSettings,
	COUNTDOWN_SETTINGS_FILE: settingsFiles.countdown,
	RECORDINGS_SETTINGS_FILE: settingsFiles.recordings,
	SHORTCUTS_FILE: settingsFiles.shortcuts,
}));

vi.mock("../utils", () => ({
	parseJsonWithByteOrderMark: (content: string) =>
		JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content),
}));

vi.mock("../../cursorHider", () => ({
	hideCursor: vi.fn(() => true),
}));

vi.mock("../../windows", () => ({
	closeCountdownWindow: vi.fn(),
	createCountdownWindow: vi.fn(),
	getCountdownWindow: vi.fn(() => null),
}));

import { registerSettingsHandlers } from "./settings";

type AppSettingResult = { success: boolean; value?: unknown; error?: string };

function invoke(channel: string, ...args: unknown[]): AppSettingResult {
	const listener = ipcListeners.on.get(channel);
	if (!listener) {
		throw new Error(`No IPC listener registered for ${channel}`);
	}

	const event = { returnValue: undefined as unknown };
	listener(event, ...args);
	return event.returnValue as AppSettingResult;
}

function readStore(): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(settingsFiles.appSettings, "utf-8")) as Record<
		string,
		unknown
	>;
}

describe("app-settings IPC", () => {
	beforeEach(() => {
		fs.mkdirSync(settingsFiles.base, { recursive: true });
		fs.rmSync(settingsFiles.appSettings, { force: true });
		ipcListeners.on.clear();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		registerSettingsHandlers();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(settingsFiles.base, { force: true, recursive: true });
	});

	it("creates the store when it does not exist yet", () => {
		expect(invoke("app-settings:set", "theme", "dark")).toEqual({ success: true });
		expect(readStore()).toEqual({ theme: "dark" });
	});

	it("keeps unrelated keys and the existing JSON layout on write", () => {
		const existing = {
			theme: "dark",
			"recordly.editor.preferences": { showCursor: false, cursorSize: 2.5 },
			windowBounds: { width: 1280, height: 720 },
		};
		fs.writeFileSync(settingsFiles.appSettings, JSON.stringify(existing, null, 2), "utf-8");

		expect(invoke("app-settings:set", "theme", "light")).toEqual({ success: true });

		expect(fs.readFileSync(settingsFiles.appSettings, "utf-8")).toBe(
			JSON.stringify({ ...existing, theme: "light" }, null, 2),
		);
	});

	it("reads stored values and reports absent keys as a successful null", () => {
		fs.writeFileSync(
			settingsFiles.appSettings,
			JSON.stringify({ theme: "dark", "recordly.editor.preferences": { showCursor: true } }),
			"utf-8",
		);

		expect(invoke("app-settings:get", "theme")).toEqual({ success: true, value: "dark" });
		expect(invoke("app-settings:get", "missing")).toEqual({ success: true, value: null });
	});

	it("accepts a byte-order-marked store", () => {
		fs.writeFileSync(
			settingsFiles.appSettings,
			`\uFEFF${JSON.stringify({ theme: "dark" })}`,
			"utf-8",
		);

		expect(invoke("app-settings:get", "theme")).toEqual({ success: true, value: "dark" });
	});

	it("refuses to overwrite a store that cannot be parsed", () => {
		const corrupt = '{"theme": "dark",';
		fs.writeFileSync(settingsFiles.appSettings, corrupt, "utf-8");

		const result = invoke("app-settings:set", "theme", "light");

		expect(result.success).toBe(false);
		expect(result.error).toBeTruthy();
		expect(fs.readFileSync(settingsFiles.appSettings, "utf-8")).toBe(corrupt);
	});

	it("refuses to overwrite a store that is not a JSON object", () => {
		const corrupt = '["theme"]';
		fs.writeFileSync(settingsFiles.appSettings, corrupt, "utf-8");

		expect(invoke("app-settings:set", "theme", "light").success).toBe(false);
		expect(fs.readFileSync(settingsFiles.appSettings, "utf-8")).toBe(corrupt);
	});

	it("reports a parse failure on get instead of an absent key", () => {
		fs.writeFileSync(settingsFiles.appSettings, "not json", "utf-8");

		const result = invoke("app-settings:get", "theme");

		expect(result).toMatchObject({ success: false, value: null });
		expect(result.error).toBeTruthy();
	});

	it("reports a read failure on set instead of replacing the store", () => {
		fs.writeFileSync(settingsFiles.appSettings, "not json", "utf-8");

		expect(invoke("app-settings:set", "theme", "light").success).toBe(false);
		expect(fs.readFileSync(settingsFiles.appSettings, "utf-8")).toBe("not json");
	});

	it("writes through a same-directory temp file and leaves no artifacts", () => {
		fs.writeFileSync(settingsFiles.appSettings, JSON.stringify({ theme: "dark" }), "utf-8");

		expect(invoke("app-settings:set", "theme", "light")).toEqual({ success: true });

		const leftovers = fs
			.readdirSync(settingsFiles.base)
			.filter((entry) => entry.endsWith(".tmp"));
		expect(leftovers).toEqual([]);
	});

	it.skipIf(process.platform === "win32")("preserves the existing file mode", () => {
		fs.writeFileSync(settingsFiles.appSettings, "{}", { encoding: "utf-8", mode: 0o600 });
		fs.chmodSync(settingsFiles.appSettings, 0o600);

		expect(invoke("app-settings:set", "theme", "dark")).toEqual({ success: true });

		expect(fs.statSync(settingsFiles.appSettings).mode & 0o777).toBe(0o600);
	});
});
