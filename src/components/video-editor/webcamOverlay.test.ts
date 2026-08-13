import { describe, expect, it } from "vitest";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamCropSourceRect,
	getWebcamOverlayDimensionsPx,
	getWebcamOverlayPosition,
	isWebcamCropRegionDefault,
	normalizeWebcamCropRegion,
} from "./webcamOverlay";

describe("normalizeWebcamCropRegion", () => {
	it("defaults to the full webcam frame", () => {
		expect(normalizeWebcamCropRegion()).toEqual({ x: 0, y: 0, width: 1, height: 1 });
		expect(isWebcamCropRegionDefault()).toBe(true);
	});

	it("clamps crop dimensions inside the source frame", () => {
		const crop = normalizeWebcamCropRegion({ x: 0.8, y: -1, width: 0.5, height: 2 });
		expect(crop.x).toBe(0.8);
		expect(crop.y).toBe(0);
		expect(crop.width).toBeCloseTo(0.2);
		expect(crop.height).toBe(1);
	});
});

describe("getWebcamOverlayDimensionsPx", () => {
	it("resolves independent width and height percentages", () => {
		expect(
			getWebcamOverlayDimensionsPx({
				containerWidth: 1000,
				containerHeight: 800,
				widthPercent: 50,
				heightPercent: 25,
				margin: 0,
				zoomScale: 1,
				reactToZoom: false,
			}),
		).toEqual({
			width: 400,
			height: 200,
		});
	});
});

describe("getWebcamOverlayPosition", () => {
	it("uses rectangular dimensions when anchoring to a preset", () => {
		expect(
			getWebcamOverlayPosition({
				containerWidth: 1000,
				containerHeight: 800,
				width: 400,
				height: 200,
				margin: 20,
				positionPreset: "bottom-right",
				positionX: 1,
				positionY: 1,
				legacyCorner: "bottom-right",
			}),
		).toEqual({ x: 580, y: 580 });
	});
});

describe("getCropMatchedWebcamHeightPercent", () => {
	it("matches height to a non-default crop aspect when width and height are linked", () => {
		expect(
			getCropMatchedWebcamHeightPercent(60, 60, 1920, 1080, {
				x: 0.1,
				y: 0.2,
				width: 0.6,
				height: 0.4,
			}),
		).toBeCloseTo(22.5);
	});

	it("preserves manually separated width and height controls", () => {
		expect(
			getCropMatchedWebcamHeightPercent(60, 45, 1920, 1080, {
				x: 0.1,
				y: 0.2,
				width: 0.6,
				height: 0.4,
			}),
		).toBe(45);
	});

	it("keeps the default crop square-compatible", () => {
		expect(getCropMatchedWebcamHeightPercent(60, 60, 1920, 1080, undefined)).toBe(60);
	});
});

describe("getWebcamCropSourceRect", () => {
	it("converts normalized crop settings to source pixels", () => {
		expect(
			getWebcamCropSourceRect({ x: 0.25, y: 0.1, width: 0.5, height: 0.75 }, 1920, 1080),
		).toEqual({
			sx: 480,
			sy: 108,
			sw: 960,
			sh: 810,
		});
	});
});
