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
