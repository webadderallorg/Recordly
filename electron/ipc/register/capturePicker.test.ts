import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	list: vi.fn(),
	selected: vi.fn(),
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
vi.mock("../capturePickerSources", () => ({ listCapturePickerWindows: mocks.list }));
vi.mock("../cursor/bounds", () => ({ stopWindowBoundsCapture: vi.fn() }));
vi.mock("../state", () => ({ setSelectedSource: mocks.selected }));
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
	mocks.windows = [mocks.overlay];
	Object.defineProperty(process, "platform", { value: "darwin" });
	mocks.list.mockResolvedValue([]);
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
