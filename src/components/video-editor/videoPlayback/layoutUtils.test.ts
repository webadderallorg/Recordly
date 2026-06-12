import { describe, expect, it } from "vitest";
import {
	computePaddedLayout,
	type PaddedLayoutResult,
	scalePreviewBorderRadius,
} from "./layoutUtils";

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

describe("computePaddedLayout fillFrameProgress", () => {
	// 16:10 video inside a 16:9 canvas.
	const baseParams = {
		width: 1920,
		height: 1080,
		padding: 10,
		frameInsets: null,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		videoWidth: 1920,
		videoHeight: 1200,
	};

	it("matches the current framed result exactly at progress 0 (and when omitted)", () => {
		const framed = computePaddedLayout(baseParams);
		expect(computePaddedLayout({ ...baseParams, fillFrameProgress: 0 })).toEqual(framed);

		// Framed regression: padding 10 -> 2% per side, contain fit on the height axis.
		const availableW = 1920 * 0.96;
		const availableH = 1080 * 0.96;
		expect(framed.scale).toBeCloseTo(Math.min(availableW / 1920, availableH / 1200), 9);
	});

	it("covers the canvas at progress 1: scale on the width axis, height overflows", () => {
		const cover = computePaddedLayout({ ...baseParams, fillFrameProgress: 1 });
		// cover scale = max(1920/1920, 1080/1200) = 1 -> width axis matches.
		expect(cover.scale).toBeCloseTo(1, 9);
		expect(cover.fullVideoDisplayWidth).toBeCloseTo(1920, 9);
		expect(cover.fullVideoDisplayHeight).toBeCloseTo(1200, 9);
		// Height overflows the 1080 canvas, centered (cropped top/bottom).
		expect(cover.centerOffsetY).toBeCloseTo((1080 - 1200) / 2, 9);
		expect(cover.centerOffsetX).toBeCloseTo(0, 9);
		// Padding is ignored at full progress.
		expect(cover).toEqual(
			computePaddedLayout({ ...baseParams, padding: 0, fillFrameProgress: 1 }),
		);
	});

	it("ignores frame insets at progress 1", () => {
		const withInsets = computePaddedLayout({
			...baseParams,
			frameInsets: { top: 0.1, right: 0.1, bottom: 0.1, left: 0.1 },
			fillFrameProgress: 1,
		});
		expect(withInsets).toEqual(computePaddedLayout({ ...baseParams, fillFrameProgress: 1 }));
	});

	it("lerps every numeric field strictly between framed and cover at the midpoint", () => {
		const framed = computePaddedLayout(baseParams);
		const cover = computePaddedLayout({ ...baseParams, fillFrameProgress: 1 });
		const mid = computePaddedLayout({ ...baseParams, fillFrameProgress: 0.5 });

		for (const key of Object.keys(framed) as Array<keyof PaddedLayoutResult>) {
			expect(mid[key]).toBeCloseTo((framed[key] + cover[key]) / 2, 9);
			if (framed[key] !== cover[key]) {
				const low = Math.min(framed[key], cover[key]);
				const high = Math.max(framed[key], cover[key]);
				expect(mid[key]).toBeGreaterThan(low);
				expect(mid[key]).toBeLessThan(high);
			}
		}
	});

	it("clamps progress to 0..1", () => {
		expect(computePaddedLayout({ ...baseParams, fillFrameProgress: -0.5 })).toEqual(
			computePaddedLayout(baseParams),
		);
		expect(computePaddedLayout({ ...baseParams, fillFrameProgress: 1.5 })).toEqual(
			computePaddedLayout({ ...baseParams, fillFrameProgress: 1 }),
		);
	});
});
