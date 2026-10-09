import { describe, expect, it } from "vitest";
import {
	buildHudWindowShape,
	padShapeRect,
	shapeKey,
	toShapeRect,
} from "./hudOverlayShape";

const windowSize = { width: 860, height: 540 };
const bar = { x: 148, y: 406, width: 565, height: 114 };

describe("padShapeRect", () => {
	it("expands a rect by the pad on every side", () => {
		expect(padShapeRect(bar, windowSize)).toEqual({
			x: 138,
			y: 396,
			width: 585,
			height: 134,
		});
	});

	it("clamps into the window bounds", () => {
		const atEdge = padShapeRect(
			{ x: 0, y: 500, width: 860, height: 40 },
			windowSize,
		);
		expect(atEdge).toEqual({ x: 0, y: 490, width: 860, height: 50 });
	});

	it("drops rects entirely outside the window", () => {
		expect(
			padShapeRect({ x: 0, y: 600, width: 100, height: 50 }, windowSize),
		).toBeNull();
	});
});

describe("toShapeRect", () => {
	it("converts a DOM rect to a rounded window-relative rect", () => {
		expect(
			toShapeRect({ top: 406.4, left: 147.6, right: 713.2, bottom: 519.8 }),
		).toEqual({ x: 148, y: 406, width: 566, height: 113 });
	});
});

describe("buildHudWindowShape", () => {
	it("returns just the padded bar when no popover is open", () => {
		expect(buildHudWindowShape({ windowSize, bar })).toEqual([
			{ x: 138, y: 396, width: 585, height: 134 },
		]);
	});

	it("adds the padded popover rect when a menu is open", () => {
		const popover = { x: 270, y: 80, width: 320, height: 300 };
		const shape = buildHudWindowShape({ windowSize, bar, popover });
		expect(shape).toEqual([
			{ x: 138, y: 396, width: 585, height: 134 },
			{ x: 260, y: 70, width: 340, height: 320 },
		]);
	});

	it("ignores a popover that falls entirely outside the window", () => {
		const outside = buildHudWindowShape({
			windowSize,
			bar,
			popover: { x: 0, y: -500, width: 320, height: 300 },
		});
		expect(outside).toHaveLength(1);
	});
});

describe("shapeKey", () => {
	it("is stable across rect order and identical shapes", () => {
		const a = shapeKey([
			{ x: 1, y: 2, width: 3, height: 4 },
			{ x: 5, y: 6, width: 7, height: 8 },
		]);
		const b = shapeKey([
			{ x: 5, y: 6, width: 7, height: 8 },
			{ x: 1, y: 2, width: 3, height: 4 },
		]);
		expect(a).toBe(b);
		expect(a).not.toBe(shapeKey([{ x: 1, y: 2, width: 3, height: 5 }]));
	});
});
