import { describe, expect, it } from "vitest";
import { deriveNextId } from "./projectPersistence";

import {
	type ClipRegion,
	clipsToTrims,
	extendAutoFullTrackClip,
	findClipAtTimelineTime,
	getTimelineDurationMs,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	resolveCursorClickEffectProfile,
	trimsToClips,
} from "./types";

describe("resolveCursorClickEffectProfile", () => {
	const left = { effect: "ripple" as const, color: "#2563EB", scale: 1.25 };
	const right = { effect: "spotlight" as const, color: "#F97316", scale: 1.75 };

	it("uses the right-click profile only for right-click interactions", () => {
		expect(resolveCursorClickEffectProfile(left, right, "right-click")).toEqual(right);
		expect(resolveCursorClickEffectProfile(left, right, "click")).toEqual(left);
		expect(resolveCursorClickEffectProfile(left, right, "double-click")).toEqual(left);
		expect(resolveCursorClickEffectProfile(left, right, "middle-click")).toEqual(left);
	});

	it("falls back to the left-click profile when no right profile is configured", () => {
		expect(resolveCursorClickEffectProfile(left, undefined, "right-click")).toEqual(left);
	});
});

describe("extendAutoFullTrackClip", () => {
	it("extends the default full-track clip when metadata duration grows", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
				"clip-1",
				5_000,
				8_000,
			),
		).toEqual([{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 1 }]);
	});

	it("does not change a clip that no longer matches the auto-created shape", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1.5 }],
				"clip-1",
				5_000,
				8_000,
			),
		).toBeNull();
	});

	it("does not change multi-clip timelines", () => {
		expect(
			extendAutoFullTrackClip(
				[
					{ id: "clip-1", startMs: 0, endMs: 3_000, speed: 1 },
					{ id: "clip-2", startMs: 4_000, endMs: 8_000, speed: 1 },
				],
				"clip-1",
				8_000,
				10_000,
			),
		).toBeNull();
	});

	it("does not change clips when the duration does not grow", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 1 }],
				"clip-1",
				8_000,
				8_000,
			),
		).toBeNull();
	});

	it("does not change clips when the auto-created clip id is missing", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
				null,
				5_000,
				8_000,
			),
		).toBeNull();
	});

	it("does not change clips when the previous auto-created end time is missing", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
				"clip-1",
				null,
				8_000,
			),
		).toBeNull();
	});

	it("does not change clips when the reported duration shrinks", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 1 }],
				"clip-1",
				8_000,
				7_000,
			),
		).toBeNull();
	});

	it("does not change clips when the tracked clip id no longer matches", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }],
				"clip-2",
				5_000,
				8_000,
			),
		).toBeNull();
	});

	it("does not change clips when the clip no longer starts at zero", () => {
		expect(
			extendAutoFullTrackClip(
				[{ id: "clip-1", startMs: 250, endMs: 5_000, speed: 1 }],
				"clip-1",
				5_000,
				8_000,
			),
		).toBeNull();
	});
});

describe("clip timeline mapping", () => {
	it("selects the next source at an exact cut, but keeps fractional times before it in the previous clip", () => {
		const clips = [
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
			{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 6000, speed: 1 },
		];
		expect(mapTimelineTimeToSourceTime(1000, clips)).toBe(6000);
		expect(mapTimelineTimeToSourceTime(999.9, clips)).toBe(3000);
		expect(mapTimelineTimeToSourceTime(2000, clips)).toBe(7000);
		const sourceAdjacent = [
			clips[0],
			{ ...clips[1], startMs: 2000, endMs: 3000, sourceStartMs: 3000 },
		];
		expect(mapSourceTimeToTimelineTime(3000, sourceAdjacent)).toBe(2000);
	});
	const clips = [
		{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 },
		{ id: "clip-2", startMs: 6_000, endMs: 8_000, speed: 2 },
	];

	it("maps kept timeline time into source time", () => {
		expect(mapTimelineTimeToSourceTime(1_500, clips)).toBe(1_500);
		expect(mapTimelineTimeToSourceTime(7_000, clips)).toBe(8_000);
	});

	it("snaps timeline gaps to the nearest clip edge", () => {
		expect(mapTimelineTimeToSourceTime(4_300, clips)).toBe(4_000);
		expect(mapTimelineTimeToSourceTime(5_700, clips)).toBe(6_000);
	});

	it("maps kept source time back into timeline time", () => {
		expect(mapSourceTimeToTimelineTime(1_500, clips)).toBe(1_500);
		expect(mapSourceTimeToTimelineTime(8_000, clips)).toBe(7_000);
	});

	it("snaps removed source gaps to the nearest kept boundary", () => {
		expect(mapSourceTimeToTimelineTime(4_200, clips)).toBe(4_000);
		expect(mapSourceTimeToTimelineTime(5_900, clips)).toBe(6_000);
	});

	it("maps gaps between different source and timeline positions", () => {
		const movedClips = [
			{ id: "clip-1", startMs: 0, endMs: 4_000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-2", startMs: 6_000, endMs: 8_000, sourceStartMs: 10_000, speed: 1 },
		];

		expect(mapTimelineTimeToSourceTime(5_900, movedClips)).toBe(10_000);
		expect(mapSourceTimeToTimelineTime(9_900, movedClips)).toBe(6_000);
	});

	it("finds clips only inside visible kept spans", () => {
		expect(findClipAtTimelineTime(500, clips)?.id).toBe("clip-1");
		expect(findClipAtTimelineTime(5_000, clips)).toBeNull();
	});

	it("derives the next clip id after converting trim gaps into clip ids", () => {
		const clipsFromTrims = trimsToClips(
			[
				{ id: "trim-gap-1", startMs: 1_000, endMs: 2_000 },
				{ id: "trim-gap-2", startMs: 4_000, endMs: 5_000 },
			],
			6_000,
		);

		expect(clipsFromTrims.map((clip) => clip.id)).toEqual(["clip-1", "clip-2", "clip-3"]);
		expect(
			deriveNextId(
				"clip",
				clipsFromTrims.map((clip) => clip.id),
			),
		).toBe(4);
	});
});

describe("getTimelineDurationMs", () => {
	it("extends the timeline when a slow clip becomes longer than the source duration", () => {
		expect(
			getTimelineDurationMs(
				[{ id: "clip-1", startMs: 0, endMs: 20_000, speed: 0.5 }],
				10_000,
			),
		).toBe(20_000);
	});

	it("shortens the timeline when speed edits make clips shorter", () => {
		expect(
			getTimelineDurationMs([{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 2 }], 10_000),
		).toBe(5_000);
	});
});

describe("clipsToTrims", () => {
	it("trims the source ranges no clip covers", () => {
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 },
			{ id: "clip-2", startMs: 10_000, endMs: 20_000, sourceStartMs: 30_000, speed: 1 },
		];

		expect(clipsToTrims(clips, 60_000)).toEqual([
			{ id: "trim-gap-1", startMs: 10_000, endMs: 30_000 },
			{ id: "trim-gap-2", startMs: 40_000, endMs: 60_000 },
		]);
	});

	it("covers source ranges that sit out of order on the timeline", () => {
		// A moved clip keeps its source in-point, so the clip that comes first on
		// the timeline can read from later in the recording.
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 10_000, sourceStartMs: 20_000, speed: 1 },
			{ id: "clip-2", startMs: 10_000, endMs: 20_000, sourceStartMs: 0, speed: 1 },
		];

		// Source [0,10] and [20,30] are both in use; only the gaps go.
		expect(clipsToTrims(clips, 40_000)).toEqual([
			{ id: "trim-gap-1", startMs: 10_000, endMs: 20_000 },
			{ id: "trim-gap-2", startMs: 30_000, endMs: 40_000 },
		]);
	});

	it("merges overlapping source spans instead of trimming between them", () => {
		const clips: ClipRegion[] = [
			{ id: "clip-1", startMs: 0, endMs: 20_000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-2", startMs: 20_000, endMs: 30_000, sourceStartMs: 10_000, speed: 1 },
		];

		expect(clipsToTrims(clips, 40_000)).toEqual([
			{ id: "trim-gap-1", startMs: 20_000, endMs: 40_000 },
		]);
	});
});
