import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../../types";
import type { EditorOpContext } from "./types";
import { zoomOps } from "./zoom";

function makeContext(initial: ZoomRegion[] = [], duration = 10) {
	const state = { regions: initial, selected: null as string | null };
	const context = {
		duration,
		videoSourcePath: "/tmp/a.mp4",
		timeline: {
			clipRegions: [],
			get zoomRegions() {
				return state.regions;
			},
			get selectedZoomId() {
				return state.selected;
			},
			setZoomRegions: (next: unknown) => {
				state.regions =
					typeof next === "function"
						? (next as (c: ZoomRegion[]) => ZoomRegion[])(state.regions)
						: (next as ZoomRegion[]);
			},
			setSelectedZoomId: (id: string | null) => {
				state.selected = id;
			},
		},
		ids: {
			zoom: { current: state.regions.length + 1 },
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

const region = (over: Partial<ZoomRegion> = {}): ZoomRegion => ({
	id: "zoom-1",
	startMs: 1000,
	endMs: 2000,
	depth: 3,
	focus: { cx: 0.5, cy: 0.5 },
	mode: "auto",
	...over,
});
const zoomTwo = () => region({ id: "zoom-2", startMs: 5000, endMs: 6000 });
const run = (op: string, payload: unknown, context: EditorOpContext) =>
	zoomOps[op](payload, context) as Record<string, unknown>;

describe("zoom.add", () => {
	it("adds a manual region with the default depth and a selected id", () => {
		const { state, context } = makeContext();
		const result = run("zoom.add", { startMs: 1000, endMs: 3000 }, context) as {
			zoom: ZoomRegion;
		};
		expect(state.regions).toEqual([
			{
				id: "zoom-1",
				startMs: 1000,
				endMs: 3000,
				depth: 3,
				focus: { cx: 0.5, cy: 0.5 },
				mode: "manual",
			},
		]);
		expect(state.selected).toBe("zoom-1");
		expect(result.zoom).toMatchObject({ scale: 1.8 });
	});

	it("accepts the exact edges: 0 ms, the timeline end, focus 0 and 1, touching zooms", () => {
		const { state, context } = makeContext([region({ startMs: 0, endMs: 1000 })]);
		run(
			"zoom.add",
			{ startMs: 1000, endMs: 10000, focus: { cx: 0, cy: 1 }, depth: 6 },
			context,
		);
		expect(state.regions[1]).toEqual({
			id: "zoom-2",
			startMs: 1000,
			endMs: 10000,
			depth: 6,
			focus: { cx: 0, cy: 1 },
			mode: "manual",
		});
	});

	it.each([
		[{ startMs: 1000, endMs: 3000, depth: 7 }, /depth must be one of 1, 2, 3, 4, 5, 6/],
		[{ startMs: 1000, endMs: 3000, depth: 2.5 }, /depth must be one of/],
		[{ startMs: 1000, endMs: 3000, focus: { cx: 1.2, cy: 0.5 } }, /between 0 and 1/],
		[{ startMs: 1000, endMs: 3000, focus: { cx: 0.5, cy: -0.1 } }, /between 0 and 1/],
		[{ startMs: 1000, endMs: 3000, mode: "follow" }, /mode must be/],
		[{ startMs: Number.NaN, endMs: 3000 }, /startMs must be a number/],
		[{ startMs: 3000, endMs: 1000 }, /0 <= startMs < endMs/],
		[{ startMs: 1000, endMs: 1000 }, /0 <= startMs < endMs/],
		[{ startMs: -1, endMs: 1000 }, /0 <= startMs < endMs/],
		[{ startMs: 1000, endMs: 10001 }, /past the end of the timeline/],
		[{ startMs: 1500, endMs: 2500 }, /overlaps zoom "zoom-1"/],
		[{ startMs: 1200, endMs: 1800 }, /overlaps zoom "zoom-1"/],
		[{ startMs: 500, endMs: 2500 }, /overlaps zoom "zoom-1"/],
		[{ startMs: 1000, endMs: 3000, scale: 2 }, /unknown field scale/],
	])("refuses %j and changes nothing", (payload, message) => {
		const { state, context } = makeContext([region()]);
		expect(() => run("zoom.add", payload, context)).toThrow(message);
		expect(state.regions).toEqual([region()]);
		expect(state.selected).toBeNull();
	});

	it("refuses when no recording is loaded", () => {
		const { context } = makeContext([], 0);
		expect(() => run("zoom.add", { startMs: 0, endMs: 100 }, context)).toThrow(
			/no recording loaded/,
		);
	});

	it("numbers a new zoom from the editor's own counter, as a hand edit would", () => {
		const { state, context } = makeContext([region({ id: "zoom-1" })]);
		run("zoom.add", { startMs: 5000, endMs: 6000 }, context);
		expect(state.regions[1].id).toBe("zoom-2");
	});
});

describe("zoom.update", () => {
	it("changes only the given fields", () => {
		const { state, context } = makeContext([region()]);
		run("zoom.update", { id: "zoom-1", depth: 5, mode: "manual" }, context);
		expect(state.regions[0]).toEqual(region({ depth: 5, mode: "manual" }));
	});

	it("lets a region move within the space it already occupies", () => {
		const { state, context } = makeContext([region()]);
		run("zoom.update", { id: "zoom-1", endMs: 2500 }, context);
		expect(state.regions[0].endMs).toBe(2500);
	});

	it.each([
		[{ id: "zoom-9", depth: 2 }, /no zoom with id "zoom-9"/],
		[{ id: "zoom-1" }, /at least one field/],
		[{ id: "zoom-1", depth: 0 }, /depth must be one of/],
		[{ id: "zoom-1", focus: { cx: 2, cy: 0 } }, /between 0 and 1/],
		[{ id: "zoom-1", endMs: 900 }, /0 <= startMs < endMs/],
		[{ id: "zoom-1", endMs: 99999 }, /past the end/],
		[{ id: "zoom-1", endMs: 5500 }, /overlaps zoom "zoom-2"/],
		[{ id: "zoom-1", colour: "red" }, /unknown field colour/],
	])("refuses %j and changes nothing", (payload, message) => {
		const initial = [region(), region({ id: "zoom-2", startMs: 5000, endMs: 6000 })];
		const { state, context } = makeContext(initial);
		expect(() => run("zoom.update", payload, context)).toThrow(message);
		expect(state.regions).toEqual(initial);
	});
});

describe("zoom.remove and zoom.clear", () => {
	it("removes one zoom and drops the selection if it was selected", () => {
		const { state, context } = makeContext([region(), zoomTwo()]);
		state.selected = "zoom-1";
		run("zoom.remove", { id: "zoom-1" }, context);
		expect(state.regions.map((r) => r.id)).toEqual(["zoom-2"]);
		expect(state.selected).toBeNull();
	});

	it("refuses an unknown id", () => {
		const { state, context } = makeContext([region()]);
		expect(() => run("zoom.remove", { id: "nope" }, context)).toThrow(/no zoom with id "nope"/);
		expect(state.regions).toHaveLength(1);
	});

	it("clears every zoom, including auto ones, and says how many", () => {
		const { state, context } = makeContext([region(), zoomTwo()]);
		state.selected = "zoom-2";
		expect(run("zoom.clear", {}, context)).toMatchObject({ removed: 2, undoable: true });
		expect(state.regions).toEqual([]);
		expect(state.selected).toBeNull();
	});

	it("reports an already-empty timeline instead of pretending to clear", () => {
		const { context } = makeContext();
		expect(run("zoom.clear", {}, context)).toMatchObject({ removed: 0, undoable: false });
	});
});
