import { describe, expect, it } from "vitest";
import {
	getWebcamCropSourceRect,
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
