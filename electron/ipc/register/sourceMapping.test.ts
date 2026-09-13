import { describe, expect, it } from "vitest";

import {
	getLinuxWindowSystem,
	getScreenSourceIdForDisplay,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
	shouldUseLinuxPortalSentinel,
} from "./sourceMapping";

describe("Linux window-system source routing", () => {
	it("keeps the portal sentinel on Wayland", () => {
		const env = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" };
		expect(getLinuxWindowSystem(env, "linux")).toBe("wayland");
		expect(
			shouldUseLinuxPortalSentinel({
				env,
				platform: "linux",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(true);
	});

	it("never routes X11 through the portal sentinel", () => {
		const env = { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" };
		expect(getLinuxWindowSystem(env, "linux")).toBe("x11");
		expect(
			shouldUseLinuxPortalSentinel({
				env,
				platform: "linux",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(false);
		expect(shouldUseLinuxPortalSentinel({ env, platform: "linux", sourceId: null })).toBe(
			false,
		);
	});
});

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
