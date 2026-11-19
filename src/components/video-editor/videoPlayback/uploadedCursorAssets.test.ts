import { describe, expect, it } from "vitest";
import { invertCursorPixelData } from "./cursorAssetRasterization";
import { hasBakedCursorShadow } from "./cursorRenderConfig";
import { cursorSetAssets, getCursorStyleSizeMultiplier } from "./uploadedCursorAssets";

describe("Windows system cursor assets", () => {
	it("uses the native 32px cursor hotspots", () => {
		expect(cursorSetAssets.windows11.arrow.fallbackAnchor).toEqual({ x: 0, y: 0 });
		expect(cursorSetAssets.windows11.pointer.fallbackAnchor).toEqual({ x: 6 / 32, y: 0 });
		expect(cursorSetAssets.windows11["resize-ew"].fallbackAnchor).toEqual({
			x: 11 / 32,
			y: 4 / 32,
		});
		expect(cursorSetAssets.windows11["resize-ns"].fallbackAnchor).toEqual({
			x: 4 / 32,
			y: 11 / 32,
		});
		expect(cursorSetAssets.windows11["not-allowed"].fallbackAnchor).toEqual({
			x: 8 / 32,
			y: 8 / 32,
		});
	});

	it("normalizes the Windows cursor set from the measured arrow pixel height", () => {
		expect(getCursorStyleSizeMultiplier("windows11")).toBeCloseTo(512 / 304, 8);
	});
});

describe("original cursor shadows", () => {
	it("keeps the baked Golden Gate arrow/hand/text shadows without losing the clean crosshair shadow", () => {
		for (const style of ["tahoe", "tahoe-inverted"] as const) {
			for (const key of [
				"arrow",
				"pointer",
				"text",
				"open-hand",
				"closed-hand",
				"resize-ew",
				"resize-ns",
				"not-allowed",
			] as const) {
				expect(hasBakedCursorShadow(style, cursorSetAssets.tahoe[key])).toBe(true);
			}
			expect(hasBakedCursorShadow(style, cursorSetAssets.tahoe.crosshair)).toBe(false);
		}
	});
	it("retains procedural shadows for unshadowed Windows and outline artwork", () => {
		expect(hasBakedCursorShadow("windows11", cursorSetAssets.windows11.arrow)).toBe(false);
		expect(hasBakedCursorShadow("bold-outline")).toBe(false);
	});
});

it("inverts visible body pixels without turning baked black alpha shadows into white halos", () => {
	const pixels = new Uint8ClampedArray([
		0, 0, 0, 70, 0, 0, 0, 255, 255, 255, 255, 128, 30, 40, 50, 0,
	]);
	invertCursorPixelData(pixels, true);
	expect([...pixels]).toEqual([0, 0, 0, 70, 255, 255, 255, 255, 0, 0, 0, 128, 30, 40, 50, 0]);
	const cleanOutline = new Uint8ClampedArray([0, 0, 0, 70]);
	invertCursorPixelData(cleanOutline, false);
	expect([...cleanOutline]).toEqual([255, 255, 255, 70]);
});
