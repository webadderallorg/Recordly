import { describe, expect, it } from "vitest";
import { flattenCaptionWords } from "./captionLayout";
import { deleteCue, mergeCues, retimeCue, splitCue } from "./captionOps";
import type { CaptionCue } from "./types";

function makeCues(): CaptionCue[] {
	return [
		{
			id: "a",
			startMs: 0,
			endMs: 2_000,
			text: "one two three four",
			words: [
				{ text: "one", startMs: 0, endMs: 500 },
				{ text: "two", startMs: 500, endMs: 1_000, leadingSpace: true },
				{ text: "three", startMs: 1_000, endMs: 1_500, leadingSpace: true },
				{ text: "four", startMs: 1_500, endMs: 2_000, leadingSpace: true },
			],
		},
		{
			id: "b",
			startMs: 2_200,
			endMs: 3_000,
			text: "five six",
			words: [
				{ text: "five", startMs: 2_200, endMs: 2_600 },
				{ text: "six", startMs: 2_600, endMs: 3_000, leadingSpace: true },
			],
		},
	];
}

function assertCuesValid(cues: CaptionCue[]) {
	for (let index = 0; index < cues.length - 1; index += 1) {
		expect(cues[index].startMs).toBeLessThanOrEqual(cues[index + 1].startMs);
		expect(cues[index].endMs).toBeLessThanOrEqual(cues[index + 1].startMs);
	}

	const words = flattenCaptionWords(cues);
	for (let index = 0; index < words.length; index += 1) {
		expect(words[index].endMs).toBeGreaterThan(words[index].startMs);
		if (index > 0) {
			expect(words[index].startMs).toBeGreaterThanOrEqual(words[index - 1].startMs);
			expect(words[index].startMs).toBeGreaterThanOrEqual(words[index - 1].endMs);
		}
	}
}

describe("captionOps.retimeCue", () => {
	it("extends end and rescales word timings proportionally", () => {
		const single: CaptionCue[] = [makeCues()[0]];
		const result = retimeCue(single, "a", { startMs: 0, endMs: 4_000 });
		const cue = result.find((value) => value.id === "a");
		expect(cue?.endMs).toBe(4_000);
		expect(cue?.words?.[cue.words.length - 1].endMs).toBe(4_000);
		expect(cue?.words?.[1].startMs).toBe(1_000);
		expect(cue?.text).toBe("one two three four");
		assertCuesValid(result);
	});

	it("honors requested timing without clamping to neighbors", () => {
		const result = retimeCue(makeCues(), "a", { startMs: 1_000, endMs: 2_500 });
		const cue = result.find((value) => value.id === "a");
		const neighbor = result.find((value) => value.id === "b");
		expect(cue?.startMs).toBe(1_000);
		expect(cue?.endMs).toBe(2_500);
		expect(cue?.words?.[0].startMs).toBe(1_000);
		expect(cue?.words?.[cue.words.length - 1].endMs).toBe(2_500);
		expect(neighbor?.startMs).toBe(2_200);
	});

	it("returns cue-level timing when the cue has no words", () => {
		const cues: CaptionCue[] = [{ id: "a", startMs: 0, endMs: 1_000, text: "hello" }];
		const result = retimeCue(cues, "a", { startMs: 200, endMs: 1_500 });
		expect(result[0].startMs).toBe(200);
		expect(result[0].endMs).toBe(1_500);
		expect(result[0].words).toBeUndefined();
	});

	it("keeps words valid and non-overlapping when retimed shorter than its word count", () => {
		// Retiming a 4-word cue into a 3ms span can't fit one monotonic 1ms range per word,
		// which is where overlapping/reordered word timings appear. The span is widened to
		// the minimum viable length so the words stay valid.
		const result = retimeCue(makeCues(), "a", { startMs: 0, endMs: 3 });
		const cue = result.find((value) => value.id === "a");
		expect(cue?.words).toHaveLength(4);
		assertCuesValid(result);
	});

	it("is a no-op for an unknown id", () => {
		const cues = makeCues();
		expect(retimeCue(cues, "missing", { startMs: 0, endMs: 100 })).toBe(cues);
	});
});

describe("captionOps.splitCue", () => {
	it("splits at the nearest word boundary into two cues", () => {
		const result = splitCue(makeCues(), "a", 1_000);
		expect(result).toHaveLength(3);
		const [left, right] = result;
		expect(left.id).toBe("a");
		expect(left.text).toBe("one two");
		expect(right.id).not.toBe("a");
		expect(right.text).toBe("three four");
		expect(right.words?.[0].leadingSpace).toBeUndefined();
		expect(left.endMs).toBeLessThanOrEqual(right.startMs);
		assertCuesValid(result);
	});

	it("does not split a single-word cue", () => {
		const cues: CaptionCue[] = [
			{
				id: "solo",
				startMs: 0,
				endMs: 500,
				text: "word",
				words: [{ text: "word", startMs: 0, endMs: 500 }],
			},
		];
		expect(splitCue(cues, "solo", 250)).toBe(cues);
	});
});

describe("captionOps.mergeCues", () => {
	it("merges adjacent cues and re-derives spacing", () => {
		const result = mergeCues(makeCues(), "a", "b");
		expect(result).toHaveLength(1);
		const merged = result[0];
		expect(merged.id).toBe("a");
		expect(merged.startMs).toBe(0);
		expect(merged.endMs).toBe(3_000);
		expect(merged.text).toBe("one two three four five six");
		expect(merged.words?.[4].leadingSpace).toBe(true);
		assertCuesValid(result);
	});

	it("rejects a non-adjacent merge", () => {
		const cues: CaptionCue[] = [
			...makeCues(),
			{
				id: "c",
				startMs: 4_000,
				endMs: 5_000,
				text: "seven",
				words: [{ text: "seven", startMs: 4_000, endMs: 5_000 }],
			},
		];
		expect(mergeCues(cues, "a", "c")).toBe(cues);
	});
});

describe("captionOps.deleteCue", () => {
	it("removes the cue and keeps the rest sorted", () => {
		const result = deleteCue(makeCues(), "a");
		expect(result.map((cue) => cue.id)).toEqual(["b"]);
	});

	it("is a no-op for an unknown id", () => {
		const cues = makeCues();
		expect(deleteCue(cues, "missing")).toBe(cues);
	});
});
