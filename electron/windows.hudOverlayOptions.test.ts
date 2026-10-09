import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
	app: { isReady: () => true, getPath: () => "/tmp", getAppPath: () => "/tmp" },
	BrowserWindow: class {},
	ipcMain: { on: vi.fn(), once: vi.fn(), handle: vi.fn(), removeListener: vi.fn() },
	screen: {},
}));

describe("setHudOverlayOptions without a control pill", () => {
	it("changes nothing, so a later pill does not open hidden", async () => {
		const windows = await import("./windows");
		const state = windows.setHudOverlayOptions({
			hidden: true,
			position: "top-left",
			clickThrough: "on",
		});
		expect(state).toEqual({
			position: "default",
			hidden: false,
			clickThrough: "auto",
			windowOpen: false,
		});
		expect(windows.getHudOverlayState().hidden).toBe(false);
	});
});
