import { describe, expect, it } from "vitest";
import {
	closeClipGaps,
	reorderClipSequence,
	mapClipSequenceTime,
	packClipSequence,
	rippleRegionAnchors,
	rippleRegions,
} from "./clipSequence";
import { changeClipSpan } from "./clipSpanChange";

const clips = [
	{ id: "a", startMs: 0, endMs: 2800, speed: 1 },
	{ id: "b", startMs: 2800, endMs: 6000, speed: 1 },
];
describe("contiguous clip sequence", () => {
	it("a trim keeps both sides of the cut at 2.8s while changing the source in-point", () => {
		const next = closeClipGaps([clips[0], changeClipSpan(clips[1], 3500, 6000, 6000)]);
		expect(next[0].endMs).toBe(2800);
		expect(next[1]).toMatchObject({ startMs: 2800, endMs: 5300, sourceStartMs: 3500 });
		expect(rippleRegions([{ startMs: 4000, endMs: 5000 }], clips, next)).toEqual([
			{ startMs: 3300, endMs: 4300 },
		]);
	});
	it("deleting footage ripples the remaining footage and connected effects", () => {
		const next = closeClipGaps([clips[1]]);
		expect(next[0]).toMatchObject({ startMs: 0, endMs: 3200, sourceStartMs: 2800 });
		expect(
			rippleRegions(
				[
					{ startMs: 500, endMs: 2000 },
					{ startMs: 3000, endMs: 4000 },
				],
				clips,
				next,
			),
		).toEqual([{ startMs: 200, endMs: 1200 }]);
	});
	it("slowing a clip pushes the next clip without overwriting its source", () => {
		const next = closeClipGaps([{ ...clips[0], speed: 0.5, endMs: 5600 }, clips[1]]);
		expect(next[1]).toMatchObject({ startMs: 5600, endMs: 8800, sourceStartMs: 2800 });
	});
	it("reordering preserves source in-points and closes every gap", () => {
		const next = closeClipGaps([
			clips[0],
			{ ...clips[1], sourceStartMs: 2800, startMs: -3200, endMs: 0 },
		]);
		expect(next.map((c) => [c.id, c.startMs, c.endMs, c.sourceStartMs])).toEqual([
			["b", 0, 3200, 2800],
			["a", 3200, 6000, 0],
		]);
	});
});

describe("connected sequence content", () => {
	it.each([2, 4, 8, 16])("retains imported audio at fractional %sx anchors", (speed) => {
		const before = [{ id: "a", startMs: 0, endMs: 6000, speed: 1 }];
		const after = [{ ...before[0], speed, endMs: 6000 / speed }];
		const audio = [{ id: "music", startMs: 1001, endMs: 5501, volume: 0.7 }];
		expect(rippleRegionAnchors(audio, before, after)).toEqual([
			{
				...audio[0],
				startMs: Math.round(1001 / speed),
				endMs: Math.round(1001 / speed) + 4500,
			},
		]);
	});
	it("preserves independently timed audio duration across a legacy gap", () => {
		const before = [clips[0], { ...clips[1], startMs: 3500, endMs: 6700 }];
		const after = closeClipGaps(before);
		expect(rippleRegionAnchors([{ startMs: 2000, endMs: 7000 }], before, after)).toEqual([
			{ startMs: 2000, endMs: 7000 },
		]);
		expect(mapClipSequenceTime(7200, before, after)).toBe(6500);
	});
	it("retains music anchored to deleted footage at the surviving cut", () => {
		const after = closeClipGaps([clips[1]]);
		expect(rippleRegionAnchors([{ startMs: 1000, endMs: 5000 }], clips, after)).toEqual([
			{ startMs: 0, endMs: 4000 },
		]);
	});
	it("preserves an effect spanning clips whose order is reversed", () => {
		const after = closeClipGaps([
			{ ...clips[1], sourceStartMs: 2800, startMs: -3200, endMs: 0 },
			clips[0],
		]);
		expect(
			rippleRegions([{ id: "annotation", startMs: 2000, endMs: 4000 }], clips, after),
		).toEqual([{ id: "annotation", startMs: 0, endMs: 6000 }]);
	});
	it("removes effects supported solely by deleted footage", () => {
		expect(
			rippleRegions([{ startMs: 0, endMs: 2000 }], clips, closeClipGaps([clips[1]])),
		).toEqual([]);
	});
});

describe("sequence insertion", () => {
	const threeClips = [
		{ id: "a", startMs: 0, endMs: 1000, speed: 1 },
		{ id: "b", startMs: 1000, endMs: 3000, speed: 1 },
		{ id: "c", startMs: 3000, endMs: 6000, speed: 1 },
	];
	it("moves the first clip after the middle one without skipping to the end", () => {
		expect(reorderClipSequence(threeClips, "a", 1)).toEqual([
			{ ...threeClips[1], startMs: 0, endMs: 2000, sourceStartMs: 1000 },
			{ ...threeClips[0], startMs: 2000, endMs: 3000, sourceStartMs: 0 },
			threeClips[2],
		]);
	});
	it("moves a middle clip to the start while preserving source footage", () => {
		const reordered = reorderClipSequence(threeClips, "b", 0);
		expect(reordered.map((clip) => clip.id)).toEqual(["b", "a", "c"]);
		expect(reordered[0]).toMatchObject({ startMs: 0, endMs: 2000, sourceStartMs: 1000 });
	});
});

it("reveals footage on a clip's left edge without changing sequence order", () => {
	const before = [
		{ id: "a", startMs: 0, endMs: 2000, sourceStartMs: 0, speed: 1 },
		{ id: "b", startMs: 2000, endMs: 3000, sourceStartMs: 4000, speed: 1 },
	];
	const edited = [before[0], changeClipSpan(before[1], -1000, 3000, 6000)];
	const after = packClipSequence(edited);
	expect(after).toEqual([
		before[0],
		{ ...before[1], startMs: 2000, endMs: 6000, sourceStartMs: 1000 },
	]);
	expect(rippleRegions([{ startMs: 2200, endMs: 2600 }], before, after)).toEqual([
		{ startMs: 5200, endMs: 5600 },
	]);
});
