import { describe, expect, it } from "vitest";
import { getCaptionBoxCenter, getCaptionWordVisualState } from "./captionStyle";

describe("caption position", () => {
	const screen = { width: 640, height: 360, boxWidth: 200, boxHeight: 40 };

	it("keeps the legacy centered caption and bottom offset", () => {
		expect(getCaptionBoxCenter({ ...screen, horizontalPosition: 50, bottomOffset: 3 })).toEqual(
			{
				centerX: 320,
				centerY: 329.2,
			},
		);
	});

	it("keeps the whole caption inside the top and bottom corners", () => {
		expect(
			getCaptionBoxCenter({ ...screen, horizontalPosition: 0, bottomOffset: 100 }),
		).toEqual({
			centerX: 100,
			centerY: 20,
		});
		expect(
			getCaptionBoxCenter({ ...screen, horizontalPosition: 100, bottomOffset: 0 }),
		).toEqual({
			centerX: 540,
			centerY: 340,
		});
	});
});

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
