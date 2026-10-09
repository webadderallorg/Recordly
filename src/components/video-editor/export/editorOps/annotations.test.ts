import { describe, expect, it } from "vitest";
import type { AnnotationRegion } from "../../types";
import { annotationsOps } from "./annotations";
import type { EditorOpContext } from "./types";

function makeContext(initial: AnnotationRegion[] = [], duration = 10) {
	const state = { regions: initial, selected: null as string | null };
	const context = {
		duration,
		videoSourcePath: "/tmp/a.mp4",
		timeline: {
			clipRegions: [],
			get annotationRegions() {
				return state.regions;
			},
			get selectedAnnotationId() {
				return state.selected;
			},
			setAnnotationRegions: (next: unknown) => {
				state.regions =
					typeof next === "function"
						? (next as (c: AnnotationRegion[]) => AnnotationRegion[])(state.regions)
						: (next as AnnotationRegion[]);
			},
			setSelectedAnnotationId: (id: string | null) => {
				state.selected = id;
			},
		},
		history: { undo: () => undefined, redo: () => undefined },
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

const blur = { kind: "blur", startMs: 1000, endMs: 3000, x: 10, y: 20, width: 30, height: 10 };
const add = (payload: unknown, context: EditorOpContext) =>
	annotationsOps["annotate.add"](payload, context) as { id: string };

describe("annotate.add blur", () => {
	it("creates a blur region in percent coordinates with the default strength", () => {
		const { state, context } = makeContext();
		const { id } = add(blur, context);
		expect(state.regions).toHaveLength(1);
		expect(state.regions[0]).toMatchObject({
			id,
			type: "blur",
			startMs: 1000,
			endMs: 3000,
			position: { x: 10, y: 20 },
			size: { width: 30, height: 10 },
			blurIntensity: 20,
			zIndex: 1,
		});
		expect(state.selected).toBe(id);
	});

	it("squares the box so no corner pixel escapes the blur", () => {
		const { state, context } = makeContext();
		add(blur, context);
		add(
			{ startMs: 0, endMs: 1000, x: 0, y: 0, width: 20, height: 20, kind: "text", text: "a" },
			context,
		);
		expect(state.regions[0].style.borderRadius).toBe(0);
		expect(state.regions[1].style.borderRadius).toBe(8);
	});

	it("accepts a box exactly on the frame edge and a range ending at the timeline end", () => {
		const { state, context } = makeContext();
		add({ ...blur, x: 0, y: 0, width: 100, height: 100, startMs: 0, endMs: 10000 }, context);
		expect(state.regions).toHaveLength(1);
	});

	it("gives the next annotation a higher zIndex and a unique id", () => {
		const { state, context } = makeContext();
		add(blur, context);
		add(blur, context);
		expect(state.regions[1].zIndex).toBe(2);
		expect(new Set(state.regions.map((r) => r.id)).size).toBe(2);
	});

	it("takes zIndex from the editor's shared counter, so a later hand edit cannot collide", () => {
		const { state, context } = makeContext();
		add(blur, context);
		expect(context.ids.annotationZIndex.current).toBe(2);
		const handAdded = context.ids.annotationZIndex.current++;
		expect(handAdded).not.toBe(state.regions[0].zIndex);
	});

	it("burns no id or zIndex when the add is refused", () => {
		const { context } = makeContext();
		expect(() => add({ ...blur, x: 90 }, context)).toThrow();
		expect(context.ids.annotation.current).toBe(1);
		expect(context.ids.annotationZIndex.current).toBe(1);
		expect(add(blur, context).id).toBe("annotation-1");
	});

	it("takes its ids from the editor's own counter, so they cannot collide", () => {
		const { context } = makeContext();
		expect(add(blur, context).id).toBe("annotation-1");
		expect(add(blur, context).id).toBe("annotation-2");
		expect(context.ids.annotation.current).toBe(3);
	});

	it.each([
		["a non-finite start", { startMs: Number.NaN }],
		["an inverted range", { startMs: 3000, endMs: 1000 }],
		["a zero-length range", { startMs: 1000, endMs: 1000 }],
		["a negative start", { startMs: -1 }],
		["an end past the timeline", { endMs: 10001 }],
		["a zero width", { width: 0 }],
		["a negative height", { height: -5 }],
		["a negative x", { x: -1 }],
		["a box running off the right edge", { x: 80, width: 30 }],
		["a box running off the bottom", { y: 95, height: 10 }],
		["a pixel-style size", { width: 400, height: 80 }],
		["a strength of 0", { strength: 0 }],
		["a strength above 100", { strength: 101 }],
		["a text-only field", { text: "hi" }],
		["a string time", { startMs: "1000" }],
		["a misspelled strength", { strenght: 80 }],
		["a range shorter than one exported frame", { startMs: 1001, endMs: 1032 }],
	])("refuses %s and changes nothing", (_name, override) => {
		const { state, context } = makeContext();
		expect(() => add({ ...blur, ...override }, context)).toThrow();
		expect(state.regions).toEqual([]);
		expect(state.selected).toBeNull();
	});

	it("refuses when no recording is loaded", () => {
		const { state, context } = makeContext([], 0);
		expect(() => add(blur, context)).toThrow(/no recording/);
		expect(state.regions).toEqual([]);
	});

	it("refuses an unknown kind and a non-object payload", () => {
		const { state, context } = makeContext();
		expect(() => add({ ...blur, kind: "spotlight" }, context)).toThrow(/kind must be one of/);
		expect(() => add(null, context)).toThrow(/needs an object/);
		expect(state.regions).toEqual([]);
	});
});

describe("annotate.add other kinds", () => {
	it("adds text, a figure arrow and an image", () => {
		const { state, context } = makeContext();
		const geo = { startMs: 0, endMs: 1000, x: 0, y: 0, width: 20, height: 20 };
		add({ ...geo, kind: "text", text: "Hello" }, context);
		add({ ...geo, kind: "figure", arrowDirection: "up-left", color: "#ff0000" }, context);
		add({ ...geo, kind: "image", image: "data:image/png;base64,AAAA" }, context);
		expect(state.regions[0]).toMatchObject({
			type: "text",
			content: "Hello",
			textContent: "Hello",
		});
		expect(state.regions[1].figureData).toEqual({
			arrowDirection: "up-left",
			color: "#ff0000",
			strokeWidth: 4,
		});
		expect(state.regions[2]).toMatchObject({
			type: "image",
			imageContent: "data:image/png;base64,AAAA",
		});
	});

	it("refuses empty text, a bad arrow and a non-image URL", () => {
		const { state, context } = makeContext();
		const geo = { startMs: 0, endMs: 1000, x: 0, y: 0, width: 20, height: 20 };
		expect(() => add({ ...geo, kind: "text" }, context)).toThrow();
		expect(() => add({ ...geo, kind: "text", text: "  " }, context)).toThrow();
		expect(() => add({ ...geo, kind: "figure", arrowDirection: "sideways" }, context)).toThrow(
			/arrowDirection/,
		);
		expect(() => add({ ...geo, kind: "image", image: "https://x/y.png" }, context)).toThrow(
			/data:image/,
		);
		expect(state.regions).toEqual([]);
	});
});

describe("annotate.update / remove / clear", () => {
	it("moves a blur and keeps the rest", () => {
		const { state, context } = makeContext();
		const { id } = add(blur, context);
		annotationsOps["annotate.update"]({ id, x: 50, strength: 60 }, context);
		expect(state.regions[0]).toMatchObject({
			position: { x: 50, y: 20 },
			size: { width: 30, height: 10 },
			blurIntensity: 60,
		});
	});

	it("refuses an update that would leave the frame and keeps the old region", () => {
		const { state, context } = makeContext();
		const { id } = add(blur, context);
		expect(() => annotationsOps["annotate.update"]({ id, x: 90 }, context)).toThrow(
			/inside the frame/,
		);
		expect(state.regions[0].position.x).toBe(10);
	});

	it("refuses a retime shorter than one exported frame and keeps the old range", () => {
		const { state, context } = makeContext();
		const { id } = add(blur, context);
		expect(() =>
			annotationsOps["annotate.update"]({ id, startMs: 1001, endMs: 1032 }, context),
		).toThrow(/too short to be rendered/);
		expect(state.regions[0]).toMatchObject({ startMs: 1000, endMs: 3000 });
	});

	it("refuses an update whose last field is unknown and applies none of the earlier ones", () => {
		const { state, context } = makeContext();
		const { id } = add(blur, context);
		expect(() =>
			annotationsOps["annotate.update"]({ id, x: 50, strength: 60, strenght: 80 }, context),
		).toThrow(/unknown field strenght/);
		expect(state.regions[0]).toMatchObject({
			position: { x: 10, y: 20 },
			blurIntensity: 20,
		});
	});

	it("refuses clear with arguments instead of wiping every annotation", () => {
		const { state, context } = makeContext();
		const { id } = add(blur, context);
		expect(() => annotationsOps["annotate.clear"]({ id }, context)).toThrow(
			/takes no arguments/,
		);
		expect(state.regions).toHaveLength(1);
	});

	it("refuses unknown ids, empty updates and kind changes", () => {
		const { context } = makeContext();
		const { id } = add(blur, context);
		expect(() => annotationsOps["annotate.update"]({ id: "nope", x: 1 }, context)).toThrow(
			/no annotation/,
		);
		expect(() => annotationsOps["annotate.update"]({ id }, context)).toThrow(
			/at least one field/,
		);
		expect(() => annotationsOps["annotate.update"]({ id, kind: "text" }, context)).toThrow(
			/cannot change/,
		);
		expect(() => annotationsOps["annotate.update"]({ id, text: "x" }, context)).toThrow(
			/does not apply/,
		);
	});

	it("removes one annotation and clears the selection only if it was selected", () => {
		const { state, context } = makeContext();
		const a = add(blur, context).id;
		const b = add(blur, context).id;
		annotationsOps["annotate.remove"]({ id: a }, context);
		expect(state.regions.map((r) => r.id)).toEqual([b]);
		expect(state.selected).toBe(b);
		annotationsOps["annotate.remove"]({ id: b }, context);
		expect(state.selected).toBeNull();
		expect(() => annotationsOps["annotate.remove"]({ id: b }, context)).toThrow(
			/no annotation/,
		);
	});

	it("clears everything, and refuses when there is nothing to clear", () => {
		const { state, context } = makeContext();
		expect(() => annotationsOps["annotate.clear"]({}, context)).toThrow(/no annotations/);
		add(blur, context);
		add(blur, context);
		expect(annotationsOps["annotate.clear"]({}, context)).toEqual({ removed: 2 });
		expect(state.regions).toEqual([]);
		expect(state.selected).toBeNull();
	});
});

describe("annotate space", () => {
	const title = {
		kind: "text",
		text: "The end",
		startMs: 0,
		endMs: 2000,
		x: 10,
		y: 40,
		width: 80,
		height: 20,
	};

	it("defaults to frame and stores screen when asked", () => {
		const { state, context } = makeContext();
		expect(annotationsOps["annotate.add"](title, context)).toMatchObject({ space: "frame" });
		expect(
			annotationsOps["annotate.add"]({ ...title, space: "screen" }, context),
		).toMatchObject({
			space: "screen",
		});
		expect(state.regions[0].space).toBeUndefined();
		expect(state.regions[1].space).toBe("screen");
	});

	it("moves an existing annotation between spaces", () => {
		const { state, context } = makeContext();
		const { id } = add(title, context);
		annotationsOps["annotate.update"]({ id, space: "screen" }, context);
		expect(state.regions[0].space).toBe("screen");
	});

	it("refuses an unknown space", () => {
		const { state, context } = makeContext();
		expect(() => add({ ...title, space: "world" }, context)).toThrow(/space must be one of/);
		expect(state.regions).toHaveLength(0);
	});

	it("refuses a blur pinned to the screen, on add and on update", () => {
		const { state, context } = makeContext();
		expect(() => add({ ...blur, space: "screen" }, context)).toThrow(
			/cannot use space "screen"/,
		);
		const { id } = add(blur, context);
		expect(() => annotationsOps["annotate.update"]({ id, space: "screen" }, context)).toThrow(
			/cannot use space "screen"/,
		);
		expect(state.regions[0].space).toBeUndefined();
	});

	it("says which space an updated annotation ended up in", () => {
		const { context } = makeContext();
		const added = annotationsOps["annotate.add"](
			{
				kind: "text",
				text: "Title",
				startMs: 0,
				endMs: 1000,
				x: 10,
				y: 10,
				width: 40,
				height: 10,
				space: "screen",
			},
			context,
		) as { id: string; space: string };
		expect(added.space).toBe("screen");
		const updated = annotationsOps["annotate.update"]({ id: added.id, x: 20 }, context) as {
			space: string;
		};
		expect(updated.space).toBe("screen");
	});
});

const spot = { kind: "highlight", startMs: 1000, endMs: 3000, x: 10, y: 20, width: 30, height: 10 };
const update = (payload: unknown, context: EditorOpContext) =>
	annotationsOps["annotate.update"](payload, context);

describe("annotate.add highlight", () => {
	it("creates a frame-space highlight with the default dim", () => {
		const { state, context } = makeContext();
		add(spot, context);
		expect(state.regions[0]).toMatchObject({ type: "highlight", highlightDim: 0.6 });
		expect(state.regions[0].space ?? "frame").toBe("frame");
	});

	it("accepts dim exactly at both bounds", () => {
		const { state, context } = makeContext();
		add({ ...spot, dim: 0.1 }, context);
		add({ ...spot, startMs: 4000, endMs: 5000, dim: 0.9 }, context);
		expect(state.regions.map((r) => r.highlightDim)).toEqual([0.1, 0.9]);
	});

	it.each([0.09, 0, 0.91, 1, -1, Number.NaN])("refuses dim %s", (dim) => {
		const { state, context } = makeContext();
		expect(() => add({ ...spot, dim }, context)).toThrow(/dim must be|finite/);
		expect(state.regions).toHaveLength(0);
	});

	it("refuses a rectangle covering the whole frame", () => {
		const { context } = makeContext();
		expect(() => add({ ...spot, x: 0, y: 0, width: 100, height: 100 }, context)).toThrow(
			/dim nothing/,
		);
	});

	it("allows a rectangle spanning the full width but not the full height", () => {
		const { state, context } = makeContext();
		add({ ...spot, x: 0, y: 40, width: 100, height: 20 }, context);
		expect(state.regions).toHaveLength(1);
	});

	it("refuses a zero-size rectangle and one partly off the frame", () => {
		const { context } = makeContext();
		expect(() => add({ ...spot, width: 0 }, context)).toThrow(/above 0/);
		expect(() => add({ ...spot, x: 80, width: 30 }, context)).toThrow(/inside the frame/);
		expect(() => add({ ...spot, y: -1 }, context)).toThrow(/inside the frame/);
	});

	it("refuses space screen", () => {
		const { context } = makeContext();
		expect(() => add({ ...spot, space: "screen" }, context)).toThrow(
			/cannot use space "screen"/,
		);
	});

	it("refuses fields of other kinds and dim on other kinds", () => {
		const { context } = makeContext();
		expect(() => add({ ...spot, text: "x" }, context)).toThrow(/does not apply/);
		expect(() => add({ ...blur, dim: 0.5 }, context)).toThrow(/does not apply/);
	});

	it("refuses overlapping highlights, allows back-to-back ones", () => {
		const { state, context } = makeContext();
		add(spot, context);
		expect(() => add({ ...spot, startMs: 2999, endMs: 4000 }, context)).toThrow(
			/already spotlights/,
		);
		add({ ...spot, startMs: 3000, endMs: 4000 }, context);
		expect(state.regions).toHaveLength(2);
	});

	it("refuses an update that makes two highlights overlap but lets one move itself", () => {
		const { context } = makeContext();
		const first = add(spot, context);
		const second = add({ ...spot, startMs: 4000, endMs: 5000 }, context);
		expect(() => update({ id: second.id, startMs: 2000 }, context)).toThrow(
			/already spotlights/,
		);
		expect(() => update({ id: first.id, startMs: 1500 }, context)).not.toThrow();
	});

	it("coexists with a blur at the same moment", () => {
		const { state, context } = makeContext();
		add(blur, context);
		add(spot, context);
		expect(state.regions.map((r) => r.type)).toEqual(["blur", "highlight"]);
	});
});

describe("annotate.add preset", () => {
	const times = { startMs: 1000, endMs: 3000 };

	it("lower_third fills a screen-space plate from one name", () => {
		const { state, context } = makeContext();
		add({ preset: "lower_third", text: "Ada Lovelace", ...times }, context);
		expect(state.regions[0]).toMatchObject({
			type: "text",
			space: "screen",
			textContent: "Ada Lovelace",
			position: { x: 5, y: 80 },
			size: { width: 50, height: 12 },
			style: { backgroundColor: "rgba(10, 10, 10, 0.88)", textAlign: "left", fontSize: 36 },
		});
	});

	it("callout needs a position because it sits next to something", () => {
		const { context } = makeContext();
		expect(() => add({ preset: "callout", text: "Click", ...times }, context)).toThrow(/x/);
		const { state, context: ok } = makeContext();
		add({ preset: "callout", text: "Click", x: 40, y: 30, ...times }, ok);
		expect(state.regions[0]).toMatchObject({
			space: "frame",
			position: { x: 40, y: 30 },
			style: { color: "#111111", backgroundColor: "#FFD60A" },
		});
	});

	it("explicit fields win over the preset", () => {
		const { state, context } = makeContext();
		add(
			{ preset: "lower_third", text: "Hi", fontSize: 50, y: 70, space: "frame", ...times },
			context,
		);
		expect(state.regions[0]).toMatchObject({
			space: "frame",
			position: { x: 5, y: 70 },
			style: { fontSize: 50, backgroundColor: "rgba(10, 10, 10, 0.88)" },
		});
	});

	it("goes through the same validation as hand-authored values", () => {
		const { context } = makeContext();
		expect(() =>
			add({ preset: "lower_third", text: "Hi", fontSize: 0, ...times }, context),
		).toThrow(/fontSize must be above 0/);
		expect(() =>
			add({ preset: "lower_third", text: "Hi", endMs: 99999, startMs: 0 }, context),
		).toThrow(/past the end/);
	});

	it("refuses an unknown name, naming the valid ones", () => {
		const { context } = makeContext();
		expect(() => add({ preset: "banner", text: "Hi", ...times }, context)).toThrow(
			/lower_third, callout/,
		);
	});

	it("refuses two presets, and a preset on a non-text kind", () => {
		const { context } = makeContext();
		expect(() =>
			add({ preset: ["lower_third", "callout"], text: "Hi", ...times }, context),
		).toThrow(/exactly one/);
		expect(() => add({ ...blur, preset: "lower_third" }, context)).toThrow(/styles a text/);
	});

	it("refuses empty or missing text", () => {
		const { state, context } = makeContext();
		expect(() => add({ preset: "lower_third", text: "", ...times }, context)).toThrow(/text/);
		expect(() => add({ preset: "lower_third", text: "  ", ...times }, context)).toThrow(/text/);
		expect(() => add({ preset: "lower_third", ...times }, context)).toThrow(/non-empty text/);
		expect(state.regions).toHaveLength(0);
	});

	it("is not accepted by annotate.update", () => {
		const { context } = makeContext();
		const { id } = add(
			{ kind: "text", text: "a", x: 0, y: 0, width: 20, height: 20, ...times },
			context,
		);
		expect(() => update({ id, preset: "callout" }, context)).toThrow(/preset/);
	});

	it("stays legible over white and over black footage", () => {
		const luminance = (rgb: number[]) => {
			const [r, g, b] = rgb.map((c) => {
				const v = c / 255;
				return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const parse = (css: string) => {
			const m = /rgba?\(([^)]+)\)/.exec(css);
			if (m) {
				const [r, g, b, a = 1] = m[1].split(",").map(Number);
				return { rgb: [r, g, b], alpha: a };
			}
			const n = Number.parseInt(css.slice(1), 16);
			return { rgb: [n >> 16, (n >> 8) & 255, n & 255], alpha: 1 };
		};
		for (const preset of ["lower_third", "callout"]) {
			const { state, context } = makeContext();
			add({ preset, text: "Hi", x: 10, y: 10, ...times }, context);
			const style = state.regions[0].style;
			const text = parse(style.color).rgb;
			const plate = parse(style.backgroundColor);
			expect(plate.alpha).toBeGreaterThanOrEqual(0.85);
			for (const backdrop of [0, 255]) {
				const shown = plate.rgb.map((c) => c * plate.alpha + backdrop * (1 - plate.alpha));
				const [hi, lo] = [luminance(text), luminance(shown)].sort((a, b) => b - a);
				expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(7);
			}
		}
	});
});
