import { describe, expect, it } from "vitest";

import {
	getLinuxWindowSystem,
	getScreenSourceIdForDisplay,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
	shouldUseLinuxPortalSentinel,
} from "./sourceMapping";

describe("getScreenSourceIdForDisplay", () => {
	it("keeps the live Electron screen source when one is available", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: "screen:42:0",
				platform: "linux",
			}),
		).toBe("screen:42:0");
	});

	it("routes unmatched Linux Wayland screens through the portal sentinel", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe(LINUX_PORTAL_SCREEN_SOURCE_ID);
	});

	it("keeps unmatched Linux X11 screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe("screen:fallback:42");
	});

	it("keeps non-Linux unmatched screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: undefined,
				platform: "win32",
			}),
		).toBe("screen:fallback:42");
	});
});
describe("getLinuxWindowSystem", () => {
	it("returns null off Linux", () => {
		expect(getLinuxWindowSystem({ XDG_SESSION_TYPE: "x11" }, "darwin")).toBeNull();
	});

	it("detects Wayland from the session type or socket", () => {
		expect(getLinuxWindowSystem({ XDG_SESSION_TYPE: "wayland" }, "linux")).toBe("wayland");
		expect(getLinuxWindowSystem({ WAYLAND_DISPLAY: "wayland-0" }, "linux")).toBe("wayland");
	});

	it("detects X11 from the session type or an X display", () => {
		expect(getLinuxWindowSystem({ XDG_SESSION_TYPE: "x11" }, "linux")).toBe("x11");
		expect(getLinuxWindowSystem({ DISPLAY: ":1" }, "linux")).toBe("x11");
		expect(
			getLinuxWindowSystem(
				{ XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" },
				"linux",
			),
		).toBe("x11");
	});

	it("returns null on Linux without any display hints", () => {
		expect(getLinuxWindowSystem({}, "linux")).toBeNull();
	});
});

describe("shouldUseLinuxPortalSentinel", () => {
	const wayland = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" };
	const x11 = { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" };

	it("uses the sentinel on Wayland for the sentinel id or when nothing is selected", () => {
		expect(
			shouldUseLinuxPortalSentinel({
				env: wayland,
				platform: "linux",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(true);
		expect(
			shouldUseLinuxPortalSentinel({ env: wayland, platform: "linux", sourceId: null }),
		).toBe(true);
	});

	it("does not use the sentinel on Wayland when a concrete source is selected", () => {
		expect(
			shouldUseLinuxPortalSentinel({
				env: wayland,
				platform: "linux",
				sourceId: "screen:42:0",
			}),
		).toBe(false);
	});

	it("never uses the sentinel on X11, even for a stale sentinel id", () => {
		expect(shouldUseLinuxPortalSentinel({ env: x11, platform: "linux", sourceId: null })).toBe(
			false,
		);
		expect(
			shouldUseLinuxPortalSentinel({
				env: x11,
				platform: "linux",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(false);
	});

	it("never uses the sentinel off Linux", () => {
		expect(
			shouldUseLinuxPortalSentinel({ env: wayland, platform: "win32", sourceId: null }),
		).toBe(false);
	});
});
