import type { Range, Span } from "dnd-timeline";
import { CLIP_ROW_ID } from "../core/constants";
import type { TimelineRegionSpan } from "../core/timelineTypes";

export interface DndEngineConfig {
	totalMs: number;
	minItemDurationMs: number;
	minVisibleRangeMs: number;
	allRegionSpans: TimelineRegionSpan[];
	hasOverlap: (newSpan: Span, excludeId?: string, rowId?: string) => boolean;
}

export function clampSpanToBounds(
	span: Span,
	config: Pick<DndEngineConfig, "totalMs" | "minItemDurationMs">,
): Span {
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

export function clampRange(
	candidate: Range,
	config: Pick<DndEngineConfig, "totalMs" | "minVisibleRangeMs">,
): Range {
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

export function getSiblingSpans(
	activeItemId: string,
	rowId: string | undefined,
	allRegionSpans: TimelineRegionSpan[],
) {
	const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
	const resolvedRowId = rowId ?? activeItem?.rowId;
	if (!resolvedRowId) {
		return [];
	}

	return allRegionSpans
		.filter((region) => region.id !== activeItemId && region.rowId === resolvedRowId)
		.sort((left, right) => left.start - right.start);
}

export function clampResizedSpanToNeighbours(
	span: Span,
	activeItemId: string,
	config: Pick<DndEngineConfig, "allRegionSpans" | "minItemDurationMs" | "totalMs">,
): Span {
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
		const resizedLeft = Boolean(
			activeItem && span.start !== activeItem.start && span.end === activeItem.end,
		);
		if (resizedLeft) {
			start = end - minDur;
		} else {
			end = start + minDur;
		}
	}

	return { start: Math.max(0, start), end: Math.min(end, totalMs || end) };
}

function getClipDragTotalMs(
	activeItem: TimelineRegionSpan | undefined,
	rowId: string | undefined,
	span: Span,
	totalMs: number,
) {
	if (activeItem?.rowId !== CLIP_ROW_ID || rowId !== CLIP_ROW_ID) {
		return totalMs;
	}

	return Math.max(totalMs, Math.ceil(span.end));
}

function spansOverlap(left: Span, right: Span) {
	return left.start < right.end && left.end > right.start;
}

function placeSpanAfterSibling(
	siblings: TimelineRegionSpan[],
	siblingIndex: number,
	duration: number,
): Span {
	let start = siblings[siblingIndex].end;

	for (let index = siblingIndex + 1; index < siblings.length; index += 1) {
		const sibling = siblings[index];
		if (start + duration <= sibling.start) {
			break;
		}
		start = sibling.end;
	}

	return { start, end: start + duration };
}

function placeSpanBeforeSibling(
	siblings: TimelineRegionSpan[],
	siblingIndex: number,
	duration: number,
): Span | null {
	let end = siblings[siblingIndex].start;

	for (let index = siblingIndex - 1; index >= 0; index -= 1) {
		const sibling = siblings[index];
		if (end - duration >= sibling.end) {
			break;
		}
		end = sibling.start;
	}

	const start = end - duration;
	if (start < 0) {
		return null;
	}

	return { start, end };
}

function resolveClipDragInsertionSpan(params: {
	activeItem: TimelineRegionSpan;
	siblings: TimelineRegionSpan[];
	proposedStart: number;
	duration: number;
}): Span | null {
	const { activeItem, siblings, proposedStart, duration } = params;
	const proposedSpan = { start: proposedStart, end: proposedStart + duration };
	const proposedCenter = proposedStart + duration / 2;
	const delta = proposedStart - activeItem.start;

	if (delta > 0) {
		const nextIndex = siblings.findIndex(
			(sibling) =>
				sibling.start >= activeItem.end &&
				spansOverlap(proposedSpan, sibling) &&
				proposedCenter >= sibling.start,
		);
		if (nextIndex >= 0) {
			return placeSpanAfterSibling(siblings, nextIndex, duration);
		}

		return null;
	}

	if (delta < 0) {
		for (let index = siblings.length - 1; index >= 0; index -= 1) {
			const sibling = siblings[index];
			if (
				sibling.end <= activeItem.start &&
				spansOverlap(proposedSpan, sibling) &&
				proposedCenter <= sibling.end
			) {
				return placeSpanBeforeSibling(siblings, index, duration);
			}
		}
	}

	return null;
}

export function clampDraggedSpanToNeighbours(
	span: Span,
	activeItemId: string,
	rowId: string | undefined,
	config: Pick<DndEngineConfig, "allRegionSpans" | "minItemDurationMs" | "totalMs">,
): Span {
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
	const proposedSpan = { start: proposedStart, end: proposedStart + duration };

	if (activeItem.rowId === CLIP_ROW_ID && rowId === CLIP_ROW_ID) {
		const insertionSpan = resolveClipDragInsertionSpan({
			activeItem,
			siblings,
			proposedStart,
			duration,
		});
		if (insertionSpan) {
			const insertionTotalMs = getClipDragTotalMs(activeItem, rowId, insertionSpan, totalMs);
			return clampSpanToBounds(insertionSpan, {
				totalMs: insertionTotalMs,
				minItemDurationMs,
			});
		}
	}

	const effectiveTotalMs = getClipDragTotalMs(activeItem, rowId, proposedSpan, totalMs);

	const previousSibling = [...siblings]
		.reverse()
		.find((region) => region.end <= activeItem.start);
	const nextSibling = siblings.find((region) => region.start >= activeItem.end);
	const minStart = previousSibling ? previousSibling.end : 0;
	const maxStart = nextSibling
		? nextSibling.start - duration
		: effectiveTotalMs > 0
			? effectiveTotalMs - duration
			: proposedStart;

	const start = Math.max(minStart, Math.min(proposedStart, maxStart));
	return clampSpanToBounds(
		{ start, end: start + duration },
		{ totalMs: effectiveTotalMs, minItemDurationMs },
	);
}

export function resolveResizeEnd(
	activeItemId: string,
	updatedSpan: Span,
	config: Pick<
		DndEngineConfig,
		"totalMs" | "minItemDurationMs" | "allRegionSpans" | "hasOverlap"
	>,
): Span | null {
	const { totalMs, minItemDurationMs, allRegionSpans, hasOverlap } = config;
	let clamped = clampSpanToBounds(updatedSpan, { totalMs, minItemDurationMs });
	const effectiveMinDuration =
		totalMs > 0 ? Math.min(minItemDurationMs, totalMs) : minItemDurationMs;
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
	config: Pick<
		DndEngineConfig,
		"allRegionSpans" | "totalMs" | "minItemDurationMs" | "hasOverlap"
	>,
	resolveTargetRowId?: (id: string, proposedRowId: string) => string,
): { span: Span; rowId: string } | null {
	const { allRegionSpans, totalMs, minItemDurationMs, hasOverlap } = config;
	const resolvedRowId = resolveTargetRowId?.(activeItemId, proposedRowId) ?? proposedRowId;

	const activeItem = allRegionSpans.find((r) => r.id === activeItemId);
	const originalDuration = activeItem
		? activeItem.end - activeItem.start
		: updatedSpan.end - updatedSpan.start;
	const dragSpan: Span = { start: updatedSpan.start, end: updatedSpan.start + originalDuration };
	const effectiveTotalMs = getClipDragTotalMs(activeItem, resolvedRowId, dragSpan, totalMs);

	let clamped = clampSpanToBounds(dragSpan, { totalMs: effectiveTotalMs, minItemDurationMs });
	if (hasOverlap(clamped, activeItemId, resolvedRowId)) {
		clamped = clampDraggedSpanToNeighbours(clamped, activeItemId, resolvedRowId, {
			allRegionSpans,
			minItemDurationMs,
			totalMs: effectiveTotalMs,
		});
		if (hasOverlap(clamped, activeItemId, resolvedRowId)) {
			return null;
		}
	}

	return { span: clamped, rowId: resolvedRowId };
}
