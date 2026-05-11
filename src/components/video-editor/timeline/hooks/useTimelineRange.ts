import type { Range } from "dnd-timeline";
import { useCallback, useEffect, useMemo, useState, type RefObject, type WheelEvent } from "react";
import { createInitialRange, normalizeWheelDeltaToPixels } from "../core/time";

interface UseTimelineRangeParams {
	totalMs: number;
	timelineContainerRef: RefObject<HTMLDivElement>;
}

export function useTimelineRange({ totalMs, timelineContainerRef }: UseTimelineRangeParams) {
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
			if (event.ctrlKey || event.metaKey || totalMs <= 0) {
				return;
			}

			const rawHorizontalDelta =
				Math.abs(event.deltaX) > 0
					? event.deltaX
					: event.shiftKey && Math.abs(event.deltaY) > 0
						? event.deltaY
						: 0;

			if (rawHorizontalDelta === 0) {
				return;
			}

			const containerWidth = timelineContainerRef.current?.clientWidth ?? 0;
			const visibleRangeMs = clampedRange.end - clampedRange.start;
			if (containerWidth <= 0 || visibleRangeMs <= 0) {
				return;
			}

			event.preventDefault();
			const horizontalDeltaPx = normalizeWheelDeltaToPixels(rawHorizontalDelta, event.deltaMode);
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
	};
}
