import { type MouseEvent, useCallback, useRef, useState } from "react";
import { type ClipPresentation, getTimeAtClipSeam } from "../../core/clipPresentation";

interface LaneHoverParams {
	clipPresentation?: ClipPresentation[];
	direction: string;
	rangeStart: number;
	visibleDurationMs: number;
	videoDurationMs: number;
	valueToPixels: (value: number) => number;
	// Ghost block length to preview under the cursor.
	ghostDurationMs: number;
	// Whether the lane currently accepts adds (e.g. captions only when shown).
	enabled: boolean;
	// Suppress the ghost while a drag/resize is in progress.
	isDragging: boolean;
	onAddAtMs?: (startMs: number) => void;
	canPlaceAtMs?: (startMs: number) => boolean;
	// When set, the ghost previews the exact span an add would produce (clamped to
	// neighbors/end) instead of a fixed ghostDurationMs. Returns null when no add fits.
	resolveGhostSpanMs?: (startMs: number) => { start: number; end: number } | null;
}

export function useTimelineLaneHover({
	clipPresentation,
	direction,
	rangeStart,
	visibleDurationMs,
	videoDurationMs,
	valueToPixels,
	ghostDurationMs,
	enabled,
	isDragging,
	onAddAtMs,
	canPlaceAtMs,
	resolveGhostSpanMs,
}: LaneHoverParams) {
	const [isHovered, setIsHovered] = useState(false);
	const [hoverMs, setHoverMs] = useState<number | null>(null);
	const addPressRef = useRef<{ x: number; y: number } | null>(null);

	const updateHoverTime = useCallback(
		(clientX: number, rect: DOMRect) => {
			if (rect.width <= 0) return;
			const position =
				direction === "rtl"
					? Math.max(0, Math.min(rect.right - clientX, rect.width))
					: Math.max(0, Math.min(clientX - rect.left, rect.width));
			const ratio = position / rect.width;
			const nextMs = rangeStart + ratio * visibleDurationMs;
			setHoverMs(
				getTimeAtClipSeam(
					Math.max(0, Math.min(nextMs, videoDurationMs)),
					clipPresentation ?? [],
				),
			);
		},
		[direction, rangeStart, videoDurationMs, visibleDurationMs, clipPresentation],
	);

	const onMouseEnter = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (isDragging || event.buttons !== 0) return;
			setIsHovered(true);
			updateHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[isDragging, updateHoverTime],
	);

	const onMouseMove = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (isDragging || event.buttons !== 0) return;
			setIsHovered(true);
			updateHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[isDragging, updateHoverTime],
	);

	const onMouseLeave = useCallback(() => {
		setIsHovered(false);
		setHoverMs(null);
	}, []);

	const onMouseDown = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			setIsHovered(false);
			setHoverMs(null);
			// A resized item can move away from the pointer before mouseup. The
			// browser then clicks the lane; only a press on empty space may add.
			addPressRef.current =
				enabled &&
				!isDragging &&
				event.button === 0 &&
				!(event.target as HTMLElement).closest("[data-timeline-item]")
					? { x: event.clientX, y: event.clientY }
					: null;
		},
		[enabled, isDragging],
	);

	const onClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			const press = addPressRef.current;
			addPressRef.current = null;
			if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
			// Respect the lane's enabled flag so a hidden ghost can't still add on click.
			if (!enabled || isDragging || !onAddAtMs || event.button !== 0) return;
			if ((event.target as HTMLElement).closest("[data-timeline-item]")) return;
			const rect = event.currentTarget.getBoundingClientRect();
			if (rect.width <= 0) return;
			const x = direction === "rtl" ? rect.right - event.clientX : event.clientX - rect.left;
			const startMs = getTimeAtClipSeam(
				Math.max(
					0,
					Math.min(rangeStart + (x / rect.width) * visibleDurationMs, videoDurationMs),
				),
				clipPresentation ?? [],
			);
			if (canPlaceAtMs && !canPlaceAtMs(startMs)) return;
			onAddAtMs(startMs);
		},
		[
			clipPresentation,
			enabled,
			isDragging,
			direction,
			rangeStart,
			visibleDurationMs,
			canPlaceAtMs,
			onAddAtMs,
			videoDurationMs,
		],
	);

	const reset = useCallback(() => {
		setIsHovered(false);
		setHoverMs(null);
	}, []);

	const clampedHoverMs =
		hoverMs === null ? null : Math.max(0, Math.min(hoverMs, videoDurationMs));
	// When a resolver is supplied, preview the exact span the add would create (clamped to
	// the next item / end of timeline); otherwise fall back to a fixed-length ghost.
	const resolvedSpan =
		resolveGhostSpanMs && clampedHoverMs !== null ? resolveGhostSpanMs(clampedHoverMs) : null;
	const ghostStartMs =
		clampedHoverMs === null ? null : resolvedSpan ? resolvedSpan.start : clampedHoverMs;
	const ghostEndMs =
		ghostStartMs === null
			? null
			: resolvedSpan
				? resolvedSpan.end
				: Math.max(ghostStartMs, Math.min(videoDurationMs, ghostStartMs + ghostDurationMs));
	const ghostStartOffsetPx =
		ghostStartMs === null ? 0 : valueToPixels(Math.max(0, ghostStartMs - rangeStart));
	const ghostEndOffsetPx =
		ghostEndMs === null ? 0 : valueToPixels(Math.max(0, ghostEndMs - rangeStart));
	const ghostWidthPx = Math.max(18, ghostEndOffsetPx - ghostStartOffsetPx);
	const canShowGhost =
		!isDragging &&
		enabled &&
		isHovered &&
		ghostStartMs !== null &&
		(resolveGhostSpanMs
			? resolvedSpan !== null
			: onAddAtMs
				? (canPlaceAtMs?.(ghostStartMs) ?? true)
				: false);

	return {
		reset,
		ghostStartMs,
		ghostWidthPx,
		canShowGhost,
		onMouseEnter,
		onMouseMove,
		onMouseLeave,
		onMouseDown,
		onClick,
	};
}
