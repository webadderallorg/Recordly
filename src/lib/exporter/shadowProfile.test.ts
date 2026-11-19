import { describe, expect, it } from "vitest";
import {
	getWebcamShadowFilter,
	getWebcamShadowPadding,
	getShadowFilterPadding,
	getWebcamShadowStrength,
	getVideoShadowStrength,
	getVideoShadowFilter,
	WEBCAM_SHADOW_LAYER_PROFILES,
} from "./shadowProfile";

describe("getWebcamShadowStrength", () => {
	it("doubles the webcam shadow response and clamps it", () => {
		expect(getWebcamShadowStrength(0)).toBe(0);
		expect(getWebcamShadowStrength(0.25)).toBe(0.5);
		expect(getWebcamShadowStrength(0.5)).toBe(1);
		expect(getWebcamShadowStrength(1)).toBe(1);
	});

	it("adds a tighter contact shadow so strength also increases density", () => {
		expect(WEBCAM_SHADOW_LAYER_PROFILES).toHaveLength(2);
		expect(getWebcamShadowFilter(100, 0)).toBe("none");
		const filter = getWebcamShadowFilter(100, 0.5);
		expect(filter.match(/drop-shadow/g)).toHaveLength(2);
		expect(filter).toContain("rgba(0, 0, 0, 0.24)");
		expect(filter).toContain("rgba(0, 0, 0, 0.38)");
	});
});

describe("video shadow strength", () => {
	it("doubles the response so 50% is the previous maximum and 100% is stronger", () => {
		for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(getVideoShadowStrength(invalid)).toBe(0);
			expect(getVideoShadowFilter(1, invalid)).toBe("none");
		}
		expect(getVideoShadowStrength(0.5)).toBe(1);
		expect(getVideoShadowStrength(1)).toBe(2);
		expect(getVideoShadowFilter(1, 0.5)).toBe(
			"drop-shadow(0 12px 28px rgba(0, 0, 0, 0.24)) drop-shadow(0 2px 3px rgba(0, 0, 0, 0.38))",
		);
		expect(getVideoShadowFilter(1, 2)).toBe(getVideoShadowFilter(1, 1));
	});
});

describe("shadow blur bounds", () => {
	it("reserves three blur radii plus offset so zoomed shadows are not clipped", () => {
		expect(getShadowFilterPadding(20, 5)).toBe(65);
		expect(getShadowFilterPadding(20, -5)).toBe(65);
	});
	it("includes expansion from every chained camera shadow", () => {
		expect(getWebcamShadowPadding(200, 0)).toBe(0);
		expect(getWebcamShadowPadding(200, 0.5)).toBeGreaterThanOrEqual(107);
		expect(getWebcamShadowPadding(200, 0.5)).toBeLessThanOrEqual(109);
	});
});
