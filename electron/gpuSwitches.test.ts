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

	it("does not force EGL on X11 session", () => {
		expect(shouldForceLinuxEgl({ XDG_SESSION_TYPE: "x11" })).toBe(false);
	});
});

describe("getGpuSwitches", () => {
	it("returns the Linux VAAPI workaround on Linux Wayland", () => {
		expect(
			getGpuSwitches("linux", {
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("returns VAAPI + WebRTCPipeWireCapturer disable on Linux X11", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder", "WebRTCPipeWireCapturer"],
		});
	});
});
