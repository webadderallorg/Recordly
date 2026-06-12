import { describe, expect, it } from "vitest";
import { CLIP_ROW_ID, ZOOM_ROW_ID } from "./core/constants";
import { getAnnotationTrackRowId, getAudioTrackRowId } from "./core/rows";
import {
	countTimelineRows,
	getTimelineContentMinHeightPx,
	getTimelinePreferredHeightPx,
	getTimelineRowsMinHeightPx,
	TIMELINE_AXIS_HEIGHT_PX,
	TIMELINE_COMFORTABLE_ROW_HEIGHT_PX,
	TIMELINE_ROW_MIN_HEIGHT_PX,
} from "./timelineLayout";

describe("timelineLayout", () => {
	it("reserves vertical space for every rendered timeline row", () => {
		expect(getTimelineRowsMinHeightPx(5)).toBe(5 * TIMELINE_ROW_MIN_HEIGHT_PX);
		expect(getTimelineContentMinHeightPx(5)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 5 * TIMELINE_ROW_MIN_HEIGHT_PX,
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
		expect(getTimelineRowsMinHeightPx(2.9)).toBe(2 * TIMELINE_ROW_MIN_HEIGHT_PX);
		expect(getTimelineContentMinHeightPx(2.9)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 2 * TIMELINE_ROW_MIN_HEIGHT_PX,
		);
	});

	it("prefers a comfortable height per visible row", () => {
		expect(getTimelinePreferredHeightPx(2)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 2 * TIMELINE_COMFORTABLE_ROW_HEIGHT_PX,
		);
		expect(getTimelinePreferredHeightPx(3)).toBe(
			TIMELINE_AXIS_HEIGHT_PX + 3 * TIMELINE_COMFORTABLE_ROW_HEIGHT_PX,
		);
		expect(getTimelinePreferredHeightPx(Number.NaN)).toBe(TIMELINE_AXIS_HEIGHT_PX);
	});

	describe("countTimelineRows", () => {
		const baseOptions = {
			showCameraTrack: false,
			showFillFrameTrack: false,
			showSourceAudioTrack: false,
			sourceAudioTrackCount: 0,
		};

		it("always counts the clip and zoom rows", () => {
			expect(countTimelineRows([], baseOptions)).toBe(2);
		});

		it("adds the camera row when visible", () => {
			expect(countTimelineRows([], { ...baseOptions, showCameraTrack: true })).toBe(3);
		});

		it("adds the fill-frame row when visible", () => {
			expect(countTimelineRows([], { ...baseOptions, showFillFrameTrack: true })).toBe(3);
			expect(
				countTimelineRows([], {
					...baseOptions,
					showCameraTrack: true,
					showFillFrameTrack: true,
				}),
			).toBe(4);
		});

		it("adds one row per visible source-audio track", () => {
			expect(
				countTimelineRows([], {
					...baseOptions,
					showSourceAudioTrack: true,
					sourceAudioTrackCount: 2,
				}),
			).toBe(4);
			expect(countTimelineRows([], { ...baseOptions, sourceAudioTrackCount: 2 })).toBe(2);
		});

		it("counts distinct annotation and audio track rows from items", () => {
			const items = [
				{ rowId: CLIP_ROW_ID },
				{ rowId: ZOOM_ROW_ID },
				{ rowId: getAnnotationTrackRowId(0) },
				{ rowId: getAnnotationTrackRowId(0) },
				{ rowId: getAnnotationTrackRowId(1) },
				{ rowId: getAudioTrackRowId(0) },
			];
			expect(countTimelineRows(items, baseOptions)).toBe(5);
		});
	});
});
