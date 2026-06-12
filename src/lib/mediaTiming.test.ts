import { describe, expect, it } from "vitest";

import {
	clampMediaTimeToDuration,
	enablePitchPreservingPlayback,
	estimateCompanionAudioStartDelaySeconds,
	getCompanionAudioEndToleranceSeconds,
	getEffectiveRecordingDurationMs,
	getEffectiveVideoStreamDurationSeconds,
	getMediaSyncPlaybackRate,
	resolveCompanionAudioPreviewTiming,
} from "./mediaTiming";

describe("clampMediaTimeToDuration", () => {
	it("clamps playback time to known media duration", () => {
		expect(clampMediaTimeToDuration(12, 4.5)).toBe(4.5);
		expect(clampMediaTimeToDuration(-1, 4.5)).toBe(0);
	});

	it("leaves playback time unchanged when duration is unknown", () => {
		expect(clampMediaTimeToDuration(12, null)).toBe(12);
		expect(clampMediaTimeToDuration(12, Number.NaN)).toBe(12);
	});
});

describe("estimateCompanionAudioStartDelaySeconds", () => {
	it("keeps small inferred offsets when the companion audio is only slightly shorter", () => {
		expect(estimateCompanionAudioStartDelaySeconds(10, 9.6)).toBeCloseTo(0.4);
		expect(estimateCompanionAudioStartDelaySeconds(10, 9.97)).toBeCloseTo(0.03);
	});

	it("prefers an explicitly recorded start delay", () => {
		expect(estimateCompanionAudioStartDelaySeconds(10, 2, 3_500)).toBeCloseTo(3.5);
		expect(estimateCompanionAudioStartDelaySeconds(10, 2, 0)).toBe(0);
	});

	it("ignores tiny, negative, or suspiciously large inferred differences", () => {
		expect(estimateCompanionAudioStartDelaySeconds(10, 9.99)).toBe(0);
		expect(estimateCompanionAudioStartDelaySeconds(10, 10.5)).toBe(0);
		expect(estimateCompanionAudioStartDelaySeconds(600, 565)).toBe(0);
	});
});

describe("getCompanionAudioEndToleranceSeconds", () => {
	it("uses a small default tail tolerance when durations already line up", () => {
		expect(
			getCompanionAudioEndToleranceSeconds({
				timelineDuration: 96.4,
				audioDuration: 96.24,
				recordedStartDelayMs: 134,
			}),
		).toBeCloseTo(0.376, 2);
	});

	it("absorbs multi-second companion duration mismatches instead of ending immediately", () => {
		expect(
			getCompanionAudioEndToleranceSeconds({
				timelineDuration: 96.4,
				audioDuration: 93,
				recordedStartDelayMs: 134,
			}),
		).toBeCloseTo(3.616, 2);
	});
});

describe("resolveCompanionAudioPreviewTiming", () => {
	it("uses recorded microphone start delay instead of forcing mic preview to zero", () => {
		expect(
			resolveCompanionAudioPreviewTiming({
				currentTimeSeconds: 0.1,
				timelineDurationSeconds: 96.4,
				audioDurationSeconds: 96.24,
				recordedStartDelayMs: 134,
			}),
		).toMatchObject({
			startDelaySeconds: 0.134,
			beforeAudioStart: true,
			atEnd: false,
		});
	});

	it("does not mark a shorter-than-expected companion track as ended until its tail tolerance is exhausted", () => {
		const result = resolveCompanionAudioPreviewTiming({
			currentTimeSeconds: 95.5,
			timelineDurationSeconds: 96.4,
			audioDurationSeconds: 93,
			recordedStartDelayMs: 134,
		});

		expect(result.startDelaySeconds).toBeCloseTo(0.134, 2);
		expect(result.targetTime).toBe(93);
		expect(result.atEnd).toBe(false);
		expect(result.endToleranceSeconds).toBeGreaterThan(3);
	});

	it("prefers a probed sidecar duration over a shorter browser media duration near the tail", () => {
		const result = resolveCompanionAudioPreviewTiming({
			currentTimeSeconds: 146.8,
			timelineDurationSeconds: 147.539,
			audioDurationSeconds: 72,
			recordedStartDelayMs: 143,
			probedAudioDurationSeconds: 147.36,
		} as never);

		expect(result.targetTime).toBeCloseTo(146.657, 2);
		expect(result.atEnd).toBe(false);
	});
});

describe("getEffectiveRecordingDurationMs", () => {
	it("subtracts accumulated paused time", () => {
		expect(
			getEffectiveRecordingDurationMs({
				startTimeMs: 1_000,
				endTimeMs: 11_000,
				accumulatedPausedDurationMs: 2_500,
			}),
		).toBe(7_500);
	});

	it("subtracts an active pause interval", () => {
		expect(
			getEffectiveRecordingDurationMs({
				startTimeMs: 1_000,
				endTimeMs: 11_000,
				accumulatedPausedDurationMs: 2_000,
				pauseStartedAtMs: 9_000,
			}),
		).toBe(6_000);
	});
});

describe("getMediaSyncPlaybackRate", () => {
	it("returns the base rate when drift is within tolerance", () => {
		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10,
				targetTime: 10.01,
			}),
		).toBe(1);
	});

	it("nudges playback rate toward the target time", () => {
		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10,
				targetTime: 10.1,
			}),
		).toBeCloseTo(1.05);

		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10.1,
				targetTime: 10,
			}),
		).toBeCloseTo(0.95);
	});

	it("clamps oversized corrections", () => {
		expect(
			getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: 10,
				targetTime: 10.5,
			}),
		).toBeCloseTo(1.08);
	});
});

describe("enablePitchPreservingPlayback", () => {
	it("enables standard and vendor pitch-preserve switches", () => {
		const media = {} as HTMLMediaElement & {
			preservesPitch?: boolean;
			mozPreservesPitch?: boolean;
			webkitPreservesPitch?: boolean;
		};

		enablePitchPreservingPlayback(media);

		expect(media.preservesPitch).toBe(true);
		expect(media.mozPreservesPitch).toBe(true);
		expect(media.webkitPreservesPitch).toBe(true);
	});
});

describe("getEffectiveVideoStreamDurationSeconds", () => {
	it("prefers the video stream duration when present", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: 12,
				streamDuration: 11.2,
			}),
		).toBe(11.2);
	});

	it("uses the container duration when the video stream is much shorter", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: 60,
				streamDuration: 40,
			}),
		).toBe(60);
	});

	it("falls back to the container duration when stream duration is missing", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: 12,
				streamDuration: undefined,
			}),
		).toBe(12);
	});

	it("returns zero when neither duration is usable", () => {
		expect(
			getEffectiveVideoStreamDurationSeconds({
				duration: Number.NaN,
				streamDuration: 0,
			}),
		).toBe(0);
	});
});
