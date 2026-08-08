import { afterEach, describe, expect, it, vi } from "vitest";

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

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses the full work area when mouse passthrough is supported", () => {
		expect(getHudOverlayWindowBounds(workArea, true)).toEqual(workArea);
	});

	it("uses full display work area bounds on Linux when mouse passthrough is false", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("linux");
		expect(getHudOverlayWindowBounds(workArea, false)).toEqual(workArea);
	});

	it("uses a bottom-centered compact fallback on non-Linux when mouse passthrough is unavailable", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		expect(getHudOverlayWindowBounds(workArea, false)).toEqual({
			x: 480,
			y: 920,
			width: 1200,
			height: 160,
		});
	});

	it("expands the non-Linux fallback for HUD menus and hover interaction", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
		expect(getHudOverlayWindowBounds(workArea, false, true)).toEqual({
			x: 480,
			y: 480,
			width: 1200,
			height: 600,
		});
	});

	it("keeps the non-Linux compact fallback inside small displays", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
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

	it("fits the non-Linux expanded fallback inside small displays", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
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

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns full work area on Linux", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("linux");
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

	it("preserves the dragged bottom edge on non-Linux when expanding", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
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
		).toEqual({
			x: 420,
			y: 260,
			width: 1200,
			height: 600,
		});
	});

	it("preserves the dragged bottom edge on non-Linux when compacting", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
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
		).toEqual({
			x: 420,
			y: 700,
			width: 1200,
			height: 160,
		});
	});

	it("keeps resized fallback bounds inside display work area on non-Linux", () => {
		vi.spyOn(process, "platform", "get").mockReturnValue("win32");
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
		).toEqual({
			x: 720,
			y: 460,
			width: 1200,
			height: 600,
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
