import { expect, it } from "vitest";
import { mergeCaptionSources } from "./mergeSources";
import { parseWhisperJsonCues } from "./parser";

it("keeps system speech when the microphone has no speech", () => {
	const system = [{ id: "s", startMs: 0, endMs: 1000, text: "System speech" }];
	expect(mergeCaptionSources([], system)[0].text).toBe("System speech");
});
it("keeps both tracks, choosing mic only for overlapping words", () => {
	const mic = [{ id: "m", startMs: 1000, endMs: 2000, text: "Mic speech" }];
	const system = [
		{
			id: "s",
			startMs: 0,
			endMs: 3000,
			text: "Before conflict after",
			words: [
				{ text: "Before", startMs: 0, endMs: 900 },
				{ text: "conflict", startMs: 1100, endMs: 1900, leadingSpace: true },
				{ text: "after", startMs: 2100, endMs: 3000, leadingSpace: true },
			],
		},
	];
	expect(mergeCaptionSources(mic, system).map((cue) => cue.text)).toEqual([
		"Before",
		"Mic speech",
		"after",
	]);
});
it("retains real Whisper word timing through control tokens and punctuation", () => {
	const cues = parseWhisperJsonCues(
		JSON.stringify({
			transcription: [
				{
					offsets: { from: 0, to: 1000 },
					text: "Hello.",
					tokens: [
						{ text: "[_BEG_]", offsets: { from: 0, to: 0 } },
						{ text: " Hello", offsets: { from: 0, to: 900 } },
						{ text: ".", offsets: { from: 900, to: 900 } },
						{ text: "[_TT_50]", offsets: { from: 1000, to: 1000 } },
					],
				},
			],
		}),
	);
	expect(cues[0].words).toEqual([{ text: "Hello.", startMs: 0, endMs: 900 }]);
});

it("does not let mic sound labels replace system speech", () => {
	expect(
		mergeCaptionSources(
			[{ id: "m", startMs: 0, endMs: 2000, text: "[Coughing]" }],
			[{ id: "s", startMs: 0, endMs: 2000, text: "The spoken paragraph." }],
		).map((c) => c.text),
	).toEqual(["The spoken paragraph."]);
});

it("preserves untimed speech next to timed words", async () => {
	const { segmentCuesIntoPhrases } = await import("./segment");
	const result = segmentCuesIntoPhrases(
		[
			{
				id: "a",
				startMs: 0,
				endMs: 1000,
				text: "First.",
				words: [{ text: "First.", startMs: 0, endMs: 1000 }],
			},
			{ id: "b", startMs: 1000, endMs: 3000, text: "There is a timeline editor." },
		],
		[],
	);
	expect(result.map((c) => c.text).join(" ")).toContain("There is a timeline editor.");
});

it("preserves system speech between timed microphone words", () => {
	const result = mergeCaptionSources(
		[
			{
				id: "mic",
				startMs: 0,
				endMs: 3000,
				text: "Hello again",
				words: [
					{ text: "Hello", startMs: 0, endMs: 600 },
					{ text: "again", startMs: 2400, endMs: 3000 },
				],
			},
		],
		[{ id: "system", startMs: 1000, endMs: 1800, text: "In the gap" }],
	);
	expect(result.map((cue) => cue.text)).toContain("In the gap");
});

it("retains the unopposed portions of an untimed system cue", () => {
	const result = mergeCaptionSources(
		[
			{
				id: "mic",
				startMs: 0,
				endMs: 3000,
				text: "Mic",
				words: [{ text: "Mic", startMs: 1000, endMs: 2000 }],
			},
		],
		[{ id: "system", startMs: 0, endMs: 3000, text: "System paragraph" }],
	);
	expect(
		result
			.filter((cue) => cue.text === "System paragraph")
			.map(({ startMs, endMs }) => [startMs, endMs]),
	).toEqual([
		[0, 1000],
		[2000, 3000],
	]);
});
