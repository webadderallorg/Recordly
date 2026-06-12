import { describe, expect, it } from "vitest";
import {
	CAMERA_OPACITY_DEFAULT,
	CAMERA_OPACITY_MAX,
	CAMERA_OPACITY_MIN,
	clampCameraOpacity,
	parseStoredCameraOpacity,
} from "./teleprompterCamera";

describe("clampCameraOpacity", () => {
	it("clamps into [min, max]", () => {
		expect(clampCameraOpacity(0)).toBe(CAMERA_OPACITY_MIN);
		expect(clampCameraOpacity(1)).toBe(CAMERA_OPACITY_MAX);
		expect(clampCameraOpacity(0.35)).toBe(0.35);
	});
});

describe("parseStoredCameraOpacity", () => {
	it("parses valid stored values and falls back otherwise", () => {
		expect(parseStoredCameraOpacity("0.5")).toBe(0.5);
		expect(parseStoredCameraOpacity("2")).toBe(CAMERA_OPACITY_MAX);
		expect(parseStoredCameraOpacity("junk")).toBe(CAMERA_OPACITY_DEFAULT);
		expect(parseStoredCameraOpacity(null)).toBe(CAMERA_OPACITY_DEFAULT);
	});
});
