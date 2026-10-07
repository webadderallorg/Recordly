import { describe, expect, it } from "vitest";
import { planClipTrimToPlayhead } from "./clipTrim";
import type { ClipRegion } from "./types";

const clips = [
	{ id: "a", startMs: 0, endMs: 4000, speed: 1 },
	{ id: "b", startMs: 4000, endMs: 9000, speed: 1 },
] as ClipRegion[];

describe("planClipTrimToPlayhead", () => {
	it("trims the clip under the playhead to start or end there", () => {
		expect(planClipTrimToPlayhead(clips, 1500, "start", 100)).toEqual({
			clip: clips[0],
			span: { start: 1500, end: 4000 },
		});
		expect(planClipTrimToPlayhead(clips, 6000, "end", 100)).toEqual({
			clip: clips[1],
			span: { start: 4000, end: 6000 },
		});
	});

	it("does nothing outside a clip, at a clip edge or below the minimum length", () => {
		expect(planClipTrimToPlayhead(clips, 9500, "start", 100)).toBeNull();
		expect(planClipTrimToPlayhead(clips, 4000, "start", 100)).toBeNull();
		expect(planClipTrimToPlayhead(clips, 3950, "start", 100)).toBeNull();
		expect(planClipTrimToPlayhead(clips, 4050, "end", 100)).toBeNull();
	});
});
