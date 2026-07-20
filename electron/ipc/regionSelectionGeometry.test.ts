import { describe, expect, it } from "vitest";
import {
	normalizeCaptureRegion,
	normalizePointWithinRegion,
	toPixelCaptureRegion,
} from "./regionSelectionGeometry";

describe("region selection geometry", () => {
	it("normalizes reverse drags and clamps them to the display", () => {
		expect(
			normalizeCaptureRegion(
				{ x: 900, y: 700, width: -1000, height: -800 },
				{ x: 0, y: 0, width: 800, height: 600 },
			),
		).toEqual({ x: 0, y: 0, width: 800, height: 600 });
	});

	it("converts points to even Retina pixels", () => {
		expect(
			toPixelCaptureRegion(
				{ x: 10.5, y: 20.5, width: 640.5, height: 360.5 },
				{ x: 0, y: 0, width: 1512, height: 982 },
				2,
			),
		).toEqual({ x: 21, y: 41, width: 1280, height: 720, scaleFactor: 2 });
	});

	it("keeps the encoded rectangle inside the physical display", () => {
		expect(
			toPixelCaptureRegion(
				{ x: 795, y: 595, width: 100, height: 100 },
				{ x: 0, y: 0, width: 800, height: 600 },
				1.25,
			),
		).toEqual({ x: 994, y: 744, width: 6, height: 6, scaleFactor: 1.25 });
	});

	it("normalizes cursor positions against the selected area", () => {
		expect(
			normalizePointWithinRegion(
				{ x: 500, y: 350 },
				{ x: 100, y: 50, width: 800, height: 600 },
			),
		).toEqual({ cx: 0.5, cy: 0.5 });
		expect(
			normalizePointWithinRegion(
				{ x: 20, y: 900 },
				{ x: 100, y: 50, width: 800, height: 600 },
			),
		).toEqual({ cx: 0, cy: 1 });
	});
});
