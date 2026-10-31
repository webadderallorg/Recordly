import { describe, expect, it } from "vitest";
import { getHudOverlayTaskbarOptions } from "./hudOverlayWindowOptions";

describe("getHudOverlayTaskbarOptions", () => {
	it("keeps a focusable HUD in the Windows taskbar", () => {
		expect(getHudOverlayTaskbarOptions("win32")).toEqual({
			skipTaskbar: false,
			focusable: true,
		});
	});

	it.each([
		"darwin",
		"linux",
	] as const)("keeps the HUD non-focusable and out of the taskbar on %s", (platform) => {
		expect(getHudOverlayTaskbarOptions(platform)).toEqual({
			skipTaskbar: true,
			focusable: false,
		});
	});
});
