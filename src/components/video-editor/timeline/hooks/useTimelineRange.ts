import type { Range } from "dnd-timeline";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type WheelEvent,
} from "react";
import {
	createInitialRange,
	normalizeWheelDeltaToPixels,
	reconcileTimelineRange,
} from "../core/time";
import { clampRange } from "../dnd/engine";

type TimelineRangeResetKey = string | number | undefined;

interface UseTimelineRangeParams {
	totalMs: number;
	minVisibleRangeMs: number;
	timelineContainerRef: RefObject<HTMLDivElement>;
	resetRangeKey?: string | number;
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

/**
 * A new source (or project) must start fitted, while a duration change of the
 * same source keeps the user's zoom/pan window.
 */
export function resolveTimelineRangeReset(input: {
	previousResetKey: TimelineRangeResetKey;
	resetKey: TimelineRangeResetKey;
	totalMs: number;
}): Range | null {
	if (input.previousResetKey === input.resetKey) {
		return null;
	}

	return createInitialRange(input.totalMs);
}

export function useTimelineRange({
	totalMs,
	minVisibleRangeMs,
	timelineContainerRef,
	resetRangeKey,
}: UseTimelineRangeParams) {
	const [storedRange, setStoredRange] = useState<Range>(() => createInitialRange(totalMs));
	const previousTotalRef = useRef(totalMs);
	const resetKeyRef = useRef<TimelineRangeResetKey>(resetRangeKey);

	// Single clamp authority: every write (dnd-timeline pan/zoom, wheel pan) is
	// clamped here so consumers never need their own clamp policy.
	const setRange = useCallback<Dispatch<SetStateAction<Range>>>(
		(update) => {
			setStoredRange((previous) => {
				const desired = typeof update === "function" ? update(previous) : update;
				return totalMs > 0 ? clampRange(desired, { totalMs, minVisibleRangeMs }) : desired;
			});
		},
		[minVisibleRangeMs, totalMs],
	);

	useEffect(() => {
		const previousTotalMs = previousTotalRef.current;
		if (previousTotalMs === totalMs) {
			return;
		}

		previousTotalRef.current = totalMs;
		setStoredRange((previous) =>
			reconcileTimelineRange(previous, { totalMs, previousTotalMs, minVisibleRangeMs }),
		);
	}, [minVisibleRangeMs, totalMs]);

	useLayoutEffect(() => {
		const nextRange = resolveTimelineRangeReset({
			previousResetKey: resetKeyRef.current,
			resetKey: resetRangeKey,
			totalMs,
		});
		if (!nextRange) {
			return;
		}

		resetKeyRef.current = resetRangeKey;
		previousTotalRef.current = totalMs;
		setStoredRange(nextRange);
	}, [resetRangeKey, totalMs]);

	const clampedRange = useMemo<Range>(() => {
		if (totalMs <= 0) {
			return storedRange;
		}

		const clamped = clampRange(storedRange, { totalMs, minVisibleRangeMs });
		return clamped.start === storedRange.start && clamped.end === storedRange.end
			? storedRange
			: clamped;
	}, [minVisibleRangeMs, storedRange, totalMs]);

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
		[setRange, totalMs],
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
		range: clampedRange,
		setRange,
		handleTimelineWheel,
	};
}
