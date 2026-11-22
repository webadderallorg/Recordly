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

	it("does not force EGL in an X11 session", () => {
		expect(shouldForceLinuxEgl({ XDG_SESSION_TYPE: "x11" })).toBe(false);
	});

	it("does not confuse an explicit X11 session request with a supported GL implementation", () => {
		expect(
			shouldForceLinuxEgl({
				ELECTRON_OZONE_PLATFORM_HINT: "x11",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(false);
	});
	it("retains an explicit native EGL opt-in", () => {
		expect(shouldForceLinuxEgl({ RECORDLY_FORCE_EGL: "1" })).toBe(true);
		expect(shouldForceLinuxEgl({ RECORDLY_FORCE_EGL: " true " })).toBe(true);
		expect(shouldForceLinuxEgl({ RECORDLY_FORCE_EGL: "0" })).toBe(false);
	});
});

describe("getGpuSwitches", () => {
	it("keeps macOS audio in-process while preserving Metal and the capture workaround", () => {
		expect(getGpuSwitches("darwin", {})).toEqual({
			useAngle: "metal",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare", "AudioServiceOutOfProcess"],
		});
	});

	it("leaves Windows audio process isolation enabled", () => {
		expect(getGpuSwitches("win32", {})).toEqual({ useAngle: "d3d11" });
	});

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

	it("leaves Linux X11 GL selection to Chromium", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			useGl: undefined,
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});
});
