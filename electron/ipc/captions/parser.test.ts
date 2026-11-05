import { expect, it } from "vitest";
import { buildCaptionTextFromWords, parseWhisperJsonWords } from "./parser";

const timed = (text: string, from: number, to: number) => ({ text, offsets: { from, to } });
it("retains token-aligned word boundaries in Chinese without introducing spaces or times", () => {
	const words = parseWhisperJsonWords([
		timed("你", 0, 100),
		timed("好", 100, 180),
		timed("世界", 200, 500),
		timed("！", 0, 0),
	]);
	expect(words).toEqual([
		{ text: "你好", startMs: 0, endMs: 180 },
		{ text: "世界！", startMs: 200, endMs: 500 },
	]);
	expect(buildCaptionTextFromWords(words)).toBe("你好世界！");
});
it("preserves a model token containing multiple words rather than fabricating alignments", () => {
	const words = parseWhisperJsonWords([timed("你好世界", 50, 600)]);
	expect(words).toEqual([{ text: "你好世界", startMs: 50, endMs: 600 }]);
});
it("handles Japanese token boundaries and mixed Latin text without adding whitespace", () => {
	const words = parseWhisperJsonWords([
		timed("私", 0, 100),
		timed("は", 100, 200),
		timed("東京", 200, 500),
		timed("です", 500, 700),
	]);
	expect(words.map((word) => word.text)).toEqual(["私", "は", "東京", "です"]);
	expect(buildCaptionTextFromWords(words)).toBe("私は東京です");
	expect(words.map((word) => word.startMs)).toEqual([0, 100, 200, 500]);
});
it("keeps English subwords, punctuation and real spaces unchanged", () => {
	const words = parseWhisperJsonWords([
		timed("[_BEG_]", 0, 0),
		timed("Hel", 0, 120),
		timed("lo", 120, 220),
		timed(",", 0, 0),
		timed(" world", 250, 600),
		timed("!", 0, 0),
	]);
	expect(words).toEqual([
		{ text: "Hello,", startMs: 0, endMs: 220 },
		{ text: "world!", startMs: 250, endMs: 600, leadingSpace: true },
	]);
});
