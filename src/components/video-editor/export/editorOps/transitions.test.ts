import { describe, expect, it } from "vitest";
import { packClipSequence, reorderClipSequence } from "../../clipSequence";
import type { ClipRegion } from "../../types";
import {
	BOUNDARY_SNAP_MS,
	type ClipTransition,
	dipAlphaAt,
	MAX_TRANSITION_MS,
	MIN_TRANSITION_MS,
	paintDip,
	resolveTimelineDips,
	transitionOps,
} from "./transitions";
import type { EditorOpContext } from "./types";

const clip = (id: string, startMs: number, endMs: number, speed = 1): ClipRegion => ({
	id,
	startMs,
	endMs,
	sourceStartMs: startMs,
	speed,
});

function makeContext(clips: ClipRegion[], transitions: ClipTransition[] = [], duration = 20) {
	const state = { clips, transitions };
	const context = {
		duration,
		videoSourcePath: "/tmp/a.mp4",
		timeline: {
			get clipRegions() {
				return state.clips;
			},
			get transitions() {
				return state.transitions;
			},
			setTransitions: (next: ClipTransition[]) => {
				state.transitions = next;
			},
		},
		ids: {
			zoom: { current: 1 },
			clip: { current: 1 },
			audio: { current: 1 },
			annotation: { current: 1 },
			annotationZIndex: { current: 1 },
		},
		assertSameRecording: () => undefined,
		adoptJoinedMedia: () => undefined,
	} as unknown as EditorOpContext;
	return { state, context };
}

const run = (payload: unknown, context: EditorOpContext) =>
	transitionOps["timeline.transition"](payload, context) as Record<string, unknown>;

const threeClips = () => [
	clip("clip-1", 0, 5000),
	clip("clip-2", 5000, 9000),
	clip("clip-3", 9000, 20000),
];

describe("timeline.transition", () => {
	it("stores a dip on the cut named by betweenClips and leaves the length alone", () => {
		const { state, context } = makeContext(threeClips());
		const result = run({ betweenClips: 1, kind: "dip", ms: 400 }, context);
		expect(state.transitions).toEqual([
			{ id: "dip-clip-2", kind: "dip", ms: 400, afterClipId: "clip-2" },
		]);
		expect(result).toMatchObject({
			changed: true,
			kind: "dip",
			ms: 400,
			atMs: 5000,
			betweenClips: 1,
			durationMs: 20000,
		});
		expect(result.note).toContain("not a crossfade");
	});

	it("snaps atMs onto the nearest cut and reports where it moved from", () => {
		const { state, context } = makeContext(threeClips());
		const result = run({ atMs: 9000 - BOUNDARY_SNAP_MS, kind: "dip", ms: 300 }, context);
		expect(result).toMatchObject({ atMs: 9000, betweenClips: 2, snappedFromMs: 8750 });
		expect(state.transitions[0].afterClipId).toBe("clip-3");
	});

	it("refuses an atMs further from a cut than the snap distance", () => {
		const { state, context } = makeContext(threeClips());
		expect(() => run({ atMs: 2500, kind: "dip", ms: 300 }, context)).toThrow(
			/further than the 250 ms a transition snaps/,
		);
		expect(state.transitions).toEqual([]);
	});

	it("refuses a crossfade and says why, without storing anything", () => {
		const { state, context } = makeContext(threeClips());
		expect(() => run({ betweenClips: 1, kind: "crossfade", ms: 400 }, context)).toThrow(
			/never in hand together/,
		);
		expect(state.transitions).toEqual([]);
	});

	it("refuses an unknown kind instead of falling through to the dip", () => {
		const { context } = makeContext(threeClips());
		expect(() => run({ betweenClips: 1, kind: "wipe", ms: 400 }, context)).toThrow(
			/kind must be "dip"/,
		);
	});

	it("refuses a timeline of one clip and an empty timeline", () => {
		expect(() =>
			run(
				{ betweenClips: 1, kind: "dip", ms: 400 },
				makeContext([clip("clip-1", 0, 9000)]).context,
			),
		).toThrow(/no cut between clips/);
		expect(() =>
			run({ betweenClips: 1, kind: "dip", ms: 400 }, makeContext([]).context),
		).toThrow(/no clips yet/);
	});

	it("rejects betweenClips 0, the clip count, and a fraction", () => {
		const { context } = makeContext(threeClips());
		for (const betweenClips of [0, 3, -1, 1.5]) {
			expect(() => run({ betweenClips, kind: "dip", ms: 400 }, context)).toThrow(
				/betweenClips must be a whole number from 1 to 2/,
			);
		}
	});

	it("rejects both or neither of atMs and betweenClips", () => {
		const { context } = makeContext(threeClips());
		expect(() => run({ atMs: 5000, betweenClips: 1, kind: "dip", ms: 400 }, context)).toThrow(
			/exactly one of atMs/,
		);
		expect(() => run({ kind: "dip", ms: 400 }, context)).toThrow(/exactly one of atMs/);
	});

	it("rejects an unknown field and a non-numeric ms", () => {
		const { context } = makeContext(threeClips());
		expect(() =>
			run({ betweenClips: 1, kind: "dip", ms: 400, easing: "linear" }, context),
		).toThrow(/unknown field easing/);
		expect(() => run({ betweenClips: 1, kind: "dip", ms: "400" }, context)).toThrow(
			/ms must be a number/,
		);
	});

	it("rejects a negative ms and one under the floor or over the cap", () => {
		const { state, context } = makeContext(threeClips());
		expect(() => run({ betweenClips: 1, kind: "dip", ms: -400 }, context)).toThrow(
			/no length at all/,
		);
		expect(() =>
			run({ betweenClips: 1, kind: "dip", ms: MIN_TRANSITION_MS - 1 }, context),
		).toThrow(/read as a flicker/);
		expect(() =>
			run({ betweenClips: 1, kind: "dip", ms: MAX_TRANSITION_MS + 1 }, context),
		).toThrow(/look like a stall/);
		expect(state.transitions).toEqual([]);
	});

	it("refuses a dip whose half is longer than the shorter neighbouring clip", () => {
		const { state, context } = makeContext([
			clip("clip-1", 0, 5000),
			clip("clip-2", 5000, 5300),
			clip("clip-3", 5300, 9000),
		]);
		expect(() => run({ betweenClips: 2, kind: "dip", ms: 1000 }, context)).toThrow(
			/only runs 300 ms.*ask for 600 ms or less/s,
		);
		expect(state.transitions).toEqual([]);
		expect(run({ betweenClips: 2, kind: "dip", ms: 600 }, context)).toMatchObject({ ms: 600 });
	});

	it("accepts a cut between clips of different speeds without scaling the dip", () => {
		const { state, context } = makeContext([
			clip("clip-1", 0, 5000, 0.5),
			clip("clip-2", 5000, 7000, 2),
		]);
		run({ betweenClips: 1, kind: "dip", ms: 800 }, context);
		expect(resolveTimelineDips(state.clips, state.transitions)).toEqual([
			{ atMs: 5000, ms: 800 },
		]);
	});

	it("replaces rather than stacks a second transition on the same cut", () => {
		const { state, context } = makeContext(threeClips());
		run({ betweenClips: 1, kind: "dip", ms: 400 }, context);
		const result = run({ atMs: 5000, kind: "dip", ms: 900 }, context);
		expect(result).toMatchObject({ changed: true, ms: 900, replaced: 400 });
		expect(state.transitions).toHaveLength(1);
		expect(dipAlphaAt(resolveTimelineDips(state.clips, state.transitions), 5000)).toBe(1);
	});

	it("removes a transition on ms 0 and reports an empty cut as unchanged", () => {
		const { state, context } = makeContext(threeClips());
		run({ betweenClips: 1, kind: "dip", ms: 400 }, context);
		expect(run({ betweenClips: 1, kind: "dip", ms: 0 }, context)).toMatchObject({
			changed: true,
			removed: 400,
		});
		expect(state.transitions).toEqual([]);
		expect(run({ betweenClips: 1, kind: "dip", ms: 0 }, context)).toMatchObject({
			changed: false,
		});
	});

	it("starts from an absent transition list without throwing", () => {
		const { state, context } = makeContext(threeClips());
		state.transitions = undefined as unknown as ClipTransition[];
		expect(run({ betweenClips: 1, kind: "dip", ms: 400 }, context)).toMatchObject({
			changed: true,
		});
		expect(state.transitions).toHaveLength(1);
	});
});

describe("paintDip", () => {
	type Pixel = { r: number; g: number; b: number };

	function rasterizer(fill: Pixel, width = 4, height = 2) {
		const pixels: Pixel[] = Array.from({ length: width * height }, () => ({ ...fill }));
		const stack: { alpha: number; style: string }[] = [];
		const context = {
			canvas: { width, height },
			globalAlpha: 1,
			globalCompositeOperation: "source-over",
			fillStyle: "#000000",
			save() {
				stack.push({ alpha: context.globalAlpha, style: context.fillStyle });
			},
			restore() {
				const held = stack.pop();
				if (!held) return;
				context.globalAlpha = held.alpha;
				context.fillStyle = held.style;
			},
			fillRect(x: number, y: number, w: number, h: number) {
				if (context.globalCompositeOperation !== "source-over") {
					throw new Error(`unsupported composite ${context.globalCompositeOperation}`);
				}
				const source = {
					r: Number.parseInt(context.fillStyle.slice(1, 3), 16),
					g: Number.parseInt(context.fillStyle.slice(3, 5), 16),
					b: Number.parseInt(context.fillStyle.slice(5, 7), 16),
				};
				const alpha = context.globalAlpha;
				for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) {
					for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) {
						const target = pixels[row * width + col];
						target.r = Math.round(target.r * (1 - alpha) + source.r * alpha);
						target.g = Math.round(target.g * (1 - alpha) + source.g * alpha);
						target.b = Math.round(target.b * (1 - alpha) + source.b * alpha);
					}
				}
			},
		};
		return {
			pixels,
			context: context as unknown as CanvasRenderingContext2D,
			paint: (alpha: number) => paintDip(context as never, width, height, alpha),
		};
	}

	const white = { r: 255, g: 255, b: 255 };
	const wallpaper = { r: 32, g: 84, b: 200 };

	it("drives every pixel to black at full dip", () => {
		const target = rasterizer(white);
		expect(target.paint(1)).toBe(true);
		expect(target.pixels).toHaveLength(8);
		for (const pixel of target.pixels) expect(pixel).toEqual({ r: 0, g: 0, b: 0 });
	});

	it("darkens every pixel by half at half dip", () => {
		const target = rasterizer(white);
		expect(target.paint(0.5)).toBe(true);
		for (const pixel of target.pixels) expect(pixel).toEqual({ r: 128, g: 128, b: 128 });
	});

	it("darkens a wallpaper-coloured gap frame, which is not already black", () => {
		const target = rasterizer(wallpaper);
		expect(target.paint(0.75)).toBe(true);
		for (const pixel of target.pixels) {
			expect(pixel.r).toBeLessThan(wallpaper.r);
			expect(pixel.g).toBeLessThan(wallpaper.g);
			expect(pixel.b).toBeLessThan(wallpaper.b);
			expect(pixel).toEqual({ r: 8, g: 21, b: 50 });
		}
	});

	it("leaves every pixel untouched at zero, negative or no size, and reports it", () => {
		for (const alpha of [0, -1, Number.NaN]) {
			const target = rasterizer(white);
			expect(target.paint(alpha)).toBe(false);
			for (const pixel of target.pixels) expect(pixel).toEqual(white);
		}
		const sized = rasterizer(white);
		expect(paintDip(sized.context, 0, 2, 1)).toBe(false);
		expect(paintDip(sized.context, 2, 0, 1)).toBe(false);
		for (const pixel of sized.pixels) expect(pixel).toEqual(white);
	});

	it("clamps past full black rather than overshooting", () => {
		const target = rasterizer(white);
		expect(target.paint(4)).toBe(true);
		for (const pixel of target.pixels) expect(pixel).toEqual({ r: 0, g: 0, b: 0 });
	});

	it("restores the alpha and fill it borrowed", () => {
		const target = rasterizer(white);
		const context = target.context as unknown as { globalAlpha: number; fillStyle: string };
		context.globalAlpha = 0.25;
		context.fillStyle = "#ff0000";
		target.paint(0.5);
		expect(context.globalAlpha).toBe(0.25);
		expect(context.fillStyle).toBe("#ff0000");
	});
});

describe("resolveTimelineDips", () => {
	const dip = (afterClipId: string, ms = 400): ClipTransition => ({
		id: `dip-${afterClipId}`,
		kind: "dip",
		ms,
		afterClipId,
	});

	it("reads the boundary time off the clip the dip runs into", () => {
		expect(resolveTimelineDips(threeClips(), [dip("clip-3")])).toEqual([
			{ atMs: 9000, ms: 400 },
		]);
	});

	it("follows a reorder that repacks every clip", () => {
		const reordered = reorderClipSequence(threeClips(), "clip-3", 0);
		expect(reordered.map((entry) => entry.id)).toEqual(["clip-3", "clip-1", "clip-2"]);
		expect(resolveTimelineDips(reordered, [dip("clip-2")])).toEqual([{ atMs: 16000, ms: 400 }]);
	});

	it("drops a dip whose clip is gone, and one whose clip became the first", () => {
		const withoutTwo = packClipSequence([threeClips()[0], threeClips()[2]]);
		expect(resolveTimelineDips(withoutTwo, [dip("clip-2")])).toEqual([]);
		const withoutOne = packClipSequence(threeClips().slice(1));
		expect(resolveTimelineDips(withoutOne, [dip("clip-2")])).toEqual([]);
	});

	it("clamps a dip that no longer fits after its clips were trimmed", () => {
		const trimmed = packClipSequence([clip("clip-1", 0, 5000), clip("clip-2", 5000, 5120)]);
		expect(resolveTimelineDips(trimmed, [dip("clip-2", 800)])).toEqual([
			{ atMs: 5000, ms: 240 },
		]);
	});

	it("ignores a zero, negative or unknown-kind entry and never stacks one cut", () => {
		expect(resolveTimelineDips(threeClips(), [dip("clip-2", 0), dip("clip-2", -400)])).toEqual(
			[],
		);
		expect(
			resolveTimelineDips(threeClips(), [
				{ ...dip("clip-2", 400), kind: "crossfade" as unknown as "dip" },
			]),
		).toEqual([]);
		expect(
			resolveTimelineDips(threeClips(), [
				dip("clip-2", 400),
				{ ...dip("clip-2", 900), id: "dip-stray" },
			]),
		).toEqual([{ atMs: 5000, ms: 400 }]);
	});

	it("returns nothing for an empty or missing list", () => {
		expect(resolveTimelineDips(threeClips(), [])).toEqual([]);
		expect(resolveTimelineDips(threeClips(), undefined)).toEqual([]);
		expect(resolveTimelineDips([], [dip("clip-2")])).toEqual([]);
	});
});

describe("dipAlphaAt", () => {
	const dips = [{ atMs: 5000, ms: 400 }];

	it("peaks at full black on the cut and reaches zero at both ends", () => {
		expect(dipAlphaAt(dips, 5000)).toBe(1);
		expect(dipAlphaAt(dips, 4900)).toBeCloseTo(0.5);
		expect(dipAlphaAt(dips, 5100)).toBeCloseTo(0.5);
		expect(dipAlphaAt(dips, 4800)).toBe(0);
		expect(dipAlphaAt(dips, 5200)).toBe(0);
	});

	it("stays clear of every frame outside the dip", () => {
		expect(dipAlphaAt(dips, 0)).toBe(0);
		expect(dipAlphaAt(dips, 4799)).toBe(0);
		expect(dipAlphaAt(dips, 20000)).toBe(0);
		expect(dipAlphaAt([], 5000)).toBe(0);
		expect(dipAlphaAt(undefined, 5000)).toBe(0);
	});

	it("takes the darkest of two overlapping dips rather than summing them", () => {
		const overlapping = [
			{ atMs: 5000, ms: 400 },
			{ atMs: 5100, ms: 400 },
		];
		expect(dipAlphaAt(overlapping, 5050)).toBeCloseTo(0.75);
		expect(dipAlphaAt(overlapping, 5050)).toBeLessThanOrEqual(1);
	});

	it("ignores a dip of no length", () => {
		expect(dipAlphaAt([{ atMs: 5000, ms: 0 }], 5000)).toBe(0);
	});
});
