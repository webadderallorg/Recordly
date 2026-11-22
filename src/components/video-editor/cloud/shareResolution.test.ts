import { describe, expect, it } from "vitest";
import { capShareDimensions, getShareResolution } from "./shareResolution";

describe("shared video resolution", () => {
	it("uses 720p unless Plus is confirmed", () => {
		for (const plan of [undefined, "free", "unknown"])
			expect(getShareResolution(plan)).toBe(720);
		expect(getShareResolution("pro")).toBe(1080);
	});
	it.each([
		[3840, 2160, 720, 1280, 720],
		[3840, 2160, 1080, 1920, 1080],
		[2160, 3840, 720, 720, 1280],
		[2160, 3840, 1080, 1080, 1920],
		[2048, 2048, 720, 720, 720],
		[2048, 2048, 1080, 1080, 1080],
		[4096, 1024, 720, 1280, 320],
		[4096, 1024, 1080, 1920, 480],
		[640, 360, 1080, 640, 360],
		[641, 361, 720, 640, 360],
	] as const)("fits %ix%i into %ip", (width, height, resolution, expectedWidth, expectedHeight) => {
		expect(capShareDimensions({ width, height }, resolution)).toEqual({
			width: expectedWidth,
			height: expectedHeight,
		});
	});
	it("rejects unavailable metadata", () => {
		expect(() => capShareDimensions({ width: NaN, height: 0 }, 720)).toThrow();
	});
});
