import { describe, expect, it } from "vitest";

import { resolveTimelineWheelPanDeltaPx } from "./useTimelineRange";

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
