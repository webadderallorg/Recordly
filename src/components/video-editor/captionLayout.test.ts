import { describe, expect, it } from "vitest";
import {
	buildActiveCaptionLayout,
	flattenCaptionWords,
	prepareCaptionLayout,
} from "./captionLayout";
import { type CaptionCue, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

it("wraps uppercase TikTok display text without changing the editable transcript", () => {
	const cue = { id: "caps", startMs: 0, endMs: 1000, text: "hello wide" };
	const layout = buildActiveCaptionLayout({
		cues: [cue],
		timeMs: 500,
		settings: {
			...DEFAULT_AUTO_CAPTION_SETTINGS,
			style: "tiktok",
			maxRows: 2,
			animationStyle: "none",
		},
		maxWidthPx: 100,
		measureText: (text) =>
			[...text].reduce((sum, char) => sum + (/[A-Z]/.test(char) ? 12 : 6), 0),
	});
	expect(layout?.visibleLines.map((line) => line.width)).toEqual([60, 48]);
	expect(layout?.editTarget.text).toBe("hello wide");
	expect(layout?.editTarget.words.map((word) => word.text)).toEqual(["hello", "wide"]);
	expect(cue.text).toBe("hello wide");
});

describe("flattenCaptionWords", () => {
	it("forces a break at every cue boundary so each phrase shows on its own", () => {
		const cues: CaptionCue[] = [
			{
				id: "a",
				startMs: 0,
				endMs: 1_000,
				text: "hello world",
				words: [
					{ text: "hello", startMs: 0, endMs: 500 },
					{ text: "world", startMs: 500, endMs: 1_000, leadingSpace: true },
				],
			},
			{
				// back-to-back with cue "a" (no gap) — would previously be re-packed by width
				id: "b",
				startMs: 1_000,
				endMs: 2_000,
				text: "next one",
				words: [
					{ text: "next", startMs: 1_000, endMs: 1_500 },
					{ text: "one", startMs: 1_500, endMs: 2_000, leadingSpace: true },
				],
			},
		];

		const flattened = flattenCaptionWords(cues);
		const firstWordOfSecondCue = flattened.find(
			(word) => word.cueId === "b" && word.cueWordIndex === 0,
		);

		expect(firstWordOfSecondCue?.forcedBreakBefore).toBe(true);
		expect(firstWordOfSecondCue?.leadingSpace).toBe(false);
		// the very first word of the first cue never forces a break
		expect(flattened[0].forcedBreakBefore).toBe(false);
	});
});

describe("current-word caption layout", () => {
	const cue: CaptionCue = {
		id: "a",
		startMs: 0,
		endMs: 1000,
		text: "hello world",
		words: [
			{ text: "hello", startMs: 0, endMs: 300 },
			{ text: "world", startMs: 600, endMs: 1000, leadingSpace: true },
		],
	};
	const layout = (timeMs: number, cues = [cue], maxRows = 1) =>
		buildActiveCaptionLayout({
			cues,
			timeMs,
			settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, maxRows, animationStyle: "none" },
			maxWidthPx: 1000,
			measureText: (text) => text.length * 10,
		});

	it("lays out unsorted saved cues in time order without mutating their array", () => {
		const middle = { id: "middle", startMs: 1200, endMs: 2000, text: "middle phrase" };
		const last = { id: "last", startMs: 2400, endMs: 3200, text: "last phrase" };
		const unsorted = [last, cue, middle];
		for (const time of [100, 700, 1300, 1900, 2500, 3100]) {
			expect(layout(time, unsorted)).toEqual(layout(time, [cue, middle, last]));
		}
		expect(unsorted).toEqual([last, cue, middle]);
	});

	it("retains the established input ordering for cues with equal start times", () => {
		const sameStart = { ...cue, id: "same-start", text: "same start", words: undefined };
		const later = { id: "later", startMs: 2000, endMs: 3000, text: "later" };
		for (const time of [100, 600, 2100]) {
			expect(layout(time, [later, cue, sameStart])).toEqual(
				layout(time, [cue, sameStart, later]),
			);
		}
	});

	it.each([
		"chronological",
		"reversed",
	] as const)("keeps the visible overlapping cue and its highlighted word together for %s saved cues", (order) => {
		const next: CaptionCue = {
			id: "b",
			startMs: 800,
			endMs: 1800,
			text: "next phrase",
			words: [
				{ text: "next", startMs: 800, endMs: 1200 },
				{ text: "phrase", startMs: 1400, endMs: 1800, leadingSpace: true },
			],
		};
		const cues = order === "chronological" ? [cue, next] : [next, cue];
		const options = {
			cues,
			settings: {
				...DEFAULT_AUTO_CAPTION_SETTINGS,
				maxRows: 1,
				animationStyle: "none" as const,
			},
			maxWidthPx: 1000,
			measureText: (text: string) => text.length * 10,
		};
		const sample = prepareCaptionLayout(options);
		expect(sample(799)?.cue.id).toBe("a");
		for (const timeMs of [800, 900, 999, 1000]) {
			const active = sample(timeMs)!;
			expect(active.editTarget.text).toBe("next phrase");
			expect(active.cue.id).toBe("b");
			const emphasized = active.visibleLines
				.flatMap((line) => line.words)
				.filter((word) => word.state === "active");
			expect(emphasized.map((word) => word.cueId)).toEqual(["b"]);
			expect(emphasized[0].index).toBe(active.activeWordIndex);
			expect(active.activeWordProgress).toBeCloseTo((timeMs - 800) / 400);
			expect(buildActiveCaptionLayout({ ...options, timeMs })).toEqual(active);
		}
		expect(sample(799)?.cue.id).toBe("a");
		expect(sample(900)?.cue.id).toBe("b");
		expect(sample(1800)).toBeNull();
	});

	it("keeps an overlapping cue lead-in unhighlighted until its own first word", () => {
		const next: CaptionCue = {
			id: "b",
			startMs: 800,
			endMs: 1800,
			text: "next",
			words: [{ text: "next", startMs: 880, endMs: 1700 }],
		};
		for (const timeMs of [800, 850, 879]) {
			const active = layout(timeMs, [cue, next])!;
			expect(active.editTarget.text).toBe("next");
			expect(active.cue.id).toBe("b");
			expect(active.activeWordIndex).toBe(-1);
			expect(active.visibleLines[0].words[0].state).toBe("upcoming");
		}
		expect(layout(880, [cue, next])?.visibleLines[0].words[0].state).toBe("active");
	});

	it("finishes Pop in 90ms while Fade retains its 180ms entrance", () => {
		const animated = (animationStyle: "pop" | "fade", timeMs: number) =>
			buildActiveCaptionLayout({
				cues: [cue],
				timeMs,
				settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, animationStyle },
				maxWidthPx: 1000,
				measureText: (text) => text.length * 10,
			});
		expect(animated("pop", 45)?.scale).toBeLessThan(1);
		expect(animated("pop", 90)?.scale).toBe(1);
		expect(animated("pop", 90)?.opacity).toBe(1);
		expect(animated("fade", 90)?.opacity).toBeLessThan(1);
		expect(animated("fade", 180)?.opacity).toBe(1);
	});

	it("switches the active word exactly when the next word starts", () => {
		expect(layout(100)?.visibleLines[0].words.map((word) => word.state)).toEqual([
			"active",
			"upcoming",
		]);
		expect(layout(600)?.visibleLines[0].words.map((word) => word.state)).toEqual([
			"spoken",
			"active",
		]);
	});

	it("holds the active word through the gap without changing acoustic or editing timestamps", () => {
		for (const time of [300, 450, 599]) {
			const paused = layout(time);
			expect(paused?.editTarget.text).toBe("hello world");
			expect(paused?.activeWordIndex).toBe(0);
			expect(paused?.activeWordProgress).toBe(1);
			expect(paused?.visibleLines[0].words.map((word) => word.state)).toEqual([
				"active",
				"upcoming",
			]);
			expect(paused?.editTarget.words[0].endMs).toBe(300);
		}
	});

	it("hands emphasis to the next word even when acoustic intervals overlap", () => {
		const overlapping = {
			...cue,
			words: [{ ...cue.words![0], endMs: 800 }, cue.words![1]],
		};
		expect(layout(599, [overlapping])?.activeWordIndex).toBe(0);
		expect(layout(600, [overlapping])?.visibleLines[0].words.map((word) => word.state)).toEqual(
			["spoken", "active"],
		);
	});

	it("keeps the final word active through cue padding and a bridged short gap", () => {
		const padded = { ...cue, endMs: 1100 };
		const next = { id: "b", startMs: 1300, endMs: 2000, text: "next" };
		for (const time of [1000, 1099, 1100, 1299]) {
			expect(layout(time, [padded, next])?.activeWordIndex).toBe(1);
			expect(layout(time, [padded, next])?.visibleLines[0].words[1].state).toBe("active");
		}
		expect(layout(1300, [padded, next])?.editTarget.text).toBe("next");
		expect(layout(1100, [padded])).toBeNull();
	});

	it("switches phrases exactly at their boundary and never packs a future phrase into extra rows", () => {
		const next: CaptionCue = {
			id: "b",
			startMs: 1000,
			endMs: 2000,
			text: "next phrase",
		};
		for (const rows of [1, 2, 4]) {
			expect(layout(800, [cue, next], rows)?.editTarget.text).toBe("hello world");
			expect(layout(1000, [cue, next], rows)?.editTarget.text).toBe("next phrase");
		}
		expect(layout(2000, [cue, next])).toBeNull();
	});

	it("never resurrects the previous phrase when speech resumes after silence", () => {
		const next: CaptionCue = {
			id: "b",
			startMs: 2000,
			endMs: 3000,
			text: "next phrase",
			words: [
				{ text: "next", startMs: 2080, endMs: 2400 },
				{ text: "phrase", startMs: 2450, endMs: 2900, leadingSpace: true },
			],
		};
		for (const rows of [1, 2, 4]) {
			for (const time of [1000, 1500, 1999])
				expect(layout(time, [cue, next], rows)).toBeNull();
			for (const time of [2000, 2040, 2079, 2080, 2950]) {
				expect(layout(time, [cue, next], rows)?.editTarget.text).toBe("next phrase");
			}
		}
		expect(layout(2040, [cue, next])?.activeWordIndex).toBe(-1);
		expect(layout(2080, [cue, next])?.visibleLines[0].words[0].state).toBe("active");
		expect(layout(3000, [cue, next])).toBeNull();
	});

	it("bridges a short pause but switches to the next cue before its delayed first word", () => {
		const next: CaptionCue = {
			id: "b",
			startMs: 1200,
			endMs: 2000,
			text: "next",
			words: [{ text: "next", startMs: 1280, endMs: 1900 }],
		};
		expect(layout(1199, [cue, next])?.editTarget.text).toBe("hello world");
		expect(layout(1200, [cue, next])?.editTarget.text).toBe("next");
		expect(layout(1200, [cue, next])?.activeWordIndex).toBe(-1);
		expect(layout(1280, [cue, next])?.visibleLines[0].words[0].state).toBe("active");
	});

	it("fades once at the cue end even when the last word ends earlier", () => {
		const padded = { ...cue, words: [{ text: "hello", startMs: 80, endMs: 900 }] };
		const at = (timeMs: number) =>
			buildActiveCaptionLayout({
				cues: [padded],
				timeMs,
				settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, animationStyle: "fade" },
				maxWidthPx: 1000,
				measureText: (text) => text.length * 10,
			});
		expect(at(0)?.editTarget.text).toBe("hello");
		expect(at(800)?.opacity).toBe(1);
		expect(at(950)?.opacity).toBeGreaterThan(0);
		expect(at(950)?.opacity).toBeLessThan(0.5);
		expect(at(999)?.opacity).toBeLessThan(at(950)!.opacity);
		expect(at(1000)).toBeNull();
	});

	it("does not fade away while the last word is still being spoken", () => {
		for (const timeMs of [900, 950, 999]) {
			const active = buildActiveCaptionLayout({
				cues: [cue],
				timeMs,
				settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, animationStyle: "fade" },
				maxWidthPx: 1000,
				measureText: (text) => text.length * 10,
			});
			expect(active?.opacity).toBe(1);
			expect(active?.visibleLines[0].words.at(-1)?.state).toBe("active");
		}
	});

	it("does not claim text-only captions have acoustic word timings", () => {
		const untimed = layout(100, [{ ...cue, words: undefined }]);
		expect(untimed?.hasWordTimings).toBe(false);
	});

	it("uses the configured rows for wrapping within a single phrase", () => {
		const wrapped: CaptionCue = {
			id: "wrapped",
			startMs: 0,
			endMs: 1200,
			text: "one two three four",
			words: ["one", "two", "three", "four"].map((text, index) => ({
				text,
				startMs: index * 300,
				endMs: (index + 1) * 300,
				leadingSpace: index > 0,
			})),
		};
		const at = (timeMs: number) =>
			buildActiveCaptionLayout({
				cues: [wrapped],
				timeMs,
				settings: { ...DEFAULT_AUTO_CAPTION_SETTINGS, maxRows: 2, animationStyle: "none" },
				maxWidthPx: 60,
				measureText: (text) => text.length * 10,
			});
		expect(at(599)?.visibleLines.map((line) => line.words[0].text)).toEqual(["one", "two"]);
		expect(at(600)?.visibleLines.map((line) => line.words[0].text)).toEqual(["three", "four"]);
		expect(at(600)?.visibleLines[0].words[0].state).toBe("active");
	});
});
