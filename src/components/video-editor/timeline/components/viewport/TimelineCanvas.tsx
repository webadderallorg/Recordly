import { useTimelineContext } from "dnd-timeline";
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getTimeAtClipSeam } from "../../core/clipPresentation";
import { ZOOM_ROW_ID } from "../../core/constants";
import { isAnnotationTrackRowId, isAudioTrackRowId } from "../../core/rows";
import { useTimelinePresentation } from "../../core/TimelinePresentation";
import {
	getTimelineContentMinHeightPx,
	getTimelineRowsMinHeightPx,
	TIMELINE_AXIS_HEIGHT_PX,
} from "../../timelineLayout";
import PlaybackCursor from "../playhead/PlaybackCursor";
import { TimelineCanvasRows } from "./TimelineCanvasRows";
import type { TimelineCanvasProps } from "./TimelineCanvasTypes";
import { useTimelineHover } from "./useTimelineHover";
export default function TimelineCanvas({
	videoPath,
	items,
	videoDurationMs,
	currentTimeMs,
	onSeek,
	onApplyAutoZooms,
	onAddZoomAtMs,
	canPlaceZoomAtMs,
	onAddCaptionAtMs,
	canPlaceCaptionAtMs,
	resolveCaptionSpanAtMs,
	captionsEnabled,
	captionQuickAddEnabled,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCaption,
	selectedZoomId,
	selectedClipId,
	selectedClipIds,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	selectAllBlocksActive = false,
	onClearBlockSelection,
	keyframes = [],
	sourceAudioTracks = [],
	getSourceAudioTrackSettingsForClip,
	showSourceAudioTrack = false,
	liveSpanPreviewById,
	liveHiddenItemIds,
	isDragging = false,
	isLoading = false,
}: TimelineCanvasProps) {
	const { setTimelineRef, style, sidebarWidth, direction, range, valueToPixels, pixelsToValue } =
		useTimelineContext();
	const { clips: clipPresentation } = useTimelinePresentation();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);
	const [isSeeking, setIsSeeking] = useState(false);
	const [autoZoomDismissal, setAutoZoomDismissal] = useState<{
		videoPath: typeof videoPath;
	} | null>(null);
	const autoZoomsDismissed = Boolean(
		autoZoomDismissal && autoZoomDismissal.videoPath === videoPath,
	);
	const handleDismissAutoZooms = useCallback(() => {
		setAutoZoomDismissal({ videoPath });
	}, [videoPath]);
	const seekRafRef = useRef<number | null>(null);
	const pendingSeekClientXRef = useRef<number | null>(null);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setTimelineRef(node);
			localTimelineRef.current = node;
		},
		[setTimelineRef],
	);

	const handleTimelineClick = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			if (isSeeking || (e.target as Element).closest("[data-timeline-item]")) return;
			if (!onSeek || videoDurationMs <= 0) return;

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
				onSelectCaption?.(null);
			}

			const rect = e.currentTarget.getBoundingClientRect();
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - e.clientX
					: e.clientX - rect.left - sidebarWidth;
			if (clickX < 0) return;
			const relativeMs = pixelsToValue(clickX);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
			onSeek(getTimeAtClipSeam(absoluteMs, clipPresentation) / 1000);
		},
		[
			isSeeking,
			clipPresentation,
			onSeek,
			onSelectZoom,
			onSelectClip,
			onSelectAnnotation,
			onSelectAudio,
			onSelectCaption,
			onClearBlockSelection,
			videoDurationMs,
			sidebarWidth,
			direction,
			range.start,
			pixelsToValue,
		],
	);

	const getAbsoluteMsFromClientX = useCallback(
		(clientX: number, rect: DOMRect) => {
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - clientX
					: clientX - rect.left - sidebarWidth;
			const relativeMs = pixelsToValue(clickX);
			return getTimeAtClipSeam(
				Math.max(0, Math.min(range.start + relativeMs, videoDurationMs)),
				clipPresentation,
			);
		},
		[direction, pixelsToValue, range.start, sidebarWidth, videoDurationMs, clipPresentation],
	);

	const handleTimelineMouseDown = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			if (e.button !== 0 || !onSeek || videoDurationMs <= 0 || !localTimelineRef.current)
				return;
			if ((e.target as HTMLElement).closest("[data-timeline-item]")) {
				return;
			}

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
				onSelectCaption?.(null);
			}

			const rect = localTimelineRef.current.getBoundingClientRect();
			onSeek(getAbsoluteMsFromClientX(e.clientX, rect) / 1000);
			setIsSeeking(true);
			e.preventDefault();
		},
		[
			getAbsoluteMsFromClientX,
			onClearBlockSelection,
			onSeek,
			onSelectAnnotation,
			onSelectAudio,
			onSelectCaption,
			onSelectClip,
			onSelectZoom,
			videoDurationMs,
		],
	);

	useEffect(() => {
		if (!isSeeking) return;

		const flushSeek = () => {
			seekRafRef.current = null;
			if (!onSeek || !localTimelineRef.current || pendingSeekClientXRef.current === null)
				return;
			const rect = localTimelineRef.current.getBoundingClientRect();
			onSeek(getAbsoluteMsFromClientX(pendingSeekClientXRef.current, rect) / 1000);
		};

		const handleMouseMove = (event: globalThis.MouseEvent) => {
			pendingSeekClientXRef.current = event.clientX;
			if (seekRafRef.current === null) {
				seekRafRef.current = requestAnimationFrame(flushSeek);
			}
		};

		const handleMouseUp = () => {
			if (seekRafRef.current !== null) {
				cancelAnimationFrame(seekRafRef.current);
				seekRafRef.current = null;
			}
			if (pendingSeekClientXRef.current !== null) {
				flushSeek();
			}
			pendingSeekClientXRef.current = null;
			setIsSeeking(false);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);

		return () => {
			if (seekRafRef.current !== null) {
				cancelAnimationFrame(seekRafRef.current);
				seekRafRef.current = null;
			}
			pendingSeekClientXRef.current = null;
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [getAbsoluteMsFromClientX, isSeeking, onSeek]);

	const timelineRowCount = useMemo(() => {
		const annotationRowIds = new Set<string>();
		const audioRowIds = new Set<string>();
		for (const item of items) {
			if (isAnnotationTrackRowId(item.rowId)) annotationRowIds.add(item.rowId);
			if (isAudioTrackRowId(item.rowId)) audioRowIds.add(item.rowId);
		}
		const sourceAudioRows = showSourceAudioTrack ? sourceAudioTracks.length : 0;
		return 2 + sourceAudioRows + annotationRowIds.size + audioRowIds.size;
	}, [items, showSourceAudioTrack, sourceAudioTracks.length]);
	const timelineRowsMinHeightPx = getTimelineRowsMinHeightPx(timelineRowCount);
	const timelineContentMinHeightPx = getTimelineContentMinHeightPx(timelineRowCount);
	const sideProperty = direction === "rtl" ? "right" : "left";
	const {
		canShowGhostPlayhead,
		timelineGhostOffsetPx,
		handleTimelineMouseEnter,
		handleTimelineMouseMove,
		handleTimelineMouseLeave,
		canShowGhostZoom,
		ghostStartMs,
		ghostWidthPx,
		handleZoomRowMouseEnter,
		handleZoomRowMouseMove,
		handleZoomRowMouseLeave,
		handleZoomRowMouseDown,
		handleZoomRowClick,
		canShowGhostCaption,
		captionGhostStartMs,
		captionGhostWidthPx,
		handleCaptionRowMouseEnter,
		handleCaptionRowMouseMove,
		handleCaptionRowMouseLeave,
		handleCaptionRowMouseDown,
		handleCaptionRowClick,
	} = useTimelineHover({
		clipPresentation,
		direction,
		sidebarWidth,
		rangeStart: range.start,
		rangeEnd: range.end,
		videoDurationMs,
		zoomQuickAddEnabled:
			autoZoomsDismissed ||
			!onApplyAutoZooms ||
			items.some((item) => item.rowId === ZOOM_ROW_ID),
		onAddZoomAtMs,
		canPlaceZoomAtMs,
		onAddCaptionAtMs,
		canPlaceCaptionAtMs,
		resolveCaptionSpanAtMs,
		captionsEnabled,
		captionQuickAddEnabled,
		isDragging,
		valueToPixels,
	});

	return (
		<div
			ref={setRefs}
			style={{
				...style,
				height: "100%",
				minHeight: timelineContentMinHeightPx,
				overflow: "visible",
			}}
			className="select-none bg-editor-bg relative cursor-pointer group flex flex-col"
			onMouseDown={handleTimelineMouseDown}
			onClick={handleTimelineClick}
			onMouseEnter={handleTimelineMouseEnter}
			onMouseMove={handleTimelineMouseMove}
			onMouseLeave={handleTimelineMouseLeave}
		>
			<div aria-hidden="true" style={{ height: TIMELINE_AXIS_HEIGHT_PX, flexShrink: 0 }} />
			<PlaybackCursor
				clips={clipPresentation}
				currentTimeMs={currentTimeMs}
				videoDurationMs={videoDurationMs}
				onSeek={onSeek}
				timelineRef={localTimelineRef}
				keyframes={keyframes}
				isLoading={isLoading}
			/>
			{canShowGhostPlayhead && (
				<div
					className="absolute top-0 bottom-0 z-[45] pointer-events-none"
					style={{
						[sideProperty === "right" ? "marginRight" : "marginLeft"]:
							`${sidebarWidth - 1}px`,
					}}
				>
					<div
						className="absolute top-0 bottom-0 w-px bg-foreground/35"
						style={{ [sideProperty]: `${timelineGhostOffsetPx}px` }}
					/>
				</div>
			)}

			<div
				className="relative z-10 flex flex-1 min-h-0 flex-col"
				style={{ minHeight: timelineRowsMinHeightPx }}
			>
				<TimelineCanvasRows
					onApplyAutoZooms={
						isLoading || autoZoomsDismissed ? undefined : onApplyAutoZooms
					}
					onDismissAutoZooms={handleDismissAutoZooms}
					videoPath={videoPath}
					items={items}
					videoDurationMs={videoDurationMs}
					selectAllBlocksActive={selectAllBlocksActive}
					selectedZoomId={selectedZoomId}
					selectedClipId={selectedClipId}
					selectedClipIds={selectedClipIds}
					selectedAnnotationId={selectedAnnotationId}
					selectedAudioId={selectedAudioId}
					selectedCaptionId={selectedCaptionId}
					onSelectZoom={onSelectZoom}
					onSelectClip={onSelectClip}
					onSelectAnnotation={onSelectAnnotation}
					onSelectAudio={onSelectAudio}
					onSelectCaption={onSelectCaption}
					sourceAudioTracks={sourceAudioTracks}
					getSourceAudioTrackSettingsForClip={getSourceAudioTrackSettingsForClip}
					showSourceAudioTrack={showSourceAudioTrack}
					liveSpanPreviewById={liveSpanPreviewById}
					liveHiddenItemIds={liveHiddenItemIds}
					direction={direction}
					canShowGhostZoom={canShowGhostZoom}
					ghostStartMs={ghostStartMs}
					ghostWidthPx={ghostWidthPx}
					onZoomRowMouseEnter={handleZoomRowMouseEnter}
					onZoomRowMouseMove={handleZoomRowMouseMove}
					onZoomRowMouseLeave={handleZoomRowMouseLeave}
					onZoomRowMouseDown={handleZoomRowMouseDown}
					onZoomRowClick={handleZoomRowClick}
					captionsEnabled={captionsEnabled}
					canShowGhostCaption={canShowGhostCaption}
					captionGhostStartMs={captionGhostStartMs}
					captionGhostWidthPx={captionGhostWidthPx}
					onCaptionRowMouseEnter={handleCaptionRowMouseEnter}
					onCaptionRowMouseMove={handleCaptionRowMouseMove}
					onCaptionRowMouseLeave={handleCaptionRowMouseLeave}
					onCaptionRowMouseDown={handleCaptionRowMouseDown}
					onCaptionRowClick={handleCaptionRowClick}
				/>
			</div>
		</div>
	);
}
