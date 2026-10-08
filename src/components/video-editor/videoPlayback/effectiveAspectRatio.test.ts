import { describe, expect, it } from "vitest";
import { getEffectiveNativeAspectRatio } from "./effectiveAspectRatio";

describe("getEffectiveNativeAspectRatio", () => {
	const full = { x: 0, y: 0, width: 1, height: 1 };

	it("falls back to 16:9 without usable dimensions", () => {
		expect(getEffectiveNativeAspectRatio(null)).toBeCloseTo(16 / 9);
		expect(getEffectiveNativeAspectRatio({ width: 0, height: 1080 })).toBeCloseTo(16 / 9);
	});

	it("uses the full video when uncropped", () => {
		expect(getEffectiveNativeAspectRatio({ width: 1920, height: 1080 }, full)).toBeCloseTo(
			16 / 9,
		);
	});

	it("follows the crop, so a widescreen video cropped to a portrait column is tall", () => {
		const ratio = getEffectiveNativeAspectRatio(
			{ width: 1920, height: 1080 },
			{ x: 0.4, y: 0, width: 0.25, height: 1 },
		);
		expect(ratio).toBeCloseTo(480 / 1080);
		expect(ratio).toBeLessThan(1);
	});
});
