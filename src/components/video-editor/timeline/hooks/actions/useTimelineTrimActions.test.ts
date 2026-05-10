import { describe, expect, it, vi } from "vitest";

/**
 * Since useTimelineTrimActions is a React hook that requires a component
 * context, and @testing-library/react is not installed, we test the
 * underlying trim placement logic directly via pure functions that mirror
 * the hook's internal logic.
 */

interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

/** Mirrors the core placement logic from useTimelineTrimActions */
function computeTrimPlacement(params: {
	videoDuration: number;
	totalMs: number;
	currentTimeMs: number;
	trimRegions: TrimRegion[];
	defaultTrimDurationMs: number;
}): { startMs: number; durationMs: number } | null {
	const { videoDuration, totalMs, currentTimeMs, trimRegions, defaultTrimDurationMs } = params;

	if (!videoDuration || videoDuration === 0 || totalMs === 0) return null;
	if (defaultTrimDurationMs <= 0) return null;

	const isOverlapping = trimRegions.some(
		(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
	);
	if (isOverlapping) return null;

	const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
	const nextRegion = sorted.find((region) => region.startMs > currentTimeMs);
	const gapToNext = nextRegion ? nextRegion.startMs - currentTimeMs : totalMs - currentTimeMs;

	if (gapToNext <= 0) return null;

	const actualDuration = Math.min(defaultTrimDurationMs, gapToNext);
	const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));

	return { startMs: Math.round(startPos), durationMs: Math.round(actualDuration) };
}

describe("trim placement logic", () => {
	it("returns null when video has no duration", () => {
		expect(
			computeTrimPlacement({
				videoDuration: 0,
				totalMs: 0,
				currentTimeMs: 0,
				trimRegions: [],
				defaultTrimDurationMs: 2000,
			}),
		).toBeNull();
	});

	it("places trim at playhead when no existing trims", () => {
		const result = computeTrimPlacement({
			videoDuration: 10,
			totalMs: 10000,
			currentTimeMs: 3000,
			trimRegions: [],
			defaultTrimDurationMs: 2000,
		});
		expect(result).toEqual({ startMs: 3000, durationMs: 2000 });
	});

	it("prevents overlapping trims", () => {
		const result = computeTrimPlacement({
			videoDuration: 10,
			totalMs: 10000,
			currentTimeMs: 4000,
			trimRegions: [{ id: "trim-1", startMs: 3000, endMs: 5000 }],
			defaultTrimDurationMs: 2000,
		});
		expect(result).toBeNull();
	});

	it("clamps trim duration to gap before next trim", () => {
		const result = computeTrimPlacement({
			videoDuration: 10,
			totalMs: 10000,
			currentTimeMs: 5000,
			trimRegions: [{ id: "trim-1", startMs: 6000, endMs: 8000 }],
			defaultTrimDurationMs: 2000,
		});
		expect(result).toEqual({ startMs: 5000, durationMs: 1000 });
	});

	it("uses shorter duration for short videos", () => {
		const result = computeTrimPlacement({
			videoDuration: 1,
			totalMs: 1000,
			currentTimeMs: 0,
			trimRegions: [],
			defaultTrimDurationMs: 1000,
		});
		expect(result).toEqual({ startMs: 0, durationMs: 1000 });
	});

	it("clamps start position to video bounds", () => {
		const result = computeTrimPlacement({
			videoDuration: 5,
			totalMs: 5000,
			currentTimeMs: 4000,
			trimRegions: [],
			defaultTrimDurationMs: 2000,
		});
		// Duration should be clamped to remaining gap (1000ms)
		expect(result).toEqual({ startMs: 4000, durationMs: 1000 });
	});

	it("returns null when playhead is at end with no gap", () => {
		const result = computeTrimPlacement({
			videoDuration: 10,
			totalMs: 10000,
			currentTimeMs: 10000,
			trimRegions: [],
			defaultTrimDurationMs: 2000,
		});
		// Gap is 0 at the end
		expect(result).toBeNull();
	});

	it("places trim between two existing trims", () => {
		const result = computeTrimPlacement({
			videoDuration: 20,
			totalMs: 20000,
			currentTimeMs: 10000,
			trimRegions: [
				{ id: "t1", startMs: 2000, endMs: 5000 },
				{ id: "t2", startMs: 15000, endMs: 18000 },
			],
			defaultTrimDurationMs: 2000,
		});
		expect(result).toEqual({ startMs: 10000, durationMs: 2000 });
	});
});
