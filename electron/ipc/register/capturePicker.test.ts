import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	list: vi.fn(),
	validate: vi.fn(),
	remember: vi.fn(),
	selected: vi.fn(),
	currentSource: null as Record<string, unknown> | null,
	create: vi.fn(),
	close: vi.fn(),
	overlay: {},
	outsider: {},
	windows: [] as object[],
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => unknown) =>
			mocks.handlers.set(name, handler),
	},
	BrowserWindow: { fromWebContents: (sender: unknown) => sender },
}));
vi.mock("../../windows", () => ({
	createCapturePickerWindows: mocks.create,
	closeCapturePickerWindows: mocks.close,
	getCapturePickerWindows: () => mocks.windows,
}));
vi.mock("../captureSelection", () => ({
	validateCaptureSource: mocks.validate,
	rememberCaptureSource: mocks.remember,
}));
vi.mock("../capturePickerSources", () => ({ listCapturePickerWindows: mocks.list }));
vi.mock("../cursor/bounds", () => ({ stopWindowBoundsCapture: vi.fn() }));
vi.mock("../state", () => ({
	setSelectedSource: mocks.selected,
	get selectedSource() {
		return mocks.currentSource;
	},
}));
vi.mock("../utils", () => ({
	getScreen: () => ({
		getAllDisplays: () => [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 1000 } }],
		getPrimaryDisplay: () => ({ id: 1 }),
		getCursorScreenPoint: () => ({ x: 0, y: 0 }),
	}),
}));
vi.mock("./sources", () => ({
	bringSelectedWindowForward: vi.fn(),
	broadcastSelectedSourceChange: vi.fn(),
	getDesktopSources: vi.fn().mockResolvedValue([{ id: "screen:1:0", display_id: "1" }]),
}));
import { registerCapturePickerHandlers } from "./capturePicker";
const platform = process.platform;
afterEach(() => {
	Object.defineProperty(process, "platform", { value: platform });
	vi.unstubAllEnvs();
});
beforeEach(() => {
	vi.clearAllMocks();
	mocks.handlers.clear();
	mocks.currentSource = null;
	mocks.windows = [mocks.overlay];
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.list.mockResolvedValue([]);
	mocks.validate.mockImplementation(async (source) => source);
	registerCapturePickerHandlers();
});
const call = (name: string, sender: object, input?: unknown) =>
	mocks.handlers.get(name)!({ sender }, input);
describe("selection-only picker IPC", () => {
	it("ignores completion from other windows and forces selection-only completion", async () => {
		const pending = call("pick-capture-target", mocks.outsider);
		await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		await call("complete-capture-pick", mocks.outsider, {
			kind: "screen",
			displayId: 1,
			record: true,
		});
		expect(mocks.selected).not.toHaveBeenCalled();
		await call("complete-capture-pick", mocks.overlay, {
			kind: "screen",
			displayId: 1,
			record: true,
		});
		expect(await pending).toMatchObject({ success: true, source: { id: "screen:1:0" } });
		expect(await pending).not.toHaveProperty("record");
	});
	it("coalesces simultaneous opens into one picker", async () => {
		const first = call("pick-capture-target", mocks.outsider);
		const second = call("pick-capture-target", mocks.outsider);
		await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		await call("complete-capture-pick", mocks.overlay, null);
		expect(await first).toEqual({ success: false, canceled: true });
		expect(await second).toEqual({ success: false, canceled: true });
	});
	it("keeps Wayland on the existing portal path without overlays or geometry probes", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		expect(await call("pick-capture-target", mocks.outsider)).toMatchObject({
			success: true,
			source: { id: "screen:linux-portal" },
		});
		expect(mocks.create).not.toHaveBeenCalled();
		expect(mocks.list).not.toHaveBeenCalled();
	});
});

it("rejects a window that disappeared while the picker was open", async () => {
	mocks.list.mockResolvedValue([
		{
			id: "window:101:0",
			title: "Document",
			appName: "Notes",
			x: 0,
			y: 0,
			width: 400,
			height: 300,
		},
	]);
	mocks.validate.mockResolvedValue(null);
	const pending = call("pick-capture-target", mocks.outsider);
	await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
	await call("complete-capture-pick", mocks.overlay, {
		kind: "window",
		windowId: "window:101:0",
		displayId: 1,
	});
	expect(await pending).toMatchObject({
		success: false,
		message: "That window or screen is no longer available.",
	});
	expect(mocks.selected).not.toHaveBeenCalled();
	expect(mocks.remember).not.toHaveBeenCalled();
});
it("surfaces detection failures instead of opening a screen-only overlay", async () => {
	mocks.list.mockRejectedValue(new Error("Unable to detect windows"));
	expect(await call("pick-capture-target", mocks.outsider)).toMatchObject({
		success: false,
		message: "Unable to detect windows",
	});
	expect(mocks.create).not.toHaveBeenCalled();
	expect(mocks.selected).not.toHaveBeenCalled();
});

it("reopens the currently selected saved area, without reusing an old area for a window", async () => {
	mocks.currentSource = {
		id: "area:1",
		display_id: "1",
		area: { x: 100, y: 200, width: 400, height: 300 },
	};
	expect(await call("get-capture-picker-context", mocks.overlay, 1)).toMatchObject({
		lastArea: mocks.currentSource.area,
	});
	mocks.currentSource = { id: "window:101:0", display_id: "1" };
	expect(await call("get-capture-picker-context", mocks.overlay, 1)).toMatchObject({
		lastArea: null,
	});
});
