import { describe, expect, it } from "vitest";

import {
	extendAutoFullTrackClip,
	findClipAtTimelineTime,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	trimsToClips,
} from "./types";
import { deriveNextId } from "./projectPersistence";

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

	it("derives the next clip id after converting trim gaps into clip ids", () => {
		const clipsFromTrims = trimsToClips(
			[
				{ id: "trim-gap-1", startMs: 1_000, endMs: 2_000 },
				{ id: "trim-gap-2", startMs: 4_000, endMs: 5_000 },
			],
			6_000,
		);

		expect(clipsFromTrims.map((clip) => clip.id)).toEqual(["clip-1", "clip-2", "clip-3"]);
		expect(deriveNextId("clip", clipsFromTrims.map((clip) => clip.id))).toBe(4);
	});
});
