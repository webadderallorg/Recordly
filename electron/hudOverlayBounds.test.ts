import { describe, expect, it } from "vitest";

import {
	getHudOverlayWindowBounds,
	resizeHudOverlayFallbackBounds,
	shouldExpandHudOverlayFallback,
} from "./hudOverlayBounds";

describe("getHudOverlayWindowBounds", () => {
	const workArea = {
		x: 120,
		y: 40,
		width: 1920,
		height: 1040,
	};

	it("uses the full work area when mouse passthrough is supported", () => {
		expect(getHudOverlayWindowBounds(workArea, true)).toEqual(workArea);
	});

	it("uses the full work area when mouse passthrough is supported", () => {
		expect(getHudOverlayWindowBounds(workArea, true)).toEqual(workArea);
	});

	it("uses full display work area bounds for the overlay window", () => {
		expect(getHudOverlayWindowBounds(workArea, false)).toEqual(workArea);
	});

	it("expands to full work area bounds", () => {
		expect(getHudOverlayWindowBounds(workArea, false, true)).toEqual(workArea);
	});

	it("preserves full work area bounds inside small displays", () => {
		const small = { x: -100, y: 20, width: 640, height: 420 };
		expect(getHudOverlayWindowBounds(small, false)).toEqual(small);
	});
});

describe("resizeHudOverlayFallbackBounds", () => {
	const workArea = {
		x: 0,
		y: 0,
		width: 1920,
		height: 1080,
	};

	it("returns full work area when expanding", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 700,
					width: 1200,
					height: 160,
				},
				true,
			),
		).toEqual(workArea);
	});

	it("returns full work area when compacting", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 260,
					width: 1200,
					height: 600,
				},
				false,
			),
		).toEqual(workArea);
	});

	it("returns full work area inside the display work area", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 1500,
					y: 900,
					width: 1200,
					height: 160,
				},
				true,
			),
		).toEqual(workArea);
	});
});

describe("shouldExpandHudOverlayFallback", () => {
	it("expands while recording only when the floating webcam preview is visible", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: true,
				webcamPreviewVisible: true,
			}),
		).toBe(true);
	});

	it("keeps the compact recording fallback when there is no webcam preview", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: true,
				webcamPreviewVisible: false,
			}),
		).toBe(false);
	});

	it("preserves manual fallback expansion outside recording", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: true,
				recordingActive: false,
				webcamPreviewVisible: false,
			}),
		).toBe(true);
	});

	it("does not expand for webcam visibility outside recording", () => {
		expect(
			shouldExpandHudOverlayFallback({
				fallbackExpanded: false,
				recordingActive: false,
				webcamPreviewVisible: true,
			}),
		).toBe(false);
	});
});
