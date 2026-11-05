import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: {
		once: vi.fn(),
		dock: {
			isVisible: vi.fn(() => true),
			show: vi.fn(async () => undefined),
			hide: vi.fn(),
			setMenu: vi.fn(),
		},
	},
	BrowserWindow: {},
	ipcMain: { handle: vi.fn() },
	Menu: { buildFromTemplate: vi.fn((template) => template) },
}));
vi.mock("./appSettingsStore", () => ({
	readAppSetting: vi.fn(() => null),
	writeAppSetting: vi.fn(),
}));

async function setup() {
	const presence = await import("./desktopPresence");
	const stopRecording = vi.fn();
	presence.initializeDesktopPresence({
		refreshEntryPoints: vi.fn(),
		stopRecording,
		onRecordingOwnerLost: vi.fn(),
		stopIcon: {} as Electron.NativeImage,
	});
	return { ...presence, stopRecording };
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
});

describe("recording icon stop action", () => {
	it("leaves idle clicks available for opening the app", async () => {
		const p = await setup();
		expect(p.stopRecordingFromDesktopIcon()).toBe(false);
		expect(p.stopRecording).not.toHaveBeenCalled();
	});

	it("stops active capture once and consumes rapid clicks while it finalizes", async () => {
		const p = await setup();
		p.setDesktopPresenceRecording(true);
		expect(p.stopRecordingFromDesktopIcon()).toBe(true);
		expect(p.stopRecordingFromDesktopIcon()).toBe(true);
		// Repeated active notifications must not re-arm the stop action.
		p.setDesktopPresenceRecording(true);
		expect(p.stopRecordingFromDesktopIcon()).toBe(true);
		expect(p.stopRecording).toHaveBeenCalledTimes(1);
	});

	it("returns to opening the app after stop and re-arms for the next recording", async () => {
		const p = await setup();
		p.setDesktopPresenceRecording(true);
		p.stopRecordingFromDesktopIcon();
		p.setDesktopPresenceRecording(false);
		expect(p.stopRecordingFromDesktopIcon()).toBe(false);
		p.setDesktopPresenceRecording(true);
		expect(p.stopRecordingFromDesktopIcon()).toBe(true);
		expect(p.stopRecording).toHaveBeenCalledTimes(2);
	});
});
