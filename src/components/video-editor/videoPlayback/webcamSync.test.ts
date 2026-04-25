import { describe, expect, it } from "vitest";
import { getWebcamPreviewTargetTimeSeconds } from "./webcamSync";

describe("getWebcamPreviewTargetTimeSeconds", () => {
	it("applies positive webcam offsets", () => {
		expect(
			getWebcamPreviewTargetTimeSeconds({
				currentTime: 10,
				webcamDuration: 20,
				timeOffsetMs: 250,
			}),
		).toBe(10.25);
	});

	it("clamps negative webcam offsets to zero", () => {
		expect(
			getWebcamPreviewTargetTimeSeconds({
				currentTime: 0.1,
				webcamDuration: 20,
				timeOffsetMs: -250,
			}),
		).toBe(0);
	});

	it("falls back to the unshifted time when the offset is invalid", () => {
		expect(
			getWebcamPreviewTargetTimeSeconds({
				currentTime: 3.5,
				webcamDuration: 20,
				timeOffsetMs: Number.NaN,
			}),
		).toBe(3.5);
	});

	it("clamps to the webcam duration", () => {
		expect(
			getWebcamPreviewTargetTimeSeconds({
				currentTime: 8.9,
				webcamDuration: 9,
				timeOffsetMs: 500,
			}),
		).toBe(9);
	});
});
