import { describe, expect, it } from "vitest";
import { buildClipDecodeRuns, segmentFrameCount, segmentSourceTime } from "./videoTimelineSegments";
import { requiresClipTimelineRendering } from "./clipTimeline";

describe("explicit clip export timeline", () => {
	it("preserves gaps and source in-points without starting another decode pass", () => {
		const runs = buildClipDecodeRuns([
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 3 },
			{ id: "b", startMs: 2000, endMs: 4000, sourceStartMs: 6000, speed: 3 },
		]);
		expect(runs).toEqual([
			[
				{ startSec: 0, endSec: 3, speed: 3, outputStartSec: 0, outputEndSec: 1 },
				{ startSec: 6, endSec: 12, speed: 3, outputStartSec: 2, outputEndSec: 4 },
			],
		]);
	});
	it("starts a new source pass for reordered footage", () => {
		const runs = buildClipDecodeRuns([
			{ id: "b", startMs: 2000, endMs: 3000, sourceStartMs: 0, speed: 1 },
			{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 5000, speed: 1 },
		]);
		expect(runs.map((run) => run[0].startSec)).toEqual([5, 0]);
	});
	it.each([
		24, 30, 60, 59.94,
	])("uses a single %s fps grid across fractional-frame cuts", (fps) => {
		const clips = Array.from({ length: 100 }, (_, i) => ({
			id: `${i}`,
			startMs: i * 137,
			endMs: (i + 1) * 137,
			sourceStartMs: i * 411,
			speed: 3,
		}));
		const [segments] = buildClipDecodeRuns(clips);
		expect(segments.reduce((n, s) => n + segmentFrameCount(s, fps), 0)).toBe(
			Math.ceil(13.7 * fps),
		);
		for (const segment of segments) {
			for (let i = 0; i < segmentFrameCount(segment, fps); i++) {
				const source = segmentSourceTime(segment, i, fps);
				expect(source).toBeGreaterThanOrEqual(segment.startSec);
				expect(source).toBeLessThan(segment.endSec);
			}
		}
	});
	it("does not route positioned clips through a concatenating native path", () => {
		expect(requiresClipTimelineRendering(undefined)).toBe(false);
		expect(
			requiresClipTimelineRendering([{ id: "full", startMs: 0, endMs: 1000, speed: 1 }]),
		).toBe(false);
		expect(requiresClipTimelineRendering([])).toBe(true);
		expect(
			requiresClipTimelineRendering([{ id: "gap", startMs: 1000, endMs: 2000, speed: 1 }]),
		).toBe(true);
	});
});
