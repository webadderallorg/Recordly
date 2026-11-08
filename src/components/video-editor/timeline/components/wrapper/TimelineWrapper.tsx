import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
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
import { useCallback, useMemo, useRef } from "react";
import { ZOOM_ROW_ID } from "../../core/constants";
import { TimelinePresentation } from "../../core/TimelinePresentation";
import type { ClipSequenceSpan, TimelineRegionSpan } from "../../core/timelineTypes";
import {
	getZoomDisplaySpan,
	getZoomPresentationTiming,
	type ZoomPresentationOptions,
} from "../../core/zoomPresentation";
import { clampRange, resolveDragEnd, resolveResizeEnd } from "../../dnd/engine";
import { useClipResizeScroll } from "../../hooks/useClipResizeScroll";

interface TimelineWrapperProps {
	zoomPresentationOptions?: ZoomPresentationOptions;
	children: ReactNode;
	range: Range;
	videoDuration: number;
	clipResizeEndById?: Record<string, number>;
	hasOverlap: (newSpan: Span, excludeId?: string, rowId?: string) => boolean;
	onRangeChange: Dispatch<SetStateAction<Range>>;
	minItemDurationMs: number;
	minVisibleRangeMs: number;
	gridSizeMs?: number;
	onItemSpanChange: (id: string, span: ClipSequenceSpan, rowId?: string) => void;
	resolveTargetRowId?: (id: string, proposedRowId: string) => string;
	allRegionSpans?: TimelineRegionSpan[];
	onLiveSpanPreviewChange?: (id: string, span: Span | null) => void;
	onDraggingChange?: (dragging: boolean) => void;
}

export default function TimelineWrapper({
	children,
	range,
	videoDuration,
	clipResizeEndById = {},
	hasOverlap,
	onRangeChange,
	minItemDurationMs,
	minVisibleRangeMs,
	gridSizeMs: _gridSizeMs,
	onItemSpanChange,
	resolveTargetRowId,
	allRegionSpans = [],
	onLiveSpanPreviewChange,
	onDraggingChange,
	zoomPresentationOptions,
}: TimelineWrapperProps) {
	const { zoomInDurationMs, zoomOutDurationMs } = zoomPresentationOptions ?? {};
	const zoomTiming = useMemo(
		() =>
			getZoomPresentationTiming({
				zoomInDurationMs,
				zoomOutDurationMs,
			}),
		[zoomInDurationMs, zoomOutDurationMs],
	);
	// Treat small pointer jitter as a selection, never as a persisted timeline edit.
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
		useSensor(KeyboardSensor),
	);
	const totalMs = Math.max(0, Math.round(videoDuration * 1000));
	const dragMovedRef = useRef(false);
	const dragPreviewSpanRef = useRef<ClipSequenceSpan | null>(null);

	const onResizeEnd = useCallback(
		(event: ResizeEndEvent) => {
			if (Math.abs(event.delta.x) <= 4) return;
			const updatedSpan = event.active.data.current.getSpanFromResizeEvent?.(event);
			if (!updatedSpan) return;

			const activeItemId = event.active.id as string;
			const resolvedSpan = resolveResizeEnd(activeItemId, updatedSpan, {
				totalMs,
				minItemDurationMs,
				allRegionSpans,
				hasOverlap,
			});
			if (!resolvedSpan) return;
			onItemSpanChange(activeItemId, resolvedSpan);
		},
		[allRegionSpans, hasOverlap, minItemDurationMs, onItemSpanChange, totalMs],
	);

	const onDragEnd = useCallback(
		(event: DragEndEvent) => {
			if (Math.hypot(event.delta.x, event.delta.y) <= 4 && !dragMovedRef.current) return;
			const proposedRowId = event.over?.id as string;
			// The item's DOM preview can consume dnd-kit's final translation. Commit
			// the last resolved preview instead of reading the restored DOM position.
			const updatedSpan =
				dragPreviewSpanRef.current ??
				event.active.data.current.getSpanFromDragEvent?.(event);
			if (!updatedSpan || !proposedRowId) return;

			const activeItemId = event.active.id as string;
			const resolved = resolveDragEnd(
				activeItemId,
				updatedSpan,
				proposedRowId,
				{
					allRegionSpans,
					totalMs,
					minItemDurationMs,
					hasOverlap,
				},
				resolveTargetRowId,
			);
			if (!resolved) return;
			onItemSpanChange(activeItemId, resolved.span, resolved.rowId);
		},
		[
			allRegionSpans,
			hasOverlap,
			minItemDurationMs,
			onItemSpanChange,
			resolveTargetRowId,
			totalMs,
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
		(span: { start: number; end: number } | null, screenX?: number, id?: string) => {
			const el = tooltipRef.current;
			if (!el) return;
			if (!span) {
				el.style.opacity = "0";
				return;
			}
			const region = allRegionSpans.find((r) => r.id === id && r.rowId === ZOOM_ROW_ID);
			const visible = region ? getZoomDisplaySpan(span, zoomTiming) : span;
			el.textContent = `${formatTooltipMs(visible.start)} – ${formatTooltipMs(visible.end)}`;
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
		[formatTooltipMs, allRegionSpans, zoomTiming],
	);

	const resolveDragPreviewSpan = useCallback(
		(event: DragMoveEvent, span: Span): ClipSequenceSpan | null => {
			const proposedRowId = event.over?.id as string | undefined;
			if (!proposedRowId) return span;

			const activeItemId = event.active.id as string;
			const resolved = resolveDragEnd(
				activeItemId,
				span,
				proposedRowId,
				{
					allRegionSpans,
					totalMs,
					minItemDurationMs,
					hasOverlap,
				},
				resolveTargetRowId,
			);

			return resolved?.span ?? null;
		},
		[allRegionSpans, hasOverlap, minItemDurationMs, resolveTargetRowId, totalMs],
	);
	const clipResizeScroll = useClipResizeScroll({
		range,
		totalMs,
		minDurationMs: minItemDurationMs,
		clipResizeEndById,
		onPreview: showTooltip,
		onCancel: () => {
			showTooltip(null);
			onDraggingChange?.(false);
		},
	});

	const onDragStart = useCallback(
		(event: DragStartEvent) => {
			dragMovedRef.current = false;
			dragPreviewSpanRef.current = null;
			onDraggingChange?.(true);
			const span = event.active.data.current.getSpanFromDragEvent?.(event);
			if (span) showTooltip(span, undefined, String(event.active.id));
		},
		[onDraggingChange, showTooltip],
	);

	const onDragMove = useCallback(
		(event: DragMoveEvent) => {
			const span = event.active.data.current.getSpanFromDragEvent?.(event);
			const previewSpan = span ? resolveDragPreviewSpan(event, span) : null;
			const screenX =
				event.activatorEvent && "clientX" in event.activatorEvent
					? (event.activatorEvent as PointerEvent).clientX + (event.delta?.x ?? 0)
					: undefined;
			if (previewSpan) {
				showTooltip(previewSpan, screenX, String(event.active.id));
			} else {
				showTooltip(null);
			}
			const moved = Math.hypot(event.delta?.x ?? 0, event.delta?.y ?? 0) > 4;
			dragMovedRef.current ||= moved;
			if (dragMovedRef.current) {
				dragPreviewSpanRef.current = previewSpan;
				onLiveSpanPreviewChange?.(event.active.id as string, previewSpan);
			}
		},
		[onLiveSpanPreviewChange, resolveDragPreviewSpan, showTooltip],
	);

	const onResizeMove = useCallback(
		(event: ResizeMoveEvent) => {
			onDraggingChange?.(true);
			if (clipResizeScroll.move(event)) return;
			const span = event.active.data.current.getSpanFromResizeEvent?.(event);
			const screenX =
				event.activatorEvent && "clientX" in event.activatorEvent
					? (event.activatorEvent as PointerEvent).clientX + (event.delta?.x ?? 0)
					: undefined;
			if (span) showTooltip(span, screenX, String(event.active.id));
			// dnd-timeline mutates the active item's DOM during resize; React preview
			// renders here can reset that inline width/edge position and make trims stutter.
		},
		[onDraggingChange, showTooltip, clipResizeScroll],
	);

	const hideTooltip = useCallback(() => showTooltip(null), [showTooltip]);

	const onResizeEndWithTooltip = useCallback(
		(event: ResizeEndEvent) => {
			const preview = clipResizeScroll.finish();
			hideTooltip();
			if (preview) {
				if (preview.moved) onItemSpanChange(String(event.active.id), preview.span);
			} else {
				onResizeEnd(event);
			}
			onLiveSpanPreviewChange?.(event.active.id as string, null);
			onDraggingChange?.(false);
		},
		[
			hideTooltip,
			onDraggingChange,
			onLiveSpanPreviewChange,
			onResizeEnd,
			clipResizeScroll,
			onItemSpanChange,
		],
	);

	const onDragEndWithTooltip = useCallback(
		(event: DragEndEvent) => {
			hideTooltip();
			onDragEnd(event);
			onLiveSpanPreviewChange?.(event.active.id as string, null);
			onDraggingChange?.(false);
		},
		[hideTooltip, onDraggingChange, onDragEnd, onLiveSpanPreviewChange],
	);

	// dnd-kit fires onDragCancel (not onDragEnd) when a drag is aborted, e.g. via
	// Escape. Without this the drag-active state and live preview would stick.
	const onDragCancel = useCallback(
		(event: { active: { id: string | number } }) => {
			hideTooltip();
			onLiveSpanPreviewChange?.(String(event.active.id), null);
			onDraggingChange?.(false);
		},
		[hideTooltip, onDraggingChange, onLiveSpanPreviewChange],
	);

	const handleRangeChange = useCallback(
		(updater: (previous: Range) => Range) => {
			onRangeChange((prev) => {
				const normalized =
					totalMs > 0 ? clampRange(prev, { totalMs, minVisibleRangeMs }) : prev;
				const desired = updater(normalized);

				if (totalMs > 0) {
					return clampRange(desired, { totalMs, minVisibleRangeMs });
				}

				return desired;
			});
		},
		[minVisibleRangeMs, onRangeChange, totalMs],
	);

	return (
		<TimelineContext
			sensors={sensors}
			range={clipResizeScroll.range}
			onResizeStart={clipResizeScroll.start}
			onRangeChanged={handleRangeChange}
			onResizeEnd={onResizeEndWithTooltip}
			onResizeMove={onResizeMove}
			onDragStart={onDragStart}
			onDragMove={onDragMove}
			onDragEnd={onDragEndWithTooltip}
			onDragCancel={onDragCancel}
			autoScroll={{
				enabled: true,
				threshold: { x: 0.08, y: 0.08 },
				acceleration: 3,
				interval: 16,
				layoutShiftCompensation: { x: false, y: false },
			}}
			resizeHandleWidth={28}
		>
			<div ref={clipResizeScroll.hostRef} className="relative h-full min-h-0">
				<TimelinePresentation
					zoomTiming={zoomTiming}
					regions={allRegionSpans}
					totalMs={totalMs}
					minItemDurationMs={minItemDurationMs}
					hasOverlap={hasOverlap}
				>
					{children}
				</TimelinePresentation>
				{/* Floating tooltip shown during drag/resize */}
				<div
					ref={tooltipRef}
					data-clip-resize-tooltip
					className="absolute top-1 pointer-events-none z-[60] px-1.5 py-0.5 rounded bg-editor-bg/90 text-[10px] text-foreground/90 font-medium tabular-nums whitespace-nowrap border border-foreground/10 shadow-lg"
					style={{ opacity: 0, transition: "opacity 0.1s" }}
				/>
			</div>
		</TimelineContext>
	);
}
