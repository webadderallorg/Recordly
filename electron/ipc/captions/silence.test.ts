import { describe, expect, it } from "vitest";
import type { CaptionCuePayload } from "../types";
import { parseSilenceIntervals, resegmentCuesBySilence } from "./silence";

describe("parseSilenceIntervals", () => {
	it("pairs silence_start / silence_end lines into ms intervals", () => {
		const stderr = [
			"[silencedetect @ 0x1] silence_start: 0",
			"[silencedetect @ 0x1] silence_end: 3.2 | silence_duration: 3.2",
			"[silencedetect @ 0x1] silence_start: 8.5",
			"[silencedetect @ 0x1] silence_end: 9.3 | silence_duration: 0.8",
		].join("\n");
		expect(parseSilenceIntervals(stderr)).toEqual([
			{ startMs: 0, endMs: 3_200 },
			{ startMs: 8_500, endMs: 9_300 },
		]);
	});

	it("treats a trailing silence_start with no end as running to end-of-audio", () => {
		const stderr = "[silencedetect] silence_start: 12.0";
		expect(parseSilenceIntervals(stderr)).toEqual([
			{ startMs: 12_000, endMs: Number.POSITIVE_INFINITY },
		]);
	});

	it("returns an empty array when there is no silence output", () => {
		expect(parseSilenceIntervals("some unrelated ffmpeg log\n")).toEqual([]);
	});
});

describe("resegmentCuesBySilence", () => {
	it("trims leading silence off a word-less cue", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 13_920, text: "Hello, this is a test" },
		];
		const result = resegmentCuesBySilence(cues, [{ startMs: 0, endMs: 3_000 }]);
		expect(result).toHaveLength(1);
		// speech span [3000, 13920]; only an 80ms pad re-enters the silence
		expect(result[0].startMs).toBe(3_000 - 80);
		expect(result[0].endMs).toBe(13_920 + 80);
		expect(result[0].text).toBe("Hello, this is a test");
	});

	it("does NOT split on a short pause (slowing down stays one phrase)", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 8_000, text: "one two three four" },
		];
		// 800ms pause is below the 1500ms split threshold -> absorbed, stays one phrase
		const result = resegmentCuesBySilence(cues, [{ startMs: 3_000, endMs: 3_800 }]);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("one two three four");
	});

	it("merges adjacent cues that are not separated by a long pause", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "a", startMs: 0, endMs: 3_000, text: "hello world" },
			{ id: "b", startMs: 3_000, endMs: 6_000, text: "how are you" },
		];
		// continuous speech, no silence -> one merged phrase
		const result = resegmentCuesBySilence(cues, []);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("hello world how are you");
	});

	it("splits only at a long pause (>= 1500ms)", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 10_000, text: "one two three four" },
		];
		// 2000ms pause -> a real boundary
		const result = resegmentCuesBySilence(cues, [{ startMs: 4_000, endMs: 6_000 }]);
		expect(result).toHaveLength(2);
		expect(result[0].endMs).toBeLessThanOrEqual(result[1].startMs);
		expect(`${result[0].text} ${result[1].text}`).toBe("one two three four");
	});

	it("does not over-split: two short pauses inside a sentence stay one phrase", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 9_000, text: "so this is a slow sentence" },
		];
		const result = resegmentCuesBySilence(cues, [
			{ startMs: 2_000, endMs: 2_700 }, // 700ms
			{ startMs: 5_000, endMs: 5_900 }, // 900ms
		]);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("so this is a slow sentence");
	});

	it("drops a cue that falls entirely inside silence (hallucination)", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 5_000, endMs: 7_000, text: "Thank you." },
		];
		const result = resegmentCuesBySilence(cues, [{ startMs: 4_000, endMs: 9_000 }]);
		expect(result).toHaveLength(0);
	});

	it("keeps a continuous cue (no silence) as a single phrase", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 1_000, endMs: 4_000, text: "continuous speech" },
		];
		const result = resegmentCuesBySilence(cues, []);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("continuous speech");
	});

	it("splits a word-timed cue by assigning each word to its speech region", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 10_000,
				text: "alpha beta gamma",
				words: [
					{ text: "alpha", startMs: 500, endMs: 1_000 },
					{ text: "beta", startMs: 1_000, endMs: 1_500, leadingSpace: true },
					{ text: "gamma", startMs: 7_000, endMs: 7_500, leadingSpace: true },
				],
			},
		];
		// 4000ms pause puts alpha+beta in region 1, gamma in region 2
		const result = resegmentCuesBySilence(cues, [{ startMs: 2_000, endMs: 6_000 }]);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("alpha beta");
		expect(result[1].text).toBe("gamma");
		expect(result[0].endMs).toBeLessThanOrEqual(result[1].startMs);
	});

	it("produces sorted, non-overlapping cues with sequential ids", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "x", startMs: 0, endMs: 6_000, text: "first phrase here" },
			{ id: "y", startMs: 6_000, endMs: 14_000, text: "second phrase here" },
		];
		const result = resegmentCuesBySilence(cues, [{ startMs: 6_000, endMs: 8_000 }]);
		for (let index = 0; index < result.length - 1; index += 1) {
			expect(result[index].startMs).toBeLessThanOrEqual(result[index + 1].startMs);
			expect(result[index].endMs).toBeLessThanOrEqual(result[index + 1].startMs);
		}
		expect(result.map((cue) => cue.id)).toEqual(
			result.map((_, index) => `caption-${index + 1}`),
		);
	});
});
