import { describe, expect, it } from "vitest";

import {
	canShowFloatingWebcamPreview,
	canToggleFloatingWebcamPreview,
	clampPreviewPosition,
	resolvePreviewViewport,
} from "./floatingWebcamPreview";

describe("canShowFloatingWebcamPreview", () => {
	it("shows the floating preview only when it was requested and passthrough is supported", () => {
		expect(canShowFloatingWebcamPreview(true, true)).toBe(true);
		expect(canShowFloatingWebcamPreview(false, true)).toBe(false);
		expect(canShowFloatingWebcamPreview(true, false)).toBe(false);
		expect(canShowFloatingWebcamPreview(true, null)).toBe(false);
	});
});

describe("canToggleFloatingWebcamPreview", () => {
	it("keeps the toggle visible while support is unknown or available", () => {
		expect(canToggleFloatingWebcamPreview(null)).toBe(true);
		expect(canToggleFloatingWebcamPreview(true)).toBe(true);
	});

	it("hides the toggle when the platform cannot support the floating preview", () => {
		expect(canToggleFloatingWebcamPreview(false)).toBe(false);
	});
});

describe("resolvePreviewViewport", () => {
	it("uses the window viewport, not the display, so the preview cannot leave its window", () => {
		// HUD overlay covers the work area: shorter than the display because of
		// the menu bar and Dock. Clamping to screen.height let the preview be
		// dragged below the window's bottom edge, where it clipped and vanished.
		expect(
			resolvePreviewViewport({ width: 1512, height: 916 }, { width: 1512, height: 982 }),
		).toEqual({ width: 1512, height: 916 });
	});

	it("falls back to the display only for a degenerate zero viewport", () => {
		expect(resolvePreviewViewport({ width: 0, height: 0 }, { width: 1512, height: 982 })).toEqual({
			width: 1512,
			height: 982,
		});
		expect(resolvePreviewViewport({ width: 0, height: 0 }, null)).toEqual({ width: 0, height: 0 });
	});
});

describe("clampPreviewPosition", () => {
	const preview = { width: 240, height: 240 };
	const viewport = { width: 1512, height: 916 };

	it("keeps the preview fully inside the viewport", () => {
		expect(clampPreviewPosition({ left: 4000, top: 4000 }, preview, viewport)).toEqual({
			left: 1272,
			top: 676,
		});
		expect(clampPreviewPosition({ left: -500, top: -500 }, preview, viewport)).toEqual({
			left: 0,
			top: 0,
		});
	});

	it("leaves an in-bounds position untouched", () => {
		expect(clampPreviewPosition({ left: 100, top: 100 }, preview, viewport)).toEqual({
			left: 100,
			top: 100,
		});
	});

	it("pins to the origin when the preview is larger than the viewport", () => {
		expect(
			clampPreviewPosition({ left: 50, top: 50 }, { width: 300, height: 300 }, { width: 200, height: 200 }),
		).toEqual({ left: 0, top: 0 });
	});
});
