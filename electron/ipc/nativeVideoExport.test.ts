import { describe, expect, it } from "vitest";
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
		).toContain("concat=n=2:v=0:a=1[aout]");
	});
});

describe("buildEditedTrackSourceAudioFilter", () => {
	it("builds a concat filtergraph that pitch-shifts via asetrate for speed changes", () => {
		const filter = buildEditedTrackSourceAudioFilter(
			[
				{ startMs: 0, endMs: 2_000, speed: 1 },
				{ startMs: 2_000, endMs: 6_000, speed: 1.5 },
			],
			44_100,
		);

		expect(filter).toContain(
			"[1:a]atrim=start=2.000:end=6.000,asetpts=PTS-STARTPTS,asetrate=66150,aresample=44100[edited_audio_1]",
		);
		expect(filter).toContain("concat=n=2:v=0:a=1[aout]");
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
});
