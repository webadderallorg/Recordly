import { describe, expect, it } from "vitest";
import { deriveNextId } from "./projectPersistence";

import {
	extendAutoFullTrackClip,
	findClipAtTimelineTime,
	getTimelineDurationMs,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	trimsToClips,
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

describe("clip timeline mapping (ripple)", () => {
	const clips = [
		{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 },
		{ id: "clip-2", startMs: 6_000, endMs: 8_000, speed: 2 },
	];

	it("compacts adjacent clips by removing the inter-clip source gap", () => {
		// clip-1 display: 4_000ms, clip-2 display: (8_000 - 6_000) = 2_000ms
		// (speed is embedded in endMs via getClipSourceEndMs, so display = end - start)
		// total timeline length: 6_000ms — the source gap [4000, 6000] contributes nothing
		expect(getTimelineDurationMs(clips, 10_000)).toBe(6_000);
	});

	it("maps kept timeline time into source time inside each kept span", () => {
		// timeline [0, 4000] → source [0, 4000] at speed 1
		expect(mapTimelineTimeToSourceTime(1_500, clips)).toBe(1_500);
		// timeline [4000, 6000] → source [6000, 10000] at speed 2
		expect(mapTimelineTimeToSourceTime(5_000, clips)).toBe(8_000);
	});

	it("maps a clip boundary into the next kept span", () => {
		// timeline 4_000 is the splice between clip-1 and clip-2; it must map to
		// the next clip's source origin (6_000), not clip-1's source end (4_000).
		expect(mapTimelineTimeToSourceTime(4_000, clips)).toBe(6_000);
		expect(findClipAtTimelineTime(4_000, clips)?.id).toBe("clip-2");
	});

	it("clamps timeline positions that fall outside the compacted range", () => {
		// far before first kept span → source origin of clip-1
		expect(mapTimelineTimeToSourceTime(-100, clips)).toBe(0);
		// far after last kept span → source end of clip-2 (= 6000 + 4000 source ms)
		expect(mapTimelineTimeToSourceTime(7_000, clips)).toBe(10_000);
	});

	it("maps source time back into compacted timeline time", () => {
		expect(mapSourceTimeToTimelineTime(1_500, clips)).toBe(1_500);
		expect(mapSourceTimeToTimelineTime(8_000, clips)).toBe(5_000);
	});

	it("clamps source positions inside removed gaps to the nearest kept boundary", () => {
		// source [4000, 6000] is removed; both sides collapse onto the timeline splice at 4_000ms.
		expect(mapSourceTimeToTimelineTime(4_100, clips)).toBe(4_000);
		expect(mapSourceTimeToTimelineTime(5_900, clips)).toBe(4_000);
	});

	it("finds clips only inside visible kept spans", () => {
		expect(findClipAtTimelineTime(500, clips)?.id).toBe("clip-1");
		expect(findClipAtTimelineTime(5_000, clips)?.id).toBe("clip-2");
		// exactly on the right boundary of clip-2 → no clip owns the open end
		expect(findClipAtTimelineTime(6_000, clips)).toBeNull();
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

	it("uses the display duration of clips, ignoring the source duration", () => {
		// speed=2 halves the apparent length: display = 5_000ms regardless of source 10_000ms
		expect(
			getTimelineDurationMs([{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 2 }], 10_000),
		).toBe(5_000);
	});

	it("sums all clip display durations and ignores inter-clip source gaps", () => {
		expect(
			getTimelineDurationMs(
				[
					{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 },
					{ id: "clip-2", startMs: 6_000, endMs: 8_000, speed: 2 },
				],
				10_000,
			),
		).toBe(6_000);
	});
});
