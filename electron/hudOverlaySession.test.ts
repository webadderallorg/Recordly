import { describe, expect, it } from "vitest";

import { isWaylandSession } from "./hudOverlaySession";

describe("isWaylandSession", () => {
	it("detects Wayland from XDG_SESSION_TYPE", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "wayland" })).toBe(true);
		expect(isWaylandSession({ XDG_SESSION_TYPE: " Wayland " })).toBe(true);
	});

	it("detects Wayland from WAYLAND_DISPLAY", () => {
		expect(isWaylandSession({ WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
	});

	it("does not treat X11 or empty variables as Wayland", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "x11" })).toBe(false);
		expect(isWaylandSession({ XDG_SESSION_TYPE: "", WAYLAND_DISPLAY: "  " })).toBe(false);
		expect(isWaylandSession({})).toBe(false);
	});

	it("prefers an exposed Wayland socket when both session hints exist", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" })).toBe(
			true,
		);
	});
});
