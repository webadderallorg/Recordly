export type TimelineSpan = {
	startMs: number;
	endMs: number;
};

/**
 * Place a copy of a span immediately after the original.
 * Returns null when there is no remaining room on the timeline.
 */
export function placeSpanAfter(
	span: TimelineSpan,
	totalMs: number,
): { startMs: number; endMs: number } | null {
	const duration = Math.max(0, Math.round(span.endMs) - Math.round(span.startMs));
	const timelineEnd = Math.max(0, Math.round(totalMs));
	if (duration <= 0 || timelineEnd <= 0) {
		return null;
	}

	const startMs = Math.round(span.endMs);
	if (startMs >= timelineEnd) {
		return null;
	}

	const endMs = Math.min(startMs + duration, timelineEnd);
	if (endMs - startMs < 1) {
		return null;
	}

	return { startMs, endMs };
}
