import type { Span } from "dnd-timeline";

export function spansOverlap(left: Span, right: Span) {
	return left.end > right.start && left.start < right.end;
}

export function normalizeRegionSpan(params: {
	startMs: number;
	endMs: number;
	totalMs: number;
	minDurationMs: number;
}) {
	const { startMs, endMs, totalMs, minDurationMs } = params;
	const safeTotalMs = Math.max(0, totalMs);
	const safeMinDurationMs = Math.max(0, Math.min(minDurationMs, safeTotalMs));
	const clampedStart = Math.max(0, Math.min(startMs, safeTotalMs));
	const normalizedStart = Math.max(0, Math.min(clampedStart, safeTotalMs - safeMinDurationMs));
	const normalizedEnd = Math.min(
		safeTotalMs,
		Math.max(endMs, normalizedStart + safeMinDurationMs),
	);

	return { start: normalizedStart, end: normalizedEnd };
}
