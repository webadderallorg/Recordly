import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	sources: vi.fn(),
	mac: vi.fn(),
	linux: vi.fn(),
	dip: vi.fn(),
}));
vi.mock("electron", () => ({ systemPreferences: { getMediaAccessStatus: () => "granted" } }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("./cursor/bounds", () => ({
	getNativeMacWindowsFrontToBack: mocks.mac,
	resolveLinuxWindowBounds: mocks.linux,
}));
vi.mock("./register/sources", () => ({ getDesktopSources: mocks.sources }));
vi.mock("./utils", () => ({
	parseWindowId: (id?: string) => Number(id?.split(":")[1]),
	getScreen: () => ({ screenToDipRect: mocks.dip }),
}));
import { listCapturePickerWindows, parseStackingOrder } from "./capturePickerSources";
const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	vi.resetAllMocks();
	mocks.sources.mockResolvedValue([
		{ id: "window:101:0", name: "Front" },
		{ id: "window:102:0", name: "Back" },
	]);
});
describe("capture picker source adapters", () => {
	it("reads X11 stacking from topmost to bottommost", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		mocks.exec.mockResolvedValue({
			stdout: "_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x66, 0x65",
		});
		mocks.linux.mockResolvedValue({ x: 0, y: 0, width: 400, height: 300 });
		expect(parseStackingOrder("0x66, 0x65")).toEqual([101, 102]);
		expect((await listCapturePickerWindows()).map((entry) => entry.id)).toEqual([
			"window:101:0",
			"window:102:0",
		]);
	});
	it("matches Windows handles to real capture IDs and converts physical bounds to DIP", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.exec.mockResolvedValue({
			stdout: JSON.stringify([
				{ id: 999, x: 0, y: 0, width: 20, height: 20 },
				{ id: 101, x: -1600, y: 0, width: 800, height: 600 },
			]),
		});
		mocks.dip.mockReturnValue({ x: -800, y: 0, width: 400, height: 300 });
		expect(await listCapturePickerWindows()).toEqual([
			{
				id: "window:101:0",
				appName: "",
				title: "Front",
				display_id: undefined,
				x: -800,
				y: 0,
				width: 400,
				height: 300,
			},
		]);
		expect(mocks.dip).toHaveBeenCalledWith(null, expect.objectContaining({ x: -1600 }));
	});
	it("excludes Recordly's own macOS windows and invalid geometry", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		mocks.mac.mockResolvedValue([
			{ id: "window:1:0", ownerPid: process.pid, x: 0, y: 0, width: 10, height: 10 },
			{ id: "window:2:0", ownerPid: 99, name: "Other", x: 0, y: 0, width: 400, height: 300 },
			{ id: "window:3:0", width: Number.NaN },
		]);
		expect((await listCapturePickerWindows()).map((entry) => entry.id)).toEqual(["window:2:0"]);
	});
});
