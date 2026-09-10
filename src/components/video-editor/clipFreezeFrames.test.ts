import { describe, expect, it } from "vitest";
import {
	clampFreezeFrameDurationMs,
	fitClipFreezeFrames,
	getRightClipFreezeFramesAfterSplit,
	planAddClipFreezeFrame,
	planClipFreezeFrameDurationChange,
	planRemoveClipFreezeFrame,
} from "./clipFreezeFrames";
import type { ClipRegion, ZoomRegion } from "./types";

function zoom(id: string, startMs: number, endMs: number): ZoomRegion {
	return { id, startMs, endMs, depth: 2, focus: { cx: 0.5, cy: 0.5 } };
}

const fullClip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 };

const frozenClip: ClipRegion = {
	...fullClip,
	endMs: 12_000,
	freezeFrames: [{ id: "freeze-1", offsetMs: 4_000, durationMs: 2_000 }],
};

describe("clampFreezeFrameDurationMs", () => {
	it("keeps hold durations inside the supported range", () => {
		expect(clampFreezeFrameDurationMs(10)).toBe(100);
		expect(clampFreezeFrameDurationMs(2_345.6)).toBe(2_346);
		expect(clampFreezeFrameDurationMs(99_999)).toBe(30_000);
		expect(clampFreezeFrameDurationMs(Number.NaN)).toBe(2_000);
	});
});

describe("planAddClipFreezeFrame", () => {
	it("holds the frame under the playhead and lengthens the clip", () => {
		expect(
			planAddClipFreezeFrame({
				clipRegions: [fullClip],
				zoomRegions: [],
				timelineMs: 4_000,
				durationMs: 2_000,
				freezeFrameId: "freeze-1",
			}),
		).toEqual({
			clipRegions: [frozenClip],
			zoomRegions: [],
			clipId: "clip-1",
			freezeFrameId: "freeze-1",
			created: true,
		});
	});

	it("stores the held frame in source time when the clip is sped up", () => {
		expect(
			planAddClipFreezeFrame({
				clipRegions: [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 2 }],
				zoomRegions: [],
				timelineMs: 1_000,
				durationMs: 1_000,
				freezeFrameId: "freeze-1",
			}),
		).toMatchObject({
			clipRegions: [{ endMs: 6_000, freezeFrames: [{ offsetMs: 2_000, durationMs: 1_000 }] }],
		});
	});

	it("shifts zooms after the hold and stretches a zoom that spans it", () => {
		expect(
			planAddClipFreezeFrame({
				clipRegions: [fullClip],
				zoomRegions: [
					zoom("zoom-before", 500, 1_500),
					zoom("zoom-span", 3_000, 5_000),
					zoom("zoom-after", 6_000, 7_000),
				],
				timelineMs: 4_000,
				durationMs: 2_000,
				freezeFrameId: "freeze-1",
			}),
		).toMatchObject({
			zoomRegions: [
				{ id: "zoom-before", startMs: 500, endMs: 1_500 },
				{ id: "zoom-span", startMs: 3_000, endMs: 7_000 },
				{ id: "zoom-after", startMs: 8_000, endMs: 9_000 },
			],
		});
	});

	it("blocks a hold that would run into the next clip", () => {
		const clipRegions: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 },
			{ id: "clip-2", startMs: 5_000, endMs: 8_000, speed: 1 },
		];

		expect(
			planAddClipFreezeFrame({
				clipRegions,
				zoomRegions: [],
				timelineMs: 1_000,
				durationMs: 2_000,
				freezeFrameId: "freeze-1",
			}),
		).toEqual({ blockedReason: "clip-overlap" });
		expect(
			planAddClipFreezeFrame({
				clipRegions,
				zoomRegions: [],
				timelineMs: 1_000,
				durationMs: 1_000,
				freezeFrameId: "freeze-1",
			}),
		).toMatchObject({ created: true, clipRegions: [{ endMs: 5_000 }, { id: "clip-2" }] });
	});

	it("blocks when the playhead is not over a clip", () => {
		expect(
			planAddClipFreezeFrame({
				clipRegions: [
					{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 },
					{ id: "clip-2", startMs: 5_000, endMs: 8_000, speed: 1 },
				],
				zoomRegions: [],
				timelineMs: 4_500,
				durationMs: 1_000,
				freezeFrameId: "freeze-1",
			}),
		).toEqual({ blockedReason: "no-clip" });
	});

	it("blocks when a shifted zoom would overlap another zoom", () => {
		expect(
			planAddClipFreezeFrame({
				clipRegions: [{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 }],
				zoomRegions: [
					zoom("zoom-in-clip", 3_000, 3_900),
					zoom("zoom-in-gap", 4_500, 5_500),
				],
				timelineMs: 1_000,
				durationMs: 1_000,
				freezeFrameId: "freeze-1",
			}),
		).toEqual({ blockedReason: "zoom-overlap" });
	});

	it("returns the existing hold when the playhead is already inside one", () => {
		const clipRegions = [frozenClip];
		const zoomRegions = [zoom("zoom-1", 0, 1_000)];

		expect(
			planAddClipFreezeFrame({
				clipRegions,
				zoomRegions,
				timelineMs: 5_000,
				durationMs: 2_000,
				freezeFrameId: "freeze-2",
			}),
		).toEqual({
			clipRegions,
			zoomRegions,
			clipId: "clip-1",
			freezeFrameId: "freeze-1",
			created: false,
		});
	});

	it("holds the last frame when the playhead sits on the clip end", () => {
		expect(
			planAddClipFreezeFrame({
				clipRegions: [fullClip],
				zoomRegions: [],
				timelineMs: 10_000,
				durationMs: 1_000,
				freezeFrameId: "freeze-1",
			}),
		).toMatchObject({
			clipRegions: [{ endMs: 11_000, freezeFrames: [{ offsetMs: 9_999 }] }],
			created: true,
		});
	});
});

describe("planClipFreezeFrameDurationChange", () => {
	it("resizes the hold, the clip, and zooms after it", () => {
		expect(
			planClipFreezeFrameDurationChange({
				clipRegions: [frozenClip],
				zoomRegions: [zoom("zoom-after", 8_000, 9_000)],
				clipId: "clip-1",
				freezeFrameId: "freeze-1",
				durationMs: 3_000,
			}),
		).toEqual({
			clipRegions: [
				{
					...frozenClip,
					endMs: 13_000,
					freezeFrames: [{ id: "freeze-1", offsetMs: 4_000, durationMs: 3_000 }],
				},
			],
			zoomRegions: [zoom("zoom-after", 9_000, 10_000)],
			clipId: "clip-1",
			freezeFrameId: "freeze-1",
		});
	});

	it("blocks growing a hold into the next clip", () => {
		expect(
			planClipFreezeFrameDurationChange({
				clipRegions: [
					frozenClip,
					{ id: "clip-2", startMs: 12_500, endMs: 14_000, speed: 1 },
				],
				zoomRegions: [],
				clipId: "clip-1",
				freezeFrameId: "freeze-1",
				durationMs: 3_000,
			}),
		).toEqual({ blockedReason: "clip-overlap" });
	});

	it("returns null for a hold that does not exist", () => {
		expect(
			planClipFreezeFrameDurationChange({
				clipRegions: [frozenClip],
				zoomRegions: [],
				clipId: "clip-1",
				freezeFrameId: "freeze-9",
				durationMs: 3_000,
			}),
		).toBeNull();
	});
});

describe("planRemoveClipFreezeFrame", () => {
	it("restores the clip length, pulls later zooms back and drops zooms inside the hold", () => {
		expect(
			planRemoveClipFreezeFrame({
				clipRegions: [frozenClip],
				zoomRegions: [zoom("zoom-inside", 4_500, 5_500), zoom("zoom-after", 8_000, 9_000)],
				clipId: "clip-1",
				freezeFrameId: "freeze-1",
			}),
		).toEqual({
			clipRegions: [fullClip],
			zoomRegions: [zoom("zoom-after", 6_000, 7_000)],
			clipId: "clip-1",
			freezeFrameId: "freeze-1",
		});
	});

	it("returns null for a hold that does not exist", () => {
		expect(
			planRemoveClipFreezeFrame({
				clipRegions: [fullClip],
				zoomRegions: [],
				clipId: "clip-1",
				freezeFrameId: "freeze-1",
			}),
		).toBeNull();
	});
});

describe("fitClipFreezeFrames", () => {
	it("drops holds that no longer fit after trimming the clip end", () => {
		expect(
			fitClipFreezeFrames({
				id: "clip-1",
				startMs: 0,
				endMs: 5_000,
				speed: 1,
				freezeFrames: [
					{ id: "freeze-a", offsetMs: 1_000, durationMs: 1_000 },
					{ id: "freeze-b", offsetMs: 3_500, durationMs: 1_000 },
				],
			}),
		).toEqual({
			id: "clip-1",
			startMs: 0,
			endMs: 5_000,
			speed: 1,
			freezeFrames: [{ id: "freeze-a", offsetMs: 1_000, durationMs: 1_000 }],
		});
	});

	it("removes the freeze list when no hold fits", () => {
		expect(
			fitClipFreezeFrames({
				id: "clip-1",
				startMs: 2_000,
				endMs: 5_000,
				speed: 1,
				freezeFrames: [{ id: "freeze-a", offsetMs: -200, durationMs: 1_000 }],
			}),
		).toEqual({ id: "clip-1", startMs: 2_000, endMs: 5_000, speed: 1 });
	});
});

describe("getRightClipFreezeFramesAfterSplit", () => {
	it("moves holds after the split point to the right clip", () => {
		expect(getRightClipFreezeFramesAfterSplit(frozenClip, 3_000)).toEqual([
			{ id: "freeze-1", offsetMs: 1_000, durationMs: 2_000 },
		]);
	});

	it("refuses to split after a hold because the right clip would skip footage", () => {
		expect(getRightClipFreezeFramesAfterSplit(frozenClip, 7_000)).toBeNull();
	});
});
