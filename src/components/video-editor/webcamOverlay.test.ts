import { describe, expect, it } from "vitest";
import {
	clampWebcamOverlayPosition,
	getSnappedWebcamPositionPoint,
	getWebcamAvoidCursorPosition,
	getWebcamCropDrawLayout,
	getWebcamCropSourceRect,
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

describe("getWebcamAvoidCursorPosition", () => {
	it("keeps the current position when the cursor is far away", () => {
		const currentPosition = { x: 720, y: 420 };

		expect(
			getWebcamAvoidCursorPosition({
				containerWidth: 960,
				containerHeight: 540,
				size: 160,
				margin: 24,
				currentPosition,
				cursor: { x: 120, y: 120 },
				legacyCorner: "bottom-right",
			}),
		).toEqual(currentPosition);
	});

	it("moves to the corner farthest from the cursor when the cursor enters the bubble radius", () => {
		expect(
			getWebcamAvoidCursorPosition({
				containerWidth: 960,
				containerHeight: 540,
				size: 160,
				margin: 24,
				currentPosition: { x: 776, y: 356 },
				cursor: { x: 850, y: 430 },
				legacyCorner: "bottom-right",
			}),
		).toEqual({ x: 24, y: 24 });
	});
});

describe("getWebcamOverlayPosition", () => {
	it("uses independent height when anchoring a stretched webcam", () => {
		expect(
			getWebcamOverlayPosition({
				containerWidth: 960,
				containerHeight: 540,
				size: 160,
				height: 260,
				margin: 24,
				positionPreset: "bottom-right",
				positionX: 1,
				positionY: 1,
				legacyCorner: "bottom-right",
			}),
		).toEqual({ x: 776, y: 256 });
	});
});

describe("clampWebcamOverlayPosition", () => {
	it("keeps a resizing webcam inside the canvas bounds", () => {
		expect(
			clampWebcamOverlayPosition({
				containerWidth: 960,
				containerHeight: 540,
				size: 260,
				height: 220,
				margin: 24,
				position: { x: 820, y: 400 },
			}),
		).toEqual({ x: 676, y: 296 });
	});
});

describe("getWebcamCropDrawLayout", () => {
	it("reveals more vertical source without increasing scale when the frame stretches upward", () => {
		const square = getWebcamCropDrawLayout({
			sourceWidth: 100,
			sourceHeight: 300,
			targetWidth: 100,
			targetHeight: 100,
		});
		const stretched = getWebcamCropDrawLayout({
			sourceWidth: 100,
			sourceHeight: 300,
			targetWidth: 100,
			targetHeight: 180,
		});

		expect(square.drawWidth).toBe(100);
		expect(square.drawHeight).toBe(300);
		expect(square.drawY).toBe(-100);
		expect(stretched.drawWidth).toBe(100);
		expect(stretched.drawHeight).toBe(300);
		expect(stretched.drawY).toBe(-20);
	});

	it("falls back to cover when the source has no extra vertical image to reveal", () => {
		const stretched = getWebcamCropDrawLayout({
			sourceWidth: 300,
			sourceHeight: 100,
			targetWidth: 100,
			targetHeight: 180,
		});

		expect(stretched.drawWidth).toBeCloseTo(540);
		expect(stretched.drawHeight).toBeCloseTo(180);
		expect(stretched.drawY).toBeCloseTo(0);
	});
});

describe("getSnappedWebcamPositionPoint", () => {
	it("snaps to corner and center presets within the magnetic threshold", () => {
		expect(getSnappedWebcamPositionPoint({ x: 0.96, y: 0.97 })).toEqual({ x: 1, y: 1 });
		expect(getSnappedWebcamPositionPoint({ x: 0.52, y: 0.48 })).toEqual({
			x: 0.5,
			y: 0.5,
		});
		expect(getSnappedWebcamPositionPoint({ x: 0.51, y: 0.02 })).toEqual({
			x: 0.5,
			y: 0,
		});
	});

	it("keeps freeform positions outside the magnetic threshold", () => {
		expect(getSnappedWebcamPositionPoint({ x: 0.4, y: 0.72 })).toEqual({ x: 0.4, y: 0.72 });
	});
});
