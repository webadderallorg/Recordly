import { afterEach, describe, expect, it, vi } from "vitest";
import type { AudioRegion, SpeedRegion } from "@/components/video-editor/types";
import { ModernVideoExporter } from "./modernVideoExporter";
import type { DecodedVideoInfo } from "./streamingDecoder";

const videoInfo: DecodedVideoInfo = {
	width: 1920,
	height: 1080,
	duration: 60,
	streamDuration: 60,
	frameRate: 30,
	codec: "h264",
	hasAudio: true,
	audioCodec: "aac",
	audioSampleRate: 48_000,
};

function createExporter(overrides: Record<string, unknown> = {}) {
	vi.stubGlobal("window", {
		electronAPI: {
			nativeStaticLayoutExport: vi.fn(),
			nativeStaticLayoutExportCancel: vi.fn(),
		},
	});

	return new ModernVideoExporter({
		videoUrl: "file:///recording.mp4",
		width: 1920,
		height: 1080,
		frameRate: 30,
		bitrate: 8_000_000,
		wallpaper: "#101010",
		padding: 0,
		borderRadius: 0,
		backgroundBlur: 0,
		shadowIntensity: 0,
		showShadow: false,
		cropRegion: { x: 0, y: 0, width: 1, height: 1 },
		experimentalNativeExport: true,
		...overrides,
	} as never) as unknown as {
		getNativeStaticLayoutSkipReason: (
			audioPlan: unknown,
			videoInfo: DecodedVideoInfo,
			effectiveDurationSec: number,
		) => string | null;
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("ModernVideoExporter native static-layout eligibility", () => {
	it("allows native video when only the audio track needs offline editing", () => {
		const audioRegions: AudioRegion[] = [
			{
				id: "audio-1",
				audioPath: "file:///overlay.wav",
				startMs: 1_000,
				endMs: 4_000,
				volume: 0.85,
			},
		];
		const exporter = createExporter({ audioRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				60,
			),
		).toBeNull();
	});

	it("rejects native static-layout when speed edits do not have a native timeline map", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "offline-render-fallback",
				},
				videoInfo,
				60,
			),
		).toBe("unsupported-native-speed-timeline");
	});

	it("allows speed-only native static-layout when audio and video share filtergraph segments", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "filtergraph-fast-path",
					audioSourcePath: "recording.mp4",
					audioSourceSampleRate: 48_000,
					editedTrackSegments: [
						{ startMs: 0, endMs: 1_000, speed: 1 },
						{ startMs: 1_000, endMs: 4_000, speed: 1.5 },
						{ startMs: 4_000, endMs: 60_000, speed: 1 },
					],
				},
				videoInfo,
				59,
			),
		).toBeNull();
	});

	it("allows slow-speed native static-layout when a timeline map is available", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 0.5 },
		];
		const exporter = createExporter({ speedRegions });

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "filtergraph-fast-path",
					audioSourcePath: "recording.mp4",
					audioSourceSampleRate: 48_000,
					editedTrackSegments: [
						{ startMs: 0, endMs: 1_000, speed: 1 },
						{ startMs: 1_000, endMs: 4_000, speed: 0.5 },
						{ startMs: 4_000, endMs: 60_000, speed: 1 },
					],
				},
				videoInfo,
				63,
			),
		).toBeNull();
	});

	it("allows native speed timelines with a resolvable webcam source", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 1_000, endMs: 4_000, speed: 1.5 },
		];
		const exporter = createExporter({
			speedRegions,
			webcam: {
				enabled: true,
				sourcePath: "C:\\recordly\\webcam.mp4",
			},
		});

		expect(
			exporter.getNativeStaticLayoutSkipReason(
				{
					audioMode: "edited-track",
					strategy: "filtergraph-fast-path",
					audioSourcePath: "recording.mp4",
					audioSourceSampleRate: 48_000,
					editedTrackSegments: [
						{ startMs: 0, endMs: 1_000, speed: 1 },
						{ startMs: 1_000, endMs: 4_000, speed: 1.5 },
						{ startMs: 4_000, endMs: 60_000, speed: 1 },
					],
				},
				videoInfo,
				59,
			),
		).toBeNull();
	});
});
