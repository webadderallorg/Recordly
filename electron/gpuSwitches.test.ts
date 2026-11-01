import { describe, expect, it } from "vitest";

import { getGpuSwitches, isLinuxX11Session } from "./gpuSwitches";

describe("isLinuxX11Session", () => {
	it("is false in a Wayland session", () => {
		expect(
			isLinuxX11Session({
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(false);
	});

	it("is false when Wayland is explicitly requested via Ozone", () => {
		expect(
			isLinuxX11Session({
				OZONE_PLATFORM: "wayland",
				XDG_SESSION_TYPE: "x11",
			}),
		).toBe(false);
	});

	it("is true when launched with --ozone-platform=x11 from a Wayland session", () => {
		expect(
			isLinuxX11Session({ XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" }, [
				"/opt/Recordly/recordly",
				"--ozone-platform=x11",
			]),
		).toBe(true);
	});

	it("is false when launched with --ozone-platform=wayland from an X11 session", () => {
		expect(
			isLinuxX11Session({ XDG_SESSION_TYPE: "x11" }, [
				"recordly",
				"--ozone-platform=wayland",
			]),
		).toBe(false);
	});

	it("uses the last --ozone-platform switch when repeated", () => {
		expect(
			isLinuxX11Session({ XDG_SESSION_TYPE: "wayland" }, [
				"recordly",
				"--ozone-platform=wayland",
				"--ozone-platform=x11",
			]),
		).toBe(true);
	});

	it("prefers --ozone-platform over --ozone-platform-hint", () => {
		expect(
			isLinuxX11Session({ XDG_SESSION_TYPE: "x11" }, [
				"recordly",
				"--ozone-platform-hint=x11",
				"--ozone-platform=wayland",
			]),
		).toBe(false);
	});

	it("honors --ozone-platform-hint when --ozone-platform is absent", () => {
		expect(
			isLinuxX11Session({ WAYLAND_DISPLAY: "wayland-0" }, [
				"recordly",
				"--ozone-platform-hint=x11",
			]),
		).toBe(true);
	});

	it("falls back to the session when the ozone switch is auto", () => {
		expect(
			isLinuxX11Session({ XDG_SESSION_TYPE: "wayland" }, [
				"recordly",
				"--ozone-platform-hint=auto",
			]),
		).toBe(false);
	});

	it("is true in an X11 session", () => {
		expect(isLinuxX11Session({ XDG_SESSION_TYPE: "x11" })).toBe(true);
	});

	it("ignores ELECTRON_OZONE_PLATFORM_HINT, which Electron 43 no longer honors", () => {
		expect(
			isLinuxX11Session({
				ELECTRON_OZONE_PLATFORM_HINT: "x11",
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe(false);
	});
});

describe("getGpuSwitches", () => {
	it("returns the Linux VAAPI workaround on Wayland", () => {
		expect(
			getGpuSwitches("linux", {
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("does not force EGL on Linux X11", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});
});
