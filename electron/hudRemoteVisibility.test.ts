import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	read: vi.fn(),
	write: vi.fn(),
}));
vi.mock("electron", () => ({
	app: {},
	BrowserWindow: {},
	ipcMain: {
		on: vi.fn(),
		handle: (name: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(name, handler),
	},
}));
vi.mock("node:fs", () => ({
	default: { existsSync: () => true, readFileSync: mocks.read, writeFileSync: mocks.write },
}));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "test-data" }));
vi.mock("./rendererServer", () => ({ getPackagedRendererBaseUrl: vi.fn() }));
vi.mock("./ipc/state", () => ({
	currentProjectPath: null,
	currentVideoPath: null,
	currentRecordingSession: null,
}));

describe("remote HUD visibility persistence", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.resetAllMocks();
		mocks.handlers.clear();
		mocks.read.mockReturnValue(JSON.stringify({ hiddenFromCapture: true }));
	});
	it("loads old configurations and restores the original preference after remote mode", async () => {
		const windows = await import("./windows");
		expect(windows.getHudOverlayCaptureProtectionEnabled()).toBe(true);
		const set = mocks.handlers.get("set-hud-remote-visible")!;
		expect(set({}, true)).toEqual({ success: true });
		expect(windows.getHudOverlayCaptureProtectionEnabled()).toBe(false);
		expect(JSON.parse(mocks.write.mock.calls[0][1])).toEqual({
			hiddenFromCapture: true,
			remoteVisible: true,
		});
		expect(set({}, false)).toEqual({ success: true });
		expect(windows.getHudOverlayCaptureProtectionEnabled()).toBe(true);
	});
	it("restores persisted remote mode on restart and does not mutate state on disk failure", async () => {
		mocks.read.mockReturnValue(
			JSON.stringify({ hiddenFromCapture: true, remoteVisible: true }),
		);
		const windows = await import("./windows");
		expect(windows.getHudOverlayCaptureProtectionEnabled()).toBe(false);
		mocks.write.mockImplementation(() => {
			throw new Error("read-only");
		});
		expect(mocks.handlers.get("set-hud-remote-visible")!({}, false)).toMatchObject({
			success: false,
		});
		expect(windows.getHudOverlayCaptureProtectionEnabled()).toBe(false);
	});
	it("validates IPC input and preserves a disabled capture-protection preference", async () => {
		mocks.read.mockReturnValue(JSON.stringify({ hiddenFromCapture: false }));
		const windows = await import("./windows");
		const set = mocks.handlers.get("set-hud-remote-visible")!;
		expect(set({}, "true")).toMatchObject({ success: false });
		set({}, true);
		set({}, false);
		expect(windows.getHudOverlayCaptureProtectionEnabled()).toBe(false);
	});
});
