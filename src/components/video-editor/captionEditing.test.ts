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

	it("preserves cue identity and timing when editing captions with word timings", () => {
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
		expect(updated[0].words).toEqual([{ text: "Hi", startMs: 1_000, endMs: 2_000 }]);
		expect(updated[1].words).toEqual([
			{ text: "大家好", startMs: 2_000, endMs: 2_400 },
			{ text: "这个是我的屏幕", startMs: 2_400, endMs: 3_000, leadingSpace: true },
		]);
	});

	it("does not update captions when edited text is blank", () => {
		const cues: CaptionCue[] = [{ id: "a", startMs: 1_000, endMs: 2_000, text: "Hello Hello" }];

		expect(updateCaptionCuesForEditedTarget(cues, visibleTarget, " \n\t ")).toBe(cues);
	});
});
