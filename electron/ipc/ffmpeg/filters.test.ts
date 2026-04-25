import { describe, expect, it } from "vitest";

import {
	appendSyncedAudioFilter,
	applyRecordedAudioStartDelay,
	getAudioSyncAdjustment,
} from "./filters";

describe("getAudioSyncAdjustment", () => {
	it("does not speed up longer audio tracks that would advance speech", () => {
		expect(getAudioSyncAdjustment(120, 122.5)).toEqual({
			mode: "none",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: -2500,
		});
	});

	it("still stretches slightly shorter audio tracks to match the video", () => {
		expect(getAudioSyncAdjustment(120, 117)).toEqual({
			mode: "tempo",
			delayMs: 0,
			tempoRatio: 0.975,
			durationDeltaMs: 3000,
		});
	});

	it("still delays much shorter audio tracks instead of extreme tempo correction", () => {
		expect(getAudioSyncAdjustment(120, 110)).toEqual({
			mode: "delay",
			delayMs: 10000,
			tempoRatio: 1,
			durationDeltaMs: 10000,
		});
	});

	it("pads trailing silence instead of prepending extreme delay for very short audio tracks", () => {
		expect(getAudioSyncAdjustment(600, 480)).toEqual({
			mode: "pad",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: 120000,
		});
	});

	it("does not inject atempo when longer audio stays on the anchored path", () => {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", getAudioSyncAdjustment(120, 122.5));

		expect(filterParts).toEqual([
			"[1:a]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[aout]",
		]);
	});

	it("still injects atempo for slightly shorter audio tracks", () => {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", getAudioSyncAdjustment(120, 117));

		expect(filterParts).toEqual([
			"[1:a]atempo=0.975000,aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[aout]",
		]);
	});

	it("pads the tail for very short audio tracks", () => {
		const filterParts: string[] = [];
		appendSyncedAudioFilter(filterParts, "[1:a]", "aout", getAudioSyncAdjustment(600, 480));

		expect(filterParts).toEqual([
			"[1:a]apad=pad_dur=120.000,aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[aout]",
		]);
	});
});

describe("applyRecordedAudioStartDelay", () => {
	it("pads the tail when recorded metadata says audio started on time", () => {
		expect(applyRecordedAudioStartDelay(getAudioSyncAdjustment(120, 110), 0)).toEqual({
			mode: "pad",
			delayMs: 0,
			tempoRatio: 1,
			durationDeltaMs: 10000,
		});
	});

	it("prefers a measured start delay over a tempo-only heuristic", () => {
		expect(applyRecordedAudioStartDelay(getAudioSyncAdjustment(120, 119.8), 275)).toEqual({
			mode: "delay",
			delayMs: 275,
			tempoRatio: 1,
			durationDeltaMs: 200,
		});
	});

	it("applies a measured start delay even when durations already match", () => {
		expect(applyRecordedAudioStartDelay(getAudioSyncAdjustment(120, 120), 275)).toEqual({
			mode: "delay",
			delayMs: 275,
			tempoRatio: 1,
			durationDeltaMs: 0,
		});
	});

	it("leaves tempo correction alone when recorded metadata says there was no late start", () => {
		expect(applyRecordedAudioStartDelay(getAudioSyncAdjustment(120, 117), 0)).toEqual({
			mode: "tempo",
			delayMs: 0,
			tempoRatio: 0.975,
			durationDeltaMs: 3000,
		});
	});
});
