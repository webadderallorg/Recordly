import { describe, expect, it } from "vitest";
import type { SourceTrackRoutingPolicy } from "@/lib/exporter/sourceTrackRoutingPolicy";
import type { AudioPeaksData } from "./core/timelineTypes";
import {
	buildSourceSidecarPathCandidates,
	buildTimelineSourceAudioTracks,
} from "./sourceAudioTracks";

function peaks(id: number): AudioPeaksData {
	return {
		durationMs: 1000,
		peaks: new Float32Array([id]),
	};
}

const labels = {
	system: "Source System",
	mic: "Source Mic",
	mixed: "Source",
};

function policy(overrides: Partial<SourceTrackRoutingPolicy> = {}): SourceTrackRoutingPolicy {
	return {
		hasEmbeddedSourceAudio: false,
		pathsByTrack: {},
		playbackPaths: [],
		muteEmbeddedPreview: false,
		includeEmbeddedInExport: false,
		...overrides,
	};
}

describe("timeline source audio tracks", () => {
	it("builds candidates for Windows and macOS sidecar containers", () => {
		expect(buildSourceSidecarPathCandidates("C:\\Recordly\\recording-1.mp4", "mic")).toEqual([
			"C:/Recordly/recording-1.mic.wav",
			"C:/Recordly/recording-1.mic.m4a",
			"C:/Recordly/recording-1.mic.webm",
		]);
	});

	it("keeps embedded system audio controllable when mic is a sidecar", () => {
		const source = peaks(1);
		const mic = peaks(2);

		expect(
			buildTimelineSourceAudioTracks({
				routingPolicy: policy({
					hasEmbeddedSourceAudio: true,
					pathsByTrack: { mic: "/tmp/recording.mic.wav" },
					playbackPaths: ["/tmp/recording.mic.wav"],
					includeEmbeddedInExport: true,
				}),
				videoResource: "/tmp/recording.mp4",
				sourceAudioPeaks: source,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				mixedSidecarPeaks: null,
				labels,
			}),
		).toEqual([
			{
				id: "system",
				label: "Source System",
				kind: "embedded",
				resourcePath: "/tmp/recording.mp4",
				peaks: source,
				probedDurationMs: null,
				waveformAvailable: true,
				waveformCoverage: "full",
			},
			{
				id: "mic",
				label: "Source Mic",
				kind: "mic",
				resourcePath: "/tmp/recording.mic.wav",
				peaks: mic,
				probedDurationMs: null,
				waveformAvailable: true,
				waveformCoverage: "full",
			},
		]);
	});

	it("does not invent an embedded system track when the source has no embedded audio", () => {
		const mic = peaks(2);

		expect(
			buildTimelineSourceAudioTracks({
				routingPolicy: policy({
					pathsByTrack: { mic: "/tmp/recording.mic.wav" },
					playbackPaths: ["/tmp/recording.mic.wav"],
				}),
				videoResource: "/tmp/recording.mp4",
				sourceAudioPeaks: null,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				mixedSidecarPeaks: null,
				probedDurationMsByPath: {
					"/tmp/recording.mic.wav": 147_360,
				},
				labels,
			}),
		).toEqual([
			{
				id: "mic",
				label: "Source Mic",
				kind: "mic",
				resourcePath: "/tmp/recording.mic.wav",
				peaks: mic,
				probedDurationMs: 147_360,
				waveformAvailable: true,
				waveformCoverage: "partial",
			},
		]);
	});

	it("uses dedicated sidecars over the embedded track when both source tracks exist", () => {
		const system = peaks(2);
		const mic = peaks(3);

		expect(
			buildTimelineSourceAudioTracks({
				routingPolicy: policy({
					hasEmbeddedSourceAudio: true,
					pathsByTrack: {
						system: "/tmp/recording.system.wav",
						mic: "/tmp/recording.mic.wav",
					},
					playbackPaths: ["/tmp/recording.system.wav", "/tmp/recording.mic.wav"],
					muteEmbeddedPreview: true,
				}),
				videoResource: "/tmp/recording.mp4",
				sourceAudioPeaks: null,
				micSidecarPeaks: mic,
				systemSidecarPeaks: system,
				mixedSidecarPeaks: null,
				labels,
			}),
		).toEqual([
			{
				id: "system",
				label: "Source System",
				kind: "system",
				resourcePath: "/tmp/recording.system.wav",
				peaks: system,
				probedDurationMs: null,
				waveformAvailable: true,
				waveformCoverage: "full",
			},
			{
				id: "mic",
				label: "Source Mic",
				kind: "mic",
				resourcePath: "/tmp/recording.mic.wav",
				peaks: mic,
				probedDurationMs: null,
				waveformAvailable: true,
				waveformCoverage: "full",
			},
		]);
	});

	it("falls back to one mixed source track when no dedicated sidecar exists", () => {
		const source = peaks(1);

		expect(
			buildTimelineSourceAudioTracks({
				routingPolicy: policy({
					hasEmbeddedSourceAudio: true,
				}),
				videoResource: "/tmp/recording.mp4",
				sourceAudioPeaks: source,
				micSidecarPeaks: null,
				systemSidecarPeaks: null,
				mixedSidecarPeaks: null,
				labels,
			}),
		).toEqual([
			{
				id: "mixed",
				label: "Source",
				kind: "embedded",
				resourcePath: "/tmp/recording.mp4",
				peaks: source,
				probedDurationMs: null,
				waveformAvailable: true,
				waveformCoverage: "full",
			},
		]);
	});

	it("keeps visible rows even when waveform peaks have not loaded yet", () => {
		expect(
			buildTimelineSourceAudioTracks({
				routingPolicy: policy({
					hasEmbeddedSourceAudio: true,
					pathsByTrack: { mic: "/tmp/recording.mic.wav" },
					playbackPaths: ["/tmp/recording.mic.wav"],
					includeEmbeddedInExport: true,
				}),
				videoResource: "/tmp/recording.mp4",
				sourceAudioPeaks: null,
				micSidecarPeaks: null,
				systemSidecarPeaks: null,
				mixedSidecarPeaks: null,
				probedDurationMsByPath: {
					"/tmp/recording.mic.wav": 147_360,
				},
				labels,
			}),
		).toEqual([
			{
				id: "system",
				label: "Source System",
				kind: "embedded",
				resourcePath: "/tmp/recording.mp4",
				peaks: null,
				probedDurationMs: null,
				waveformAvailable: false,
				waveformCoverage: "none",
			},
			{
				id: "mic",
				label: "Source Mic",
				kind: "mic",
				resourcePath: "/tmp/recording.mic.wav",
				peaks: null,
				probedDurationMs: 147_360,
				waveformAvailable: false,
				waveformCoverage: "none",
			},
		]);
	});

	it("marks mic waveforms as partial when peaks end before the probed sidecar duration", () => {
		const mic = {
			durationMs: 72_000,
			peaks: new Float32Array([0.25, 0.5, 0.75]),
		} satisfies AudioPeaksData;

		expect(
			buildTimelineSourceAudioTracks({
				routingPolicy: policy({
					pathsByTrack: { mic: "/tmp/recording.mic.wav" },
					playbackPaths: ["/tmp/recording.mic.wav"],
				}),
				videoResource: "/tmp/recording.mp4",
				sourceAudioPeaks: null,
				micSidecarPeaks: mic,
				systemSidecarPeaks: null,
				mixedSidecarPeaks: null,
				probedDurationMsByPath: {
					"/tmp/recording.mic.wav": 147_360,
				},
				labels,
			}),
		).toEqual([
			{
				id: "mic",
				label: "Source Mic",
				kind: "mic",
				resourcePath: "/tmp/recording.mic.wav",
				peaks: mic,
				probedDurationMs: 147_360,
				waveformAvailable: true,
				waveformCoverage: "partial",
			},
		]);
	});
});
