import type { Span } from "dnd-timeline";

/** Sample the visible edit in source coordinates, including source trims and speed. */
export function filmstripSampleTimes(span: Span, source: Span, visible: Span, count: number) {
	const start = Math.max(span.start, visible.start);
	const end = Math.min(span.end, visible.end);
	if (end <= start || span.end <= span.start || count < 1) return [];
	return Array.from({ length: count }, (_, index) => {
		const timelineMs = start + ((index + 0.5) / count) * (end - start);
		return (
			source.start +
			((timelineMs - span.start) / (span.end - span.start)) * (source.end - source.start)
		);
	});
}
