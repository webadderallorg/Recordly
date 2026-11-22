import { describe, expect, it } from "vitest";
import { getHudOverlayTaskbarOptions, supportsX11HudWindowDrag } from "./hudOverlayWindowOptions";

it("uses programmatic HUD movement for X11 and an explicit XWayland launch", () => {
	const x11 = { DISPLAY: ":0", XDG_SESSION_TYPE: "x11" };
	const wayland = { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" };
	expect(supportsX11HudWindowDrag("linux", x11)).toBe(true);
	expect(supportsX11HudWindowDrag("linux", wayland, "x11")).toBe(true);
	expect(supportsX11HudWindowDrag("linux", wayland)).toBe(false);
	expect(supportsX11HudWindowDrag("linux", x11, "wayland")).toBe(false);
	expect(supportsX11HudWindowDrag("linux", {})).toBe(false);
	expect(supportsX11HudWindowDrag("darwin", x11)).toBe(false);
});

describe("getHudOverlayTaskbarOptions", () => {
	it("keeps a focusable HUD in the Windows taskbar", () => {
		expect(getHudOverlayTaskbarOptions("win32")).toEqual({
			skipTaskbar: false,
			focusable: true,
		});
	});

	it("uses a non-activating macOS panel so HUD clicks do not raise Home", () => {
		expect(getHudOverlayTaskbarOptions("darwin")).toEqual({
			skipTaskbar: true,
			focusable: true,
			type: "panel",
		});
	});

	it("keeps the Linux HUD non-focusable and out of the taskbar", () => {
		expect(getHudOverlayTaskbarOptions("linux")).toEqual({
			skipTaskbar: true,
			focusable: false,
		});
	});
});
