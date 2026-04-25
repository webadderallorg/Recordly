import type {
	DragEndEvent,
	DragMoveEvent,
	DragStartEvent,
	Range,
	ResizeEndEvent,
	ResizeMoveEvent,
	Span,
} from "dnd-timeline";
import { TimelineContext } from "dnd-timeline";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useCallback, useRef } from "react";

interface TimelineWrapperProps {
	children: ReactNode;
	range: Range;
	videoDuration: number;
	hasOverlap: (newSpan: Span, excludeId?: string, rowId?: string) => boolean;
	onRangeChange: Dispatch<SetStateAction<Range>>;
	minItemDurationMs: number;
	minVisibleRangeMs: number;
	gridSizeMs?: number;
	onItemSpanChange: (id: string, span: Span, rowId?: string) => void;
	resolveTargetRowId?: (id: string, proposedRowId: string) => string;
	canMoveItem?: (id: string, rowId: string) => boolean;
	allRegionSpans?: { id: string; start: number; end: number; rowId: string }[];
}

export default function TimelineWrapper({
	children,
	range,
	videoDuration,
	hasOverlap,
	onRangeChange,
	minItemDurationMs,
	minVisibleRangeMs,
	gridSizeMs: _gridSizeMs,
	onItemSpanChange,
	resolveTargetRowId,
	canMoveItem,
	allRegionSpans = [],
}: TimelineWrapperProps) {
	const totalMs = Math.max(0, Math.round(videoDuration * 1000));

	const clampSpanToBounds = useCallback(
		(span: Span): Span => {
			const rawDuration = Math.max(span.end - span.start, 0);
			const normalizedStart = Number.isFinite(span.start) ? span.start : 0;

			if (totalMs === 0) {
				const minDuration = Math.max(minItemDurationMs, 1);
				const duration = Math.max(rawDuration, minDuration);
				const start = Math.max(0, normalizedStart);
				return {
					start,
					end: start + duration,
				};
			}

			const minDuration = Math.min(Math.max(minItemDurationMs, 1), totalMs);
			const duration = Math.min(Math.max(rawDuration, minDuration), totalMs);

			const start = Math.max(0, Math.min(normalizedStart, totalMs - duration));
			const end = start + duration;

			return { start, end };
		},
		[minItemDurationMs, totalMs],
	);

	const clampRange = useCallback(
		(candidate: Range): Range => {
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
		},
		[minVisibleRangeMs, totalMs],
	);

	const getSiblingSpans = useCallback(
		(activeItemId: string, rowId?: string) => {
			const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
			const resolvedRowId = rowId ?? activeItem?.rowId;
			if (!resolvedRowId) {
				return [];
			}

			return allRegionSpans
				.filter((region) => region.id !== activeItemId && region.rowId === resolvedRowId)
				.sort((left, right) => left.start - right.start);
		},
		[allRegionSpans],
	);

	// When a resize overlaps neighbours, clamp the resized edge to the nearest boundary.
	const clampResizedSpanToNeighbours = useCallback(
		(span: Span, activeItemId: string): Span => {
			const siblings = getSiblingSpans(activeItemId);
			const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
			let { start, end } = span;

			for (const r of siblings) {
				// Span's right edge crossed into a region to the right
				if (end > r.start && start < r.start) {
					end = r.start;
				}
				// Span's left edge crossed into a region to the left
				if (start < r.end && end > r.end) {
					start = r.end;
				}
			}

			// Ensure minimum duration after clamping
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
		},
		[allRegionSpans, getSiblingSpans, minItemDurationMs, totalMs],
	);

	// When a drag overlaps neighbours, keep duration fixed and stop at the nearest gap boundary.
	const clampDraggedSpanToNeighbours = useCallback(
		(span: Span, activeItemId: string, rowId?: string): Span => {
			const activeItem = allRegionSpans.find((region) => region.id === activeItemId);
			if (!activeItem) {
				return clampSpanToBounds(span);
			}

			const siblings = getSiblingSpans(activeItemId, rowId);
			const duration = Math.max(
				activeItem.end - activeItem.start,
				Math.min(minItemDurationMs, totalMs || minItemDurationMs),
			);
			const proposedStart = Number.isFinite(span.start) ? span.start : activeItem.start;

			const previousSibling = [...siblings]
				.reverse()
				.find((region) => region.end <= activeItem.start);
			const nextSibling = siblings.find((region) => region.start >= activeItem.end);

			const minStart = previousSibling ? previousSibling.end : 0;
			const maxStart = nextSibling
				? nextSibling.start - duration
				: totalMs > 0
					? totalMs - duration
					: proposedStart;

			const start = Math.max(minStart, Math.min(proposedStart, maxStart));
			return clampSpanToBounds({ start, end: start + duration });
		},
		[allRegionSpans, clampSpanToBounds, getSiblingSpans, minItemDurationMs, totalMs],
	);

	const onResizeEnd = useCallback(
		(event: ResizeEndEvent) => {
			const updatedSpan = event.active.data.current.getSpanFromResizeEvent?.(event);
			if (!updatedSpan) return;

			const activeItemId = event.active.id as string;
			let clampedSpan = clampSpanToBounds(updatedSpan);

			const effectiveMinDuration =
				totalMs > 0 ? Math.min(minItemDurationMs, totalMs) : minItemDurationMs;
			if (clampedSpan.end - clampedSpan.start < effectiveMinDuration) {
				return;
			}

			// Clamp to neighbour boundaries instead of rejecting
			if (hasOverlap(clampedSpan, activeItemId)) {
				clampedSpan = clampSpanToBounds(
					clampResizedSpanToNeighbours(clampedSpan, activeItemId),
				);
				// If still overlapping after clamping, fall back to original position
				if (hasOverlap(clampedSpan, activeItemId)) {
					return;
				}
			}

			onItemSpanChange(activeItemId, clampedSpan);
		},
		[
			clampResizedSpanToNeighbours,
			clampSpanToBounds,
			hasOverlap,
			minItemDurationMs,
			onItemSpanChange,
			totalMs,
		],
	);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			const proposedRowId = event.over?.id as string;
			const updatedSpan = event.active.data.current.getSpanFromDragEvent?.(event);
			if (!updatedSpan || !proposedRowId) return;

			const activeItemId = event.active.id as string;
			const resolvedRowId =
				resolveTargetRowId?.(activeItemId, proposedRowId) ?? proposedRowId;

			if (canMoveItem && !canMoveItem(activeItemId, resolvedRowId)) {
				return;
			}

			// Drags are pure translations — always preserve the original duration.
			// The span from getSpanFromDragEvent can drift due to pixel-to-ms
			// rounding at different zoom levels, so pin to the known duration.
			const activeItem = allRegionSpans.find((r) => r.id === activeItemId);
			const originalDuration = activeItem
				? activeItem.end - activeItem.start
				: updatedSpan.end - updatedSpan.start;
			const dragSpan: Span = {
				start: updatedSpan.start,
				end: updatedSpan.start + originalDuration,
			};

			let clampedSpan = clampSpanToBounds(dragSpan);

			// Clamp to neighbour boundaries instead of rejecting
			if (hasOverlap(clampedSpan, activeItemId, resolvedRowId)) {
				clampedSpan = clampDraggedSpanToNeighbours(
					clampedSpan,
					activeItemId,
					resolvedRowId,
				);
				if (hasOverlap(clampedSpan, activeItemId, resolvedRowId)) {
					return;
				}
			}

			onItemSpanChange(activeItemId, clampedSpan, resolvedRowId);
		},
		[
			allRegionSpans,
			clampDraggedSpanToNeighbours,
			clampSpanToBounds,
			hasOverlap,
			canMoveItem,
			onItemSpanChange,
			resolveTargetRowId,
		],
	);

	// Drag/resize tooltip (direct DOM updates, no re-renders)
	const tooltipRef = useRef<HTMLDivElement>(null);

	const formatTooltipMs = useCallback((ms: number) => {
		const s = ms / 1000;
		const min = Math.floor(s / 60);
		const sec = s % 60;
		return min > 0 ? `${min}:${sec.toFixed(1).padStart(4, "0")}` : `${sec.toFixed(1)}s`;
	}, []);

	const showTooltip = useCallback(
		(span: { start: number; end: number } | null, screenX?: number) => {
			const el = tooltipRef.current;
			if (!el) return;
			if (!span) {
				el.style.opacity = "0";
				return;
			}
			el.textContent = `${formatTooltipMs(span.start)} – ${formatTooltipMs(span.end)}`;
			el.style.opacity = "1";
			if (screenX !== undefined) {
				const parent = el.parentElement;
				if (parent) {
					const rect = parent.getBoundingClientRect();
					const x = Math.max(0, Math.min(screenX - rect.left, rect.width - 100));
					el.style.left = `${x}px`;
				}
			}
		},
		[formatTooltipMs],
	);

	const onDragStart = useCallback(
		(event: DragStartEvent) => {
			const span = event.active.data.current.getSpanFromDragEvent?.(event);
			if (span) showTooltip(span);
		},
		[showTooltip],
	);

	const onDragMove = useCallback(
		(event: DragMoveEvent) => {
			const span = event.active.data.current.getSpanFromDragEvent?.(event);
			const screenX =
				event.activatorEvent && "clientX" in event.activatorEvent
					? (event.activatorEvent as PointerEvent).clientX + (event.delta?.x ?? 0)
					: undefined;
			if (span) showTooltip(span, screenX);
		},
		[showTooltip],
	);

	const onResizeMove = useCallback(
		(event: ResizeMoveEvent) => {
			const span = event.active.data.current.getSpanFromResizeEvent?.(event);
			const screenX =
				event.activatorEvent && "clientX" in event.activatorEvent
					? (event.activatorEvent as PointerEvent).clientX + (event.delta?.x ?? 0)
					: undefined;
			if (span) showTooltip(span, screenX);
		},
		[showTooltip],
	);

	const hideTooltip = useCallback(() => showTooltip(null), [showTooltip]);

	const onResizeEndWithTooltip = useCallback(
		(event: ResizeEndEvent) => {
			hideTooltip();
			onResizeEnd(event);
		},
		[hideTooltip, onResizeEnd],
	);

	const onDragEndWithTooltip = useCallback(
		(event: DragEndEvent) => {
			hideTooltip();
			onDragEnd(event);
		},
		[hideTooltip, onDragEnd],
	);

	const handleRangeChange = useCallback(
		(updater: (previous: Range) => Range) => {
			onRangeChange((prev) => {
				const normalized = totalMs > 0 ? clampRange(prev) : prev;
				const desired = updater(normalized);

				if (totalMs > 0) {
					return clampRange(desired);
				}

				return desired;
			});
		},
		[clampRange, onRangeChange, totalMs],
	);

	return (
		<TimelineContext
			range={range}
			onRangeChanged={handleRangeChange}
			onResizeEnd={onResizeEndWithTooltip}
			onResizeMove={onResizeMove}
			onDragStart={onDragStart}
			onDragMove={onDragMove}
			onDragEnd={onDragEndWithTooltip}
			autoScroll={{ enabled: false }}
			resizeHandleWidth={28}
		>
			<div className="relative h-full min-h-0">
				{children}
				{/* Floating tooltip shown during drag/resize */}
				<div
					ref={tooltipRef}
					className="absolute top-1 pointer-events-none z-[60] px-1.5 py-0.5 rounded bg-editor-bg/90 text-[10px] text-foreground/90 font-medium tabular-nums whitespace-nowrap border border-foreground/10 shadow-lg"
					style={{ opacity: 0, transition: "opacity 0.1s" }}
				/>
			</div>
		</TimelineContext>
	);
}
