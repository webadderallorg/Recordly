import { type MouseEvent, useCallback, useState } from "react";
import {
	type ClipPresentation,
	getPlayheadDisplayTime,
	getTimeAtClipSeam,
} from "../../core/clipPresentation";
import { DEFAULT_ZOOM_BLOCK_DURATION_MS } from "../../core/constants";
import { DEFAULT_CAPTION_DURATION_MS } from "../../hooks/actions/useTimelineCaptionActions";
import { useTimelineLaneHover } from "./useTimelineLaneHover";

interface TimelineHoverParams {
	clipPresentation: ClipPresentation[];
	direction: string;
	sidebarWidth: number;
	rangeStart: number;
	rangeEnd: number;
	videoDurationMs: number;
	zoomQuickAddEnabled?: boolean;
	onAddZoomAtMs?: (startMs: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	onAddCaptionAtMs?: (startMs: number) => void;
	canPlaceCaptionAtMs?: (startMs: number) => boolean;
	resolveCaptionSpanAtMs?: (startMs: number) => { start: number; end: number } | null;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	isDragging: boolean;
	valueToPixels: (value: number) => number;
}

export function useTimelineHover({
	clipPresentation,
	direction,
	sidebarWidth,
	rangeStart,
	rangeEnd,
	videoDurationMs,
	zoomQuickAddEnabled = true,
	onAddZoomAtMs,
	canPlaceZoomAtMs,
	onAddCaptionAtMs,
	canPlaceCaptionAtMs,
	resolveCaptionSpanAtMs,
	captionsEnabled,
	captionQuickAddEnabled = true,
	isDragging,
	valueToPixels,
}: TimelineHoverParams) {
	const [isTimelineHovered, setIsTimelineHovered] = useState(false);
	const [timelineHoverMs, setTimelineHoverMs] = useState<number | null>(null);

	const visibleDurationMs = Math.max(1, rangeEnd - rangeStart);

	const updateTimelineHoverTime = useCallback(
		(clientX: number, rect: DOMRect) => {
			const contentWidth = Math.max(1, rect.width - sidebarWidth);
			const contentX =
				direction === "rtl"
					? rect.right - sidebarWidth - clientX
					: clientX - rect.left - sidebarWidth;
			const clampedX = Math.max(0, Math.min(contentX, contentWidth));
			const ratio = clampedX / contentWidth;
			const nextMs = rangeStart + ratio * visibleDurationMs;
			setTimelineHoverMs(
				getTimeAtClipSeam(Math.max(0, Math.min(nextMs, videoDurationMs)), clipPresentation),
			);
		},
		[direction, rangeStart, sidebarWidth, videoDurationMs, visibleDurationMs, clipPresentation],
	);

	const handleTimelineMouseEnter = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			setIsTimelineHovered(true);
			updateTimelineHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[updateTimelineHoverTime],
	);

	const handleTimelineMouseMove = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!isTimelineHovered) setIsTimelineHovered(true);
			updateTimelineHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[isTimelineHovered, updateTimelineHoverTime],
	);

	const zoom = useTimelineLaneHover({
		clipPresentation,
		direction,
		rangeStart,
		visibleDurationMs,
		videoDurationMs,
		valueToPixels,
		ghostDurationMs: Math.min(DEFAULT_ZOOM_BLOCK_DURATION_MS, videoDurationMs),
		enabled: zoomQuickAddEnabled,
		isDragging,
		onAddAtMs: onAddZoomAtMs,
		canPlaceAtMs: canPlaceZoomAtMs,
	});

	const caption = useTimelineLaneHover({
		clipPresentation,
		direction,
		rangeStart,
		visibleDurationMs,
		videoDurationMs,
		valueToPixels,
		ghostDurationMs: Math.min(DEFAULT_CAPTION_DURATION_MS, videoDurationMs),
		enabled: Boolean(captionsEnabled) && captionQuickAddEnabled,
		isDragging,
		onAddAtMs: onAddCaptionAtMs,
		canPlaceAtMs: canPlaceCaptionAtMs,
		resolveGhostSpanMs: resolveCaptionSpanAtMs,
	});

	const handleTimelineMouseLeave = useCallback(() => {
		setIsTimelineHovered(false);
		setTimelineHoverMs(null);
		zoom.reset();
		caption.reset();
	}, [zoom.reset, caption.reset]);

	const timelineGhostOffsetPx =
		timelineHoverMs === null
			? 0
			: valueToPixels(
					Math.max(
						0,
						getPlayheadDisplayTime(timelineHoverMs, clipPresentation) - rangeStart,
					),
				);
	const canShowGhostPlayhead = isTimelineHovered && timelineHoverMs !== null;

	return {
		canShowGhostPlayhead,
		timelineGhostOffsetPx,
		handleTimelineMouseEnter,
		handleTimelineMouseMove,
		handleTimelineMouseLeave,
		canShowGhostZoom: zoom.canShowGhost,
		ghostStartMs: zoom.ghostStartMs,
		ghostWidthPx: zoom.ghostWidthPx,
		handleZoomRowMouseEnter: zoom.onMouseEnter,
		handleZoomRowMouseMove: zoom.onMouseMove,
		handleZoomRowMouseLeave: zoom.onMouseLeave,
		// Let the empty auto-zoom lane use the canvas's click/drag seeking.
		handleZoomRowMouseDown: zoomQuickAddEnabled ? zoom.onMouseDown : undefined,
		handleZoomRowClick: zoomQuickAddEnabled ? zoom.onClick : undefined,
		canShowGhostCaption: caption.canShowGhost,
		captionGhostStartMs: caption.ghostStartMs,
		captionGhostWidthPx: caption.ghostWidthPx,
		handleCaptionRowMouseEnter: caption.onMouseEnter,
		handleCaptionRowMouseMove: caption.onMouseMove,
		handleCaptionRowMouseLeave: caption.onMouseLeave,
		handleCaptionRowMouseDown: caption.onMouseDown,
		handleCaptionRowClick: caption.onClick,
	};
}
