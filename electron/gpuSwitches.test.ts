import { describe, expect, it } from "vitest";

import { getGpuSwitches } from "./gpuSwitches";

describe("getGpuSwitches", () => {
	it("returns the Linux VAAPI workaround without forcing a GL implementation on Wayland", () => {
		expect(
			getGpuSwitches("linux", {
				XDG_SESSION_TYPE: "wayland",
				WAYLAND_DISPLAY: "wayland-0",
			}),
		).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("does not force a GL implementation on Linux X11", () => {
		expect(getGpuSwitches("linux", { XDG_SESSION_TYPE: "x11" })).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});

	it("does not force a GL implementation when the session type is unknown", () => {
		expect(getGpuSwitches("linux", {})).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
	});
});
