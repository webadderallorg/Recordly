import { describe, expect, it, vi } from "vitest";

vi.mock("./parakeetModel", () => ({ assertParakeetModelDirectory: vi.fn() }));

import { mergeParakeetWindows, parseParakeetWords } from "./parakeet";

describe("Parakeet word timestamps", () => {
	it("joins SentencePiece tokens and punctuation, preserving acoustic pauses and durations", () => {
		expect(
			parseParakeetWords(
				{
					text: "Hello, world!",
					tokens: ["▁Hel", "lo", ",", "▁world", "!"],
					timestamps: [0.1, 0.2, 0.3, 1.2, 1.5],
					durations: [0.1, 0.1, 0, 0.3, 0],
				},
				30000,
			),
		).toEqual([
			{ text: "Hello,", startMs: 30100, endMs: 30301 },
			{ text: "world!", startMs: 31200, endMs: 31501, leadingSpace: true },
		]);
	});
	it("preserves standalone SentencePiece word separators", () => {
		expect(
			parseParakeetWords({
				text: "Hello world",
				tokens: ["▁Hello", "▁", "world"],
				timestamps: [0, 0.2, 0.5],
				durations: [0.2, 0, 0.3],
			}),
		).toEqual([
			{ text: "Hello", startMs: 0, endMs: 200 },
			{ text: "world", startMs: 500, endMs: 800, leadingSpace: true },
		]);
	});
	it("keeps separated closing punctuation attached to the spoken word", () => {
		expect(
			parseParakeetWords({
				text: "Hello, world!",
				tokens: ["▁Hello", "▁", ",", "▁world", " !"],
				timestamps: [0, 0.2, 0.2, 0.5, 0.8],
				durations: [0.2, 0, 0, 0.3, 0],
			}).map((word) => word.text),
		).toEqual(["Hello,", "world!"]);
	});
	it("bounds stretched trailing word timings without changing ordinary speech", () => {
		expect(
			parseParakeetWords({
				text: "Wait here.",
				tokens: ["▁Wait", "▁here", "."],
				timestamps: [0.1, 1, 1.2],
				durations: [0.4, 16, 0],
			}),
		).toEqual([
			{ text: "Wait", startMs: 100, endMs: 500 },
			{ text: "here.", startMs: 1000, endMs: 3500, leadingSpace: true },
		]);
	});
	it("does not manufacture timings when the backend omits them", () => {
		expect(() =>
			parseParakeetWords({
				text: "Hi",
				tokens: ["▁Hi"],
				timestamps: [],
				durations: [],
			}),
		).toThrow("timings");
		expect(() =>
			parseParakeetWords({
				text: "Hi",
				tokens: [],
				timestamps: [],
				durations: [],
			}),
		).toThrow("without word timings");
	});
	it("accepts silence and ignores special tokens", () => {
		expect(
			parseParakeetWords({
				text: "",
				tokens: [],
				timestamps: [],
				durations: [],
			}),
		).toEqual([]);
		expect(
			parseParakeetWords({
				text: "",
				tokens: ["<blk>"],
				timestamps: [],
				durations: [],
			}),
		).toEqual([]);
	});
});

describe("Parakeet overlapping audio windows", () => {
	const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });
	it("uses neighboring words to align a repeated word despite shifted estimates", () => {
		const previous = [
			word("go", 29000, 29080),
			word("left", 29100, 29180),
			word("go", 29200, 29280),
			word("right", 29300, 29380),
		];
		const next = [
			word("go", 29010, 29090),
			word("right", 29110, 29190),
			word("now", 29400, 29480),
		];
		const result = mergeParakeetWindows(previous, next, 30000);
		expect(result.map(({ text }) => text)).toEqual(["go", "left", "go", "right", "now"]);
		// Alignment chooses existing word estimates; it must not manufacture timing.
		expect(result.every((item) => [...previous, ...next].includes(item))).toBe(true);
	});
	it("keeps a seam word once when independent estimates shift to opposite sides", () => {
		const left = [word("Hello", 29000, 29300), word("world.", 29900, 30000)];
		const right = [
			word("hello", 29040, 29320),
			word("world,", 30000, 30100),
			word("again", 30500, 30700),
		];
		expect(mergeParakeetWindows(left, right, 30000).map((w) => w.text.toLowerCase())).toEqual([
			"hello",
			"world,",
			"again",
		]);
	});
	it("keeps a seam word when independent midpoints would discard both estimates", () => {
		expect(
			mergeParakeetWindows(
				[word("world", 30000, 30100)],
				[word("world", 29900, 30000)],
				30000,
			),
		).toEqual([word("world", 29900, 30000)]);
	});
	it("keeps repeated words at distinct times and preserves speech before silent windows", () => {
		const left = [word("go", 29000, 29200), word("go", 29700, 29900)];
		const right = [word("go", 29720, 29920), word("go", 30500, 30700)];
		expect(mergeParakeetWindows(left, right, 30000)).toHaveLength(3);
		expect(mergeParakeetWindows(left, [], 30000)).toEqual(left);
	});
});
