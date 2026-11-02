import { describe, expect, it } from "vitest";

import { resolveTimelineRangeReset, resolveTimelineWheelPanDeltaPx } from "./useTimelineRange";

describe("resolveTimelineRangeReset", () => {
	it("does not reset while the source identity is unchanged", () => {
		expect(
			resolveTimelineRangeReset({
				previousResetKey: "/recordings/a.mp4",
				resetKey: "/recordings/a.mp4",
				totalMs: 12_000,
			}),
		).toBeNull();
		expect(
			resolveTimelineRangeReset({
				previousResetKey: undefined,
				resetKey: undefined,
				totalMs: 12_000,
			}),
		).toBeNull();
	});

	it("fits the range when the source identity changes", () => {
		expect(
			resolveTimelineRangeReset({
				previousResetKey: "/recordings/a.mp4",
				resetKey: "/recordings/b.mp4",
				totalMs: 12_000,
			}),
		).toEqual({ start: 0, end: 12_000 });
		expect(
			resolveTimelineRangeReset({
				previousResetKey: "",
				resetKey: "/recordings/b.mp4",
				totalMs: 0,
			}),
		).toEqual({ start: 0, end: 1000 });
	});
});

describe("resolveTimelineWheelPanDeltaPx", () => {
	it("uses trackpad horizontal wheel movement for timeline panning", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 24,
				deltaY: 0,
				deltaMode: 0,
			}),
		).toBe(24);
	});

	it("uses shifted vertical wheel movement for timeline panning", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 3,
				deltaMode: 1,
				shiftKey: true,
			}),
		).toBe(48);
	});

	it("keeps ctrl wheel available for timeline zoom unless shift is also held", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 3,
				deltaMode: 1,
				ctrlKey: true,
			}),
		).toBe(0);
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 3,
				deltaMode: 1,
				ctrlKey: true,
				shiftKey: true,
			}),
		).toBe(48);
	});

	it("uses regular wheel movement when the timeline has no vertical overflow", () => {
		expect(
			resolveTimelineWheelPanDeltaPx({
				deltaX: 0,
				deltaY: 20,
				deltaMode: 0,
				canScrollVertically: false,
			}),
		).toBe(20);
	});
});
