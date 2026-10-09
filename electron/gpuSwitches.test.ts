import { describe, expect, it } from "vitest";

import { getGpuSwitches, shouldForceLinuxEgl } from "./gpuSwitches";

describe("shouldForceLinuxEgl", () => {
	it("does not force EGL by default in a Wayland session", () => {
		expect(
			shouldForceLinuxEgl({
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(false);
	});

	it("does not force EGL by default in an X11 session", () => {
		expect(shouldForceLinuxEgl({ XDG_SESSION_TYPE: "x11" })).toBe(false);
	});

	it("forces EGL when explicitly requested via RECORDLY_FORCE_EGL", () => {
		expect(shouldForceLinuxEgl({ RECORDLY_FORCE_EGL: "1" })).toBe(true);
		expect(shouldForceLinuxEgl({ RECORDLY_FORCE_EGL: "true" })).toBe(true);
		expect(shouldForceLinuxEgl({ RECORDLY_FORCE_EGL: "0" })).toBe(false);
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
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("returns the Linux VAAPI workaround without forcing EGL on Linux X11", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("respects RECORDLY_USE_GL and RECORDLY_USE_ANGLE overrides on Linux", () => {
		expect(
			getGpuSwitches("linux", {
				RECORDLY_USE_GL: "angle",
				RECORDLY_USE_ANGLE: "gl",
			}),
		).toEqual({
			useGl: "angle",
			useAngle: "gl",
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("respects RECORDLY_FORCE_EGL on Linux when explicitly enabled", () => {
		expect(
			getGpuSwitches("linux", {
				RECORDLY_FORCE_EGL: "1",
			}),
		).toEqual({
			useGl: "egl",
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});
});
