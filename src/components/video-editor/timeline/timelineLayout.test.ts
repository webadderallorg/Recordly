import { describe, expect, it } from "vitest";
import {
	getTimelineContentMinHeightPx,
	getTimelineRowsMinHeightPx,
	TIMELINE_CLIP_ROW_HEIGHT_PX,
	TIMELINE_AXIS_HEIGHT_PX,
	TIMELINE_ROW_MIN_HEIGHT_PX,
} from "./timelineLayout";

describe("timelineLayout", () => {
	it("reserves vertical space for every rendered timeline row", () => {
		expect(getTimelineRowsMinHeightPx(5)).toBe(
			TIMELINE_CLIP_ROW_HEIGHT_PX + 4 * TIMELINE_ROW_MIN_HEIGHT_PX + 10,
		);
		expect(getTimelineContentMinHeightPx(5)).toBe(
			TIMELINE_AXIS_HEIGHT_PX +
				TIMELINE_CLIP_ROW_HEIGHT_PX +
				4 * TIMELINE_ROW_MIN_HEIGHT_PX +
				10,
		);
	});

	it("ignores invalid row counts", () => {
		expect(getTimelineRowsMinHeightPx(-1)).toBe(0);
		expect(getTimelineRowsMinHeightPx(Number.NaN)).toBe(0);
		expect(getTimelineContentMinHeightPx(Number.POSITIVE_INFINITY)).toBe(
			TIMELINE_AXIS_HEIGHT_PX,
		);
	});

	it("floors fractional row counts", () => {
		expect(getTimelineRowsMinHeightPx(2.9)).toBe(
			TIMELINE_CLIP_ROW_HEIGHT_PX + 2 * TIMELINE_ROW_MIN_HEIGHT_PX + 4,
		);
		expect(getTimelineContentMinHeightPx(2.9)).toBe(
			TIMELINE_AXIS_HEIGHT_PX +
				TIMELINE_CLIP_ROW_HEIGHT_PX +
				2 * TIMELINE_ROW_MIN_HEIGHT_PX +
				4,
		);
	});

	it("fits clip and full zoom, or clip and two compact tracks, in the minimum viewport", () => {
		const availableHeight = 180 - 24;
		expect(getTimelineContentMinHeightPx(2)).toBeLessThanOrEqual(availableHeight);
		expect(getTimelineContentMinHeightPx(3)).toBeLessThanOrEqual(availableHeight);
		expect(getTimelineContentMinHeightPx(4)).toBeGreaterThan(availableHeight);
	});
});
