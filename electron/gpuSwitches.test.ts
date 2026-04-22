import { describe, expect, it } from "vitest";

import { getGpuSwitches, shouldForceLinuxEgl } from "./gpuSwitches";

describe("shouldForceLinuxEgl", () => {
	it("does not force EGL in a Wayland session", () => {
		expect(
			shouldForceLinuxEgl({
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(false);
	});

	it("does not force EGL when Wayland is explicitly requested via Ozone", () => {
		expect(
			shouldForceLinuxEgl({
				OZONE_PLATFORM: "wayland",
				XDG_SESSION_TYPE: "x11",
			}),
		).toBe(false);
	});

	it("falls back to Electron's ozone hint when OZONE_PLATFORM is invalid", () => {
		expect(
			shouldForceLinuxEgl({
				OZONE_PLATFORM: "auto",
				ELECTRON_OZONE_PLATFORM_HINT: "wayland",
				XDG_SESSION_TYPE: "x11",
			}),
		).toBe(false);
	});

	it("forces EGL in an X11 session", () => {
		expect(shouldForceLinuxEgl({ XDG_SESSION_TYPE: "x11" })).toBe(true);
	});

	it("forces EGL when x11 is explicitly requested via Electron's ozone hint", () => {
		expect(
			shouldForceLinuxEgl({
				ELECTRON_OZONE_PLATFORM_HINT: "x11",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(true);
	});
});

describe("getGpuSwitches", () => {
	it("returns the Linux VAAPI workaround without forcing EGL on Wayland", () => {
		expect(
			getGpuSwitches("linux", {
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toEqual({
			useGl: undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("returns the X11 EGL workaround on Linux X11", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			useGl: "egl",
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});
});
