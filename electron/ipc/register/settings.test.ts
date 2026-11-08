import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	syncHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock("electron", () => ({
	app: {},
	BrowserWindow: {},
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(channel, handler),
		on: (channel: string, handler: (...args: unknown[]) => unknown) =>
			mocks.syncHandlers.set(channel, handler),
	},
}));
vi.mock("../recording/focus", () => ({ recordingFocus: {} }));
vi.mock("../../windows", () => ({ createCountdownWindow: vi.fn() }));
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
import { readAppSettingsStoreWithStatus, writeAppSettingsStore } from "../../appSettingsStore";

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

describe("app setting write status", () => {
	beforeEach(() => {
		mocks.syncHandlers.clear();
		vi.mocked(readAppSettingsStoreWithStatus).mockReset();
		vi.mocked(writeAppSettingsStore).mockReset();
		registerSettingsHandlers();
	});
	const write = (key: unknown, value: unknown) => {
		const event = { returnValue: undefined as unknown };
		mocks.syncHandlers.get("app-settings:set")!(event, key, value);
		return event.returnValue;
	};

	it("does not replace unreadable settings with a partial map", () => {
		vi.mocked(readAppSettingsStoreWithStatus).mockReturnValue({ success: false });
		expect(write("volume", 0.5)).toEqual({ success: false });
		expect(writeAppSettingsStore).not.toHaveBeenCalled();
	});

	it("preserves other settings when updating a successfully read store", () => {
		vi.mocked(readAppSettingsStoreWithStatus).mockReturnValue({
			success: true,
			store: {
				"recordly.project-share-links.v1": { project: "https://example.test/v/share" },
			},
		});
		expect(write("volume", 0.5)).toEqual({ success: true });
		expect(writeAppSettingsStore).toHaveBeenCalledExactlyOnceWith({
			"recordly.project-share-links.v1": { project: "https://example.test/v/share" },
			volume: 0.5,
		});
	});
});
