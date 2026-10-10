import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SelectedSource } from "../types";
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	sources: vi.fn(),
	validate: vi.fn(),
	remember: vi.fn(),
	recording: false,
	selected: null as SelectedSource | null,
	exec: vi.fn(),
	windows: vi.fn(),
	writeAppSetting: vi.fn(),
	setHudRecordingPreparationActive: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(name, handler),
	},
	app: { getName: () => "Recordly", focus: vi.fn() },
	BrowserWindow: { getAllWindows: mocks.windows },
	desktopCapturer: { getSources: mocks.sources },
}));
vi.mock("node:child_process", () => ({ execFile: mocks.exec }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("../../appSettingsStore", () => ({ writeAppSetting: mocks.writeAppSetting }));
vi.mock("../../windows", () => ({
	setHudRecordingPreparationActive: mocks.setHudRecordingPreparationActive,
}));
vi.mock("../constants", () => ({ ALLOW_RECORDLY_WINDOW_CAPTURE: false }));
vi.mock("../cursor/bounds", () => ({ stopWindowBoundsCapture: vi.fn() }));
vi.mock("../recording/ffmpeg", () => ({}));
vi.mock("../windowsWindowControl", () => ({}));
vi.mock("../captureSelection", () => ({
	validateCaptureSource: mocks.validate,
	rememberCaptureSource: mocks.remember,
	restoreLastCaptureSource: vi.fn(),
}));
vi.mock("../state", () => ({
	get isCursorCaptureActive() {
		return mocks.recording;
	},
	get selectedSource() {
		return mocks.selected;
	},
	setSelectedSource: (source: SelectedSource) => {
		mocks.selected = source;
	},
}));
vi.mock("../utils", () => ({
	parseWindowId: (id: string) => Number(id.split(":")[1]) || null,
	getScreen: () => ({
		getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0 } }],
		getPrimaryDisplay: () => ({ id: 1 }),
	}),
}));
import { getDesktopSources, registerSourceHandlers } from "./sources";
const platform = process.platform;
beforeEach(() => {
	vi.clearAllMocks();
	mocks.handlers.clear();
	mocks.recording = false;
	mocks.selected = null;
	mocks.windows.mockReturnValue([]);
	mocks.validate.mockImplementation(async (source) => source);
	mocks.exec.mockRejectedValue(new Error("wmctrl is not installed"));
	Object.defineProperty(process, "platform", { value: "linux" });
	vi.stubEnv("XDG_SESSION_TYPE", "x11");
});
afterEach(() => {
	Object.defineProperty(process, "platform", { value: platform });
	vi.unstubAllEnvs();
});
function pickerFixture() {
	let current: BrowserWindow | null = null;
	const win = Object.assign(new EventEmitter(), {
		webContents: {},
		close: () => {
			current = null;
			win.emit("closed");
		},
	});
	const create = vi.fn(() => {
		current = win as unknown as BrowserWindow;
		return current;
	});
	const createEditor = vi.fn();
	const { pickSourceList } = registerSourceHandlers({
		createEditorWindow: createEditor,
		createSourceSelectorWindow: create,
		getSourceSelectorWindow: () => current,
	});
	return {
		win,
		create,
		createEditor,
		pickSourceList,
		select: (source: SelectedSource) =>
			mocks.handlers.get("select-source")!({ sender: win.webContents }, source),
	};
}
for (const operatingSystem of ["darwin", "win32", "linux"]) {
	it(`opens recording onboarding from the HUD on ${operatingSystem}`, () => {
		Object.defineProperty(process, "platform", { value: operatingSystem });
		const picker = pickerFixture();
		const send = vi.fn();
		const destroyedSend = vi.fn();
		mocks.windows.mockReturnValue([
			{ isDestroyed: () => false, webContents: { send } },
			{ isDestroyed: () => true, webContents: { send: destroyedSend } },
		]);
		mocks.handlers.get("show-recording-permissions")!();
		expect(picker.createEditor).toHaveBeenCalledOnce();
		expect(mocks.writeAppSetting).toHaveBeenCalledWith(
			"recordly.onboarding.permissionsRequested",
			true,
		);
		expect(mocks.setHudRecordingPreparationActive).toHaveBeenCalledWith(false);
		expect(send).toHaveBeenCalledWith("recording-permissions-requested");
		expect(destroyedSend).not.toHaveBeenCalled();
	});
	it(`keeps recording onboarding closed during active capture on ${operatingSystem}`, () => {
		Object.defineProperty(process, "platform", { value: operatingSystem });
		const picker = pickerFixture();
		mocks.recording = true;
		mocks.handlers.get("show-recording-permissions")!();
		expect(picker.createEditor).not.toHaveBeenCalled();
		expect(mocks.writeAppSetting).not.toHaveBeenCalled();
		expect(mocks.setHudRecordingPreparationActive).not.toHaveBeenCalled();
		expect(mocks.windows).not.toHaveBeenCalled();
	});
}
it("never enumerates or previews Wayland sources before recording", async () => {
	vi.stubEnv("XDG_SESSION_TYPE", "wayland");
	expect(await getDesktopSources({ types: ["screen", "window"] })).toEqual([
		{ id: "screen:linux-portal", name: "System picker", sourceType: "screen" },
	]);
	expect(await getDesktopSources({ types: ["window"] })).toEqual([]);
	expect(mocks.sources).not.toHaveBeenCalled();
});
it("completes X11 selection even without optional window raising tools", async () => {
	const picker = pickerFixture();
	const pending = picker.pickSourceList();
	const source = { id: "window:101:0", name: "Document" };
	expect(await picker.select(source)).toEqual(source);
	expect(await pending).toEqual({ success: true, source });
	expect(mocks.remember).toHaveBeenCalledWith(source);
});
it("leaves the source list pending when a selected window no longer exists", async () => {
	const picker = pickerFixture();
	const pending = picker.pickSourceList();
	mocks.validate.mockResolvedValue(null);
	await expect(picker.select({ id: "window:101:0", name: "Document" })).rejects.toThrow(
		"no longer available",
	);
	expect(mocks.selected).toBeNull();
	expect(mocks.remember).not.toHaveBeenCalled();
	picker.win.close();
	expect(await pending).toEqual({ success: false, canceled: true });
});
it("does not apply a selection after the source list is dismissed during validation", async () => {
	const picker = pickerFixture();
	const pending = picker.pickSourceList();
	let finish!: (value: SelectedSource) => void;
	mocks.validate.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const source = { id: "screen:1:0", name: "Screen" };
	const selection = picker.select(source);
	picker.win.close();
	finish(source);
	await selection;
	expect(await pending).toEqual({ success: false, canceled: true });
	expect(mocks.selected).toBeNull();
	expect(mocks.remember).not.toHaveBeenCalled();
});
it("does not change sources if recording starts during validation", async () => {
	const picker = pickerFixture();
	const pending = picker.pickSourceList();
	mocks.validate.mockImplementation(async (source) => {
		mocks.recording = true;
		return source;
	});
	await picker.select({ id: "screen:1:0", name: "Screen" });
	expect(mocks.selected).toBeNull();
	expect(mocks.remember).not.toHaveBeenCalled();
	picker.win.close();
	expect(await pending).toEqual({ success: false, canceled: true });
});
