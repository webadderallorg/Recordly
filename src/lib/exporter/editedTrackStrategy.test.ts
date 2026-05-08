import { describe, expect, it } from "vitest";
import type { AudioRegion, SpeedRegion, TrimRegion } from "@/components/video-editor/types";
import { buildEditedTrackSourceSegments, classifyEditedTrackStrategy } from "./editedTrackStrategy";

const SOURCE_DURATION_MS = 20_000;
const EMPTY_TRIMS: TrimRegion[] = [];

describe("editedTrackStrategy", () => {
	it("marks single-source speed-only edits as filtergraph candidates", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 2_000, endMs: 10_000, speed: 1.5 },
		];

		expect(
			classifyEditedTrackStrategy({
				primaryAudioSourcePath: "recording.mp4",
				sourceDurationMs: SOURCE_DURATION_MS,
				trimRegions: EMPTY_TRIMS,
				speedRegions,
				audioRegions: [],
				sourceAudioFallbackPaths: [],
			}),
		).toBe("filtergraph-fast-path");
	});

	it("marks a single external source audio track as a filtergraph candidate", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 2_000, endMs: 10_000, speed: 1.25 },
		];

		expect(
			classifyEditedTrackStrategy({
				primaryAudioSourcePath: "mic.m4a",
				sourceDurationMs: SOURCE_DURATION_MS,
				trimRegions: EMPTY_TRIMS,
				speedRegions,
				audioRegions: [],
				sourceAudioFallbackPaths: ["mic.m4a"],
			}),
		).toBe("filtergraph-fast-path");
	});

	it("falls back for multi-source mixes", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 2_000, endMs: 10_000, speed: 1.5 },
		];

		expect(
			classifyEditedTrackStrategy({
				primaryAudioSourcePath: "recording.mp4",
				sourceDurationMs: SOURCE_DURATION_MS,
				trimRegions: EMPTY_TRIMS,
				speedRegions,
				audioRegions: [],
				sourceAudioFallbackPaths: ["mic.m4a"],
			}),
		).toBe("offline-render-fallback");
	});

	it("falls back when audio regions require overlay mixing", () => {
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 2_000, endMs: 10_000, speed: 1.5 },
		];
		const audioRegions: AudioRegion[] = [
			{
				id: "audio-1",
				audioPath: "overlay.wav",
				startMs: 1_000,
				endMs: 4_000,
				volume: 0.8,
			},
		];

		expect(
			classifyEditedTrackStrategy({
				primaryAudioSourcePath: "recording.mp4",
				sourceDurationMs: SOURCE_DURATION_MS,
				trimRegions: EMPTY_TRIMS,
				speedRegions,
				audioRegions,
				sourceAudioFallbackPaths: [],
			}),
		).toBe("offline-render-fallback");
	});

	it("falls back for speeds outside the conservative filtergraph window", () => {
		const speedRegions = [
			{ id: "speed-1", startMs: 2_000, endMs: 10_000, speed: 2.5 },
		] as SpeedRegion[];

		expect(
			classifyEditedTrackStrategy({
				primaryAudioSourcePath: "recording.mp4",
				sourceDurationMs: SOURCE_DURATION_MS,
				trimRegions: EMPTY_TRIMS,
				speedRegions,
				audioRegions: [],
				sourceAudioFallbackPaths: [],
			}),
		).toBe("offline-render-fallback");
	});

	it("falls back when source duration or speed-region bounds are invalid", () => {
		const invalidBounds: SpeedRegion[] = [
			{ id: "speed-1", startMs: Number.NaN, endMs: 10_000, speed: 1.5 },
		];

		expect(
			classifyEditedTrackStrategy({
				primaryAudioSourcePath: "recording.mp4",
				sourceDurationMs: Number.POSITIVE_INFINITY,
				trimRegions: EMPTY_TRIMS,
				speedRegions: invalidBounds,
				audioRegions: [],
				sourceAudioFallbackPaths: [],
			}),
		).toBe("offline-render-fallback");
	});

	it("builds source segments that preserve trims and speed boundaries", () => {
		const trimRegions: TrimRegion[] = [{ id: "trim-1", startMs: 10_000, endMs: 12_000 }];
		const speedRegions: SpeedRegion[] = [
			{ id: "speed-1", startMs: 2_000, endMs: 6_000, speed: 1.5 },
			{ id: "speed-2", startMs: 14_000, endMs: 18_000, speed: 0.75 },
		];

		expect(
			buildEditedTrackSourceSegments(SOURCE_DURATION_MS, trimRegions, speedRegions),
		).toEqual([
			{ startMs: 0, endMs: 2_000, speed: 1 },
			{ startMs: 2_000, endMs: 6_000, speed: 1.5 },
			{ startMs: 6_000, endMs: 10_000, speed: 1 },
			{ startMs: 12_000, endMs: 14_000, speed: 1 },
			{ startMs: 14_000, endMs: 18_000, speed: 0.75 },
			{ startMs: 18_000, endMs: 20_000, speed: 1 },
		]);
	});

	it("returns no source segments when speed-region bounds are invalid", () => {
		expect(
			buildEditedTrackSourceSegments(SOURCE_DURATION_MS, EMPTY_TRIMS, [
				{ id: "speed-1", startMs: 15_000, endMs: 10_000, speed: 1.5 },
			]),
		).toEqual([]);
	});
});
