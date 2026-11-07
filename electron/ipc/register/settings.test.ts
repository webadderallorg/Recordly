import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	syncHandlers: new Map<string, (...args: unknown[]) => unknown>(),
	send: vi.fn(),
	focusStart: vi.fn(),
	focusStop: vi.fn(),
}));
vi.mock("electron", () => ({
	app: {},
	BrowserWindow: {
		getAllWindows: () => [
			{
				isDestroyed: () => false,
				webContents: { isDestroyed: () => false, send: mocks.send },
			},
		],
	},
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		on: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.syncHandlers.set(channel, handler),
	},
}));
vi.mock("../recording/focus", () => ({
	recordingFocus: { start: mocks.focusStart, stop: mocks.focusStop },
}));
vi.mock("../../cursorHider", () => ({ hideCursor: vi.fn() }));
vi.mock("../../appSettingsStore", () => ({
	hasAppSetting: vi.fn(),
	readAppSettingsStore: vi.fn(),
	readAppSettingsStoreWithStatus: vi.fn(),
	writeAppSettingsStore: vi.fn(),
}));
vi.mock("../constants", () => ({
	COUNTDOWN_SETTINGS_FILE: "/unused/countdown.json",
	RECORDINGS_SETTINGS_FILE: "/unused/recordings.json",
	SHORTCUTS_FILE: "/unused/shortcuts.json",
}));
vi.mock("../settings/recordingPreferencesStore", () => ({
	createRecordingPreferencesStore: () => ({ read: vi.fn(), update: vi.fn() }),
}));
vi.mock("../utils", () => ({ parseJsonWithByteOrderMark: JSON.parse }));

import { registerSettingsHandlers } from "./settings";
import { hasAppSetting, readAppSettingsStoreWithStatus } from "../../appSettingsStore";

describe("app setting read status", () => {
	beforeEach(() => {
		mocks.syncHandlers.clear();
		vi.mocked(readAppSettingsStoreWithStatus).mockReset();
		vi.mocked(hasAppSetting).mockImplementation((store, key) =>
			Reflect.getOwnPropertyDescriptor(store, key) !== undefined,
		);
		registerSettingsHandlers();
	});

	const read = (key: unknown) => {
		const event = { returnValue: undefined as unknown };
		mocks.syncHandlers.get("app-settings:get")!(event, key);
		return event.returnValue;
	};

	it("returns successful empty and existing values without conflating storage failure", () => {
		vi.mocked(readAppSettingsStoreWithStatus).mockReturnValue({ success: true, store: {} });
		expect(read("history")).toEqual({ success: true, found: false, value: null });
		vi.mocked(readAppSettingsStoreWithStatus).mockReturnValue({ success: true, store: { history: 123 } });
		expect(read("history")).toEqual({ success: true, found: true, value: 123 });
		vi.mocked(readAppSettingsStoreWithStatus).mockReturnValue({ success: true, store: { history: null } });
		expect(read("history")).toEqual({ success: true, found: true, value: null });
		vi.mocked(readAppSettingsStoreWithStatus).mockReturnValue({ success: false });
		expect(read("history")).toEqual({ success: false, value: null });
	});

	it.each([null, "", 1])("rejects invalid setting keys without reading storage: %j", (key) => {
		expect(read(key)).toEqual({ success: false, value: null });
		expect(readAppSettingsStoreWithStatus).not.toHaveBeenCalled();
	});
});

describe("recording microphone profile configuration", () => {
	beforeEach(() => {
		vi.stubEnv("RECORDLY_BROWSER_MIC_PROFILE", undefined);
		mocks.handlers.clear();
		registerSettingsHandlers();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const getProfile = () => mocks.handlers.get("get-recording-audio-lab-config")!();

	it("disables AGC for normal recordings without a lab override", () => {
		expect(getProfile()).toEqual({
			browserMicrophoneProfile: "no-agc",
			requestedBrowserMicrophoneProfile: null,
		});
	});

	it.each(["", "unknown"])("uses the safe default for %j configuration", (value) => {
		vi.stubEnv("RECORDLY_BROWSER_MIC_PROFILE", value);
		expect(getProfile()).toMatchObject({ browserMicrophoneProfile: "no-agc" });
	});

	it("preserves an explicitly requested processed microphone profile", () => {
		vi.stubEnv("RECORDLY_BROWSER_MIC_PROFILE", " Processed ");
		expect(getProfile()).toEqual({
			browserMicrophoneProfile: "processed",
			requestedBrowserMicrophoneProfile: "Processed",
		});
	});
});

describe("inline recording countdown", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mocks.handlers.clear();
		mocks.send.mockClear();
		registerSettingsHandlers();
	});
	afterEach(() => {
		mocks.handlers.get("cancel-countdown")?.();
		vi.useRealTimers();
	});

	it("broadcasts inline ticks and clears the countdown after success", async () => {
		const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
		const pending = mocks.handlers.get("start-countdown")!({ sender }, 3);
		await vi.advanceTimersByTimeAsync(3000);
		await expect(pending).resolves.toEqual({ success: true });
		expect(mocks.send.mock.calls).toEqual([
			["countdown-tick", 3],
			["countdown-tick", 2],
			["countdown-tick", 1],
			["countdown-tick", 0],
		]);
		expect(sender.listenerCount("destroyed")).toBe(0);
	});

	it.each([
		"destroyed",
		"render-process-gone",
	])("cancels when the recording owner exits via %s", async (event) => {
		const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false });
		const pending = mocks.handlers.get("start-countdown")!({ sender }, 3);
		sender.emit(event);
		await expect(pending).resolves.toEqual({ success: false, cancelled: true });
		expect(mocks.handlers.get("get-active-countdown")!()).toEqual({
			success: true,
			seconds: null,
		});
		expect(vi.getTimerCount()).toBe(0);
	});
});
