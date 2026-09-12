import { describe, expect, it } from "vitest";

import { isWaylandSession } from "./hudOverlaySession";

describe("isWaylandSession", () => {
	it("detects Wayland via XDG_SESSION_TYPE", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "wayland" })).toBe(true);
	});

	it("detects Wayland via WAYLAND_DISPLAY", () => {
		expect(isWaylandSession({ WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
	});

	it("detects Wayland when both variables are set", () => {
		expect(
			isWaylandSession({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-1" }),
		).toBe(true);
	});

	it("reports X11 sessions as non-Wayland", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "x11" })).toBe(false);
	});

	it("reports undefined session variables as non-Wayland", () => {
		expect(isWaylandSession({})).toBe(false);
	});

	it("ignores empty environment values", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "", WAYLAND_DISPLAY: "" })).toBe(false);
	});

	it("treats a set WAYLAND_DISPLAY as Wayland even when XDG_SESSION_TYPE says x11", () => {
		expect(isWaylandSession({ XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" })).toBe(
			true,
		);
	});
});
