import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
	sources: vi.fn(),
	mac: vi.fn(),
	dip: vi.fn(),
	geometry: vi.fn(),
}));
vi.mock("./windowsWindowGeometry", () => ({ readWindowsWindowGeometry: mocks.geometry }));
vi.mock("electron", () => ({ systemPreferences: { getMediaAccessStatus: () => "granted" } }));
vi.mock("node:util", () => ({ promisify: () => mocks.exec }));
vi.mock("./cursor/bounds", () => ({
	getNativeMacWindowsFrontToBack: mocks.mac,
}));
vi.mock("./register/sources", () => ({ getDesktopSources: mocks.sources }));
vi.mock("./utils", () => ({
	parseWindowId: (id?: string) => Number(id?.split(":")[1]),
	getScreen: () => ({ screenToDipRect: mocks.dip }),
}));

import { listCapturePickerWindows } from "./capturePickerSources";

const platform = process.platform;
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));
beforeEach(() => {
	vi.resetAllMocks();
	mocks.geometry.mockRejectedValue(new Error("older helper"));
	mocks.sources.mockResolvedValue([
		{ id: "window:101:0", name: "Front" },
		{ id: "window:102:0", name: "Back" },
	]);
});
describe("capture picker source adapters", () => {
	it("uses native Windows geometry without starting PowerShell", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.geometry.mockResolvedValue([
			{ id: 101, ownerPid: process.pid + 1, x: 100, y: 80, width: 800, height: 600 },
		]);
		mocks.dip.mockImplementation((_window, bounds) => bounds);
		expect((await listCapturePickerWindows()).map((entry) => entry.id)).toEqual([
			"window:101:0",
		]);
		expect(mocks.geometry).toHaveBeenCalledWith(["--list-windows"]);
		expect(mocks.exec).not.toHaveBeenCalled();
	});
	it("keeps Linux window selection on its source list without X11 helper probes", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		await expect(listCapturePickerWindows()).rejects.toThrow("Use the source list on Linux");
		expect(mocks.exec).not.toHaveBeenCalled();
	});
	it("matches Windows handles to real capture IDs and converts physical bounds to DIP", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.exec.mockResolvedValue({
			stdout: JSON.stringify([
				{ id: 999, ownerPid: 99, x: 0, y: 0, width: 20, height: 20 },
				{ id: 101, ownerPid: 99, x: -1600, y: 0, width: 800, height: 600 },
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
	it("excludes Recordly's fullscreen Windows HUD without hiding other apps named Recordly", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		mocks.sources.mockResolvedValue([
			{ id: "window:100:0", name: "Recordly" },
			{ id: "window:101:0", name: "Recordly — browser" },
		]);
		mocks.exec.mockResolvedValue({
			stdout: JSON.stringify([
				{ id: 100, ownerPid: process.pid, x: 0, y: 0, width: 1920, height: 1080 },
				{ id: 101, ownerPid: process.pid + 1, x: 100, y: 100, width: 800, height: 600 },
			]),
		});
		mocks.dip.mockImplementation((_window, bounds) => bounds);
		expect((await listCapturePickerWindows()).map((entry) => entry.id)).toEqual([
			"window:101:0",
		]);
		expect(mocks.dip).toHaveBeenCalledTimes(1);
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
