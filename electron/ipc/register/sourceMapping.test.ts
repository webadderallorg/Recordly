import { describe, expect, it } from "vitest";

import {
	getScreenSourceIdForDisplay,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
	shouldUseSyntheticLinuxPortalSource,
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

describe("shouldUseSyntheticLinuxPortalSource", () => {
	it("keeps Wayland portal capture on the synthetic source path", () => {
		expect(
			shouldUseSyntheticLinuxPortalSource({
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				platform: "linux",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(true);
	});

	it("lets X11 use Electron desktopCapturer sources instead of a synthetic id", () => {
		expect(
			shouldUseSyntheticLinuxPortalSource({
				env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
				platform: "linux",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(false);
	});

	it("recovers stale fallback ids through the synthetic path on Wayland", () => {
		expect(
			shouldUseSyntheticLinuxPortalSource({
				env: { WAYLAND_DISPLAY: "wayland-0" },
				platform: "linux",
				sourceId: "screen:fallback:0",
			}),
		).toBe(true);
	});

	it("defaults unknown Linux sessions with WAYLAND_DISPLAY to the synthetic path", () => {
		expect(
			shouldUseSyntheticLinuxPortalSource({
				env: { WAYLAND_DISPLAY: "wayland-0" },
				platform: "linux",
				sourceId: null,
			}),
		).toBe(true);
	});

	it("does not synthesize for concrete source ids", () => {
		expect(
			shouldUseSyntheticLinuxPortalSource({
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				platform: "linux",
				sourceId: "screen:42:0",
			}),
		).toBe(false);
	});

	it("does not synthesize outside Linux", () => {
		expect(
			shouldUseSyntheticLinuxPortalSource({
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				platform: "win32",
				sourceId: LINUX_PORTAL_SCREEN_SOURCE_ID,
			}),
		).toBe(false);
	});
});
