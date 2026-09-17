import { describe, expect, it } from "vitest";
import { clampSpotlightOpacity } from "./useAnnotationRegionCommands";

describe("clampSpotlightOpacity", () => {
	it("keeps values within 0-100", () => {
		expect(clampSpotlightOpacity(-5)).toBe(0);
		expect(clampSpotlightOpacity(42)).toBe(42);
		expect(clampSpotlightOpacity(250)).toBe(100);
	});

	it("falls back to the default for non-finite input", () => {
		expect(clampSpotlightOpacity(Number.NaN)).toBe(50);
	});
});
