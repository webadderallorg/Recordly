import type { Range } from "dnd-timeline";
import { type RefObject, useCallback, useEffect, useMemo, useState, type WheelEvent } from "react";
import { createInitialRange, normalizeWheelDeltaToPixels, scaleTimelineRange } from "../core/time";

interface UseTimelineRangeParams {
	totalMs: number;
	minimumSpanMs: number;
	timelineContainerRef: RefObject<HTMLDivElement | null>;
}

export interface TimelineWheelPanDeltaInput {
	deltaX: number;
	deltaY: number;
	deltaMode: number;
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	canScrollVertically?: boolean;
}

export function resolveTimelineWheelPanDeltaPx({
	deltaX,
	deltaY,
	deltaMode,
	shiftKey = false,
	ctrlKey = false,
	metaKey = false,
	canScrollVertically = true,
}: TimelineWheelPanDeltaInput) {
	if ((ctrlKey || metaKey) && !shiftKey) {
		return 0;
	}

	if (Math.abs(deltaX) > 0) {
		return normalizeWheelDeltaToPixels(deltaX, deltaMode);
	}

	if ((shiftKey || !canScrollVertically) && Math.abs(deltaY) > 0) {
		return normalizeWheelDeltaToPixels(deltaY, deltaMode);
	}

	return 0;
}

export function useTimelineRange({
	totalMs,
	minimumSpanMs,
	timelineContainerRef,
}: UseTimelineRangeParams) {
	const [range, setRange] = useState<Range>(() => createInitialRange(totalMs));

	useEffect(() => {
		setRange(createInitialRange(totalMs));
	}, [totalMs]);

	const clampedRange = useMemo<Range>(() => {
		if (totalMs === 0) {
			return range;
		}
		return {
			start: Math.max(0, Math.min(range.start, totalMs)),
			end: Math.min(range.end, totalMs),
		};
	}, [range, totalMs]);

	const zoomIn = useCallback(() => {
		setRange((previous) => scaleTimelineRange(previous, totalMs, minimumSpanMs, 0.75));
	}, [minimumSpanMs, totalMs]);

	const zoomOut = useCallback(() => {
		setRange((previous) => scaleTimelineRange(previous, totalMs, minimumSpanMs, 4 / 3));
	}, [minimumSpanMs, totalMs]);

	const panTimelineRange = useCallback(
		(deltaMs: number) => {
			if (!Number.isFinite(deltaMs) || deltaMs === 0 || totalMs <= 0) {
				return;
			}

			setRange((previous) => {
				const visibleSpan = Math.max(1, previous.end - previous.start);
				const maxStart = Math.max(0, totalMs - visibleSpan);
				const nextStart = Math.max(0, Math.min(previous.start + deltaMs, maxStart));
				return { start: nextStart, end: nextStart + visibleSpan };
			});
		},
		[totalMs],
	);

	const handleTimelineWheel = useCallback(
		(event: WheelEvent<HTMLDivElement>) => {
			if (((event.ctrlKey || event.metaKey) && !event.shiftKey) || totalMs <= 0) {
				return;
			}

			const container = timelineContainerRef.current;
			const horizontalDeltaPx = resolveTimelineWheelPanDeltaPx({
				deltaX: event.deltaX,
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				shiftKey: event.shiftKey,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				canScrollVertically: container
					? container.scrollHeight > container.clientHeight + 1
					: true,
			});

			if (horizontalDeltaPx === 0) {
				return;
			}

			const containerWidth = container?.clientWidth ?? 0;
			const visibleRangeMs = clampedRange.end - clampedRange.start;
			if (containerWidth <= 0 || visibleRangeMs <= 0) {
				return;
			}

			event.preventDefault();
			const deltaMs = (horizontalDeltaPx / containerWidth) * visibleRangeMs;
			panTimelineRange(deltaMs);
		},
		[clampedRange.end, clampedRange.start, panTimelineRange, timelineContainerRef, totalMs],
	);

	return {
		range,
		setRange,
		clampedRange,
		handleTimelineWheel,
		zoomIn,
		zoomOut,
	};
}
