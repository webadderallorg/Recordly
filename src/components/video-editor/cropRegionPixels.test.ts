import { describe, expect, it } from "vitest";
import { cropRegionFromPixels, cropRegionToPixels } from "./cropRegionPixels";

describe("cropRegionPixels", () => {
	it("converts normalized crop regions into source pixel values", () => {
		expect(
			cropRegionToPixels(
				{
					x: 0.25,
					y: 0.1,
					width: 0.5,
					height: 0.75,
				},
				1920,
				1080,
			),
		).toEqual({
			x: 480,
			y: 108,
			width: 960,
			height: 810,
		});
	});

	it("converts source pixel values back into normalized crop regions", () => {
		expect(cropRegionFromPixels({ x: 100, y: 50, width: 500, height: 300 }, 1000, 500))
			.toEqual({
				x: 0.1,
				y: 0.1,
				width: 0.5,
				height: 0.6,
			});
	});

	it("clamps pixel input to the source bounds and minimum crop size", () => {
		expect(cropRegionFromPixels({ x: 995, y: 498, width: 1, height: 1 }, 1000, 500))
			.toEqual({
				x: 0.99,
				y: 0.99,
				width: 0.01,
				height: 0.01,
			});
	});
});
