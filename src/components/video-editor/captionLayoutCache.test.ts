import { describe, expect, it, vi } from "vitest";
import { prepareCaptionLayout } from "./captionLayout";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

const cues: CaptionCue[] = [
	{
		id: "a",
		startMs: 0,
		endMs: 1200,
		text: "hello world",
		words: [
			{ text: "hello", startMs: 80, endMs: 300 },
			{ text: "world", startMs: 600, endMs: 1000, leadingSpace: true },
		],
	},
	{ id: "b", startMs: 1400, endMs: 2000, text: "next phrase" },
];

const options = {
	cues,
	settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, animationStyle: "fade" as const },
	maxWidthPx: 1000,
	measureText: (text: string) => text.length * 10,
};

describe("prepared caption layout", () => {
	it("reuses wrapping and edit targets without measuring during playback or backward seeks", () => {
		const measureText = vi.fn(options.measureText);
		const sample = prepareCaptionLayout({ ...options, measureText });
		expect(measureText).toHaveBeenCalled();
		measureText.mockClear();
		const first = sample(100)!;
		const later = sample(700)!;
		expect(first.visibleLines[0].words.map((word) => word.state)).toEqual([
			"active",
			"upcoming",
		]);
		expect(later.visibleLines[0].words.map((word) => word.state)).toEqual(["spoken", "active"]);
		expect(later.editTarget).toBe(first.editTarget);
		expect(later.visibleLines[0].width).toBe(first.visibleLines[0].width);
		expect(later.opacity).toBe(1);
		expect(first.opacity).toBeLessThan(1);
		expect(sample(100)).toEqual(first);
		expect(sample(1399)?.editTarget.text).toBe("hello world");
		expect(sample(1400)?.editTarget.text).toBe("next phrase");
		expect(sample(2000)).toBeNull();
		expect(sample(-1)).toBeNull();
		expect(measureText).not.toHaveBeenCalled();
		// Sampling a different frame must never mutate an earlier returned frame.
		expect(first.visibleLines[0].words[0].state).toBe("active");
	});

	it("rebuilds wrapping and baseline for new width, font metrics, and row settings", () => {
		const phrase = [{ id: "c", startMs: 0, endMs: 3000, text: "alpha bravo charlie delta" }];
		const wide = prepareCaptionLayout({ ...options, cues: phrase, fontBaselinePx: 14 });
		const narrow = prepareCaptionLayout({
			...options,
			cues: phrase,
			maxWidthPx: 65,
			fontBaselinePx: 18,
		});
		const largerFont = prepareCaptionLayout({
			...options,
			cues: phrase,
			maxWidthPx: 120,
			measureText: (text) => text.length * 20,
		});
		const twoRows = prepareCaptionLayout({
			...options,
			cues: phrase,
			maxWidthPx: 65,
			settings: { ...options.settings, maxRows: 2 },
		});
		expect(wide(100)?.editTarget.text).toBe("alpha bravo charlie delta");
		expect(narrow(100)?.editTarget.text).toBe("alpha");
		expect(narrow(100)?.fontBaselinePx).toBe(18);
		expect(wide(100)?.fontBaselinePx).toBe(14);
		expect(largerFont(100)?.visibleLines[0].width).toBe(100);
		expect(twoRows(100)?.visibleLines).toHaveLength(2);
	});

	it("rebuilds text and timings after a caption edit without changing an existing timeline", () => {
		const original = prepareCaptionLayout(options);
		const edited = prepareCaptionLayout({
			...options,
			cues: [{ id: "a", startMs: 300, endMs: 900, text: "edited phrase" }],
		});
		expect(edited(100)).toBeNull();
		expect(edited(400)?.editTarget.text).toBe("edited phrase");
		expect(edited(400)?.editTarget.startMs).toBe(300);
		expect(original(400)?.editTarget.text).toBe("hello world");
	});
});
