import { describe, expect, it } from "vitest";
import { parseWhisperJsonCues, parseWhisperJsonWords } from "./parser";

function token(text: string, from: number, to: number) {
	return { text, offsets: { from, to } };
}

describe("parseWhisperJsonWords", () => {
	it("skips whisper.cpp special tokens instead of discarding the segment's words", () => {
		const words = parseWhisperJsonWords([
			token("[_BEG_]", 0, 0),
			token(" Bueno", 10, 1830),
			token(",", 1830, 2560),
			token(" prueba", 2560, 4760),
			token("[_TT_612]", 12240, 12240),
		]);

		expect(words).toEqual([
			{ text: "Bueno,", startMs: 10, endMs: 2560 },
			{ text: "prueba", startMs: 2560, endMs: 4760, leadingSpace: true },
		]);
	});

	it("keeps zero-length word tokens with a minimal duration", () => {
		const words = parseWhisperJsonWords([
			token(" en", 12000, 12240),
			token(" la", 12240, 12240),
			token(" punta", 12250, 12590),
		]);

		expect(words).toEqual([
			{ text: "en", startMs: 12000, endMs: 12240 },
			{ text: "la", startMs: 12240, endMs: 12241, leadingSpace: true },
			{ text: "punta", startMs: 12250, endMs: 12590, leadingSpace: true },
		]);
	});

	it("merges sub-word tokens into one word spanning both", () => {
		const words = parseWhisperJsonWords([
			token(" pun", 13050, 13290),
			token("ta", 13290, 13450),
		]);

		expect(words).toEqual([{ text: "punta", startMs: 13050, endMs: 13450 }]);
	});

	it("prefers DTW token timestamps, shifted earlier by the measured DTW lag", () => {
		const words = parseWhisperJsonWords([
			{ text: "[_BEG_]", offsets: { from: 0, to: 0 }, t_dtw: -1 },
			{ text: " prueba", offsets: { from: 2560, to: 4760 }, t_dtw: 644 },
			{ text: " de", offsets: { from: 4920, to: 5490 }, t_dtw: 664 },
			{ text: " video", offsets: { from: 5490, to: 7140 }, t_dtw: 706 },
		]);

		expect(words).toEqual([
			{ text: "prueba", startMs: 6290, endMs: 6490 },
			{ text: "de", startMs: 6490, endMs: 6910, leadingSpace: true },
			{ text: "video", startMs: 6910, endMs: 7140, leadingSpace: true },
		]);
	});

	it("falls back to token offsets when any real token lacks a DTW timestamp", () => {
		const words = parseWhisperJsonWords([
			{ text: " uno", offsets: { from: 7520, to: 7860 }, t_dtw: 774 },
			{ text: " dos", offsets: { from: 8290, to: 8600 }, t_dtw: -1 },
		]);

		expect(words.map((word) => word.startMs)).toEqual([7520, 8290]);
	});

	it("returns no words when a real token has no usable offsets", () => {
		expect(parseWhisperJsonWords([{ text: " hola", offsets: {} }])).toEqual([]);
	});
});

describe("parseWhisperJsonCues", () => {
	it("attaches word timings to segments that start with [_BEG_]", () => {
		const json = JSON.stringify({
			transcription: [
				{
					text: " uno, dos",
					offsets: { from: 7000, to: 9000 },
					tokens: [
						token("[_BEG_]", 7000, 7000),
						token(" uno", 7520, 7860),
						token(",", 7860, 8120),
						token(" dos", 8290, 8600),
					],
				},
			],
		});

		const [cue] = parseWhisperJsonCues(json);

		expect(cue.words?.map((word) => word.startMs)).toEqual([7520, 8290]);
		expect(cue.text).toBe("uno, dos");
	});
});
