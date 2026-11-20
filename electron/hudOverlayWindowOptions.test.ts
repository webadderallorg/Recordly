import { describe, expect, it } from "vitest";
import { getHudOverlayTaskbarOptions } from "./hudOverlayWindowOptions";

describe("getHudOverlayTaskbarOptions", () => {
	it("keeps a focusable HUD in the Windows taskbar", () => {
		expect(getHudOverlayTaskbarOptions("win32")).toEqual({
			skipTaskbar: false,
			focusable: true,
		});
	});

	it("uses an auxiliary macOS panel so the HUD can join full-screen Spaces", () => {
		expect(getHudOverlayTaskbarOptions("darwin")).toEqual({
			skipTaskbar: true,
			focusable: true,
			type: "panel",
			fullscreenable: false,
		});
	});

	it("keeps the Linux HUD non-focusable and out of the taskbar", () => {
		expect(getHudOverlayTaskbarOptions("linux")).toEqual({
			skipTaskbar: true,
			focusable: false,
		});
	});
});
