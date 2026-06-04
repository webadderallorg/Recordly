import { describe, expect, it } from "vitest";

import {
	getHudOverlayWindowBounds,
	resizeHudOverlayFallbackBounds,
	shouldExpandHudOverlayFallback,
	shouldResizeHudOverlayFallback,
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
			x: 720,
			y: 960,
			width: 720,
			height: 120,
		});
	});

	it("expands the non-passthrough fallback for HUD menus and hover interaction", () => {
		expect(getHudOverlayWindowBounds(workArea, false, true)).toEqual({
			x: 720,
			y: 560,
			width: 720,
			height: 520,
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
			y: 320,
			width: 640,
			height: 120,
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
					width: 720,
					height: 120,
				},
				true,
			),
		).toEqual({
			x: 420,
			y: 300,
			width: 720,
			height: 520,
		});
	});

	it("preserves the dragged bottom edge when compacting", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 420,
					y: 300,
					width: 720,
					height: 520,
				},
				false,
			),
		).toEqual({
			x: 420,
			y: 700,
			width: 720,
			height: 120,
		});
	});

	it("keeps resized fallback bounds inside the display work area", () => {
		expect(
			resizeHudOverlayFallbackBounds(
				workArea,
				{
					x: 1500,
					y: 900,
					width: 720,
					height: 120,
				},
				true,
			),
		).toEqual({
			x: 1200,
			y: 500,
			width: 720,
			height: 520,
		});
	});
});

describe("shouldResizeHudOverlayFallback", () => {
	it("allows non-passthrough HUD windows to expand for menus when idle", () => {
		expect(shouldResizeHudOverlayFallback(false, false)).toBe(true);
	});

	it("does not resize full passthrough HUD windows", () => {
		expect(shouldResizeHudOverlayFallback(true, false)).toBe(false);
	});

	it("keeps the recording HUD compact in non-passthrough mode", () => {
		expect(shouldResizeHudOverlayFallback(false, true)).toBe(false);
	});

	it("keeps the fallback stable while source selection is active", () => {
		expect(shouldResizeHudOverlayFallback(false, false, true)).toBe(false);
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
});
