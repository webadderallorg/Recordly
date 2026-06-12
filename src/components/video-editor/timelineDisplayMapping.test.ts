import { describe, expect, it } from "vitest";
import {
	clipsToDisplay,
	displayMsToTimeline,
	gapAwareSourceToTimelineMs,
	gapAwareTimelineToSourceMs,
	getDisplayDurationMs,
	msToDisplay,
	msToSource,
	regionToDisplay,
	spanToSource,
	spanToTimeline,
	timelineMsToDisplay,
	timelineRegionToDisplay,
} from "./timelineDisplayMapping";
import type { ClipRegion } from "./types";

// Two speed-1 clips with a 3s source gap between them.
const gappedClips: ClipRegion[] = [
	{ id: "a", startMs: 0, endMs: 2000, speed: 1 },
	{ id: "b", startMs: 5000, endMs: 10000, speed: 1 },
];

// A 2x clip (source [0, 2000], timeline [0, 1000]) then a gap, then a 1x clip.
const speedClips: ClipRegion[] = [
	{ id: "c", startMs: 0, endMs: 1000, speed: 2 },
	{ id: "d", startMs: 4000, endMs: 6000, speed: 1 },
];

describe("clipsToDisplay", () => {
	it("packs clips contiguously preserving display durations", () => {
		const display = clipsToDisplay(gappedClips);
		expect(
			display.map((clip) => ({ id: clip.id, startMs: clip.startMs, endMs: clip.endMs })),
		).toEqual([
			{ id: "a", startMs: 0, endMs: 2000 },
			{ id: "b", startMs: 2000, endMs: 7000 },
		]);
	});

	it("keeps speed-compressed display durations and carries source spans", () => {
		const display = clipsToDisplay(speedClips);
		expect(display[0]).toMatchObject({
			id: "c",
			startMs: 0,
			endMs: 1000,
			speed: 2,
			sourceStartMs: 0,
			sourceEndMs: 2000,
		});
		expect(display[1]).toMatchObject({
			id: "d",
			startMs: 1000,
			endMs: 3000,
			speed: 1,
			sourceStartMs: 4000,
			sourceEndMs: 6000,
		});
	});

	it("sorts unsorted input by start time", () => {
		const display = clipsToDisplay([gappedClips[1], gappedClips[0]]);
		expect(display.map((clip) => clip.id)).toEqual(["a", "b"]);
		expect(display[0].startMs).toBe(0);
		expect(display[1].startMs).toBe(2000);
	});

	it("preserves clip metadata", () => {
		const display = clipsToDisplay([
			{ id: "a", startMs: 5000, endMs: 10000, speed: 1, muted: true, showSourceAudio: true },
		]);
		expect(display[0]).toMatchObject({
			id: "a",
			startMs: 0,
			endMs: 5000,
			muted: true,
			showSourceAudio: true,
		});
	});

	it("returns an empty array for no clips", () => {
		expect(clipsToDisplay([])).toEqual([]);
	});
});

describe("getDisplayDurationMs", () => {
	it("sums clip display durations", () => {
		expect(getDisplayDurationMs(gappedClips)).toBe(7000);
		expect(getDisplayDurationMs(speedClips)).toBe(3000);
	});

	it("returns 0 for no clips", () => {
		expect(getDisplayDurationMs([])).toBe(0);
	});
});

describe("timelineMsToDisplay / displayMsToTimeline", () => {
	it("collapses gaps", () => {
		expect(timelineMsToDisplay(1000, gappedClips)).toBe(1000);
		expect(timelineMsToDisplay(6000, gappedClips)).toBe(3000);
		expect(displayMsToTimeline(3000, gappedClips)).toBe(6000);
	});

	it("clamps times inside a gap to the preceding boundary", () => {
		expect(timelineMsToDisplay(3500, gappedClips)).toBe(2000);
	});

	it("clamps times beyond the last clip", () => {
		expect(timelineMsToDisplay(12000, gappedClips)).toBe(7000);
		expect(displayMsToTimeline(9000, gappedClips)).toBe(10000);
	});

	it("round-trips points inside clips", () => {
		for (const timelineMs of [0, 500, 1999, 5000, 7500, 10000]) {
			expect(
				displayMsToTimeline(timelineMsToDisplay(timelineMs, gappedClips), gappedClips),
			).toBe(timelineMs);
		}
	});

	it("is the identity with no clips", () => {
		expect(timelineMsToDisplay(1234, [])).toBe(1234);
		expect(displayMsToTimeline(1234, [])).toBe(1234);
	});

	it("works with timeline-space gaps left by speed clips", () => {
		expect(timelineMsToDisplay(500, speedClips)).toBe(500);
		expect(timelineMsToDisplay(4500, speedClips)).toBe(1500);
		expect(displayMsToTimeline(1500, speedClips)).toBe(4500);
	});
});

describe("msToDisplay / msToSource", () => {
	it("maps source times into the collapsed display", () => {
		expect(msToDisplay(1000, gappedClips)).toBe(1000);
		expect(msToDisplay(6000, gappedClips)).toBe(3000);
	});

	it("maps display times back to source times", () => {
		expect(msToSource(1000, gappedClips)).toBe(1000);
		expect(msToSource(3000, gappedClips)).toBe(6000);
	});

	it("round-trips source points inside clips", () => {
		for (const sourceMs of [0, 1500, 5000, 8000, 10000]) {
			expect(msToSource(msToDisplay(sourceMs, gappedClips), gappedClips)).toBe(sourceMs);
		}
	});

	it("applies clip speed when mapping", () => {
		// Source 1000 inside the 2x clip sits at display 500.
		expect(msToDisplay(1000, speedClips)).toBe(500);
		expect(msToSource(500, speedClips)).toBe(1000);
		// Source 5000 inside the 1x clip sits at display 2000.
		expect(msToDisplay(5000, speedClips)).toBe(2000);
		expect(msToSource(2000, speedClips)).toBe(5000);
	});

	it("clamps source times inside a gap to a clip boundary", () => {
		expect(msToDisplay(2500, gappedClips)).toBe(2000);
	});

	it("is the identity with no clips", () => {
		expect(msToDisplay(777, [])).toBe(777);
		expect(msToSource(777, [])).toBe(777);
	});
});

describe("regionToDisplay / spanToSource", () => {
	it("collapses a source region spanning a gap", () => {
		const region = { id: "z", startMs: 1500, endMs: 5500, depth: 2 };
		const display = regionToDisplay(region, gappedClips);
		expect(display).toEqual({ id: "z", startMs: 1500, endMs: 2500, depth: 2 });
	});

	it("maps display spans back to source spans across the gap", () => {
		expect(spanToSource({ start: 1500, end: 2500 }, gappedClips)).toEqual({
			start: 1500,
			end: 5500,
		});
	});

	it("round-trips regions inside clips", () => {
		const region = { id: "z", startMs: 5500, endMs: 7000 };
		const display = regionToDisplay(region, gappedClips);
		expect(display).toEqual({ id: "z", startMs: 2500, endMs: 4000 });
		expect(spanToSource({ start: display.startMs, end: display.endMs }, gappedClips)).toEqual({
			start: 5500,
			end: 7000,
		});
	});

	it("passes through unchanged with no clips", () => {
		const region = { id: "z", startMs: 100, endMs: 200 };
		expect(regionToDisplay(region, [])).toEqual(region);
	});
});

describe("gapAwareSourceToTimelineMs / gapAwareTimelineToSourceMs (magnet off)", () => {
	// A clip that starts after a leading gap.
	const leadingGapClips: ClipRegion[] = [{ id: "e", startMs: 3000, endMs: 5000, speed: 1 }];
	// A single 2x clip (source [0, 2000], timeline [0, 1000]) with a trailing
	// gap up to a 3000ms source duration; the ruler runs to
	// getTimelineDurationMs = max(3000, 1000) = 3000.
	const trailingSpeedClips: ClipRegion[] = [{ id: "f", startMs: 0, endMs: 1000, speed: 2 }];

	it("matches the clip mapping for source times inside clips", () => {
		expect(gapAwareSourceToTimelineMs(1000, gappedClips)).toBe(1000);
		expect(gapAwareSourceToTimelineMs(6000, gappedClips)).toBe(6000);
		// Source 1000 inside the 2x clip sits at timeline 500.
		expect(gapAwareSourceToTimelineMs(1000, speedClips)).toBe(500);
		expect(gapAwareSourceToTimelineMs(5000, speedClips)).toBe(5000);
	});

	it("advances through an inter-clip gap instead of clamping", () => {
		// Source gap [2000, 5000] renders between the clips at timeline
		// [2000, 5000] (speed-1 neighbors), so the mapping is the identity.
		expect(gapAwareSourceToTimelineMs(3500, gappedClips)).toBe(3500);
		expect(gapAwareTimelineToSourceMs(3500, gappedClips)).toBe(3500);
	});

	it("is continuous at gap entry and exit boundaries", () => {
		// Gap entry == previous clip's rendered end.
		expect(gapAwareSourceToTimelineMs(2000, gappedClips)).toBe(2000);
		// Gap exit == next clip's rendered start.
		expect(gapAwareSourceToTimelineMs(5000, gappedClips)).toBe(5000);
	});

	it("scales a gap between speed clips to its rendered width", () => {
		// speedClips: source gap [2000, 4000] (width 2000) renders between the
		// 2x clip's end (timeline 1000) and the next clip's start (timeline
		// 4000), i.e. visual width 3000.
		expect(gapAwareSourceToTimelineMs(2000, speedClips)).toBe(1000); // entry == rendered end of clip c
		expect(gapAwareSourceToTimelineMs(4000, speedClips)).toBe(4000); // exit == rendered start of clip d
		expect(gapAwareSourceToTimelineMs(3000, speedClips)).toBe(2500); // midpoint maps to visual midpoint
		expect(gapAwareTimelineToSourceMs(2500, speedClips)).toBe(3000);
	});

	it("round-trips source times inside gaps", () => {
		for (const sourceMs of [2000, 2500, 3000, 3500, 4000]) {
			expect(
				gapAwareTimelineToSourceMs(
					gapAwareSourceToTimelineMs(sourceMs, speedClips),
					speedClips,
				),
			).toBe(sourceMs);
		}
		for (const sourceMs of [2000, 3100, 4999]) {
			expect(
				gapAwareTimelineToSourceMs(
					gapAwareSourceToTimelineMs(sourceMs, gappedClips),
					gappedClips,
				),
			).toBe(sourceMs);
		}
	});

	it("traverses a leading gap as the identity", () => {
		expect(gapAwareSourceToTimelineMs(0, leadingGapClips)).toBe(0);
		expect(gapAwareSourceToTimelineMs(1500, leadingGapClips)).toBe(1500);
		expect(gapAwareSourceToTimelineMs(3000, leadingGapClips)).toBe(3000);
		expect(gapAwareTimelineToSourceMs(1500, leadingGapClips)).toBe(1500);
	});

	it("scales a trailing gap to the ruler end when the source duration is known", () => {
		// Trailing source gap [2000, 3000] renders from the clip's end (timeline
		// 1000) to the ruler end (timeline 3000).
		expect(gapAwareSourceToTimelineMs(2000, trailingSpeedClips, 3000)).toBe(1000);
		expect(gapAwareSourceToTimelineMs(2500, trailingSpeedClips, 3000)).toBe(2000);
		expect(gapAwareSourceToTimelineMs(3000, trailingSpeedClips, 3000)).toBe(3000);
		expect(gapAwareTimelineToSourceMs(2000, trailingSpeedClips, 3000)).toBe(2500);
		expect(gapAwareTimelineToSourceMs(3000, trailingSpeedClips, 3000)).toBe(3000);
	});

	it("offsets a trailing gap from the rendered clip end without a source duration", () => {
		// gappedClips end at source == timeline 10000, so the trailing gap is an
		// identity offset.
		expect(gapAwareSourceToTimelineMs(11000, gappedClips)).toBe(11000);
		expect(gapAwareTimelineToSourceMs(11000, gappedClips)).toBe(11000);
	});

	it("clamps beyond the known durations", () => {
		expect(gapAwareSourceToTimelineMs(9999, trailingSpeedClips, 3000)).toBe(3000);
		expect(gapAwareTimelineToSourceMs(9999, trailingSpeedClips, 3000)).toBe(3000);
	});

	it("is the identity with no clips", () => {
		expect(gapAwareSourceToTimelineMs(1234, [])).toBe(1234);
		expect(gapAwareTimelineToSourceMs(1234, [])).toBe(1234);
	});
});

describe("timelineRegionToDisplay / spanToTimeline", () => {
	it("shifts timeline-space regions without rescaling for speed", () => {
		// Timeline-space region inside the second clip (timeline [4000, 6000]).
		const region = { id: "z", startMs: 4200, endMs: 5200 };
		const display = timelineRegionToDisplay(region, speedClips);
		expect(display).toEqual({ id: "z", startMs: 1200, endMs: 2200 });
		expect(spanToTimeline({ start: 1200, end: 2200 }, speedClips)).toEqual({
			start: 4200,
			end: 5200,
		});
	});

	it("collapses timeline regions spanning a gap", () => {
		const region = { id: "z", startMs: 1500, endMs: 5500 };
		expect(timelineRegionToDisplay(region, gappedClips)).toEqual({
			id: "z",
			startMs: 1500,
			endMs: 2500,
		});
	});
});
