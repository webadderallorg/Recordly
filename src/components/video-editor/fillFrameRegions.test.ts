import { describe, expect, it } from "vitest";
import {
	endFillFrameRegionAtMs,
	eventsToFillFrameRegions,
	type FillFrameRegion,
	fillFrameProgressAtMs,
	isFillFrameAtMs,
	normalizeFillFrameRegions,
	type SceneStyleEvent,
	startFillFrameRegionAtMs,
} from "./fillFrameRegions";

describe("eventsToFillFrameRegions", () => {
	it("pairs fill/framed events into regions", () => {
		const events: SceneStyleEvent[] = [
			{ timeMs: 5000, mode: "fill" },
			{ timeMs: 9000, mode: "framed" },
			{ timeMs: 20000, mode: "fill" },
			{ timeMs: 31000, mode: "framed" },
		];
		const regions = eventsToFillFrameRegions(events);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([
			[5000, 9000],
			[20000, 31000],
		]);
		expect(regions[0].id).not.toBe(regions[1].id);
	});

	it("extends an unterminated fill segment to the end", () => {
		const regions = eventsToFillFrameRegions([{ timeMs: 5000, mode: "fill" }]);
		expect(regions).toHaveLength(1);
		expect(regions[0].endMs).toBe(Number.MAX_SAFE_INTEGER);
	});

	it("dedupes consecutive same-mode events and sorts by time", () => {
		const regions = eventsToFillFrameRegions([
			{ timeMs: 9000, mode: "framed" },
			{ timeMs: 5000, mode: "fill" },
			{ timeMs: 6000, mode: "fill" },
		]);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([[5000, 9000]]);
	});

	it("drops zero-length segments and ignores leading framed events", () => {
		expect(
			eventsToFillFrameRegions([
				{ timeMs: 0, mode: "framed" },
				{ timeMs: 5000, mode: "fill" },
				{ timeMs: 5000, mode: "framed" },
			]),
		).toEqual([]);
	});

	it("ignores invalid events", () => {
		expect(
			eventsToFillFrameRegions([
				{ timeMs: Number.NaN, mode: "fill" },
				{ timeMs: -5, mode: "fill" },
			]),
		).toEqual([]);
	});
});

describe("isFillFrameAtMs", () => {
	const regions: FillFrameRegion[] = [{ id: "a", startMs: 5000, endMs: 9000 }];
	it("is true inside and false outside (end exclusive)", () => {
		expect(isFillFrameAtMs(regions, 4999)).toBe(false);
		expect(isFillFrameAtMs(regions, 5000)).toBe(true);
		expect(isFillFrameAtMs(regions, 8999)).toBe(true);
		expect(isFillFrameAtMs(regions, 9000)).toBe(false);
	});
});

describe("fillFrameProgressAtMs", () => {
	const regions: FillFrameRegion[] = [{ id: "a", startMs: 5000, endMs: 9000 }];

	it("is 0 well outside any region", () => {
		expect(fillFrameProgressAtMs(regions, 0)).toBe(0);
		expect(fillFrameProgressAtMs(regions, 4000)).toBe(0);
		expect(fillFrameProgressAtMs(regions, 10000)).toBe(0);
		expect(fillFrameProgressAtMs([], 5000)).toBe(0);
	});

	it("is 1 deep inside a region", () => {
		expect(fillFrameProgressAtMs(regions, 7000)).toBe(1);
		expect(fillFrameProgressAtMs(regions, 5200)).toBe(1);
		expect(fillFrameProgressAtMs(regions, 8800)).toBe(1);
	});

	it("is ~0.5 exactly at each boundary", () => {
		expect(fillFrameProgressAtMs(regions, 5000)).toBeCloseTo(0.5, 6);
		expect(fillFrameProgressAtMs(regions, 9000)).toBeCloseTo(0.5, 6);
	});

	it("ramps from 0 to 1 across a boundary, centered on it", () => {
		// transition 400ms -> ramp spans [4800, 5200]
		expect(fillFrameProgressAtMs(regions, 4800)).toBe(0);
		expect(fillFrameProgressAtMs(regions, 5200)).toBe(1);
		expect(fillFrameProgressAtMs(regions, 8800)).toBe(1);
		expect(fillFrameProgressAtMs(regions, 9200)).toBe(0);
	});

	it("increases monotonically across the entry ramp", () => {
		let previous = -1;
		for (let timeMs = 4750; timeMs <= 5250; timeMs += 25) {
			const progress = fillFrameProgressAtMs(regions, timeMs);
			expect(progress).toBeGreaterThanOrEqual(previous);
			previous = progress;
		}
		expect(previous).toBe(1);
	});

	it("decreases monotonically across the exit ramp", () => {
		let previous = 2;
		for (let timeMs = 8750; timeMs <= 9250; timeMs += 25) {
			const progress = fillFrameProgressAtMs(regions, timeMs);
			expect(progress).toBeLessThanOrEqual(previous);
			previous = progress;
		}
		expect(previous).toBe(0);
	});

	it("still peaks at 1 in the middle of a very short region", () => {
		const short: FillFrameRegion[] = [{ id: "s", startMs: 5000, endMs: 5100 }];
		expect(fillFrameProgressAtMs(short, 5050)).toBe(1);
		expect(fillFrameProgressAtMs(short, 4000)).toBe(0);
		expect(fillFrameProgressAtMs(short, 6000)).toBe(0);
	});

	it("respects a custom transition duration", () => {
		// transition 1000ms -> ramp spans [4500, 5500]
		expect(fillFrameProgressAtMs(regions, 4500, 1000)).toBe(0);
		expect(fillFrameProgressAtMs(regions, 5000, 1000)).toBeCloseTo(0.5, 6);
		expect(fillFrameProgressAtMs(regions, 5500, 1000)).toBe(1);
	});

	it("falls back to a hard step for non-positive transitions", () => {
		expect(fillFrameProgressAtMs(regions, 4999, 0)).toBe(0);
		expect(fillFrameProgressAtMs(regions, 5000, 0)).toBe(1);
		expect(fillFrameProgressAtMs(regions, 9000, 0)).toBe(0);
	});
});

describe("normalizeFillFrameRegions", () => {
	it("returns [] for non-arrays", () => {
		expect(normalizeFillFrameRegions(undefined)).toEqual([]);
		expect(normalizeFillFrameRegions(null)).toEqual([]);
		expect(normalizeFillFrameRegions("nope")).toEqual([]);
		expect(normalizeFillFrameRegions({})).toEqual([]);
	});

	it("keeps valid regions and drops invalid ones", () => {
		const regions = normalizeFillFrameRegions([
			{ id: "a", startMs: 1000, endMs: 2000 },
			{ id: 7, startMs: 3000, endMs: 4000 },
			{ id: "b", startMs: Number.NaN, endMs: 4000 },
			{ id: "c", startMs: 5000, endMs: 5000 },
			{ id: "d", startMs: 7000, endMs: 6000 },
			null,
			"junk",
		]);
		expect(regions).toEqual([{ id: "a", startMs: 1000, endMs: 2000 }]);
	});

	it("sorts by startMs and drops overlapping regions, keeping the earlier", () => {
		const regions = normalizeFillFrameRegions([
			{ id: "b", startMs: 3000, endMs: 6000 },
			{ id: "a", startMs: 1000, endMs: 4000 },
			{ id: "c", startMs: 4000, endMs: 5000 },
		]);
		expect(regions.map((r) => r.id)).toEqual(["a", "c"]);
	});

	it("clamps negative starts and rounds values", () => {
		const regions = normalizeFillFrameRegions([{ id: "a", startMs: -100.4, endMs: 2000.6 }]);
		expect(regions).toEqual([{ id: "a", startMs: 0, endMs: 2001 }]);
	});
});

describe("startFillFrameRegionAtMs", () => {
	const regions: FillFrameRegion[] = [
		{ id: "a", startMs: 1000, endMs: 2000 },
		{ id: "b", startMs: 5000, endMs: 6000 },
	];

	it("returns regions unchanged when already inside a region", () => {
		expect(startFillFrameRegionAtMs(regions, 1500, 10000)).toBe(regions);
	});

	it("inserts a region running to the next region start", () => {
		const result = startFillFrameRegionAtMs(regions, 3000, 10000);
		expect(result.map((r) => [r.startMs, r.endMs])).toEqual([
			[1000, 2000],
			[3000, 5000],
			[5000, 6000],
		]);
	});

	it("inserts a region running to the end limit when nothing follows", () => {
		const result = startFillFrameRegionAtMs(regions, 7000, 10000);
		expect(result.map((r) => [r.startMs, r.endMs])).toEqual([
			[1000, 2000],
			[5000, 6000],
			[7000, 10000],
		]);
	});

	it("starts from an empty list", () => {
		const result = startFillFrameRegionAtMs([], 0, 10000);
		expect(result.map((r) => [r.startMs, r.endMs])).toEqual([[0, 10000]]);
	});

	it("does nothing when there is no room before the limit", () => {
		expect(startFillFrameRegionAtMs(regions, 10000, 10000)).toBe(regions);
	});
});

describe("endFillFrameRegionAtMs", () => {
	const regions: FillFrameRegion[] = [
		{ id: "a", startMs: 1000, endMs: 2000 },
		{ id: "b", startMs: 5000, endMs: 6000 },
	];

	it("truncates the active region at the playhead", () => {
		const result = endFillFrameRegionAtMs(regions, 5500);
		expect(result.map((r) => [r.startMs, r.endMs])).toEqual([
			[1000, 2000],
			[5000, 5500],
		]);
	});

	it("drops the region when truncation empties it", () => {
		const result = endFillFrameRegionAtMs(regions, 5000);
		expect(result.map((r) => r.id)).toEqual(["a"]);
	});

	it("returns regions unchanged outside any region", () => {
		expect(endFillFrameRegionAtMs(regions, 3000)).toBe(regions);
		expect(endFillFrameRegionAtMs(regions, 6000)).toBe(regions);
	});
});
