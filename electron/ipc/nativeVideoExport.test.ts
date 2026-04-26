import { describe, expect, it } from "vitest";
import { ATEMPO_FILTER_EPSILON } from "./ffmpeg/filters";
import {
	buildEditedTrackSourceAudioFilter,
	buildTrimmedSourceAudioFilter,
} from "./nativeVideoExport";

describe("buildTrimmedSourceAudioFilter", () => {
	it("concatenates trimmed source segments into a single output label", () => {
		expect(
			buildTrimmedSourceAudioFilter([
				{ startMs: 0, endMs: 2_000 },
				{ startMs: 4_000, endMs: 6_000 },
			]),
		).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[trimmed_audio_0];" +
				"[1:a]atrim=start=4.000:end=6.000,asetpts=PTS-STARTPTS[trimmed_audio_1];" +
				"[trimmed_audio_0][trimmed_audio_1]concat=n=2:v=0:a=1[aout]",
		);
	});
});

describe("buildEditedTrackSourceAudioFilter", () => {
	it("builds a concat filtergraph that applies tempo filters for speed changes", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[
				{ startMs: 0, endMs: 2_000, speed: 1 },
				{ startMs: 2_000, endMs: 6_000, speed: 1.5 },
			],
			44_100,
		);

		expect(filter).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[edited_audio_0];" +
				"[1:a]atrim=start=2.000:end=6.000,asetpts=PTS-STARTPTS,atempo=1.500000[edited_audio_1];" +
				"[edited_audio_0][edited_audio_1]concat=n=2:v=0:a=1[aout]",
		);
	});

	it("builds a filtergraph for slowdown segments with a tempo filter", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[{ startMs: 0, endMs: 2_000, speed: 0.5 }],
			44_100,
		);

		expect(filter).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS,atempo=0.500000[edited_audio_0];" +
				"[edited_audio_0]anull[aout]",
		);
	});

	it("treats near-unity speed changes as unchanged audio", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[{ startMs: 0, endMs: 2_000, speed: 1.0002 }],
			44_100,
		);

		expect(filter).toBe(
			"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[edited_audio_0];" +
				"[edited_audio_0]anull[aout]",
		);
	});

	it("treats exact epsilon speed changes as unchanged audio", () => {
		for (const speed of [1 - ATEMPO_FILTER_EPSILON, 1 + ATEMPO_FILTER_EPSILON]) {
			const filter = buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed }],
				44_100,
			);

			expect(filter).toBe(
				"[1:a]atrim=start=0.000:end=2.000,asetpts=PTS-STARTPTS[edited_audio_0];" +
					"[edited_audio_0]anull[aout]",
			);
		}
	});

	it("returns null when the edited-track filtergraph inputs are incomplete", () => {
		expect(buildEditedTrackSourceAudioFilter([], 44_100)).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed: 1.5 }],
				Number.NaN,
			),
		).toBeNull();
	});

	it("returns null when the edited-track segments are malformed", () => {
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: Number.NaN, endMs: 2_000, speed: 1.5 }],
				44_100,
			),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: 0, endMs: 2_000, speed: 0 }], 44_100),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: 0, endMs: 2_000, speed: -1 }], 44_100),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed: Number.NaN }],
				44_100,
			),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: 0, endMs: 2_000, speed: 1 }], 0.4),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter([{ startMs: -100, endMs: 2_000, speed: 1 }], 44_100),
		).toBeNull();
		expect(
			buildEditedTrackSourceAudioFilter(
				[{ startMs: 0, endMs: 2_000, speed: Number.MAX_SAFE_INTEGER }],
				44_100,
			),
		).toBeNull();
	});
});
