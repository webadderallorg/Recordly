import { Plus } from "@phosphor-icons/react";
import { useTimelineContext } from "dnd-timeline";
import {
	type MouseEvent,
	type MouseEventHandler,
	memo,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";
import { CLIP_ROW_ID, TRIM_ROW_ID, ZOOM_ROW_ID } from "../../core/constants";
import {
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "../../core/rows";
import type { AudioPeaksData, TimelineRenderItem } from "../../core/timelineTypes";
import Item from "../../Item";
import glassStyles from "../../ItemGlass.module.css";
import Row from "../../Row";
import {
	getTimelineContentMinHeightPx,
	getTimelineRowsMinHeightPx,
	getTimelineViewportStretchFactor,
	TIMELINE_AXIS_HEIGHT_PX,
} from "../../timelineLayout";
import TimelineAxis from "../axis/TimelineAxis";
import ClipMarkerOverlay from "../overlays/ClipMarkerOverlay";
import PlaybackCursor from "../playhead/PlaybackCursor";
import AudioWaveform from "../waveform/AudioWaveform";

const HINT_CLIP = "Press C to split clip";
const HINT_TRIM = "Press T to add trim";
const HINT_ANNOTATION = "Press A to add annotation";
const HINT_AUDIO = "Click music icon to add audio";

interface TimelineCanvasProps {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	onSelectZoom?: (id: string | null) => void;
	onSelectTrim?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onAddZoomAtMs?: (startMs: number) => void;
	selectedZoomId: string | null;
	selectedTrimId?: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectAllBlocksActive?: boolean;
	onClearBlockSelection?: () => void;
	keyframes?: { id: string; time: number }[];
	audioPeaks?: AudioPeaksData | null;
}

interface TimelineHoverParams {
	direction: string;
	sidebarWidth: number;
	rangeStart: number;
	rangeEnd: number;
	videoDurationMs: number;
	onAddZoomAtMs?: (startMs: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	valueToPixels: (value: number) => number;
}

function useTimelineHover({
	direction,
	sidebarWidth,
	rangeStart,
	rangeEnd,
	videoDurationMs,
	onAddZoomAtMs,
	canPlaceZoomAtMs,
	valueToPixels,
}: TimelineHoverParams) {
	const [isTimelineHovered, setIsTimelineHovered] = useState(false);
	const [timelineHoverMs, setTimelineHoverMs] = useState<number | null>(null);
	const [isZoomRowHovered, setIsZoomRowHovered] = useState(false);
	const [zoomRowHoverMs, setZoomRowHoverMs] = useState<number | null>(null);

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
			setTimelineHoverMs(Math.max(0, Math.min(nextMs, videoDurationMs)));
		},
		[direction, rangeStart, sidebarWidth, videoDurationMs, visibleDurationMs],
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

	const handleTimelineMouseLeave = useCallback(() => {
		setIsTimelineHovered(false);
		setTimelineHoverMs(null);
		setIsZoomRowHovered(false);
		setZoomRowHoverMs(null);
	}, []);

	const updateZoomRowHoverTime = useCallback(
		(clientX: number, rect: DOMRect) => {
			if (rect.width <= 0) return;
			const position =
				direction === "rtl"
					? Math.max(0, Math.min(rect.right - clientX, rect.width))
					: Math.max(0, Math.min(clientX - rect.left, rect.width));
			const ratio = position / rect.width;
			const nextMs = rangeStart + ratio * visibleDurationMs;
			setZoomRowHoverMs(Math.max(0, Math.min(nextMs, videoDurationMs)));
		},
		[direction, rangeStart, videoDurationMs, visibleDurationMs],
	);

	const handleZoomRowMouseEnter = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			setIsZoomRowHovered(true);
			updateZoomRowHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[updateZoomRowHoverTime],
	);

	const handleZoomRowMouseMove = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (!isZoomRowHovered) setIsZoomRowHovered(true);
			updateZoomRowHoverTime(event.clientX, event.currentTarget.getBoundingClientRect());
		},
		[isZoomRowHovered, updateZoomRowHoverTime],
	);

	const handleZoomRowMouseLeave = useCallback(() => {
		setIsZoomRowHovered(false);
		setZoomRowHoverMs(null);
	}, []);

	const handleZoomRowClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			if (!onAddZoomAtMs || zoomRowHoverMs === null) return;
			const startMs = Math.max(0, Math.min(zoomRowHoverMs, videoDurationMs));
			if (canPlaceZoomAtMs && !canPlaceZoomAtMs(startMs)) return;
			onAddZoomAtMs(startMs);
		},
		[canPlaceZoomAtMs, onAddZoomAtMs, videoDurationMs, zoomRowHoverMs],
	);

	const ghostStartMs =
		zoomRowHoverMs === null ? null : Math.max(0, Math.min(zoomRowHoverMs, videoDurationMs));
	const ghostDurationMs = Math.min(1000, videoDurationMs);
	const ghostEndMs =
		ghostStartMs === null
			? null
			: Math.max(ghostStartMs, Math.min(videoDurationMs, ghostStartMs + ghostDurationMs));
	const ghostStartOffsetPx =
		ghostStartMs === null ? 0 : valueToPixels(Math.max(0, ghostStartMs - rangeStart));
	const ghostEndOffsetPx =
		ghostEndMs === null ? 0 : valueToPixels(Math.max(0, ghostEndMs - rangeStart));
	const ghostWidthPx = Math.max(18, ghostEndOffsetPx - ghostStartOffsetPx);
	const timelineGhostOffsetPx =
		timelineHoverMs === null ? 0 : valueToPixels(Math.max(0, timelineHoverMs - rangeStart));
	const canShowGhostPlayhead = isTimelineHovered && timelineHoverMs !== null;
	const canShowGhostZoom =
		isZoomRowHovered &&
		ghostStartMs !== null &&
		(onAddZoomAtMs ? (canPlaceZoomAtMs?.(ghostStartMs) ?? true) : false);

	return {
		canShowGhostPlayhead,
		timelineGhostOffsetPx,
		handleTimelineMouseEnter,
		handleTimelineMouseMove,
		handleTimelineMouseLeave,
		canShowGhostZoom,
		ghostStartMs,
		ghostStartOffsetPx,
		ghostWidthPx,
		handleZoomRowMouseEnter,
		handleZoomRowMouseMove,
		handleZoomRowMouseLeave,
		handleZoomRowClick,
	};
}

interface TimelineCanvasRowsProps {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	selectAllBlocksActive: boolean;
	selectedZoomId: string | null;
	selectedTrimId?: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	onSelectZoom?: (id: string | null) => void;
	onSelectTrim?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	audioPeaks?: AudioPeaksData | null;
	direction: string;
	canShowGhostZoom: boolean;
	ghostStartMs: number | null;
	ghostStartOffsetPx: number;
	ghostWidthPx: number;
	onZoomRowMouseEnter: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseMove: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseLeave: MouseEventHandler<HTMLDivElement>;
	onZoomRowClick: MouseEventHandler<HTMLDivElement>;
}

const TimelineCanvasRows = memo(function TimelineCanvasRows({
	items,
	videoDurationMs,
	selectAllBlocksActive,
	selectedZoomId,
	selectedTrimId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	onSelectZoom,
	onSelectTrim,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	audioPeaks,
	direction,
	canShowGhostZoom,
	ghostStartMs,
	ghostStartOffsetPx,
	ghostWidthPx,
	onZoomRowMouseEnter,
	onZoomRowMouseMove,
	onZoomRowMouseLeave,
	onZoomRowClick,
}: TimelineCanvasRowsProps) {
	const { clipItems, zoomItems, trimItems, annotationRows, audioRows } = useMemo(() => {
		const nextClipItems: TimelineRenderItem[] = [];
		const nextZoomItems: TimelineRenderItem[] = [];
		const nextTrimItems: TimelineRenderItem[] = [];
		const annotationBuckets = new Map<number, TimelineRenderItem[]>();
		const audioBuckets = new Map<number, TimelineRenderItem[]>();

		for (const item of items) {
			if (item.rowId === CLIP_ROW_ID) {
				nextClipItems.push(item);
				continue;
			}
			if (item.rowId === ZOOM_ROW_ID) {
				nextZoomItems.push(item);
				continue;
			}
			if (item.rowId === TRIM_ROW_ID) {
				nextTrimItems.push(item);
				continue;
			}
			if (isAnnotationTrackRowId(item.rowId)) {
				const trackIndex = getAnnotationTrackIndex(item.rowId);
				const bucket = annotationBuckets.get(trackIndex);
				if (bucket) bucket.push(item);
				else annotationBuckets.set(trackIndex, [item]);
				continue;
			}
			if (isAudioTrackRowId(item.rowId)) {
				const trackIndex = getAudioTrackIndex(item.rowId);
				const bucket = audioBuckets.get(trackIndex);
				if (bucket) bucket.push(item);
				else audioBuckets.set(trackIndex, [item]);
			}
		}

		const annotationRowsSorted = Array.from(annotationBuckets.entries())
			.sort(([left], [right]) => left - right)
			.map(([trackIndex, rowItems]) => ({
				rowId: getAnnotationTrackRowId(trackIndex),
				items: rowItems,
			}));
		const audioRowsSorted = Array.from(audioBuckets.entries())
			.sort(([left], [right]) => left - right)
			.map(([trackIndex, rowItems]) => ({
				rowId: getAudioTrackRowId(trackIndex),
				items: rowItems,
			}));

		return {
			clipItems: nextClipItems,
			zoomItems: nextZoomItems,
			trimItems: nextTrimItems,
			annotationRows: annotationRowsSorted,
			audioRows: audioRowsSorted,
		};
	}, [items]);

	return (
		<>
			<Row id={CLIP_ROW_ID} isEmpty={clipItems.length === 0} hint={HINT_CLIP}>
				{audioPeaks && <AudioWaveform peaks={audioPeaks} />}
				<ClipMarkerOverlay videoDurationMs={videoDurationMs} />
				{clipItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectAllBlocksActive || item.id === selectedClipId}
						onSelectId={onSelectClip}
						variant="clip"
					>
						{item.label}
					</Item>
				))}
			</Row>

			<Row
				id={ZOOM_ROW_ID}
				isEmpty={zoomItems.length === 0}
				onMouseEnter={onZoomRowMouseEnter}
				onMouseMove={onZoomRowMouseMove}
				onMouseLeave={onZoomRowMouseLeave}
				onClick={onZoomRowClick}
			>
				{canShowGhostZoom && ghostStartMs !== null && (
					<div className="absolute inset-0 z-[3] pointer-events-none">
						<div
							className="absolute top-1/2 -translate-y-1/2 h-[85%] min-h-[22px]"
							style={
								direction === "rtl"
									? {
											right: `${ghostStartOffsetPx}px`,
											width: `${ghostWidthPx}px`,
										}
									: {
											left: `${ghostStartOffsetPx}px`,
											width: `${ghostWidthPx}px`,
										}
							}
						>
							<div
								className={cn(
									glassStyles.glassPurple,
									"w-full h-full overflow-hidden flex items-center justify-center cursor-default relative opacity-80",
								)}
							>
								<div className={cn(glassStyles.zoomEndCap, glassStyles.left)} />
								<div className={cn(glassStyles.zoomEndCap, glassStyles.right)} />
								<div className="relative z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/45 bg-white/15 text-white">
									<Plus className="h-2.5 w-2.5" />
								</div>
							</div>
						</div>
					</div>
				)}
				{zoomItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectAllBlocksActive || item.id === selectedZoomId}
						onSelectId={onSelectZoom}
						zoomDepth={item.zoomDepth}
						zoomMode={item.zoomMode}
						variant="zoom"
					>
						{item.label}
					</Item>
				))}
			</Row>

			<Row id={TRIM_ROW_ID} isEmpty={trimItems.length === 0} hint={HINT_TRIM}>
				{trimItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={selectAllBlocksActive || item.id === selectedTrimId}
						onSelectId={onSelectTrim}
						variant="trim"
					>
						{item.label}
					</Item>
				))}
			</Row>

			{annotationRows.map(({ rowId, items: rowItems }, index) => (
				<Row
					key={rowId}
					id={rowId}
					isEmpty={rowItems.length === 0}
					hint={index === 0 ? HINT_ANNOTATION : undefined}
				>
					{rowItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectAllBlocksActive || item.id === selectedAnnotationId}
							onSelectId={onSelectAnnotation}
							variant="annotation"
						>
							{item.label}
						</Item>
					))}
				</Row>
			))}

			{audioRows.map(({ rowId, items: rowItems }, index) => (
				<Row
					key={rowId}
					id={rowId}
					isEmpty={rowItems.length === 0}
					hint={index === 0 ? HINT_AUDIO : undefined}
				>
					{rowItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectAllBlocksActive || item.id === selectedAudioId}
							onSelectId={onSelectAudio}
							variant="audio"
						>
							{item.label}
						</Item>
					))}
				</Row>
			))}
		</>
	);
});

export default function TimelineCanvas({
	items,
	videoDurationMs,
	currentTimeMs,
	onSeek,
	onAddZoomAtMs,
	canPlaceZoomAtMs,
	onSelectZoom,
	onSelectTrim,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	selectedZoomId,
	selectedTrimId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectAllBlocksActive = false,
	onClearBlockSelection,
	keyframes = [],
	audioPeaks,
}: TimelineCanvasProps) {
	const { setTimelineRef, style, sidebarWidth, direction, range, valueToPixels, pixelsToValue } =
		useTimelineContext();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);
	const [isSeeking, setIsSeeking] = useState(false);
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
			if (isSeeking) return;
			if (!onSeek || videoDurationMs <= 0) return;

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
			}

			const rect = e.currentTarget.getBoundingClientRect();
			const clickX =
				direction === "rtl"
					? rect.right - sidebarWidth - e.clientX
					: e.clientX - rect.left - sidebarWidth;
			if (clickX < 0) return;
			const relativeMs = pixelsToValue(clickX);
			const absoluteMs = Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
			onSeek(absoluteMs / 1000);
		},
		[
			isSeeking,
			onSeek,
			onSelectZoom,
			onSelectClip,
			onSelectAnnotation,
			onSelectAudio,
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
			return Math.max(0, Math.min(range.start + relativeMs, videoDurationMs));
		},
		[direction, pixelsToValue, range.start, sidebarWidth, videoDurationMs],
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
		return 3 + annotationRowIds.size + audioRowIds.size;
	}, [items]);
	const timelineRowsMinHeightPx = getTimelineRowsMinHeightPx(timelineRowCount);
	const timelineContentMinHeightPx = getTimelineContentMinHeightPx(timelineRowCount);
	const timelineViewportStretchFactor = getTimelineViewportStretchFactor(timelineRowCount);
	const sideProperty = direction === "rtl" ? "right" : "left";
	const {
		canShowGhostPlayhead,
		timelineGhostOffsetPx,
		handleTimelineMouseEnter,
		handleTimelineMouseMove,
		handleTimelineMouseLeave,
		canShowGhostZoom,
		ghostStartMs,
		ghostStartOffsetPx,
		ghostWidthPx,
		handleZoomRowMouseEnter,
		handleZoomRowMouseMove,
		handleZoomRowMouseLeave,
		handleZoomRowClick,
	} = useTimelineHover({
		direction,
		sidebarWidth,
		rangeStart: range.start,
		rangeEnd: range.end,
		videoDurationMs,
		onAddZoomAtMs,
		canPlaceZoomAtMs,
		valueToPixels,
	});

	return (
		<div
			ref={setRefs}
			style={{
				...style,
				height: `max(100%, ${timelineContentMinHeightPx}px, calc(${TIMELINE_AXIS_HEIGHT_PX}px + (100% - ${TIMELINE_AXIS_HEIGHT_PX}px) * ${timelineViewportStretchFactor}))`,
			}}
			className="select-none bg-editor-bg relative cursor-pointer group flex flex-col"
			onMouseDown={handleTimelineMouseDown}
			onClick={handleTimelineClick}
			onMouseEnter={handleTimelineMouseEnter}
			onMouseMove={handleTimelineMouseMove}
			onMouseLeave={handleTimelineMouseLeave}
		>
			<TimelineAxis videoDurationMs={videoDurationMs} currentTimeMs={currentTimeMs} />
			<PlaybackCursor
				currentTimeMs={currentTimeMs}
				videoDurationMs={videoDurationMs}
				onSeek={onSeek}
				timelineRef={localTimelineRef}
				keyframes={keyframes}
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
					items={items}
					videoDurationMs={videoDurationMs}
					selectAllBlocksActive={selectAllBlocksActive}
					selectedZoomId={selectedZoomId}
					selectedTrimId={selectedTrimId}
					selectedClipId={selectedClipId}
					selectedAnnotationId={selectedAnnotationId}
					selectedAudioId={selectedAudioId}
					onSelectZoom={onSelectZoom}
					onSelectTrim={onSelectTrim}
					onSelectClip={onSelectClip}
					onSelectAnnotation={onSelectAnnotation}
					onSelectAudio={onSelectAudio}
					audioPeaks={audioPeaks}
					direction={direction}
					canShowGhostZoom={canShowGhostZoom}
					ghostStartMs={ghostStartMs}
					ghostStartOffsetPx={ghostStartOffsetPx}
					ghostWidthPx={ghostWidthPx}
					onZoomRowMouseEnter={handleZoomRowMouseEnter}
					onZoomRowMouseMove={handleZoomRowMouseMove}
					onZoomRowMouseLeave={handleZoomRowMouseLeave}
					onZoomRowClick={handleZoomRowClick}
				/>
			</div>
		</div>
	);
}
