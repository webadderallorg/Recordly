import { describe, expect, it } from "vitest";

import {
	clampHudDragToWorkArea,
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

describe("clampHudDragToWorkArea", () => {
	const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
	// Shape-mode window: 860x540 with the bar in its bottom strip.
	const barRect = { x: 148, y: 406, width: 565, height: 114 };

	it("leaves positions where the bar is fully visible untouched", () => {
		expect(clampHudDragToWorkArea(workArea, { x: 530, y: 500 }, barRect)).toEqual({
			x: 530,
			y: 500,
		});
	});

	it("stops the bar from being dragged past the top edge", () => {
		// Window y = -400 would put the bar (window-relative y 406) at y=6 —
		// visible. Window y = -500 would put it at -94 — clamped back.
		expect(clampHudDragToWorkArea(workArea, { x: 530, y: -400 }, barRect)).toEqual({
			x: 530,
			y: -400,
		});
		expect(clampHudDragToWorkArea(workArea, { x: 530, y: -500 }, barRect)).toEqual({
			x: 530,
			y: -406,
		});
	});

	it("stops the bar from being dragged past the bottom or side edges", () => {
		expect(clampHudDragToWorkArea(workArea, { x: 530, y: 900 }, barRect)).toEqual({
			x: 530,
			y: 560,
		});
		expect(clampHudDragToWorkArea(workArea, { x: -300, y: 500 }, barRect)).toEqual({
			x: -148,
			y: 500,
		});
		expect(clampHudDragToWorkArea(workArea, { x: 1800, y: 500 }, barRect)).toEqual({
			x: 1207,
			y: 500,
		});
	});

	it("respects the work area origin on secondary displays", () => {
		const second = { x: 1920, y: 0, width: 1920, height: 1080 };
		// x=1000 is left of this display entirely; the bar's left edge clamps
		// to the display's left edge (1920 - 148).
		expect(clampHudDragToWorkArea(second, { x: 1000, y: -800 }, barRect)).toEqual({
			x: 1772,
			y: -406,
		});
	});
});
