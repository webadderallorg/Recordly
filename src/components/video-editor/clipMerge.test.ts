import { describe, expect, it } from "vitest";
import { planClipMerge, selectClipRange } from "./clipMerge";
import { type ClipRegion, mapTimelineTimeToSourceTime } from "./types";

const clips: ClipRegion[] = [0, 1, 2, 3].map((i) => ({
	id: `clip-${i}`,
	startMs: i * 1000,
	endMs: (i + 1) * 1000,
	sourceStartMs: 5000 + i * 2000,
	speed: 2,
	sourceMinMs: 5000,
	sourceMaxMs: 13000,
}));

describe("clip range selection and merging", () => {
	it("selects all clips between endpoints in either direction, using timeline order", () => {
		expect(selectClipRange([...clips].reverse(), "clip-0", "clip-2")).toEqual([
			"clip-0",
			"clip-1",
			"clip-2",
		]);
		expect(selectClipRange(clips, "clip-3", "clip-1")).toEqual(["clip-1", "clip-2", "clip-3"]);
		expect(selectClipRange(clips, "missing", "clip-1")).toEqual(["clip-1"]);
	});

	it("merges several sped-up clips without changing source mapping or other clips", () => {
		const merged = planClipMerge(clips, ["clip-2", "clip-0", "clip-1"])!;
		expect(merged).toEqual([{ ...clips[0], endMs: 3000 }, clips[3]]);
		for (const time of [0, 500, 999, 1000, 1999, 2500, 3000, 3999]) {
			expect(mapTimelineTimeToSourceTime(time, merged)).toBe(
				mapTimelineTimeToSourceTime(time, clips),
			);
		}
	});

	it("rejects stale IDs, isolated clips, gaps and reordered footage", () => {
		for (const ids of [["clip-0"], ["clip-0", "missing"], ["clip-0", "clip-2"]]) {
			expect(planClipMerge(clips, ids)).toBeNull();
		}
		expect(
			planClipMerge([clips[0], { ...clips[1], startMs: 1001 }], ["clip-0", "clip-1"]),
		).toBeNull();
		expect(
			planClipMerge([clips[0], { ...clips[1], sourceStartMs: 9000 }], ["clip-0", "clip-1"]),
		).toBeNull();
	});

	it("preserves speed, mute, source bounds and audio settings", () => {
		for (const patch of [
			{ speed: 1 },
			{ muted: true },
			{ showSourceAudio: true },
			{ sourceMaxMs: 15000 },
		]) {
			expect(
				planClipMerge([clips[0], { ...clips[1], ...patch }], ["clip-0", "clip-1"]),
			).toBeNull();
		}
		expect(
			planClipMerge(clips, ["clip-0", "clip-1"], (id) => ({
				mic: { volume: id === "clip-0" ? 1 : 0.5, normalize: false },
			})),
		).toBeNull();
		expect(
			planClipMerge(clips, ["clip-0", "clip-1"], (id) =>
				id === "clip-0" ? {} : { mic: { volume: 1, normalize: false } },
			),
		).not.toBeNull();
	});
});
