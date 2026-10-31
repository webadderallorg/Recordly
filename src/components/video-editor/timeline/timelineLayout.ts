export const TIMELINE_AXIS_HEIGHT_PX = 20;
export const TIMELINE_ROW_MIN_HEIGHT_PX = 32;
export const TIMELINE_CLIP_ROW_HEIGHT_PX = TIMELINE_ROW_MIN_HEIGHT_PX * 2;

function normalizeRowCount(rowCount: number) {
	if (!Number.isFinite(rowCount)) {
		return 0;
	}

	return Math.max(0, Math.floor(rowCount));
}

export function getTimelineRowsMinHeightPx(rowCount: number) {
	const count = normalizeRowCount(rowCount);
	// Clip stays full height. Zoom shares its space only when another lane exists.
	return count
		? TIMELINE_CLIP_ROW_HEIGHT_PX +
				(count === 2 ? 2 : count - 1) * TIMELINE_ROW_MIN_HEIGHT_PX +
				count * 2
		: 0;
}

export function getTimelineContentMinHeightPx(rowCount: number) {
	return TIMELINE_AXIS_HEIGHT_PX + getTimelineRowsMinHeightPx(rowCount);
}
