import { describe, expect, it } from "vitest";
import type { CaptionCuePayload } from "../types";
import { endsSentence, segmentCuesIntoPhrases } from "./segment";

describe("endsSentence", () => {
	it("detects terminal punctuation, ignoring trailing closers", () => {
		expect(endsSentence("world.")).toBe(true);
		expect(endsSentence("you?")).toBe(true);
		expect(endsSentence("stop!")).toBe(true);
		expect(endsSentence("wait…")).toBe(true);
		expect(endsSentence('said."')).toBe(true);
		expect(endsSentence("done,")).toBe(false);
		expect(endsSentence("hello")).toBe(false);
	});

	it("does not treat common abbreviations or initialisms as a sentence end", () => {
		expect(endsSentence("Mr.")).toBe(false);
		expect(endsSentence("Dr.")).toBe(false);
		expect(endsSentence("etc.")).toBe(false);
		expect(endsSentence("e.g.")).toBe(false);
		expect(endsSentence("U.S.")).toBe(false);
		expect(endsSentence("J.")).toBe(false);
		// real sentence ends are unaffected
		expect(endsSentence("Smith.")).toBe(true);
		expect(endsSentence("5.")).toBe(true);
		// `?`/`!` after an abbreviation-like token still end the sentence
		expect(endsSentence("really?")).toBe(true);
	});
});

describe("segmentCuesIntoPhrases", () => {
	it("splits back-to-back sentences with no pause into separate captions", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 1_800,
				text: "Hello world. How are you?",
				words: [
					{ text: "Hello", startMs: 0, endMs: 400 },
					{ text: "world.", startMs: 400, endMs: 800, leadingSpace: true },
					{ text: "How", startMs: 800, endMs: 1_100, leadingSpace: true },
					{ text: "are", startMs: 1_100, endMs: 1_400, leadingSpace: true },
					{ text: "you?", startMs: 1_400, endMs: 1_800, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("Hello world.");
		expect(result[1].text).toBe("How are you?");
		expect(result[0].endMs).toBeLessThanOrEqual(result[1].startMs);
	});

	it("does not leak the first word of the next sentence into the previous caption", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 1_800,
				text: "Hello world. How are you?",
				words: [
					{ text: "Hello", startMs: 0, endMs: 400 },
					{ text: "world.", startMs: 400, endMs: 800, leadingSpace: true },
					{ text: "How", startMs: 800, endMs: 1_100, leadingSpace: true },
					{ text: "are", startMs: 1_100, endMs: 1_400, leadingSpace: true },
					{ text: "you?", startMs: 1_400, endMs: 1_800, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result[1].words?.[0].text).toBe("How");
		expect(result[1].words?.[0].startMs).toBe(800);
		// the first word of a phrase has no leading space
		expect(result[1].words?.[0].leadingSpace).toBeUndefined();
	});

	it("merges rapid-fire short sentences into one caption (word-timed)", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 800,
				text: "Okay. Great.",
				words: [
					{ text: "Okay.", startMs: 0, endMs: 400 },
					{ text: "Great.", startMs: 400, endMs: 800, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("Okay. Great.");
		expect(result[0].words?.map((word) => word.text)).toEqual(["Okay.", "Great."]);
	});

	it("merges rapid-fire short sentences into one caption (word-less)", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 400, text: "Okay." },
			{ id: "caption-2", startMs: 400, endMs: 800, text: "Great." },
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("Okay. Great.");
	});

	it("does not merge two short captions across a real pause just above the merge gap", () => {
		// Two short, sentence-ended phrases separated by a 450ms gap (just above the 400ms
		// mergeGapMs). Edge padding shrinks the apparent gap, so if merge eligibility ran on
		// padded timings it would wrongly fuse them. Merge must run on the true speech gap.
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 1_250,
				text: "Okay. Great.",
				words: [
					{ text: "Okay.", startMs: 0, endMs: 400 },
					{ text: "Great.", startMs: 850, endMs: 1_250, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("Okay.");
		expect(result[1].text).toBe("Great.");
		// Padding still applies, but cues stay separate and non-overlapping.
		expect(result[0].endMs).toBeLessThanOrEqual(result[1].startMs);
	});

	it("does not merge a short sentence into a full-length one", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 2_400,
				text: "Okay. This is a full length sentence that should stand alone.",
				words: [
					{ text: "Okay.", startMs: 0, endMs: 400 },
					{ text: "This", startMs: 400, endMs: 700, leadingSpace: true },
					{ text: "is", startMs: 700, endMs: 900, leadingSpace: true },
					{ text: "a", startMs: 900, endMs: 1_050, leadingSpace: true },
					{ text: "full", startMs: 1_050, endMs: 1_350, leadingSpace: true },
					{ text: "length", startMs: 1_350, endMs: 1_650, leadingSpace: true },
					{ text: "sentence", startMs: 1_650, endMs: 1_950, leadingSpace: true },
					{ text: "that", startMs: 1_950, endMs: 2_100, leadingSpace: true },
					{ text: "should", startMs: 2_100, endMs: 2_250, leadingSpace: true },
					{ text: "stand", startMs: 2_250, endMs: 2_350, leadingSpace: true },
					{ text: "alone.", startMs: 2_350, endMs: 2_400, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("Okay.");
		expect(result[1].text).toBe("This is a full length sentence that should stand alone.");
	});

	it("keeps a comma/clause inside one caption", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 1_500,
				text: "When I'm done, I start.",
				words: [
					{ text: "When", startMs: 0, endMs: 300 },
					{ text: "I'm", startMs: 300, endMs: 600, leadingSpace: true },
					{ text: "done,", startMs: 600, endMs: 900, leadingSpace: true },
					{ text: "I", startMs: 900, endMs: 1_100, leadingSpace: true },
					{ text: "start.", startMs: 1_100, endMs: 1_500, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("When I'm done, I start.");
	});

	it("does not split on an abbreviation, only on the real sentence end", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 1_800,
				text: "Hello Mr. Smith. How are you?",
				words: [
					{ text: "Hello", startMs: 0, endMs: 300 },
					{ text: "Mr.", startMs: 300, endMs: 600, leadingSpace: true },
					{ text: "Smith.", startMs: 600, endMs: 900, leadingSpace: true },
					{ text: "How", startMs: 900, endMs: 1_200, leadingSpace: true },
					{ text: "are", startMs: 1_200, endMs: 1_500, leadingSpace: true },
					{ text: "you?", startMs: 1_500, endMs: 1_800, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("Hello Mr. Smith.");
		expect(result[1].text).toBe("How are you?");
	});

	it("splits on a real pause even without punctuation", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 2_000,
				text: "one two three four",
				words: [
					{ text: "one", startMs: 0, endMs: 300 },
					{ text: "two", startMs: 300, endMs: 600, leadingSpace: true },
					// 800ms gap (>= 700ms pause) -> phrase boundary
					{ text: "three", startMs: 1_400, endMs: 1_700, leadingSpace: true },
					{ text: "four", startMs: 1_700, endMs: 2_000, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("one two");
		expect(result[1].text).toBe("three four");
	});

	it("splits on a long acoustic silence in a word gap even when the word gap is short", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 2_600,
				text: "alpha beta",
				words: [
					{ text: "alpha", startMs: 0, endMs: 600 },
					{ text: "beta", startMs: 2_200, endMs: 2_600, leadingSpace: true },
				],
			},
		];
		// pauseMs high so the word gap (1600ms) wouldn't split on its own; the 1500ms
		// silence sitting in the gap is what forces the break. beta starts after the
		// silence ends, so it is not dropped as a hallucination.
		const result = segmentCuesIntoPhrases(cues, [{ startMs: 600, endMs: 2_100 }], {
			pauseMs: 5_000,
		});
		expect(result).toHaveLength(2);
		expect(result[0].text).toBe("alpha");
		expect(result[1].text).toBe("beta");
	});

	it("does not split that same input when there is no silence and the gap is below the pause", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 2_600,
				text: "alpha beta",
				words: [
					{ text: "alpha", startMs: 0, endMs: 600 },
					{ text: "beta", startMs: 2_200, endMs: 2_600, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, [], { pauseMs: 5_000 });
		expect(result).toHaveLength(1);
		expect(result[0].text).toBe("alpha beta");
	});

	it("splits a runaway phrase with no punctuation and no pause via the safety cap", () => {
		const words = Array.from({ length: 12 }, (_, index) => ({
			text: `w${index}`,
			startMs: index * 300,
			endMs: index * 300 + 300,
			...(index > 0 ? { leadingSpace: true } : {}),
		}));
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 3_600,
				text: words.map((w) => w.text).join(" "),
				words,
			},
		];
		const result = segmentCuesIntoPhrases(cues, [], { maxPhraseMs: 2_000 });
		expect(result.length).toBeGreaterThan(1);
		expect(result.map((cue) => cue.text).join(" ")).toBe(words.map((w) => w.text).join(" "));
	});

	it("drops words that fall entirely inside a long silence (hallucination)", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 5_000,
				endMs: 6_000,
				text: "Thank you.",
				words: [
					{ text: "Thank", startMs: 5_000, endMs: 5_500 },
					{ text: "you.", startMs: 5_500, endMs: 6_000, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, [{ startMs: 4_000, endMs: 9_000 }]);
		expect(result).toHaveLength(0);
	});

	it("produces sorted, non-overlapping cues with sequential ids", () => {
		const cues: CaptionCuePayload[] = [
			{
				id: "caption-1",
				startMs: 0,
				endMs: 2_400,
				text: "First phrase here. Second phrase here. Third one.",
				words: [
					{ text: "First", startMs: 0, endMs: 300 },
					{ text: "phrase", startMs: 300, endMs: 600, leadingSpace: true },
					{ text: "here.", startMs: 600, endMs: 900, leadingSpace: true },
					{ text: "Second", startMs: 900, endMs: 1_200, leadingSpace: true },
					{ text: "phrase", startMs: 1_200, endMs: 1_500, leadingSpace: true },
					{ text: "here.", startMs: 1_500, endMs: 1_800, leadingSpace: true },
					{ text: "Third", startMs: 1_800, endMs: 2_100, leadingSpace: true },
					{ text: "one.", startMs: 2_100, endMs: 2_400, leadingSpace: true },
				],
			},
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(3);
		for (let index = 0; index < result.length - 1; index += 1) {
			expect(result[index].startMs).toBeLessThanOrEqual(result[index + 1].startMs);
			expect(result[index].endMs).toBeLessThanOrEqual(result[index + 1].startMs);
		}
		expect(result.map((cue) => cue.id)).toEqual(
			result.map((_, index) => `caption-${index + 1}`),
		);
	});

	it("keeps a single-sentence word-less cue intact (legacy silence trim preserved)", () => {
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 13_920, text: "Hello, this is a test" },
		];
		// One sentence -> unchanged: trim leading silence, keep text (legacy behavior).
		const result = segmentCuesIntoPhrases(cues, [{ startMs: 0, endMs: 3_000 }]);
		expect(result).toHaveLength(1);
		expect(result[0].startMs).toBe(3_000 - 80);
		expect(result[0].endMs).toBe(13_920 + 80);
		expect(result[0].text).toBe("Hello, this is a test");
	});

	it("splits a continuous word-less paragraph into one caption per sentence", () => {
		// The reported bug: no word timings (SRT path) + continuous speech collapsed into one
		// caption. It must now split on sentence punctuation even without word timings.
		const cues: CaptionCuePayload[] = [
			{ id: "caption-1", startMs: 0, endMs: 3_000, text: "This is one." },
			{ id: "caption-2", startMs: 3_000, endMs: 6_000, text: "This is two." },
			{ id: "caption-3", startMs: 6_000, endMs: 9_000, text: "This is three." },
		];
		const result = segmentCuesIntoPhrases(cues, []);
		expect(result).toHaveLength(3);
		expect(result.map((cue) => cue.text)).toEqual([
			"This is one.",
			"This is two.",
			"This is three.",
		]);
		for (let index = 0; index < result.length - 1; index += 1) {
			expect(result[index].endMs).toBeLessThanOrEqual(result[index + 1].startMs);
		}
		expect(result.map((cue) => cue.id)).toEqual(["caption-1", "caption-2", "caption-3"]);
	});

	it("returns an empty array for empty input", () => {
		expect(segmentCuesIntoPhrases([], [])).toEqual([]);
	});
});
