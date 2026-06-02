import { describe, expect, it } from "vitest";
import { scalePreviewBorderRadius } from "./layoutUtils";

describe("scalePreviewBorderRadius", () => {
	it("matches export scaling against the logical preview size", () => {
		expect(scalePreviewBorderRadius(1920, 1080, 16)).toBeCloseTo(16, 6);
		expect(scalePreviewBorderRadius(960, 540, 16)).toBeCloseTo(8, 6);
		expect(scalePreviewBorderRadius(1440, 810, 16)).toBeCloseTo(12, 6);
	});

	it("clamps invalid or empty preview sizes to zero", () => {
		expect(scalePreviewBorderRadius(0, 540, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 0, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 540, -8)).toBe(0);
	});
});