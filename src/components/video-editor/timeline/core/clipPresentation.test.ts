import { describe, expect, it } from "vitest";
import {
	getRegionDisplaySpan,
	snapRegionSpan,
	getClipDisplaySpan,
	getEmbeddedCaptionSpan,
	getPlayheadDisplayTime,
	getTimeAtClipSeam,
} from "./clipPresentation";

describe("clip presentation", () => {
	it.each([
		1, 10, 100,
	])("reserves a 24px seam without changing media spans at %s ms/px", (msPerPixel) => {
		const clips = [
			{ start: 0, end: 10000 },
			{ start: 10000, end: 20000 },
		];
		const left = getClipDisplaySpan(clips[0], clips, msPerPixel);
		const right = getClipDisplaySpan(clips[1], clips, msPerPixel);
		expect((right.start - left.end) / msPerPixel).toBe(24);
		expect(left.start).toBe(0);
		expect(right.end).toBe(20000);
		expect(clips[0].end).toBe(clips[1].start);
	});
	it("does not inset a single clip and leaves tiny clips visible", () => {
		const span = { start: 0, end: 10 };
		expect(getClipDisplaySpan(span, [span], 20)).toEqual(span);
		const tiny = getClipDisplaySpan(span, [span, { start: 10, end: 20 }], 20);
		expect(tiny.end - tiny.start).toBeGreaterThan(0);
	});
	it("clips caption previews to the owning filmstrip, excluding its gutter", () => {
		const clips = [
			{ span: { start: 0, end: 1000 }, displaySpan: { start: 0, end: 900 } },
			{ span: { start: 1000, end: 2000 }, displaySpan: { start: 1100, end: 2000 } },
		];
		expect(getEmbeddedCaptionSpan({ start: 800, end: 1000 }, clips)).toEqual({
			start: 720,
			end: 900,
		});
		expect(getEmbeddedCaptionSpan({ start: 1000, end: 1200 }, clips)).toEqual({
			start: 1100,
			end: 1280,
		});
		expect(getEmbeddedCaptionSpan({ start: 2100, end: 2200 }, clips)).toBeNull();
	});
});

const splitClips = [
	{ span: { start: 0, end: 1000 }, displaySpan: { start: 0, end: 900 } },
	{ span: { start: 1000, end: 2000 }, displaySpan: { start: 1100, end: 2000 } },
];
it("jumps the playhead across a split gutter at the cut", () => {
	expect(getPlayheadDisplayTime(500, splitClips)).toBe(450);
	expect(getPlayheadDisplayTime(999, splitClips)).toBeCloseTo(899.1);
	expect(getPlayheadDisplayTime(1000, splitClips)).toBe(1100);
	expect(getPlayheadDisplayTime(1001, splitClips)).toBeCloseTo(1100.9);
	expect(getPlayheadDisplayTime(2000, splitClips)).toBe(2000);
});
it("seeks to the cut from either side of a decorative gutter", () => {
	for (const time of [900, 950, 1000, 1050, 1100]) {
		expect(getTimeAtClipSeam(time, splitClips)).toBe(1000);
	}
	expect(getTimeAtClipSeam(700, splitClips)).toBeCloseTo(700 / 0.9);
	expect(getPlayheadDisplayTime(700, [])).toBe(700);
});
it("preserves authored empty timeline time", () => {
	const clips = [
		splitClips[0],
		{ span: { start: 1500, end: 2500 }, displaySpan: { start: 1600, end: 2500 } },
	];
	expect(getTimeAtClipSeam(1200, clips)).toBe(1200);
	expect(getPlayheadDisplayTime(1200, clips)).toBe(1200);
});

it("round-trips all media time without a frozen playhead at either side of the cut", () => {
	for (let time = 0; time <= 2000; time += 7) {
		expect(getTimeAtClipSeam(getPlayheadDisplayTime(time, splitClips), splitClips)).toBeCloseTo(
			time,
			8,
		);
	}
});

it("aligns effect endpoints with opposite sides of a zero-duration seam", () => {
	expect(getRegionDisplaySpan({ start: 500, end: 1000 }, splitClips)).toEqual({
		start: 450,
		end: 900,
	});
	expect(getRegionDisplaySpan({ start: 1000, end: 1500 }, splitClips)).toEqual({
		start: 1100,
		end: 1550,
	});
});
it.each([
	1, 10, 50,
])("soft-snaps within eight screen pixels at %s ms/px and releases outside", (msPerPixel) => {
	const clips = [
		{ start: 0, end: 10000 },
		{ start: 10000, end: 20000 },
	];
	const presentation = clips.map((span) => ({
		span,
		displaySpan: getClipDisplaySpan(span, clips, msPerPixel),
	}));
	const edge = presentation[0].displaySpan.end;
	const near = getTimeAtClipSeam(edge - 5 * msPerPixel, presentation);
	const far = getTimeAtClipSeam(edge - 12 * msPerPixel, presentation);
	expect(
		snapRegionSpan({ start: 1000, end: near }, [10000], presentation, msPerPixel, "end"),
	).toEqual({ start: 1000, end: 10000 });
	expect(
		snapRegionSpan({ start: 1000, end: far }, [10000], presentation, msPerPixel, "end").end,
	).toBe(far);
	const dragged = snapRegionSpan(
		{ start: near - 2000, end: near },
		[10000],
		presentation,
		msPerPixel,
	);
	expect(dragged).toEqual({ start: 8000, end: 10000 });
});
it("snaps to other block edges and preserves drag duration", () => {
	expect(snapRegionSpan({ start: 1510, end: 1810 }, [1500], [], 2)).toEqual({
		start: 1500,
		end: 1800,
	});
	expect(snapRegionSpan({ start: 1550, end: 1850 }, [1500], [], 2)).toEqual({
		start: 1550,
		end: 1850,
	});
});
