interface TimelineSpan {
	startMs: number;
	endMs: number;
}

export function placeSpanAfter(
	source: TimelineSpan,
	totalMs: number,
	occupied: readonly TimelineSpan[] = [],
): TimelineSpan | null {
	let startMs = Math.round(source.endMs);
	const duration = startMs - Math.round(source.startMs);
	if (duration <= 0 || startMs >= totalMs) return null;

	const ordered = [...occupied].sort((left, right) => left.startMs - right.startMs);
	for (const region of ordered) {
		if (region.endMs <= startMs) continue;
		if (startMs + duration <= region.startMs) break;
		startMs = Math.ceil(region.endMs);
	}

	const endMs = startMs + duration;
	return endMs <= Math.round(totalMs) ? { startMs, endMs } : null;
}
