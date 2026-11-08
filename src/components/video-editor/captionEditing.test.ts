import { describe, expect, it } from "vitest";

import {
	type CaptionEditTarget,
	normalizeCaptionEditText,
	updateCaptionCuesForEditedTarget,
} from "./captionEditing";
import { buildActiveCaptionLayout } from "./captionLayout";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

const visibleTarget: CaptionEditTarget = {
	id: "visible-page",
	startMs: 1_000,
	endMs: 2_400,
	text: "Hello Hello 你们好啊",
	words: [
		{
			cueId: "a",
			cueWordIndex: 0,
			startMs: 1_000,
			endMs: 1_500,
			text: "Hello",
			leadingSpace: false,
		},
		{
			cueId: "a",
			cueWordIndex: 1,
			startMs: 1_500,
			endMs: 2_000,
			text: "Hello",
			leadingSpace: true,
		},
		{
			cueId: "b",
			cueWordIndex: 0,
			startMs: 2_000,
			endMs: 2_400,
			text: "你们好啊",
			leadingSpace: true,
		},
	],
};

describe("captionEditing", () => {
	it("normalizes edited caption text", () => {
		expect(normalizeCaptionEditText("  hello \n edited\tcaption  ")).toBe(
			"hello edited caption",
		);
		expect(normalizeCaptionEditText(" \n\t ")).toBe("");
	});

	it("keeps text-only captions text-only after editing", () => {
		const updated = updateCaptionCuesForEditedTarget(
			[
				{ id: "a", startMs: 1_000, endMs: 2_000, text: "Hello Hello" },
				{ id: "b", startMs: 2_000, endMs: 3_000, text: "你们好啊 这个是我的屏幕" },
			],
			visibleTarget,
			"Hi 大家好",
		);

		expect(updated.map((caption) => caption.text)).toEqual(["Hi", "大家好 这个是我的屏幕"]);
		expect(updated.every((caption) => caption.words === undefined)).toBe(true);

		const layout = buildActiveCaptionLayout({
			cues: updated,
			timeMs: 1_500,
			settings: DEFAULT_AUTO_CAPTION_SETTINGS,
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});
		expect(layout?.hasWordTimings).toBe(false);
	});

	it("preserves cue bounds and drops word timings only where the edited word count changes", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 1_000,
				endMs: 2_000,
				text: "Hello Hello",
				words: [
					{ text: "Hello", startMs: 1_000, endMs: 1_500 },
					{ text: "Hello", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
			{
				id: "b",
				startMs: 2_000,
				endMs: 3_000,
				text: "你们好啊 这个是我的屏幕",
				words: [
					{ text: "你们好啊", startMs: 2_000, endMs: 2_400 },
					{ text: "这个是我的屏幕", startMs: 2_400, endMs: 3_000, leadingSpace: true },
				],
			},
		];

		const updated = updateCaptionCuesForEditedTarget(cues, visibleTarget, "Hi 大家好");

		expect(updated.map((caption) => [caption.id, caption.startMs, caption.endMs])).toEqual([
			["a", 1_000, 2_000],
			["b", 2_000, 3_000],
		]);
		expect(updated[0].words).toBeUndefined();
		expect(updated[1].words).toEqual([
			{ text: "大家好", startMs: 2_000, endMs: 2_400 },
			{ text: "这个是我的屏幕", startMs: 2_400, endMs: 3_000, leadingSpace: true },
		]);
	});

	it("preserves acoustic pauses and uneven word durations for same-count replacements", () => {
		const cue: CaptionCue = {
			id: "timed",
			startMs: 0,
			endMs: 1000,
			text: "hello world",
			words: [
				{ text: "hello", startMs: 0, endMs: 120 },
				{ text: "world", startMs: 700, endMs: 1000, leadingSpace: true },
			],
		};
		const layout = buildActiveCaptionLayout({
			cues: [cue],
			timeMs: 100,
			settings: DEFAULT_AUTO_CAPTION_SETTINGS,
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});
		const cues = [cue];
		if (!layout) throw new Error("Expected visible caption");
		expect(updateCaptionCuesForEditedTarget(cues, layout.editTarget, " hello  world ")).toBe(
			cues,
		);
		const updated = updateCaptionCuesForEditedTarget(cues, layout.editTarget, "Hello everyone");
		expect(updated[0].words).toEqual([
			{ text: "Hello", startMs: 0, endMs: 120 },
			{ text: "everyone", startMs: 700, endMs: 1000, leadingSpace: true },
		]);
	});

	it("does not invent word timing when a partial-page edit changes word count", () => {
		const cue: CaptionCue = {
			id: "timed",
			startMs: 0,
			endMs: 1000,
			text: "one two three",
			words: [
				{ text: "one", startMs: 0, endMs: 150 },
				{ text: "two", startMs: 500, endMs: 700, leadingSpace: true },
				{ text: "three", startMs: 800, endMs: 1000, leadingSpace: true },
			],
		};
		const target: CaptionEditTarget = {
			id: "partial",
			startMs: 500,
			endMs: 700,
			text: "two",
			words: [
				{
					cueId: cue.id,
					cueWordIndex: 1,
					text: "two",
					startMs: 500,
					endMs: 700,
					leadingSpace: true,
				},
			],
		};
		const updated = updateCaptionCuesForEditedTarget([cue], target, "second word");
		expect(updated[0].text).toBe("one second word three");
		expect(updated[0].words).toBeUndefined();
		const layout = buildActiveCaptionLayout({
			cues: updated,
			timeMs: 550,
			settings: DEFAULT_AUTO_CAPTION_SETTINGS,
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});
		expect(layout?.hasWordTimings).toBe(false);
	});

	it("does not update captions when edited text is blank", () => {
		const cues: CaptionCue[] = [{ id: "a", startMs: 1_000, endMs: 2_000, text: "Hello Hello" }];

		expect(updateCaptionCuesForEditedTarget(cues, visibleTarget, " \n\t ")).toBe(cues);
	});

	it("keeps sound-effect style captions editable when word entries are blank", () => {
		const cues: CaptionCue[] = [
			{
				id: "sound-effect",
				startMs: 1_000,
				endMs: 2_000,
				text: "clears throat",
				words: [{ text: "", startMs: 1_000, endMs: 2_000 }],
			},
		];

		const layout = buildActiveCaptionLayout({
			cues,
			timeMs: 1_500,
			settings: DEFAULT_AUTO_CAPTION_SETTINGS,
			maxWidthPx: 500,
			measureText: (text) => text.length * 10,
		});

		expect(layout?.editTarget.text).toBe("clears throat");

		const updated = updateCaptionCuesForEditedTarget(cues, layout!.editTarget, "coughs");

		expect(updated[0].text).toBe("coughs");
		expect(updated[0].words).toBeUndefined();
	});
});
