import { describe, expect, it } from "vitest";

import { ADVANCED_VERTICAL_PADDING_MAX } from "../types";
import { computePaddedLayout, scalePreviewBorderRadius } from "./layoutUtils";

const BASE_LAYOUT_PARAMS = {
	width: 1000,
	height: 1000,
	cropRegion: { x: 0, y: 0, width: 1, height: 1 },
	videoWidth: 1000,
	videoHeight: 1000,
};

describe("computePaddedLayout", () => {
	it("allows advanced bottom padding to pin the video to the top edge", () => {
		const layout = computePaddedLayout({
			...BASE_LAYOUT_PARAMS,
			padding: {
				top: 0,
				bottom: ADVANCED_VERTICAL_PADDING_MAX,
				left: 0,
				right: 0,
				linked: false,
			},
		});

		expect(layout.centerOffsetY).toBeCloseTo(0);
	});

	it("allows advanced top padding to pin the video to the bottom edge", () => {
		const layout = computePaddedLayout({
			...BASE_LAYOUT_PARAMS,
			padding: {
				top: ADVANCED_VERTICAL_PADDING_MAX,
				bottom: 0,
				left: 0,
				right: 0,
				linked: false,
			},
		});

		expect(layout.centerOffsetY + layout.croppedDisplayHeight).toBeCloseTo(
			BASE_LAYOUT_PARAMS.height,
		);
	});

	it("preserves linked padding centering behavior", () => {
		const layout = computePaddedLayout({
			...BASE_LAYOUT_PARAMS,
			padding: { top: 20, bottom: 20, left: 20, right: 20, linked: true },
		});

		expect(layout.centerOffsetY).toBeCloseTo(40);
		expect(layout.centerOffsetY + layout.croppedDisplayHeight).toBeCloseTo(960);
	});
});

describe("scalePreviewBorderRadius", () => {
	it("keeps edge-to-edge output square at preview and export sizes", () => {
		for (const [width, height] of [
			[960, 540],
			[1920, 1080],
			[1080, 1920],
		]) {
			expect(scalePreviewBorderRadius(width, height, 8, { width, height })).toBe(0);
		}
	});
	it("treats subpixel native-aspect fitting as edge-to-edge", () => {
		expect(scalePreviewBorderRadius(935.111111, 526, 8, { width: 936, height: 526 })).toBe(0);
	});
	it("preserves rounded inset and letterboxed content", () => {
		expect(scalePreviewBorderRadius(1728, 972, 8, { width: 1920, height: 1080 })).toBeCloseTo(
			77.76,
		);
		expect(scalePreviewBorderRadius(1080, 1080, 8, { width: 1920, height: 1080 })).toBeCloseTo(
			86.4,
		);
	});

	it("uses a percentage of the content's shorter side", () => {
		expect(scalePreviewBorderRadius(1920, 1080, 8)).toBeCloseTo(86.4, 6);
		expect(scalePreviewBorderRadius(960, 540, 8)).toBeCloseTo(43.2, 6);
		expect(scalePreviewBorderRadius(500, 1000, 8)).toBeCloseTo(40, 6);
	});

	it("clamps invalid or empty preview sizes to zero", () => {
		expect(scalePreviewBorderRadius(0, 540, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 0, 16)).toBe(0);
		expect(scalePreviewBorderRadius(960, 540, -8)).toBe(0);
	});
});
