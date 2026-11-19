import { describe, expect, it } from "vitest";
import { getCaptionWordVisualState } from "./captionStyle";

describe("caption current-word colors", () => {
	it("uses the foreground for the current word and inactive color for surrounding words", () => {
		expect(getCaptionWordVisualState(true, "active").isInactive).toBe(false);
		expect(getCaptionWordVisualState(true, "active").isHighlighted).toBe(true);
		expect(getCaptionWordVisualState(true, "spoken").isHighlighted).toBe(false);
		expect(getCaptionWordVisualState(true, "upcoming").isHighlighted).toBe(false);
		expect(getCaptionWordVisualState(true, "spoken").isInactive).toBe(true);
		expect(getCaptionWordVisualState(true, "upcoming").isInactive).toBe(true);
	});

	it("keeps sentence-only captions uniformly readable", () => {
		for (const state of ["active", "spoken", "upcoming"] as const) {
			expect(getCaptionWordVisualState(false, state)).toEqual({
				isInactive: false,
				isHighlighted: false,
				opacity: 1,
			});
		}
	});
});
