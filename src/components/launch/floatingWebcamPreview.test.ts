import { describe, expect, it } from "vitest";

import {
	canShowFloatingWebcamPreview,
	canToggleFloatingWebcamPreview,
	DEFAULT_WEBCAM_PREVIEW_SIZE,
	parseWebcamPreviewSize,
	resizeWebcamPreview,
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

describe("parseWebcamPreviewSize", () => {
	it("restores a stored size clamped to the allowed range", () => {
		expect(parseWebcamPreviewSize('{"width":200,"height":150}')).toEqual({
			width: 200,
			height: 150,
		});
		expect(parseWebcamPreviewSize('{"width":10,"height":9000}')).toEqual({
			width: 120,
			height: 480,
		});
	});

	it("falls back to the default size for missing or corrupt values", () => {
		for (const stored of [null, "", "not json", "null", '{"width":"big"}']) {
			expect(parseWebcamPreviewSize(stored)).toEqual(DEFAULT_WEBCAM_PREVIEW_SIZE);
		}
	});
});

describe("resizeWebcamPreview", () => {
	const viewport = { width: 1440, height: 900 };
	const start = { left: 1000, top: 400, right: 1288, bottom: 688 };

	it("grows from the top-left corner without moving the anchored bottom-right edge", () => {
		expect(resizeWebcamPreview("nw", start, -50, -20, viewport)).toEqual({
			width: 338,
			height: 308,
			shiftX: 0,
			shiftY: 0,
		});
	});

	it("shifts the offset when resizing from the bottom-right so the top-left stays put", () => {
		expect(resizeWebcamPreview("se", start, -100, -60, viewport)).toEqual({
			width: 188,
			height: 228,
			shiftX: -100,
			shiftY: -60,
		});
	});

	it("enforces the minimum and maximum size", () => {
		expect(resizeWebcamPreview("ne", start, -1000, 1000, viewport)).toMatchObject({
			width: 120,
			height: 120,
		});
		expect(resizeWebcamPreview("sw", start, -1000, 1000, viewport)).toMatchObject({
			width: 480,
			height: 480,
		});
	});

	it("never pushes the dragged edge past the viewport", () => {
		const nearCorner = { left: 20, top: 30, right: 308, bottom: 318 };
		expect(resizeWebcamPreview("nw", nearCorner, -100, -100, viewport)).toMatchObject({
			width: 308,
			height: 318,
		});
		const nearEdge = { left: 1300, top: 700, right: 1420, bottom: 820 };
		expect(resizeWebcamPreview("se", nearEdge, 200, 200, viewport)).toMatchObject({
			width: 140,
			height: 200,
		});
	});
});
