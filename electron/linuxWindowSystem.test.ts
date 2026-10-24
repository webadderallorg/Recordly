import { expect, it } from "vitest";
import { getLinuxWindowSystem } from "./linuxWindowSystem";

it.each([
	[{ XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" }, undefined, "wayland"],
	[{ XDG_SESSION_TYPE: "wayland" }, "x11", "x11"],
	[{ XDG_SESSION_TYPE: "x11" }, "wayland", "wayland"],
	[{ XDG_SESSION_TYPE: "x11", WAYLAND_DISPLAY: "wayland-0" }, undefined, "x11"],
	[{ WAYLAND_DISPLAY: "wayland-0" }, undefined, "wayland"],
	[{ OZONE_PLATFORM: "x11", XDG_SESSION_TYPE: "wayland" }, undefined, "wayland"],
	[{ ELECTRON_OZONE_PLATFORM_HINT: "x11", XDG_SESSION_TYPE: "wayland" }, undefined, "wayland"],
] as const)("identifies the UI window system for %o / %s", (env, ozone, expected) => {
	expect(getLinuxWindowSystem(env, ozone)).toBe(expected);
});
