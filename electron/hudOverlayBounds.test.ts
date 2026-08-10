import { describe, expect, it } from "vitest";

import {
	getHudOverlayMouseReassertCommands,
	getHudOverlayWindowBounds,
	resizeHudOverlayFallbackBounds,
	resolveHudOverlayMousePolicy,
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

describe("resolveHudOverlayMousePolicy", () => {
	it("keeps transparent HUD pixels click-through while recording", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: true,
				requestedIgnore: true,
				recordingActive: true,
			}),
		).toEqual({ usePassthroughWindow: true, ignoreMouseEvents: true });
	});

	it("preserves the renderer's requested mouse policy outside recording", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: true,
				requestedIgnore: true,
				recordingActive: false,
			}),
		).toEqual({ usePassthroughWindow: true, ignoreMouseEvents: true });
	});

	it("keeps visible HUD controls interactive while recording", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: true,
				requestedIgnore: false,
				recordingActive: true,
			}),
		).toEqual({ usePassthroughWindow: true, ignoreMouseEvents: false });
	});

	it("retains the interactive compact fallback when passthrough is unsupported", () => {
		expect(
			resolveHudOverlayMousePolicy({
				mousePassthroughSupported: false,
				requestedIgnore: true,
				recordingActive: true,
			}),
		).toEqual({ usePassthroughWindow: false, ignoreMouseEvents: false });
	});
});

describe("getHudOverlayMouseReassertCommands", () => {
	it("restores passthrough immediately after resetting the Windows native flag", () => {
		expect(
			getHudOverlayMouseReassertCommands({
				usePassthroughWindow: true,
				ignoreMouseEvents: true,
			}),
		).toEqual([{ ignoreMouseEvents: false }, { ignoreMouseEvents: true, forward: true }]);
	});

	it("leaves an intentionally interactive HUD interactive after the reset", () => {
		expect(
			getHudOverlayMouseReassertCommands({
				usePassthroughWindow: true,
				ignoreMouseEvents: false,
			}),
		).toEqual([{ ignoreMouseEvents: false }]);
	});

	it("does not issue passthrough commands for compact fallback windows", () => {
		expect(
			getHudOverlayMouseReassertCommands({
				usePassthroughWindow: false,
				ignoreMouseEvents: false,
			}),
		).toEqual([]);
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
