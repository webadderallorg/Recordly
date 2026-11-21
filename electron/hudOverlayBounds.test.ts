import { describe, expect, it } from "vitest";

import {
	getHudOverlayWindowBounds,
	getX11HudRecordingShape,
	resizeHudOverlayFallbackBounds,
	shouldExpandHudOverlayFallback,
} from "./hudOverlayBounds";

describe("getX11HudRecordingShape", () => {
	it("keeps separate rendered regions from blocking the area between them", () => {
		expect(
			getX11HudRecordingShape(
				[
					{ left: 312.5, top: 74, right: 547.5, bottom: 128 },
					{ left: 72, top: 10, right: 270, bottom: 128 },
				],
				{ width: 860, height: 160 },
			),
		).toEqual([
			{ x: 304, y: 66, width: 252, height: 70 },
			{ x: 64, y: 2, width: 214, height: 134 },
		]);
	});

	it("clips to the viewport and ignores empty or non-finite regions", () => {
		expect(
			getX11HudRecordingShape(
				[
					{ left: -3, top: 113.5, right: 84, bottom: 160 },
					{ left: 880, top: 10, right: 900, bottom: 18 },
					{ left: 120, top: 0, right: 140, bottom: 0 },
					{ left: 30, top: 45, right: Number.POSITIVE_INFINITY, bottom: 50 },
				],
				{ width: 860, height: 160 },
			),
		).toEqual([{ x: 0, y: 105, width: 92, height: 55 }]);
	});
});

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

	it("uses a bottom-centered compact fallback when mouse passthrough is unavailable", () => {
		expect(getHudOverlayWindowBounds(workArea, false)).toEqual({
			x: 650,
			y: 920,
			width: 860,
			height: 160,
		});
	});

	it("expands the non-passthrough fallback for HUD menus and hover interaction", () => {
		expect(getHudOverlayWindowBounds(workArea, false, true)).toEqual({
			x: 650,
			y: 540,
			width: 860,
			height: 540,
		});
	});

	it("keeps the compact fallback inside small displays", () => {
		expect(
			getHudOverlayWindowBounds(
				{
					x: -100,
					y: 20,
					width: 640,
					height: 420,
				},
				false,
			),
		).toEqual({
			x: -100,
			y: 280,
			width: 640,
			height: 160,
		});
	});

	it("restores the dragged bottom edge after expanding against the top of a display", () => {
		const dragged = { x: 310, y: 95, width: 860, height: 160 };
		expect(getHudOverlayWindowBounds(workArea, false, true, dragged)).toEqual({
			x: 310,
			y: 40,
			width: 860,
			height: 540,
		});
		expect(getHudOverlayWindowBounds(workArea, false, false, dragged)).toEqual(dragged);
	});

	it("fits the expanded fallback inside small displays", () => {
		expect(
			getHudOverlayWindowBounds(
				{
					x: -100,
					y: 20,
					width: 640,
					height: 420,
				},
				false,
				true,
			),
		).toEqual({
			x: -100,
			y: 20,
			width: 640,
			height: 420,
		});
	});
});

describe("resizeHudOverlayFallbackBounds", () => {
	const workArea = {
		x: 0,
		y: 0,
		width: 1920,
		height: 1080,
	};

	it("preserves the dragged bottom edge when expanding", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 700,
					width: 860,
					height: 160,
				},
				true,
			),
		).toEqual({
			x: 420,
			y: 320,
			width: 860,
			height: 540,
		});
	});

	it("preserves the dragged bottom edge when compacting", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 320,
					width: 860,
					height: 540,
				},
				false,
			),
		).toEqual({
			x: 420,
			y: 700,
			width: 860,
			height: 160,
		});
	});

	it("keeps resized fallback bounds inside the display work area", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 1500,
					y: 900,
					width: 860,
					height: 160,
				},
				true,
			),
		).toEqual({
			x: 1060,
			y: 520,
			width: 860,
			height: 540,
		});
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
