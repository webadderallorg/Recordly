import { describe, expect, it } from "vitest";
import { deriveNextId } from "./projectPersistence";

import {
	clipsToTrims,
	extendAutoFullTrackClip,
	findClipAtTimelineTime,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	trimsToClips,
	updateClipTimelineSpan,
} from "./types";

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

	it("finds clips only inside visible kept spans", () => {
		expect(findClipAtTimelineTime(500, clips)?.id).toBe("clip-1");
		expect(findClipAtTimelineTime(5_000, clips)).toBeNull();
	});

	it("keeps source content stable when a later clip is moved into a timeline gap", () => {
		const clips = [
			{ id: "clip-1", startMs: 0, endMs: 5_000, sourceStartMs: 0, speed: 1 },
			{ id: "clip-2", startMs: 5_000, endMs: 10_000, sourceStartMs: 8_000, speed: 1 },
		];

		expect(mapTimelineTimeToSourceTime(5_500, clips)).toBe(8_500);
		expect(mapSourceTimeToTimelineTime(8_500, clips)).toBe(5_500);
		expect(clipsToTrims(clips, 13_000)).toEqual([
			{ id: "trim-gap-1", startMs: 5_000, endMs: 8_000 },
		]);
	});

	it("preserves source bounds for moves and adjusts them only for edge resizes", () => {
		const clip = {
			id: "clip-2",
			startMs: 8_000,
			endMs: 13_000,
			sourceStartMs: 8_000,
			speed: 1,
		};

		const moved = updateClipTimelineSpan(clip, { start: 5_000, end: 10_000 });
		expect(moved).toMatchObject({ startMs: 5_000, endMs: 10_000, sourceStartMs: 8_000 });
		expect(getClipSourceStartMs(moved)).toBe(8_000);
		expect(getClipSourceEndMs(moved)).toBe(13_000);

		const resizedLeft = updateClipTimelineSpan(clip, { start: 9_000, end: 13_000 });
		expect(resizedLeft).toMatchObject({ sourceStartMs: 9_000 });
		expect(getClipSourceEndMs(resizedLeft)).toBe(13_000);

		const resizedRight = updateClipTimelineSpan(clip, { start: 8_000, end: 14_000 });
		expect(resizedRight).toMatchObject({ sourceStartMs: 8_000 });
		expect(getClipSourceEndMs(resizedRight)).toBe(14_000);
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
	it("uses the reflowed timeline end after a clip is moved", () => {
		expect(
			getTimelineDurationMs(
				[
					{ id: "clip-1", startMs: 0, endMs: 5_000, sourceStartMs: 0, speed: 1 },
					{ id: "clip-2", startMs: 5_000, endMs: 10_000, sourceStartMs: 8_000, speed: 1 },
				],
				13_000,
			),
		).toBe(10_000);
	});

	it("extends the timeline when a slow clip becomes longer than the source duration", () => {
		expect(
			getTimelineDurationMs(
				[{ id: "clip-1", startMs: 0, endMs: 20_000, speed: 0.5 }],
				10_000,
			),
		).toBe(20_000);
	});

	it("keeps the source duration when speed edits make clips shorter", () => {
		expect(
			getTimelineDurationMs([{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 2 }], 10_000),
		).toBe(10_000);
	});
});
