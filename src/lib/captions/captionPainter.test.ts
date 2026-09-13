import { describe, expect, it } from "vitest";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "@/components/video-editor/types";
import { buildCaptionBlock, drawCaptionBlock, getCaptionBlockCenter } from "./captionPainter";

type DrawCall = { method: string; args: unknown[]; fillStyle: unknown };

function createRecordingContext() {
	const calls: DrawCall[] = [];
	const state: Record<string, unknown> = { font: "", fillStyle: "#000", globalAlpha: 1 };
	const ctx = new Proxy(state, {
		get(target, property: string) {
			if (property === "measureText") {
				return (text: string) => ({ width: text.length * 10 });
			}
			if (property in target) {
				return target[property];
			}
			return (...args: unknown[]) => {
				calls.push({ method: property, args, fillStyle: target.fillStyle });
			};
		},
		set(target, property: string, value) {
			target[property] = value;
			return true;
		},
	});
	return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const FRAME = { width: 1920, height: 1080 };

const CUES: CaptionCue[] = [
	{
		id: "caption-1",
		startMs: 0,
		endMs: 1_500,
		text: "hola mundo",
		words: [
			{ text: "hola", startMs: 0, endMs: 700 },
			{ text: "mundo", startMs: 700, endMs: 1_500, leadingSpace: true },
		],
	},
];

function settingsWith(overrides: Partial<AutoCaptionSettings>): AutoCaptionSettings {
	return {
		...DEFAULT_AUTO_CAPTION_SETTINGS,
		enabled: true,
		animationStyle: "none",
		...overrides,
	};
}

function buildBlock(settings: AutoCaptionSettings, cues = CUES, timeMs = 900) {
	const { ctx } = createRecordingContext();
	const block = buildCaptionBlock({ cues, timeMs, settings, frame: FRAME, measureContext: ctx });
	if (!block) throw new Error("expected a caption block");
	return block;
}

function filledTexts(calls: DrawCall[]) {
	return calls
		.filter((call) => call.method === "fillText")
		.map((call) => ({ text: call.args[0], color: call.fillStyle }));
}

describe("getCaptionBlockCenter", () => {
	const box = { width: 400, height: 100 };

	it("anchors the caption to the bottom edge offset by default", () => {
		const settings = settingsWith({ bottomOffset: 10 });
		expect(getCaptionBlockCenter(settings, FRAME, box)).toEqual({ centerX: 960, centerY: 922 });
	});

	it("anchors to the top edge and to the frame middle", () => {
		expect(
			getCaptionBlockCenter(
				settingsWith({ verticalPosition: "top", bottomOffset: 10 }),
				FRAME,
				box,
			).centerY,
		).toBe(158);
		expect(
			getCaptionBlockCenter(settingsWith({ verticalPosition: "middle" }), FRAME, box).centerY,
		).toBe(540);
	});

	it("pins left and right aligned captions near the frame edges", () => {
		expect(
			getCaptionBlockCenter(settingsWith({ horizontalAlign: "left" }), FRAME, box).centerX,
		).toBeCloseTo(76.8 + 200);
		expect(
			getCaptionBlockCenter(settingsWith({ horizontalAlign: "right" }), FRAME, box).centerX,
		).toBeCloseTo(1920 - 76.8 - 200);
	});
});

describe("buildCaptionBlock", () => {
	it("returns null when captions are disabled", () => {
		const { ctx } = createRecordingContext();
		expect(
			buildCaptionBlock({
				cues: CUES,
				timeMs: 900,
				settings: { ...settingsWith({}), enabled: false },
				frame: FRAME,
				measureContext: ctx,
			}),
		).toBeNull();
	});

	it("measures uppercase text so wider glyph runs still fit the box", () => {
		const block = buildBlock(settingsWith({ uppercase: true }));
		expect(block.layout.visibleLines[0].width).toBe("HOLA MUNDO".length * 10);
	});
});

describe("drawCaptionBlock", () => {
	it("tints only the word being spoken in color highlight mode", () => {
		const settings = settingsWith({ highlightMode: "color", highlightColor: "#FACC15" });
		const { ctx, calls } = createRecordingContext();

		drawCaptionBlock(ctx, buildBlock(settings), settings);

		expect(filledTexts(calls)).toEqual([
			{ text: "hola", color: settings.textColor },
			{ text: "mundo", color: "#FACC15" },
		]);
	});

	it("does not highlight words whose timings are estimated", () => {
		const settings = settingsWith({ highlightMode: "color" });
		const untimed: CaptionCue[] = [{ id: "c", startMs: 0, endMs: 1_500, text: "hola mundo" }];
		const { ctx, calls } = createRecordingContext();

		drawCaptionBlock(ctx, buildBlock(settings, untimed), settings);

		expect(filledTexts(calls).every((entry) => entry.color === settings.textColor)).toBe(true);
	});

	it("paints a pill behind the active word before drawing its text", () => {
		const settings = settingsWith({
			highlightMode: "pill",
			highlightColor: "#22C55E",
			backgroundOpacity: 0,
		});
		const { ctx, calls } = createRecordingContext();

		drawCaptionBlock(ctx, buildBlock(settings), settings);

		const pillFillIndex = calls.findIndex(
			(call) => call.method === "fill" && call.fillStyle === "#22C55E",
		);
		const activeTextIndex = calls.findIndex(
			(call) => call.method === "fillText" && call.args[0] === "mundo",
		);
		expect(pillFillIndex).toBeGreaterThan(-1);
		expect(pillFillIndex).toBeLessThan(activeTextIndex);
		expect(calls.filter((call) => call.method === "fill")).toHaveLength(1);
	});

	it("strokes an outline under the text when outline width is set", () => {
		const settings = settingsWith({ outlineWidth: 3, highlightMode: "none" });
		const { ctx, calls } = createRecordingContext();

		drawCaptionBlock(ctx, buildBlock(settings), settings);

		expect(
			calls.filter((call) => call.method === "strokeText").map((call) => call.args[0]),
		).toEqual(["hola", "mundo"]);
	});
});

describe("pop highlight spacing", () => {
	it("reserves the enlarged width for every word so the pop never overlaps neighbours", () => {
		const block = buildBlock(settingsWith({ highlightMode: "pop" }));

		expect(block.layout.visibleLines[0].width).toBeCloseTo(
			"hola".length * 10 * 1.12 + 10 + "mundo".length * 10 * 1.12,
		);
	});
});

describe("word emphasis", () => {
	const THREE_WORD_CUES: CaptionCue[] = [
		{
			id: "caption-1",
			startMs: 0,
			endMs: 1_500,
			text: "uno extraordinario dos",
			words: [
				{ text: "uno", startMs: 0, endMs: 500 },
				{ text: "extraordinario", startMs: 500, endMs: 1_000, leadingSpace: true },
				{ text: "dos", startMs: 1_000, endMs: 1_500, leadingSpace: true, emphasized: true },
			],
		},
	];

	function colorsAt(settings: AutoCaptionSettings, timeMs: number) {
		const { ctx, calls } = createRecordingContext();
		drawCaptionBlock(ctx, buildBlock(settings, THREE_WORD_CUES, timeMs), settings);
		return Object.fromEntries(filledTexts(calls).map((entry) => [entry.text, entry.color]));
	}

	it("draws manually emphasized words in the emphasis color", () => {
		const settings = settingsWith({ highlightMode: "none", emphasisColor: "#FB923C" });

		expect(colorsAt(settings, 200)).toEqual({
			uno: settings.textColor,
			extraordinario: settings.textColor,
			dos: "#FB923C",
		});
	});

	it("lets the spoken word highlight win over emphasis", () => {
		const settings = settingsWith({ highlightMode: "color", highlightColor: "#FACC15" });

		expect(colorsAt(settings, 1_200).dos).toBe("#FACC15");
	});

	it("accents the first word of each caption with the first-word rule", () => {
		const settings = settingsWith({ highlightMode: "none", accentRule: "first-word" });

		expect(colorsAt(settings, 200).uno).toBe(settings.emphasisColor);
	});

	it("accents the longest word of each caption with the longest-word rule", () => {
		const settings = settingsWith({ highlightMode: "none", accentRule: "longest-word" });

		const colors = colorsAt(settings, 200);
		expect(colors.extraordinario).toBe(settings.emphasisColor);
		expect(colors.uno).toBe(settings.textColor);
	});
});
