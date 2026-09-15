import { describe, expect, it } from "vitest";

import {
	getGpuSwitches,
	getLinuxOzonePlatformOverride,
	isHyprlandSession,
	shouldForceLinuxEgl,
} from "./gpuSwitches";

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

	it("ignores invalid OZONE_PLATFORM values", () => {
		expect(
			shouldForceLinuxEgl({
				OZONE_PLATFORM: "auto",
				XDG_SESSION_TYPE: "x11",
			}),
		).toBe(true);
	});

	it("forces EGL in an X11 session", () => {
		expect(shouldForceLinuxEgl({ XDG_SESSION_TYPE: "x11" })).toBe(true);
	});

	it("forces EGL when X11 is explicitly requested via OZONE_PLATFORM", () => {
		expect(
			shouldForceLinuxEgl({
				OZONE_PLATFORM: "x11",
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

describe("isHyprlandSession", () => {
	it("detects Hyprland from the compositor instance signature", () => {
		expect(isHyprlandSession({ HYPRLAND_INSTANCE_SIGNATURE: "abc" })).toBe(true);
	});

	it("detects Hyprland from XDG_CURRENT_DESKTOP", () => {
		expect(isHyprlandSession({ XDG_CURRENT_DESKTOP: "Hyprland" })).toBe(true);
		expect(isHyprlandSession({ XDG_CURRENT_DESKTOP: "sway:Hyprland" })).toBe(true);
	});

	it("ignores non-Hyprland sessions", () => {
		expect(isHyprlandSession({ XDG_CURRENT_DESKTOP: "GNOME" })).toBe(false);
	});
});

describe("getLinuxOzonePlatformOverride", () => {
	it("defaults Hyprland to X11/Ozone", () => {
		expect(
			getLinuxOzonePlatformOverride({
				XDG_SESSION_TYPE: "wayland",
				XDG_CURRENT_DESKTOP: "Hyprland",
			}),
		).toBe("x11");
	});

	it("does not override an explicit Wayland request via OZONE_PLATFORM", () => {
		expect(
			getLinuxOzonePlatformOverride({
				XDG_CURRENT_DESKTOP: "Hyprland",
				OZONE_PLATFORM: "wayland",
			}),
		).toBeNull();
	});

	it("does not override an explicit X11 request", () => {
		expect(
			getLinuxOzonePlatformOverride({
				XDG_CURRENT_DESKTOP: "Hyprland",
				OZONE_PLATFORM: "x11",
			}),
		).toBeNull();
	});

	it("does not affect other Linux desktops", () => {
		expect(
			getLinuxOzonePlatformOverride({
				XDG_SESSION_TYPE: "wayland",
				XDG_CURRENT_DESKTOP: "GNOME",
			}),
		).toBeNull();
	});
});
