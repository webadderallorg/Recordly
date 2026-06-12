import { describe, expect, it } from "vitest";
import {
	getDecodedSourcePreviewSyncAction,
	getSourceAudioElementResourceKey,
	getSourceAudioPreviewVolume,
	isAudioResourceLoadCurrent,
	shouldPlaySourceAudioElement,
	shouldUseDecodedWavSourcePreview,
} from "./useAudioPreviewSync";

describe("getSourceAudioElementResourceKey", () => {
	it("changes when probed companion audio media info arrives after an initial partial load", () => {
		const audioPath = "C:\\Recordly\\recording.mic.wav";
		const mediaInfo = {
			durationMs: 122_100,
			sampleRate: 48_000,
			channels: 1,
			hasAudioStream: true,
		};

		const withoutProbe = getSourceAudioElementResourceKey(audioPath, undefined);
		const withProbe = getSourceAudioElementResourceKey(audioPath, mediaInfo);

		expect(withoutProbe).not.toBe(withProbe);
		expect(getSourceAudioElementResourceKey(audioPath, mediaInfo)).toBe(withProbe);
	});

	it("changes when the probed duration changes for the same sidecar path", () => {
		const audioPath = "C:\\Recordly\\recording.mic.wav";

		expect(
			getSourceAudioElementResourceKey(audioPath, {
				durationMs: 75_000,
				sampleRate: 48_000,
				channels: 1,
				hasAudioStream: true,
			}),
		).not.toBe(
			getSourceAudioElementResourceKey(audioPath, {
				durationMs: 122_100,
				sampleRate: 48_000,
				channels: 1,
				hasAudioStream: true,
			}),
		);
	});
});

describe("shouldUseDecodedWavSourcePreview", () => {
	it("routes local wav companion audio through decoded Web Audio preview", () => {
		expect(
			shouldUseDecodedWavSourcePreview("C:\\Recordly\\recording.mic.wav", {
				durationMs: 146_700,
				sampleRate: 48_000,
				channels: 1,
				hasAudioStream: true,
			}),
		).toBe(true);
	});

	it("keeps non-wav companion audio on the media element path", () => {
		expect(
			shouldUseDecodedWavSourcePreview("C:\\Recordly\\recording.mic.m4a", {
				durationMs: 146_700,
				sampleRate: 48_000,
				channels: 1,
				hasAudioStream: true,
			}),
		).toBe(false);
	});

	it("does not decode a probed path without an audio stream", () => {
		expect(
			shouldUseDecodedWavSourcePreview("C:\\Recordly\\recording.mic.wav", {
				durationMs: 0,
				sampleRate: null,
				channels: null,
				hasAudioStream: false,
			}),
		).toBe(false);
	});
});

describe("shouldPlaySourceAudioElement", () => {
	it("plays only while the companion track is inside its active range", () => {
		expect(
			shouldPlaySourceAudioElement({
				isPlaying: true,
				beforeAudioStart: false,
				atEnd: false,
			}),
		).toBe(true);
	});

	it("does not start a delayed companion track early or restart it after the end", () => {
		expect(
			shouldPlaySourceAudioElement({
				isPlaying: true,
				beforeAudioStart: true,
				atEnd: false,
			}),
		).toBe(false);
		expect(
			shouldPlaySourceAudioElement({
				isPlaying: true,
				beforeAudioStart: false,
				atEnd: true,
			}),
		).toBe(false);
	});
});

describe("getDecodedSourcePreviewSyncAction", () => {
	it("starts decoded playback when a wav buffer is ready and no source is active", () => {
		expect(
			getDecodedSourcePreviewSyncAction({
				isPlaying: true,
				beforeAudioStart: false,
				atEnd: false,
				hasBuffer: true,
				hasActiveSource: false,
				timelineJumped: false,
				targetTime: 115.8,
				predictedTime: null,
				playbackRate: 1,
				activePlaybackRate: null,
			}),
		).toBe("start");
	});

	it("restarts decoded playback after a late seek drifts away from the active source", () => {
		expect(
			getDecodedSourcePreviewSyncAction({
				isPlaying: true,
				beforeAudioStart: false,
				atEnd: false,
				hasBuffer: true,
				hasActiveSource: true,
				timelineJumped: true,
				targetTime: 115.8,
				predictedTime: 48.2,
				playbackRate: 1,
				activePlaybackRate: 1,
			}),
		).toBe("restart");
	});

	it("keeps decoded playback running while the predicted PCM time is in sync", () => {
		expect(
			getDecodedSourcePreviewSyncAction({
				isPlaying: true,
				beforeAudioStart: false,
				atEnd: false,
				hasBuffer: true,
				hasActiveSource: true,
				timelineJumped: false,
				targetTime: 115.8,
				predictedTime: 115.86,
				playbackRate: 1,
				activePlaybackRate: 1,
			}),
		).toBe("keep");
	});

	it("stops decoded playback outside the companion audio range", () => {
		expect(
			getDecodedSourcePreviewSyncAction({
				isPlaying: true,
				beforeAudioStart: false,
				atEnd: true,
				hasBuffer: true,
				hasActiveSource: true,
				timelineJumped: false,
				targetTime: 146.7,
				predictedTime: 146.7,
				playbackRate: 1,
				activePlaybackRate: 1,
			}),
		).toBe("stop");
	});
});

describe("async source audio resource loading", () => {
	it("keeps an in-flight load valid across playback rerenders but rejects stale versions", () => {
		const audioPath = "C:\\Recordly\\recording.mic.wav";
		const resources = new Map([[audioPath, `${audioPath}::v1`]]);

		expect(isAudioResourceLoadCurrent(resources, audioPath, `${audioPath}::v1`)).toBe(true);

		resources.set(audioPath, `${audioPath}::v2`);
		expect(isAudioResourceLoadCurrent(resources, audioPath, `${audioPath}::v1`)).toBe(false);
	});

	it("applies the current preview volume as soon as a media element is created", () => {
		expect(getSourceAudioPreviewVolume(0.5, 0.8, false)).toBe(0.4);
		expect(getSourceAudioPreviewVolume(0.5, 0.8, true)).toBe(0);
	});
});
