import { describe, expect, it } from "vitest";
import { normalizeRegionSpan, spansOverlap } from "./spans";

describe("timeline core/spans", () => {
	it("treats adjacent spans as non-overlapping", () => {
		expect(spansOverlap({ start: 0, end: 100 }, { start: 100, end: 200 })).toBe(false);
	});

	it("detects strict overlap and containment", () => {
		expect(spansOverlap({ start: 0, end: 101 }, { start: 100, end: 200 })).toBe(true);
		expect(spansOverlap({ start: 50, end: 150 }, { start: 75, end: 100 })).toBe(true);
	});

	it("normalizes region to bounds and enforces min duration", () => {
		expect(
			normalizeRegionSpan({ startMs: -50, endMs: 10, totalMs: 1000, minDurationMs: 100 }),
		).toEqual({ start: 0, end: 100 });
	});

	it("clamps start when requested end exceeds total", () => {
		expect(
			normalizeRegionSpan({ startMs: 980, endMs: 1200, totalMs: 1000, minDurationMs: 100 }),
		).toEqual({ start: 900, end: 1000 });
	});

	it("keeps already valid spans unchanged", () => {
		expect(
			normalizeRegionSpan({ startMs: 100, endMs: 300, totalMs: 1000, minDurationMs: 50 }),
		).toEqual({ start: 100, end: 300 });
	});

	it("never exceeds total when min duration is larger than total", () => {
		expect(
			normalizeRegionSpan({ startMs: 100, endMs: 300, totalMs: 80, minDurationMs: 100 }),
		).toEqual({ start: 0, end: 80 });
	});
});
