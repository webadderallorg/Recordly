import type { Range, Span } from "dnd-timeline";
import type { TimelineRegionSpan } from "../core/timelineTypes";

export interface DndEngineConfig {
	totalMs: number;
	minItemDurationMs: number;
	minVisibleRangeMs: number;
	allRegionSpans: TimelineRegionSpan[];
	hasOverlap: (newSpan: Span, excludeId?: string, rowId?: string) => boolean;
}

export function clampSpanToBounds(span: Span, config: Pick<DndEngineConfig, "totalMs" | "minItemDurationMs">): Span {
	const { totalMs, minItemDurationMs } = config;
	const rawDuration = Math.max(span.end - span.start, 0);
	const normalizedStart = Number.isFinite(span.start) ? span.start : 0;

	if (totalMs === 0) {
		const minDuration = Math.max(minItemDurationMs, 1);
		const duration = Math.max(rawDuration, minDuration);
		const start = Math.max(0, normalizedStart);
		return { start, end: start + duration };
	}

	const minDuration = Math.min(Math.max(minItemDurationMs, 1), totalMs);
	const duration = Math.min(Math.max(rawDuration, minDuration), totalMs);
	const start = Math.max(0, Math.min(normalizedStart, totalMs - duration));
	return { start, end: start + duration };
}

export function clampRange(candidate: Range, config: Pick<DndEngineConfig, "totalMs" | "minVisibleRangeMs">): Range {
	const { totalMs, minVisibleRangeMs } = config;
	if (totalMs === 0) {
		const minSpan = Math.max(minVisibleRangeMs, 1);
		const span = Math.max(candidate.end - candidate.start, minSpan);
		const start = Math.max(0, Math.min(candidate.start, candidate.end - span));
		return { start, end: start + span };
	}

	const rawStart = Math.max(0, candidate.start);
	const rawEnd = candidate.end;
	const clampedEnd = Math.min(rawEnd, totalMs);
	const minSpan = Math.min(Math.max(minVisibleRangeMs, 1), totalMs);
	const desiredSpan = clampedEnd - rawStart;
	const span = Math.min(Math.max(desiredSpan, minSpan), totalMs);

	let finalStart = rawStart;
	let finalEnd = finalStart + span;
	if (finalEnd > totalMs) {
		finalEnd = totalMs;
		finalStart = Math.max(0, finalEnd - span);
	}

	return { start: finalStart, end: finalEnd };
}

export function getSiblingSpans(activeItemId: string, rowId: string | undefined, allRegionSpans: TimelineRegionSpan[]) {
	const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
	const resolvedRowId = rowId ?? activeItem?.rowId;
	if (!resolvedRowId) {
		return [];
	}

	return allRegionSpans
		.filter((region) => region.id !== activeItemId && region.rowId === resolvedRowId)
		.sort((left, right) => left.start - right.start);
}

export function clampResizedSpanToNeighbours(span: Span, activeItemId: string, config: Pick<DndEngineConfig, "allRegionSpans" | "minItemDurationMs" | "totalMs">): Span {
	const { allRegionSpans, minItemDurationMs, totalMs } = config;
	const siblings = getSiblingSpans(activeItemId, undefined, allRegionSpans);
	const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
	let { start, end } = span;

	for (const r of siblings) {
		if (end > r.start && start < r.start) {
			end = r.start;
		}
		if (start < r.end && end > r.end) {
			start = r.end;
		}
	}

	const minDur = Math.min(minItemDurationMs, totalMs || minItemDurationMs);
	if (end - start < minDur) {
		const resizedLeft = Boolean(activeItem && span.start !== activeItem.start && span.end === activeItem.end);
		if (resizedLeft) {
			start = end - minDur;
		} else {
			end = start + minDur;
		}
	}

	return { start: Math.max(0, start), end: Math.min(end, totalMs || end) };
}

export function clampDraggedSpanToNeighbours(span: Span, activeItemId: string, rowId: string | undefined, config: Pick<DndEngineConfig, "allRegionSpans" | "minItemDurationMs" | "totalMs">): Span {
	const { allRegionSpans, minItemDurationMs, totalMs } = config;
	const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
	if (!activeItem) {
		return clampSpanToBounds(span, { totalMs, minItemDurationMs });
	}

	const siblings = getSiblingSpans(activeItemId, rowId, allRegionSpans);
	const duration = Math.max(
		activeItem.end - activeItem.start,
		Math.min(minItemDurationMs, totalMs || minItemDurationMs),
	);
	const proposedStart = Number.isFinite(span.start) ? span.start : activeItem.start;

	const previousSibling = [...siblings].reverse().find((region) => region.end <= activeItem.start);
	const nextSibling = siblings.find((region) => region.start >= activeItem.end);
	const minStart = previousSibling ? previousSibling.end : 0;
	const maxStart = nextSibling ? nextSibling.start - duration : totalMs > 0 ? totalMs - duration : proposedStart;

	const start = Math.max(minStart, Math.min(proposedStart, maxStart));
	return clampSpanToBounds({ start, end: start + duration }, { totalMs, minItemDurationMs });
}

export function resolveResizeEnd(activeItemId: string, updatedSpan: Span, config: Pick<DndEngineConfig, "totalMs" | "minItemDurationMs" | "allRegionSpans" | "hasOverlap">): Span | null {
	const { totalMs, minItemDurationMs, allRegionSpans, hasOverlap } = config;
	let clamped = clampSpanToBounds(updatedSpan, { totalMs, minItemDurationMs });
	const effectiveMinDuration = totalMs > 0 ? Math.min(minItemDurationMs, totalMs) : minItemDurationMs;
	if (clamped.end - clamped.start < effectiveMinDuration) {
		return null;
	}

	if (hasOverlap(clamped, activeItemId)) {
		clamped = clampSpanToBounds(
			clampResizedSpanToNeighbours(clamped, activeItemId, {
				allRegionSpans,
				minItemDurationMs,
				totalMs,
			}),
			{ totalMs, minItemDurationMs },
		);
		if (hasOverlap(clamped, activeItemId)) {
			return null;
		}
	}

	return clamped;
}

export function resolveDragEnd(
	activeItemId: string,
	updatedSpan: Span,
	proposedRowId: string,
	config: Pick<DndEngineConfig, "allRegionSpans" | "totalMs" | "minItemDurationMs" | "hasOverlap">,
	resolveTargetRowId?: (id: string, proposedRowId: string) => string,
): { span: Span; rowId: string } | null {
	const { allRegionSpans, totalMs, minItemDurationMs, hasOverlap } = config;
	const resolvedRowId = resolveTargetRowId?.(activeItemId, proposedRowId) ?? proposedRowId;

	const activeItem = allRegionSpans.find((r) => r.id === activeItemId);
	const originalDuration = activeItem ? activeItem.end - activeItem.start : updatedSpan.end - updatedSpan.start;
	const dragSpan: Span = { start: updatedSpan.start, end: updatedSpan.start + originalDuration };

	let clamped = clampSpanToBounds(dragSpan, { totalMs, minItemDurationMs });
	if (hasOverlap(clamped, activeItemId, resolvedRowId)) {
		clamped = clampDraggedSpanToNeighbours(clamped, activeItemId, resolvedRowId, {
			allRegionSpans,
			minItemDurationMs,
			totalMs,
		});
		if (hasOverlap(clamped, activeItemId, resolvedRowId)) {
			return null;
		}
	}

	return { span: clamped, rowId: resolvedRowId };
}
