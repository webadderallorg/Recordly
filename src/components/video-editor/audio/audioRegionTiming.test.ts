import { describe, expect, it } from "vitest";
import {
	buildAudioRegionPlaybackSegments,
	getAudioRegionPlaybackPosition,
} from "./audioRegionTiming";

const spans = [
	{ startMs: 0, endMs: 1000, speed: 3 },
	{ startMs: 2000, endMs: 4000, speed: 2 },
];

describe("audio region timing", () => {
	it("plays imported audio at 1x over sped-up footage by default", () => {
		const segments = buildAudioRegionPlaybackSegments({ startMs: 500, endMs: 3500 }, spans);
		expect(segments).toEqual([
			{ timelineStartMs: 500, timelineEndMs: 3500, audioOffsetMs: 0, speed: 1 },
		]);
		expect(getAudioRegionPlaybackPosition(segments, 2500)).toEqual({
			audioOffsetMs: 2000,
			speed: 1,
		});
	});

	it("follows the speed of the footage under each part of a matched region", () => {
		const segments = buildAudioRegionPlaybackSegments(
			{ startMs: 500, endMs: 3500, matchClipSpeed: true },
			spans,
		);
		expect(segments).toEqual([
			{ timelineStartMs: 500, timelineEndMs: 1000, audioOffsetMs: 0, speed: 3 },
			{ timelineStartMs: 1000, timelineEndMs: 2000, audioOffsetMs: 1500, speed: 1 },
			{ timelineStartMs: 2000, timelineEndMs: 3500, audioOffsetMs: 2500, speed: 2 },
		]);
		expect(getAudioRegionPlaybackPosition(segments, 2500)).toEqual({
			audioOffsetMs: 3500,
			speed: 2,
		});
	});

	it("merges neighbouring clips that share a speed", () => {
		const segments = buildAudioRegionPlaybackSegments(
			{ startMs: 0, endMs: 2000, matchClipSpeed: true },
			[
				{ startMs: 0, endMs: 1000, speed: 2 },
				{ startMs: 1000, endMs: 2000, speed: 2 },
			],
		);
		expect(segments).toEqual([
			{ timelineStartMs: 0, timelineEndMs: 2000, audioOffsetMs: 0, speed: 2 },
		]);
	});

	it("returns no position outside the region", () => {
		const segments = buildAudioRegionPlaybackSegments({ startMs: 500, endMs: 3500 }, spans);
		expect(getAudioRegionPlaybackPosition(segments, 3500)).toBeNull();
		expect(getAudioRegionPlaybackPosition(segments, 0)).toBeNull();
		expect(buildAudioRegionPlaybackSegments({ startMs: 10, endMs: 10 }, spans)).toEqual([]);
	});
});
