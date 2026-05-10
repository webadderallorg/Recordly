import { describe, expect, it } from "vitest";
import { getWebcamMediaTargetTimeSeconds, getWebcamPreviewTargetTimeSeconds } from "./webcamSync";

describe("getWebcamPreviewTargetTimeSeconds", () => {
	it("subtracts positive webcam offsets when the webcam started after the main capture", () => {
		expect(
			getWebcamPreviewTargetTimeSeconds({
				currentTime: 10,
				webcamDuration: 20,
				timeOffsetMs: 250,
			}),
		).toBe(9.75);
	});

	it("adds negative webcam offsets when the webcam started before the main capture", () => {
		expect(
			getWebcamPreviewTargetTimeSeconds({
				currentTime: 0.1,
				webcamDuration: 20,
				timeOffsetMs: -250,
			}),
		).toBe(0.35);
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
				timeOffsetMs: -500,
			}),
		).toBe(9);
	});
});

describe("getWebcamMediaTargetTimeSeconds", () => {
	it("clamps positive offsets at zero when the main timeline is earlier than the webcam start", () => {
		expect(
			getWebcamMediaTargetTimeSeconds({
				currentTime: 0.1,
				webcamDuration: 20,
				timeOffsetMs: 250,
			}),
		).toBe(0);
	});
});
