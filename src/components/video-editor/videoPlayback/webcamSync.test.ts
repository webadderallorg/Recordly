import { describe, expect, it } from "vitest";
import {
	getWebcamMediaTargetTimeSeconds,
	getWebcamPreviewTargetTimeSeconds,
	isWebcamMediaSynchronized,
	isWebcamVisibleAtSourceTime,
	shouldSeekWebcamMedia,
} from "./webcamSync";

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

describe("shouldSeekWebcamMedia", () => {
	it("does not issue another corrective seek while the webcam element is already seeking", () => {
		expect(
			shouldSeekWebcamMedia({
				desiredTime: 10.5,
				isPlaying: true,
				isSeeking: true,
				previousTimelineTime: 10,
				timelineTime: 10.5,
				webcamCurrentTime: 9.8,
			}),
		).toBe(false);
	});

	it("seeks when playback drift grows beyond the active threshold", () => {
		expect(
			shouldSeekWebcamMedia({
				desiredTime: 10.5,
				isPlaying: true,
				isSeeking: false,
				previousTimelineTime: 10,
				timelineTime: 10.5,
				webcamCurrentTime: 9.8,
			}),
		).toBe(true);
	});

	it("does not seek when the clamped media target is already correct", () => {
		expect(
			shouldSeekWebcamMedia({
				desiredTime: 1 / 60,
				isPlaying: false,
				isSeeking: false,
				previousTimelineTime: 0,
				timelineTime: 0,
				webcamCurrentTime: 1 / 60,
			}),
		).toBe(false);
	});
});

describe("isWebcamMediaSynchronized", () => {
	it("waits for current frame data and a completed seek", () => {
		expect(
			isWebcamMediaSynchronized({
				currentTime: 10,
				targetTime: 10,
				readyState: 1,
				isSeeking: false,
			}),
		).toBe(false);
		expect(
			isWebcamMediaSynchronized({
				currentTime: 10,
				targetTime: 10,
				readyState: 2,
				isSeeking: true,
			}),
		).toBe(false);
	});

	it("accepts a loaded webcam only when it is anchored to the timeline", () => {
		expect(
			isWebcamMediaSynchronized({
				currentTime: 9.95,
				targetTime: 10,
				readyState: 2,
				isSeeking: false,
			}),
		).toBe(true);
		expect(
			isWebcamMediaSynchronized({
				currentTime: 9.5,
				targetTime: 10,
				readyState: 2,
				isSeeking: false,
			}),
		).toBe(false);
	});
});


describe("imported webcam visibility", () => {
	it("hides screen-only spans and uses source-time boundaries", () => {
		const webcam = { visibleRanges: [{ startMs: 1200, endMs: 2000 }, { startMs: 4000, endMs: 5000 }] };
		expect(isWebcamVisibleAtSourceTime(webcam, 1)).toBe(false);
		expect(isWebcamVisibleAtSourceTime(webcam, 1.2)).toBe(true);
		expect(isWebcamVisibleAtSourceTime(webcam, 2)).toBe(false);
		expect(isWebcamVisibleAtSourceTime(webcam, 4.5)).toBe(true);
		expect(isWebcamVisibleAtSourceTime({ visibleRanges: [] }, 0)).toBe(false);
		expect(isWebcamVisibleAtSourceTime({}, 0)).toBe(true);
	});
});
