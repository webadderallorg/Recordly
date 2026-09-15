import { describe, expect, it } from "vitest";
import type { CaptionCuePayload, CaptionWordPayload } from "../types";
import {
	adjustCueOffsets,
	MAX_SINGLE_PASS_DURATION_SEC,
	mergeAndDeduplicateChunkCues,
	mergeAndDeduplicateWords,
	parseDurationFromFfmpegStderr,
	planAudioChunks,
	type AudioChunk,
} from "./chunking";
import type { SilenceInterval } from "./silence";

describe("Parakeet Audio Chunking Utilities", () => {
	describe("parseDurationFromFfmpegStderr", () => {
		it("extracts duration correctly from FFmpeg stderr output", () => {
			const stderr = `
Input #0, wav, from 'sample.wav':
  Duration: 00:01:23.45, bitrate: 256 kb/s
  Stream #0:0: Audio: pcm_s16le
`;
			const duration = parseDurationFromFfmpegStderr(stderr);
			expect(duration).toBeCloseTo(83.45, 2);
		});

		it("returns null for malformed or missing duration lines", () => {
			expect(parseDurationFromFfmpegStderr("No duration here")).toBeNull();
			expect(parseDurationFromFfmpegStderr("Duration: N/A")).toBeNull();
		});
	});

	describe("planAudioChunks", () => {
		it("keeps audio <= 25 seconds in a single pass", () => {
			const chunks = planAudioChunks(22.5);
			expect(chunks.length).toBe(1);
			expect(chunks[0].startSec).toBe(0);
			expect(chunks[0].endSec).toBe(22.5);
			expect(chunks[0].durationSec).toBe(22.5);
			expect(chunks[0].durationSec).toBeLessThanOrEqual(MAX_SINGLE_PASS_DURATION_SEC);
		});

		it("keeps audio of exactly 25.0 seconds in a single pass", () => {
			const chunks = planAudioChunks(25.0);
			expect(chunks.length).toBe(1);
			expect(chunks[0].durationSec).toBe(25.0);
		});

		it("chunks audio > 25 seconds into chunks each strictly <= 24.5s (without silence)", () => {
			const duration = 65.0; // 65 seconds
			const chunks = planAudioChunks(duration);

			expect(chunks.length).toBeGreaterThan(1);
			for (const chunk of chunks) {
				expect(chunk.durationSec).toBeLessThanOrEqual(24.5);
				expect(chunk.startSec).toBeLessThan(chunk.endSec);
			}

			// Ensure first chunk starts at 0 and last chunk ends at total duration
			expect(chunks[0].startSec).toBe(0);
			expect(chunks[chunks.length - 1].endSec).toBe(duration);

			// Check 0.5s overlap between consecutive non-silence chunks
			for (let i = 1; i < chunks.length; i++) {
				const prev = chunks[i - 1];
				const curr = chunks[i];
				expect(curr.startSec).toBeCloseTo(prev.endSec - 0.5, 2);
			}
		});

		it("splits at detected silence boundaries when silence is within the window", () => {
			const duration = 40.0;
			const silences: SilenceInterval[] = [
				{ startMs: 18_000, endMs: 19_000 }, // in [16s, 24.5s] window
			];

			const chunks = planAudioChunks(duration, silences);
			expect(chunks.length).toBe(2);

			// First chunk should split in the middle of silence (18.5s)
			expect(chunks[0].endSec).toBeCloseTo(18.5, 2);
			expect(chunks[0].isSilenceBoundary).toBe(true);

			// Next chunk should start at 18.5s without needing a 0.5s overlap
			expect(chunks[1].startSec).toBeCloseTo(18.5, 2);
			expect(chunks[1].endSec).toBe(40.0);
		});

		it("handles long multi-minute audio (e.g. 300s) safely", () => {
			const chunks = planAudioChunks(300.0);
			expect(chunks.length).toBeGreaterThan(10);
			for (const chunk of chunks) {
				expect(chunk.durationSec).toBeLessThanOrEqual(24.5);
			}
			expect(chunks[chunks.length - 1].endSec).toBe(300.0);
		});

		it("handles startOffsetSec correctly for trimmed clips (e.g. 90 seconds / 90,000 ms)", () => {
			const duration = 60.0;
			const startOffsetSec = 90.0;
			const chunks = planAudioChunks(duration, [], startOffsetSec);

			expect(chunks.length).toBeGreaterThan(1);
			expect(chunks[0].startSec).toBe(90.0);
			expect(chunks[0].startMs).toBe(90_000);
			expect(chunks[chunks.length - 1].endSec).toBe(150.0);
			expect(chunks[chunks.length - 1].endMs).toBe(150_000);

			for (const chunk of chunks) {
				expect(chunk.startMs).toBe(Math.round(chunk.startSec * 1000));
				expect(chunk.endMs).toBe(Math.round(chunk.endSec * 1000));
				expect(chunk.durationSec).toBeLessThanOrEqual(24.5);
			}
		});

		it("splits at detected silence boundaries when silence is within the window with startOffsetSec", () => {
			const duration = 40.0;
			const startOffsetSec = 90.0;
			const silences: SilenceInterval[] = [{ startMs: 108_000, endMs: 109_000 }];

			const chunks = planAudioChunks(duration, silences, startOffsetSec);
			expect(chunks.length).toBe(2);

			// First chunk should split at the midpoint of silence (108.5s = 108,500ms)
			expect(chunks[0].startSec).toBe(90.0);
			expect(chunks[0].startMs).toBe(90_000);
			expect(chunks[0].endSec).toBeCloseTo(108.5, 2);
			expect(chunks[0].endMs).toBe(108_500);
			expect(chunks[0].isSilenceBoundary).toBe(true);

			// Second chunk continues from silence split to 130.0s
			expect(chunks[1].startSec).toBeCloseTo(108.5, 2);
			expect(chunks[1].endSec).toBe(130.0);
			expect(chunks[1].endMs).toBe(130_000);
		});
	});

	describe("adjustCueOffsets", () => {
		it("shifts startMs and endMs by the chunk offset", () => {
			const rawCues: CaptionCuePayload[] = [
				{
					id: "caption-1",
					startMs: 100,
					endMs: 800,
					text: "hello world",
					words: [
						{ text: "hello", startMs: 100, endMs: 400 },
						{ text: "world", startMs: 450, endMs: 800, leadingSpace: true },
					],
				},
			];

			const adjusted = adjustCueOffsets(rawCues, 20_000);
			expect(adjusted[0].startMs).toBe(20_100);
			expect(adjusted[0].endMs).toBe(20_800);
			expect(adjusted[0].words?.[0].startMs).toBe(20_100);
			expect(adjusted[0].words?.[0].endMs).toBe(20_400);
			expect(adjusted[0].words?.[1].startMs).toBe(20_450);
			expect(adjusted[0].words?.[1].endMs).toBe(20_800);
		});

		it("returns unchanged cues when offset is 0", () => {
			const rawCues: CaptionCuePayload[] = [
				{ id: "caption-1", startMs: 0, endMs: 500, text: "hi" },
			];
			expect(adjustCueOffsets(rawCues, 0)).toBe(rawCues);
		});
	});

	describe("mergeAndDeduplicateWords & mergeAndDeduplicateChunkCues", () => {
		const dummyChunk0: AudioChunk = {
			index: 0,
			startSec: 0,
			endSec: 20,
			durationSec: 20,
			startMs: 0,
			endMs: 20_000,
			isSilenceBoundary: false,
		};

		const dummyChunk1: AudioChunk = {
			index: 1,
			startSec: 19.5,
			endSec: 39.5,
			durationSec: 20,
			startMs: 19_500,
			endMs: 39_500,
			isSilenceBoundary: false,
		};

		it("deduplicates identical words appearing in the overlap window", () => {
			const chunk0Words: CaptionWordPayload[] = [
				{ text: "hello", startMs: 18_000, endMs: 18_500 },
				{ text: "world", startMs: 19_600, endMs: 19_900 },
			];

			const chunk1Words: CaptionWordPayload[] = [
				{ text: "world", startMs: 19_620, endMs: 19_920 }, // duplicate
				{ text: "again", startMs: 20_200, endMs: 20_600 },
			];

			const merged = mergeAndDeduplicateWords(
				[chunk0Words, chunk1Words],
				[dummyChunk0, dummyChunk1],
			);

			expect(merged.map((w) => w.text)).toEqual(["hello", "world", "again"]);
			expect(merged.length).toBe(3);
		});

		it("replaces partial boundary words with complete words from the subsequent chunk", () => {
			const chunk0Words: CaptionWordPayload[] = [
				{ text: "learning", startMs: 18_000, endMs: 18_500 },
				{ text: "rec", startMs: 19_600, endMs: 19_850 }, // cut-off word
			];

			const chunk1Words: CaptionWordPayload[] = [
				{ text: "recordly", startMs: 19_610, endMs: 20_100 }, // full word with future context
				{ text: "app", startMs: 20_200, endMs: 20_500 },
			];

			const merged = mergeAndDeduplicateWords(
				[chunk0Words, chunk1Words],
				[dummyChunk0, dummyChunk1],
			);

			expect(merged.map((w) => w.text)).toEqual(["learning", "recordly", "app"]);
		});

		it("seamlessly merges silence-boundary chunks without overlap", () => {
			const silenceChunk0: AudioChunk = {
				index: 0,
				startSec: 0,
				endSec: 18.5,
				durationSec: 18.5,
				startMs: 0,
				endMs: 18_500,
				isSilenceBoundary: true,
			};

			const silenceChunk1: AudioChunk = {
				index: 1,
				startSec: 18.5,
				endSec: 35.0,
				durationSec: 16.5,
				startMs: 18_500,
				endMs: 35_000,
				isSilenceBoundary: true,
			};

			const chunk0Words: CaptionWordPayload[] = [
				{ text: "first", startMs: 1_000, endMs: 1_500 },
				{ text: "sentence", startMs: 1_600, endMs: 2_000 },
			];

			const chunk1Words: CaptionWordPayload[] = [
				{ text: "second", startMs: 20_000, endMs: 20_500 },
				{ text: "sentence", startMs: 20_600, endMs: 21_000 },
			];

			const merged = mergeAndDeduplicateWords(
				[chunk0Words, chunk1Words],
				[silenceChunk0, silenceChunk1],
			);

			expect(merged.map((w) => w.text)).toEqual(["first", "sentence", "second", "sentence"]);
		});

		it("builds unified cue with words for feeding into segmentCuesIntoPhrases", () => {
			const chunk0Cues: CaptionCuePayload[] = [
				{
					id: "caption-1",
					startMs: 0,
					endMs: 19_900,
					text: "hello world",
					words: [
						{ text: "hello", startMs: 18_000, endMs: 18_500 },
						{ text: "world", startMs: 19_600, endMs: 19_900 },
					],
				},
			];

			const chunk1Cues: CaptionCuePayload[] = [
				{
					id: "caption-1",
					startMs: 19_620,
					endMs: 20_600,
					text: "world again",
					words: [
						{ text: "world", startMs: 19_620, endMs: 19_920 },
						{ text: "again", startMs: 20_200, endMs: 20_600 },
					],
				},
			];

			const mergedCues = mergeAndDeduplicateChunkCues(
				[chunk0Cues, chunk1Cues],
				[dummyChunk0, dummyChunk1],
			);

			expect(mergedCues.length).toBe(1);
			expect(mergedCues[0].text).toBe("hello world again");
			expect(mergedCues[0].words?.map((w) => w.text)).toEqual(["hello", "world", "again"]);
			expect(mergedCues[0].startMs).toBe(18_000);
			expect(mergedCues[0].endMs).toBe(20_600);
		});

		it("does not delete valid short words like 'a' when followed by 'again' (subword min length >= 3)", () => {
			const chunk0Words: CaptionWordPayload[] = [
				{ text: "take", startMs: 19_200, endMs: 19_500 },
				{ text: "a", startMs: 19_550, endMs: 19_650 },
			];

			const chunk1Words: CaptionWordPayload[] = [
				{ text: "again", startMs: 19_600, endMs: 19_950 },
				{ text: "step", startMs: 20_000, endMs: 20_400 },
			];

			const merged = mergeAndDeduplicateWords(
				[chunk0Words, chunk1Words],
				[dummyChunk0, dummyChunk1],
			);

			// "a" must not be treated as a subword of "again"
			expect(merged.map((w) => w.text)).toEqual(["take", "a", "again", "step"]);
		});

		it("deduplicates audio overlap strictly by startMs < prevChunk.endMs even when marked as silence boundary", () => {
			const overlappingSilenceChunk0: AudioChunk = {
				index: 0,
				startSec: 0,
				endSec: 20.0,
				durationSec: 20.0,
				startMs: 0,
				endMs: 20_000,
				isSilenceBoundary: true,
			};

			const overlappingSilenceChunk1: AudioChunk = {
				index: 1,
				startSec: 19.5,
				endSec: 35.0,
				durationSec: 15.5,
				startMs: 19_500, // < 20_000 (overlap)
				endMs: 35_000,
				isSilenceBoundary: true,
			};

			const chunk0Words: CaptionWordPayload[] = [
				{ text: "hello", startMs: 18_000, endMs: 18_500 },
				{ text: "world", startMs: 19_600, endMs: 19_900 },
			];

			const chunk1Words: CaptionWordPayload[] = [
				{ text: "world", startMs: 19_620, endMs: 19_920 }, // duplicate in overlap
				{ text: "peace", startMs: 20_200, endMs: 20_600 },
			];

			const merged = mergeAndDeduplicateWords(
				[chunk0Words, chunk1Words],
				[overlappingSilenceChunk0, overlappingSilenceChunk1],
			);

			expect(merged.map((w) => w.text)).toEqual(["hello", "world", "peace"]);
		});

		it("retains transcript text from chunks returning only wordless cues when merged with timestamped chunks", () => {
			const chunk0Cues: CaptionCuePayload[] = [
				{
					id: "caption-1",
					startMs: 1_000,
					endMs: 3_000,
					text: "hello world",
					words: [
						{ text: "hello", startMs: 1_000, endMs: 1_800 },
						{ text: "world", startMs: 2_000, endMs: 2_900 },
					],
				},
			];

			// Chunk 1 returns only wordless cues (e.g. fallback text without token timestamps)
			const chunk1Cues: CaptionCuePayload[] = [
				{
					id: "caption-2",
					startMs: 20_000,
					endMs: 23_000,
					text: "unsegmented phrase here",
				},
			];

			const mergedCues = mergeAndDeduplicateChunkCues(
				[chunk0Cues, chunk1Cues],
				[dummyChunk0, dummyChunk1],
			);

			expect(mergedCues.length).toBe(1);
			const allTexts = mergedCues[0].words?.map((w) => w.text);
			expect(allTexts).toContain("hello");
			expect(allTexts).toContain("world");
			expect(allTexts).toContain("unsegmented");
			expect(allTexts).toContain("phrase");
			expect(allTexts).toContain("here");
			// Specifically verify that a space exists between 'world' and 'unsegmented'
			expect(mergedCues[0].text).toBe("hello world unsegmented phrase here");
			expect(mergedCues[0].words?.find((w) => w.text === "unsegmented")?.leadingSpace).toBe(
				true,
			);
		});

		it("anchors chunk cues and words to trimmed start offsets (e.g. 90,000 ms) instead of collapsing to 0 ms", () => {
			const trimmedChunk0: AudioChunk = {
				index: 0,
				startSec: 90.0,
				endSec: 110.0,
				durationSec: 20.0,
				startMs: 90_000,
				endMs: 110_000,
				isSilenceBoundary: false,
			};
			const trimmedChunk1: AudioChunk = {
				index: 1,
				startSec: 109.5,
				endSec: 130.0,
				durationSec: 20.5,
				startMs: 109_500,
				endMs: 130_000,
				isSilenceBoundary: false,
			};

			// Cues from chunk 0 with chunk-local timestamps (or unadjusted timestamps starting near 0)
			const chunk0Cues: CaptionCuePayload[] = [
				{
					id: "caption-1",
					startMs: 500,
					endMs: 1_500,
					text: "trimmed audio",
					words: [
						{ text: "trimmed", startMs: 500, endMs: 1_000 },
						{ text: "audio", startMs: 1_050, endMs: 1_500, leadingSpace: true },
					],
				},
			];

			// Cues from chunk 1 with chunk-local timestamps
			const chunk1Cues: CaptionCuePayload[] = [
				{
					id: "caption-2",
					startMs: 1_000,
					endMs: 2_000,
					text: "timeline sync",
					words: [
						{ text: "timeline", startMs: 1_000, endMs: 1_500 },
						{ text: "sync", startMs: 1_550, endMs: 2_000, leadingSpace: true },
					],
				},
			];

			const mergedCues = mergeAndDeduplicateChunkCues(
				[chunk0Cues, chunk1Cues],
				[trimmedChunk0, trimmedChunk1],
			);

			expect(mergedCues.length).toBe(1);
			expect(mergedCues[0].text).toBe("trimmed audio timeline sync");

			const words = mergedCues[0].words;
			expect(words).toBeDefined();
			expect(words!.length).toBe(4);

			// Chunk 0 words must anchor to 90,000+ ms, NOT 500 ms or 0 ms!
			expect(words![0].text).toBe("trimmed");
			expect(words![0].startMs).toBe(90_500);
			expect(words![0].endMs).toBe(91_000);

			expect(words![1].text).toBe("audio");
			expect(words![1].startMs).toBe(91_050);
			expect(words![1].endMs).toBe(91_500);

			// Chunk 1 words must anchor to 109,500+ ms, NOT 1,000 ms!
			expect(words![2].text).toBe("timeline");
			expect(words![2].startMs).toBe(110_500);
			expect(words![2].endMs).toBe(111_000);

			expect(words![3].text).toBe("sync");
			expect(words![3].startMs).toBe(111_050);
			expect(words![3].endMs).toBe(111_500);

			// Cue bounds must span from the first word to the last word in 90,000+ ms space
			expect(mergedCues[0].startMs).toBe(90_500);
			expect(mergedCues[0].endMs).toBe(111_500);
		});

		it("anchors wordless fallback cues to trimmed chunk start offsets", () => {
			const trimmedChunk: AudioChunk = {
				index: 0,
				startSec: 90.0,
				endSec: 105.0,
				durationSec: 15.0,
				startMs: 90_000,
				endMs: 105_000,
				isSilenceBoundary: false,
			};

			const rawCue: CaptionCuePayload[] = [
				{
					id: "caption-1",
					startMs: 200,
					endMs: 1_200,
					text: "wordless cue",
				},
			];

			const merged = mergeAndDeduplicateChunkCues([rawCue], [trimmedChunk]);
			expect(merged.length).toBe(1);
			expect(merged[0].startMs).toBe(90_200);
			expect(merged[0].endMs).toBe(91_200);
		});
	});
});
