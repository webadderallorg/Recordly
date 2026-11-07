import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
const state = vi.hoisted(() => ({ dockVisible: true, hideWhileRecording: null as boolean | null }));

vi.mock("electron", () => ({
	app: {
		once: vi.fn(),
		dock: {
			isVisible: vi.fn(() => state.dockVisible),
			show: vi.fn(async () => {
				state.dockVisible = true;
			}),
			hide: vi.fn(() => {
				state.dockVisible = false;
			}),
			setMenu: vi.fn(),
		},
	},
	BrowserWindow: {},
	ipcMain: { handle: vi.fn() },
	Menu: { buildFromTemplate: vi.fn((template) => template) },
}));
vi.mock("./appSettingsStore", () => ({
	readAppSetting: vi.fn((key: string) =>
		key === "recordly.application.hideWhileRecording" ? state.hideWhileRecording : null,
	),
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
	vi.useFakeTimers();
	state.dockVisible = true;
	state.hideWhileRecording = null;
});

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	Object.defineProperty(process, "platform", platformDescriptor);
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

describe("recording Dock presence", () => {
	beforeEach(() => {
		Object.defineProperty(process, "platform", { value: "darwin" });
	});

	it("hides from the Dock by default while keeping a tray entry, then restores on finish", async () => {
		const p = await setup();
		p.setDesktopPresenceRecording(true);
		expect(state.dockVisible).toBe(false);
		expect(p.desktopPresenceNeedsTray()).toBe(true);
		p.setDesktopPresenceRecording(false);
		await vi.advanceTimersByTimeAsync(1100);
		expect(state.dockVisible).toBe(true);
	});

	it("honors an explicit preference to keep the Dock icon while recording", async () => {
		state.hideWhileRecording = false;
		const p = await setup();
		p.setDesktopPresenceRecording(true);
		expect(state.dockVisible).toBe(true);
		expect(p.desktopPresenceNeedsTray()).toBe(true);
	});
});

it.each(["linux", "win32"])("does not use the macOS Dock on %s", async (platform) => {
	Object.defineProperty(process, "platform", { value: platform });
	const { app } = await import("electron");
	const p = await setup();
	p.setDesktopPresenceRecording(true);
	expect(p.desktopPresenceNeedsTray()).toBe(true);
	p.setDesktopPresenceRecording(false);
	expect(app.dock.hide).not.toHaveBeenCalled();
	expect(app.dock.show).not.toHaveBeenCalled();
	expect(app.dock.setMenu).not.toHaveBeenCalled();
});
