import { describe, expect, it } from "vitest";
import { planClipSplit } from "./clipSplit";
import {
	type ClipRegion,
	clipsToTrims,
	getClipSourceEndMs,
	getClipSourceStartMs,
	mapTimelineTimeToSourceTime,
} from "./types";

function createIdFactory() {
	let next = 1;
	return () => `clip-${next++}`;
}

function splitAndDeleteMiddle(clip: ClipRegion, firstSplitMs: number, secondOffsetMs: number) {
	const createId = createIdFactory();
	const first = planClipSplit({ clipRegions: [clip], splitMs: firstSplitMs, createId });
	if (!first) throw new Error("first split failed");
	const second = planClipSplit({
		clipRegions: [first.right],
		splitMs: first.right.startMs + secondOffsetMs,
		createId,
	});
	if (!second) throw new Error("second split failed");
	return { kept: [first.left, second.right], deleted: second.left };
}

describe("planClipSplit", () => {
	it("returns null when no clip contains the split position", () => {
		const clips: ClipRegion[] = [{ id: "clip-1", startMs: 0, endMs: 1000, speed: 1 }];
		expect(
			planClipSplit({ clipRegions: clips, splitMs: 2000, createId: createIdFactory() }),
		).toBeNull();
		expect(
			planClipSplit({ clipRegions: clips, splitMs: 0, createId: createIdFactory() }),
		).toBeNull();
		expect(
			planClipSplit({ clipRegions: clips, splitMs: 1000, createId: createIdFactory() }),
		).toBeNull();
	});

	it("splits a 1x clip at the playhead", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 120_000, speed: 1 };
		const plan = planClipSplit({
			clipRegions: [clip],
			splitMs: 30_000,
			createId: createIdFactory(),
		});

		expect(plan?.left).toMatchObject({ startMs: 0, endMs: 30_000 });
		expect(plan?.right).toMatchObject({ startMs: 30_000, endMs: 120_000 });
	});

	it("anchors the right half to the source time the split maps to at non-1x speed", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 60_000, speed: 2 };
		const plan = planClipSplit({
			clipRegions: [clip],
			splitMs: 10_000,
			createId: createIdFactory(),
		});
		if (!plan) throw new Error("split failed");

		// 10s of playback at 2x consumes 20s of source.
		expect(getClipSourceEndMs(plan.left)).toBe(20_000);
		expect(getClipSourceStartMs(plan.right)).toBe(20_000);
		// The halves still cover exactly the source the original clip covered.
		expect(getClipSourceEndMs(plan.right)).toBe(getClipSourceEndMs(clip));
	});

	it("leaves both halves where the clip already sat on the timeline", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 60_000, speed: 2 };
		const plan = planClipSplit({
			clipRegions: [clip],
			splitMs: 10_000,
			createId: createIdFactory(),
		});

		// No visual gap: the halves abut at the playhead and still end where the clip did.
		expect(plan?.left).toMatchObject({ startMs: 0, endMs: 10_000 });
		expect(plan?.right).toMatchObject({ startMs: 10_000, endMs: 60_000 });
	});

	it("keeps the timeline-to-source mapping continuous across the split", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 60_000, speed: 2 };
		const plan = planClipSplit({
			clipRegions: [clip],
			splitMs: 10_000,
			createId: createIdFactory(),
		});
		if (!plan) throw new Error("split failed");

		const halves = [plan.left, plan.right];
		for (const timelineMs of [0, 5_000, 10_000, 30_000, 60_000]) {
			expect(mapTimelineTimeToSourceTime(timelineMs, halves)).toBe(
				mapTimelineTimeToSourceTime(timelineMs, [clip]),
			);
		}
	});

	it("keeps split halves contiguous in source time so no gap is trimmed", () => {
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 48_000, speed: 2.5 };
		const plan = planClipSplit({
			clipRegions: [clip],
			splitMs: 17_333,
			createId: createIdFactory(),
		});
		if (!plan) throw new Error("split failed");

		expect(clipsToTrims([plan.left, plan.right], getClipSourceEndMs(clip))).toEqual([]);
	});

	it("removes the source range the user cut out when the clip is sped up", () => {
		const sourceDurationMs = 120_000;
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: 60_000, speed: 2 };

		// Cut the 10s-20s playback window out of a 2x clip => source 20s-40s.
		const { kept, deleted } = splitAndDeleteMiddle(clip, 10_000, 10_000);

		expect([getClipSourceStartMs(deleted), getClipSourceEndMs(deleted)]).toEqual([
			20_000, 40_000,
		]);
		expect(clipsToTrims(kept, sourceDurationMs)).toEqual([
			{ id: "trim-gap-1", startMs: 20_000, endMs: 40_000 },
		]);
		// Nothing else is lost: the tail of the recording is still covered.
		expect(getClipSourceEndMs(kept[1])).toBe(sourceDurationMs);
	});

	it("removes the source range the user cut out at 1x", () => {
		const sourceDurationMs = 120_000;
		const clip: ClipRegion = { id: "clip-1", startMs: 0, endMs: sourceDurationMs, speed: 1 };

		const { kept } = splitAndDeleteMiddle(clip, 10_000, 10_000);

		expect(clipsToTrims(kept, sourceDurationMs)).toEqual([
			{ id: "trim-gap-1", startMs: 10_000, endMs: 20_000 },
		]);
		expect(getClipSourceEndMs(kept[1])).toBe(sourceDurationMs);
	});

	it("carries clip settings into both halves", () => {
		const clip: ClipRegion = {
			id: "clip-1",
			startMs: 0,
			endMs: 60_000,
			speed: 2,
			muted: true,
			showSourceAudio: true,
		};
		const plan = planClipSplit({
			clipRegions: [clip],
			splitMs: 10_000,
			createId: createIdFactory(),
		});

		for (const half of [plan?.left, plan?.right]) {
			expect(half).toMatchObject({ speed: 2, muted: true, showSourceAudio: true });
		}
		expect(plan?.left.id).not.toBe(plan?.right.id);
	});
});
