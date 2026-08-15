import { describe, expect, it } from "vitest";
import { resolveLinuxWindowSystem } from "./linuxWindowSystem";

describe("resolveLinuxWindowSystem", () => {
	it("uses validated Ozone settings before session environment fallbacks", () => {
		expect(
			resolveLinuxWindowSystem("linux", {
				OZONE_PLATFORM: "auto",
				ELECTRON_OZONE_PLATFORM_HINT: "x11",
				XDG_SESSION_TYPE: "wayland",
			}),
		).toBe("x11");
	});

	it("uses the explicit session type before display variables", () => {
		expect(
			resolveLinuxWindowSystem("linux", {
				XDG_SESSION_TYPE: "x11",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toBe("x11");
	});

	it("falls back to the available display variable", () => {
		expect(resolveLinuxWindowSystem("linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe("wayland");
		expect(resolveLinuxWindowSystem("linux", { DISPLAY: ":0" })).toBe("x11");
	});

	it("returns null outside Linux", () => {
		expect(resolveLinuxWindowSystem("darwin", { XDG_SESSION_TYPE: "wayland" })).toBeNull();
	});
});
