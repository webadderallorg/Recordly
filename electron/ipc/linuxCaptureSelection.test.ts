import { describe, expect, it } from "vitest";
import { isX11CaptureSession, shouldUseNativeLinuxCaptureForSource } from "./linuxCaptureSelection";

describe("isX11CaptureSession", () => {
	it("accepts a plain X11 display", () => {
		expect(isX11CaptureSession({ DISPLAY: ":0" })).toBe(true);
	});

	it("rejects a missing display", () => {
		expect(isX11CaptureSession({})).toBe(false);
		expect(isX11CaptureSession({ DISPLAY: "  " })).toBe(false);
	});

	it("rejects a native Wayland session", () => {
		expect(isX11CaptureSession({ DISPLAY: ":0", XDG_SESSION_TYPE: "wayland" })).toBe(false);
		expect(
			isX11CaptureSession({ DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" }),
		).toBe(false);
	});

	it("accepts XWayland sessions that still expose DISPLAY", () => {
		expect(
			isX11CaptureSession({
				DISPLAY: ":0",
				XDG_SESSION_TYPE: "x11",
				WAYLAND_DISPLAY: undefined,
			}),
		).toBe(true);
	});
});

describe("shouldUseNativeLinuxCaptureForSource", () => {
	it("accepts screen sources", () => {
		expect(shouldUseNativeLinuxCaptureForSource({ id: "screen:1" })).toBe(true);
	});

	it("rejects window and other sources", () => {
		expect(shouldUseNativeLinuxCaptureForSource({ id: "window:42" })).toBe(false);
		expect(shouldUseNativeLinuxCaptureForSource({ id: "screen:linux-portal" })).toBe(true);
		expect(shouldUseNativeLinuxCaptureForSource(null)).toBe(false);
		expect(shouldUseNativeLinuxCaptureForSource({})).toBe(false);
	});
});
