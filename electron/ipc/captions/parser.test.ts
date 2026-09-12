import { describe, expect, it } from "vitest";
import {
	buildCaptionTextFromWords,
	parseParakeetJsonOutput,
	parseParakeetJsonWords,
} from "./parser";

describe("Parakeet parser", () => {
	it("parses tokens with SentencePiece word delimiters and durations", () => {
		const tokens = ["\u2581Hello", "\u2581world", "!", "\u2581How", "\u2581are", "\u2581you?"];
		const timestamps = [0.1, 0.5, 0.8, 1.2, 1.6, 2.0];
		const durations = [0.35, 0.25, 0.1, 0.35, 0.35, 0.4];

		const words = parseParakeetJsonWords(tokens, timestamps, durations);

		expect(words).toHaveLength(5);
		expect(words[0]).toEqual({
			text: "Hello",
			startMs: 100,
			endMs: 450,
		});
		expect(words[1]).toEqual({
			text: "world!",
			startMs: 500,
			endMs: 900,
			leadingSpace: true,
		});
		expect(words[2]).toEqual({
			text: "How",
			startMs: 1200,
			endMs: 1550,
			leadingSpace: true,
		});
		expect(words[3]).toEqual({
			text: "are",
			startMs: 1600,
			endMs: 1950,
			leadingSpace: true,
		});
		expect(words[4]).toEqual({
			text: "you?",
			startMs: 2000,
			endMs: 2400,
			leadingSpace: true,
		});

		expect(buildCaptionTextFromWords(words)).toBe("Hello world! How are you?");
	});

	it("parses full sherpa-onnx JSON output with surrounding logs", () => {
		const rawStdout = `
Started
Reading model...
Done!
test.wav
{"lang": "en", "text": "Testing Parakeet TDT.", "timestamps": [0.2, 0.6, 1.1], "durations": [0.3, 0.4, 0.5], "tokens": ["\u2581Testing", "\u2581Parakeet", "\u2581TDT."]}
----
Elapsed seconds: 0.45s
`;
		const cues = parseParakeetJsonOutput(rawStdout);
		expect(cues).toHaveLength(1);
		expect(cues[0].text).toBe("Testing Parakeet TDT.");
		expect(cues[0].startMs).toBe(200);
		expect(cues[0].endMs).toBe(1600);
		expect(cues[0].words).toHaveLength(3);
		expect(cues[0].words?.[1].text).toBe("Parakeet");
		expect(cues[0].words?.[1].leadingSpace).toBe(true);
	});

	it("handles empty or invalid JSON gracefully", () => {
		expect(parseParakeetJsonOutput("")).toEqual([]);
		expect(parseParakeetJsonOutput("some random error")).toEqual([]);
		expect(parseParakeetJsonOutput('{"text": "Fallback text without tokens"}')).toEqual([
			{
				id: "caption-1",
				startMs: 0,
				endMs: 3000,
				text: "Fallback text without tokens",
			},
		]);
	});
});
