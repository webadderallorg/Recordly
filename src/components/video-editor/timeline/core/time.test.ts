import { describe, expect, it } from "vitest";
import {
	calculateAxisScale,
	calculateTimelineScale,
	createInitialRange,
	formatPlayheadTime,
	formatTimeLabel,
	normalizeWheelDeltaToPixels,
	reconcileTimelineRange,
} from "./time";

describe("timeline core/time", () => {
	it("creates fallback range for empty or invalid duration", () => {
		expect(createInitialRange(0)).toEqual({ start: 0, end: 1000 });
		expect(createInitialRange(-10)).toEqual({ start: 0, end: 1000 });
		expect(createInitialRange(2500)).toEqual({ start: 0, end: 2500 });
	});

	it("computes scale defaults and caps", () => {
		expect(calculateTimelineScale(0)).toEqual({
			minItemDurationMs: 100,
			defaultItemDurationMs: 1000,
			minVisibleRangeMs: 300,
		});
		expect(calculateTimelineScale(1).defaultItemDurationMs).toBe(100);
		expect(calculateTimelineScale(100).defaultItemDurationMs).toBe(5000);
		expect(calculateTimelineScale(10_000).defaultItemDurationMs).toBe(30000);
	});

	it("formats timeline labels in fractional, whole-second, and hour modes", () => {
		expect(formatTimeLabel(1234, 100)).toBe("0:01.23");
		expect(formatTimeLabel(1234, 500)).toBe("0:01.2");
		expect(formatTimeLabel(61_900, 1000)).toBe("1:01");
		expect(formatTimeLabel(3_661_999, 1000)).toBe("1:01:01");
	});

	it("formats playhead labels for sub-minute and minute timelines", () => {
		expect(formatPlayheadTime(1234)).toBe("1.2s");
		expect(formatPlayheadTime(61_400)).toBe("1:01.4");
	});

	it("normalizes wheel delta by deltaMode", () => {
		expect(normalizeWheelDeltaToPixels(2, 0)).toBe(2);
		expect(normalizeWheelDeltaToPixels(2, 1)).toBe(32);
		expect(normalizeWheelDeltaToPixels(2, 2)).toBe(480);
		expect(normalizeWheelDeltaToPixels(-3, 1)).toBe(-48);
	});

	it("picks fine and coarse axis scales based on visible range", () => {
		const tiny = calculateAxisScale(1);
		const typical = calculateAxisScale(2000);
		const huge = calculateAxisScale(24 * 60 * 60 * 1000);

		expect(tiny.intervalMs).toBeGreaterThan(0);
		expect(tiny.gridMs).toBeGreaterThan(0);
		expect(typical.intervalMs).toBeGreaterThanOrEqual(tiny.intervalMs);
		expect(huge.intervalMs).toBeGreaterThanOrEqual(typical.intervalMs);
	});

	it("keeps a fitted timeline fitted when the duration grows", () => {
		expect(
			reconcileTimelineRange(
				{ start: 0, end: 10_000 },
				{ totalMs: 20_000, previousTotalMs: 10_000, minVisibleRangeMs: 300 },
			),
		).toEqual({ start: 0, end: 20_000 });
	});

	it("preserves a zoomed window when the duration grows", () => {
		const zoomed = { start: 2000, end: 4000 };
		const next = reconcileTimelineRange(zoomed, {
			totalMs: 20_000,
			previousTotalMs: 10_000,
			minVisibleRangeMs: 300,
		});

		expect(next).toEqual(zoomed);
		expect(next).toBe(zoomed);
	});

	it("clamps a zoomed window to the new duration when the timeline shrinks", () => {
		expect(
			reconcileTimelineRange(
				{ start: 8000, end: 10_000 },
				{ totalMs: 4000, previousTotalMs: 10_000, minVisibleRangeMs: 300 },
			),
		).toEqual({ start: 2000, end: 4000 });
	});

	it("leaves the range untouched while the duration is unknown", () => {
		const previous = { start: 1000, end: 3000 };
		const next = reconcileTimelineRange(previous, {
			totalMs: 0,
			previousTotalMs: 10_000,
			minVisibleRangeMs: 300,
		});

		expect(next).toBe(previous);
	});

	it("fits the range when a duration becomes known for the first time", () => {
		expect(
			reconcileTimelineRange(
				{ start: 0, end: 1000 },
				{ totalMs: 12_500, previousTotalMs: 0, minVisibleRangeMs: 300 },
			),
		).toEqual({ start: 0, end: 12_500 });
	});

	it("respects the minimum visible range when clamping", () => {
		expect(
			reconcileTimelineRange(
				{ start: 1000, end: 1100 },
				{ totalMs: 20_000, previousTotalMs: 10_000, minVisibleRangeMs: 300 },
			),
		).toEqual({ start: 1000, end: 1300 });
	});

	it("shifts the window start only when the span would overflow", () => {
		expect(
			reconcileTimelineRange(
				{ start: 9000, end: 10_000 },
				{ totalMs: 9500, previousTotalMs: 10_000, minVisibleRangeMs: 300 },
			),
		).toEqual({ start: 8500, end: 9500 });
	});
});
