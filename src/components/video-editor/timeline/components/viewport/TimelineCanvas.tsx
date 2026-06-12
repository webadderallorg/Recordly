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
import type {
	SourceAudioTrackSettings,
	SourceAudioTrackWithPeaks,
} from "@/components/video-editor/audio/audioTypes";
import { cn } from "@/lib/utils";
import {
	CAMERA_ROW_ID,
	CLIP_ROW_ID,
	FILL_FRAME_ROW_ID,
	SOURCE_AUDIO_ROW_ID,
	ZOOM_ROW_ID,
} from "../../core/constants";
import {
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "../../core/rows";
import type { TimelineRenderItem } from "../../core/timelineTypes";
import { useTimelineAudioPeaks } from "../../hooks/useTimelineAudioPeaks";
import {
	buildMarqueeRect,
	exceedsMarqueeThreshold,
	type MarqueeRect,
	type MarqueeSelectedItem,
	resolveMarqueeSelection,
} from "../../hooks/utils/timelineMarqueeUtils";
import Item from "../../Item";
import glassStyles from "../../ItemGlass.module.css";
import Row from "../../Row";
import {
	countTimelineRows,
	getTimelineContentMinHeightPx,
	getTimelineRowsMinHeightPx,
} from "../../timelineLayout";
import TimelineAxis from "../axis/TimelineAxis";
import ClipMarkerOverlay from "../overlays/ClipMarkerOverlay";
import PlaybackCursor from "../playhead/PlaybackCursor";

const HINT_CLIP = "Press B to split clip";
const HINT_ANNOTATION = "Press A to add annotation";
const HINT_AUDIO = "Click music icon to add audio";

const EMPTY_MULTI_SELECTED_IDS: ReadonlySet<string> = new Set();

interface TimelineCanvasProps {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	canPlaceZoomAtMs?: (startMs: number) => boolean;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCamera?: (id: string | null) => void;
	onSelectFillFrame?: (id: string | null) => void;
	onAddZoomAtMs?: (startMs: number) => void;
	onFillFrameAddAtMs?: (startMs: number) => void;
	onMarqueeSelect?: (items: MarqueeSelectedItem[]) => void;
	multiSelectedIds?: ReadonlySet<string>;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCameraId?: string | null;
	selectedFillFrameId?: string | null;
	showCameraTrack?: boolean;
	showFillFrameTrack?: boolean;
	cameraRegionsDimmed?: boolean;
	selectAllBlocksActive?: boolean;
	onClearBlockSelection?: () => void;
	keyframes?: { id: string; time: number }[];
	sourceAudioTracks?: SourceAudioTrackWithPeaks[];
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	showSourceAudioTrack?: boolean;
	liveSpanPreviewById?: Record<string, { start: number; end: number }>;
	liveHiddenItemIds?: string[];
	isLoading?: boolean;
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

	const handleZoomRowMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
		event.stopPropagation();
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
		handleZoomRowMouseDown,
		handleZoomRowClick,
	};
}

interface TimelineCanvasRowsProps {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	selectAllBlocksActive: boolean;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCameraId?: string | null;
	selectedFillFrameId?: string | null;
	showCameraTrack?: boolean;
	showFillFrameTrack?: boolean;
	cameraRegionsDimmed?: boolean;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCamera?: (id: string | null) => void;
	onSelectFillFrame?: (id: string | null) => void;
	onFillFrameRowDoubleClick?: MouseEventHandler<HTMLDivElement>;
	multiSelectedIds: ReadonlySet<string>;
	sourceAudioTracks?: SourceAudioTrackWithPeaks[];
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	showSourceAudioTrack?: boolean;
	liveSpanPreviewById?: Record<string, { start: number; end: number }>;
	liveHiddenItemIds?: string[];
	direction: string;
	canShowGhostZoom: boolean;
	ghostStartMs: number | null;
	ghostStartOffsetPx: number;
	ghostWidthPx: number;
	onZoomRowMouseEnter: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseMove: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseLeave: MouseEventHandler<HTMLDivElement>;
	onZoomRowMouseDown: MouseEventHandler<HTMLDivElement>;
	onZoomRowClick: MouseEventHandler<HTMLDivElement>;
}

interface AudioItemWithWaveformProps {
	item: TimelineRenderItem;
	span: { start: number; end: number };
	waveformSpan: { start: number; end: number };
	isSelected: boolean;
	onSelectAudio?: (id: string | null) => void;
}

function AudioItemWithWaveform({
	item,
	span,
	waveformSpan,
	isSelected,
	onSelectAudio,
}: AudioItemWithWaveformProps) {
	const { peaks } = useTimelineAudioPeaks(item.audioPath ?? null);
	const normalizedWaveformSpan = useMemo(() => {
		const duration = Math.max(0, waveformSpan.end - waveformSpan.start);
		return { start: 0, end: duration };
	}, [waveformSpan.end, waveformSpan.start]);
	return (
		<Item
			id={item.id}
			rowId={item.rowId}
			span={span}
			isSelected={isSelected}
			onSelectId={onSelectAudio}
			variant="audio"
			waveformPeaks={peaks}
			waveformSegmentSpan={normalizedWaveformSpan}
			waveformGain={Math.max(0, Math.min(1, item.audioGain ?? 1))}
			waveformNormalize={Boolean(item.audioNormalize)}
		>
			{item.label}
		</Item>
	);
}

const TimelineCanvasRows = memo(function TimelineCanvasRows({
	items,
	videoDurationMs,
	selectAllBlocksActive,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCameraId,
	selectedFillFrameId,
	showCameraTrack = false,
	showFillFrameTrack = false,
	cameraRegionsDimmed = false,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCamera,
	onSelectFillFrame,
	onFillFrameRowDoubleClick,
	multiSelectedIds,
	sourceAudioTracks = [],
	getSourceAudioTrackSettingsForClip,
	showSourceAudioTrack = false,
	liveSpanPreviewById,
	liveHiddenItemIds,
	direction,
	canShowGhostZoom,
	ghostStartMs,
	ghostStartOffsetPx,
	ghostWidthPx,
	onZoomRowMouseEnter,
	onZoomRowMouseMove,
	onZoomRowMouseLeave,
	onZoomRowMouseDown,
	onZoomRowClick,
}: TimelineCanvasRowsProps) {
	const hiddenIds = useMemo(() => new Set(liveHiddenItemIds ?? []), [liveHiddenItemIds]);
	const { clipItems, zoomItems, cameraItems, fillFrameItems, annotationRows, audioRows } =
		useMemo(() => {
			const nextClipItems: TimelineRenderItem[] = [];
			const nextZoomItems: TimelineRenderItem[] = [];
			const nextCameraItems: TimelineRenderItem[] = [];
			const nextFillFrameItems: TimelineRenderItem[] = [];
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
				if (item.rowId === CAMERA_ROW_ID) {
					nextCameraItems.push(item);
					continue;
				}
				if (item.rowId === FILL_FRAME_ROW_ID) {
					nextFillFrameItems.push(item);
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
				cameraItems: nextCameraItems,
				fillFrameItems: nextFillFrameItems,
				annotationRows: annotationRowsSorted,
				audioRows: audioRowsSorted,
			};
		}, [items]);

	return (
		<>
			<Row id={CLIP_ROW_ID} isEmpty={clipItems.length === 0} hint={HINT_CLIP}>
				<ClipMarkerOverlay videoDurationMs={videoDurationMs} />
				{clipItems.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={item.id === selectedClipId}
						onSelectId={onSelectClip}
						variant="clip"
						speedValue={item.speedValue}
					>
						{item.label}
					</Item>
				))}
			</Row>
			{showSourceAudioTrack &&
				sourceAudioTracks.map((track) => (
					<Row key={track.id} id={`${SOURCE_AUDIO_ROW_ID}-${track.id}`}>
						{clipItems
							.filter((item) => item.showSourceAudio)
							.map((item) => {
								const settings = getSourceAudioTrackSettingsForClip?.(item.id)?.[
									track.id
								] ?? { volume: 1, normalize: false };
								return (
									<Item
										key={`source-audio-${track.id}-${item.id}`}
										id={`source-audio-${track.id}-${item.id}`}
										rowId={`${SOURCE_AUDIO_ROW_ID}-${track.id}`}
										span={liveSpanPreviewById?.[item.id] ?? item.span}
										disabled
										isSelected={item.id === selectedClipId}
										onSelect={() => onSelectClip?.(item.id)}
										variant="audio"
										waveformPeaks={track.peaks}
										waveformSegmentSpan={item.sourceSpan ?? item.span}
										waveformGain={Math.max(0, Math.min(1, settings.volume))}
										waveformNormalize={Boolean(settings.normalize)}
										muted={item.muted}
									>
										{track.label}
									</Item>
								);
							})}
					</Row>
				))}

			{showCameraTrack && (
				<Row id={CAMERA_ROW_ID} slim isEmpty={cameraItems.length === 0}>
					{cameraItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={
								item.id === selectedCameraId || multiSelectedIds.has(item.id)
							}
							onSelectId={onSelectCamera}
							variant="camera"
							dimmed={cameraRegionsDimmed}
						>
							{item.label}
						</Item>
					))}
				</Row>
			)}

			{showFillFrameTrack && (
				<Row
					id={FILL_FRAME_ROW_ID}
					slim
					isEmpty={fillFrameItems.length === 0}
					onDoubleClick={onFillFrameRowDoubleClick}
				>
					{fillFrameItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={
								item.id === selectedFillFrameId || multiSelectedIds.has(item.id)
							}
							onSelectId={onSelectFillFrame}
							variant="fillFrame"
						>
							{item.label}
						</Item>
					))}
				</Row>
			)}

			<Row
				id={ZOOM_ROW_ID}
				isEmpty={zoomItems.length === 0}
				onMouseEnter={onZoomRowMouseEnter}
				onMouseMove={onZoomRowMouseMove}
				onMouseLeave={onZoomRowMouseLeave}
				onMouseDown={onZoomRowMouseDown}
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
				{zoomItems
					.filter((item) => !hiddenIds.has(item.id))
					.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={
								selectAllBlocksActive ||
								item.id === selectedZoomId ||
								multiSelectedIds.has(item.id)
							}
							onSelectId={onSelectZoom}
							zoomDepth={item.zoomDepth}
							zoomMode={item.zoomMode}
							variant="zoom"
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
							isSelected={
								item.id === selectedAnnotationId || multiSelectedIds.has(item.id)
							}
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
						<AudioItemWithWaveform
							key={item.id}
							item={item}
							span={item.span}
							waveformSpan={liveSpanPreviewById?.[item.id] ?? item.span}
							isSelected={item.id === selectedAudioId}
							onSelectAudio={onSelectAudio}
						/>
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
	onFillFrameAddAtMs,
	onMarqueeSelect,
	multiSelectedIds = EMPTY_MULTI_SELECTED_IDS,
	canPlaceZoomAtMs,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCamera,
	onSelectFillFrame,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCameraId,
	selectedFillFrameId,
	showCameraTrack = false,
	showFillFrameTrack = false,
	cameraRegionsDimmed = false,
	selectAllBlocksActive = false,
	onClearBlockSelection,
	keyframes = [],
	sourceAudioTracks = [],
	getSourceAudioTrackSettingsForClip,
	showSourceAudioTrack = false,
	liveSpanPreviewById,
	liveHiddenItemIds,
	isLoading = false,
}: TimelineCanvasProps) {
	const { setTimelineRef, style, sidebarWidth, direction, range, valueToPixels, pixelsToValue } =
		useTimelineContext();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);
	const [isSeeking, setIsSeeking] = useState(false);
	const seekRafRef = useRef<number | null>(null);
	const pendingSeekClientXRef = useRef<number | null>(null);
	// Marquee (box) selection over empty viewport space below the ruler.
	const [isMarqueePending, setIsMarqueePending] = useState(false);
	const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
	const marqueeAnchorRef = useRef<{ x: number; y: number } | null>(null);
	const marqueeClientRectRef = useRef<MarqueeRect | null>(null);
	const isMarqueeActiveRef = useRef(false);
	const suppressNextClickRef = useRef(false);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setTimelineRef(node);
			localTimelineRef.current = node;
		},
		[setTimelineRef],
	);

	const handleTimelineClick = useCallback(
		(e: MouseEvent<HTMLDivElement>) => {
			// A marquee release also dispatches a click on the canvas; it must
			// not seek or clear the selection that was just applied.
			if (suppressNextClickRef.current) {
				suppressNextClickRef.current = false;
				return;
			}
			if (isSeeking) return;
			if (!onSeek || videoDurationMs <= 0) return;

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
				onSelectCamera?.(null);
				onSelectFillFrame?.(null);
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
			onSelectCamera,
			onSelectFillFrame,
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
			if (e.button !== 0 || !localTimelineRef.current) return;
			const target = e.target as HTMLElement;
			if (target.closest("[data-timeline-item]")) {
				return;
			}
			suppressNextClickRef.current = false;

			// Empty viewport space below the ruler arms the marquee; a plain
			// click (released within the drag threshold) falls through to the
			// click handler, which seeks and clears the selection as before.
			if (!target.closest("[data-timeline-axis]")) {
				marqueeAnchorRef.current = { x: e.clientX, y: e.clientY };
				marqueeClientRectRef.current = null;
				isMarqueeActiveRef.current = false;
				setIsMarqueePending(true);
				e.preventDefault();
				return;
			}

			if (!onSeek || videoDurationMs <= 0) return;

			if (onClearBlockSelection) {
				onClearBlockSelection();
			} else {
				onSelectZoom?.(null);
				onSelectClip?.(null);
				onSelectAnnotation?.(null);
				onSelectAudio?.(null);
				onSelectCamera?.(null);
				onSelectFillFrame?.(null);
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
			onSelectCamera,
			onSelectClip,
			onSelectFillFrame,
			onSelectZoom,
			videoDurationMs,
		],
	);

	useEffect(() => {
		if (!isMarqueePending) return;

		const handleMouseMove = (event: globalThis.MouseEvent) => {
			const anchor = marqueeAnchorRef.current;
			const container = localTimelineRef.current;
			if (!anchor || !container) return;
			const current = { x: event.clientX, y: event.clientY };
			if (!isMarqueeActiveRef.current) {
				if (!exceedsMarqueeThreshold(anchor, current)) return;
				isMarqueeActiveRef.current = true;
			}
			const clientRect = buildMarqueeRect(anchor, current);
			marqueeClientRectRef.current = clientRect;
			// Clamp the rendered rect to the canvas so dragging past its edges
			// never grows the scrollable area.
			const containerRect = container.getBoundingClientRect();
			const localLeft = Math.max(0, clientRect.left - containerRect.left);
			const localTop = Math.max(0, clientRect.top - containerRect.top);
			const localRight = Math.min(
				containerRect.width,
				clientRect.left + clientRect.width - containerRect.left,
			);
			const localBottom = Math.min(
				containerRect.height,
				clientRect.top + clientRect.height - containerRect.top,
			);
			setMarqueeRect({
				left: localLeft,
				top: localTop,
				width: Math.max(0, localRight - localLeft),
				height: Math.max(0, localBottom - localTop),
			});
		};

		const handleMouseUp = () => {
			const container = localTimelineRef.current;
			const clientRect = marqueeClientRectRef.current;
			if (isMarqueeActiveRef.current && clientRect && container) {
				const nodes = container.querySelectorAll<HTMLElement>("[data-timeline-item-id]");
				const candidates = Array.from(nodes).map((node) => {
					const rect = node.getBoundingClientRect();
					return {
						id: node.dataset.timelineItemId ?? "",
						kind: node.dataset.timelineItemKind ?? "",
						rect: {
							left: rect.left,
							top: rect.top,
							width: rect.width,
							height: rect.height,
						},
					};
				});
				onMarqueeSelect?.(resolveMarqueeSelection(candidates, clientRect));
				suppressNextClickRef.current = true;
			}
			marqueeAnchorRef.current = null;
			marqueeClientRectRef.current = null;
			isMarqueeActiveRef.current = false;
			setMarqueeRect(null);
			setIsMarqueePending(false);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);

		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [isMarqueePending, onMarqueeSelect]);

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

	const timelineRowCount = useMemo(
		() =>
			countTimelineRows(items, {
				showCameraTrack,
				showFillFrameTrack,
				showSourceAudioTrack,
				sourceAudioTrackCount: sourceAudioTracks.length,
			}),
		[
			items,
			showCameraTrack,
			showFillFrameTrack,
			showSourceAudioTrack,
			sourceAudioTracks.length,
		],
	);
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
		ghostStartOffsetPx,
		ghostWidthPx,
		handleZoomRowMouseEnter,
		handleZoomRowMouseMove,
		handleZoomRowMouseLeave,
		handleZoomRowMouseDown,
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

	// Mirrors the zoom row's hover-ms math: maps the double-click offset within
	// the fill-frame row to an absolute timeline ms, ignoring existing regions.
	const handleFillFrameRowDoubleClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			event.stopPropagation();
			if (!onFillFrameAddAtMs) return;
			const rect = event.currentTarget.getBoundingClientRect();
			if (rect.width <= 0) return;
			const position =
				direction === "rtl"
					? Math.max(0, Math.min(rect.right - event.clientX, rect.width))
					: Math.max(0, Math.min(event.clientX - rect.left, rect.width));
			const ratio = position / rect.width;
			const visibleDurationMs = Math.max(1, range.end - range.start);
			const startMs = Math.max(
				0,
				Math.min(range.start + ratio * visibleDurationMs, videoDurationMs),
			);
			const insideExisting = items.some(
				(item) =>
					item.rowId === FILL_FRAME_ROW_ID &&
					startMs >= item.span.start &&
					startMs < item.span.end,
			);
			if (insideExisting) return;
			onFillFrameAddAtMs(startMs);
		},
		[direction, items, onFillFrameAddAtMs, range.end, range.start, videoDurationMs],
	);

	return (
		<div
			ref={setRefs}
			style={{
				...style,
				height: `max(100%, ${timelineContentMinHeightPx}px)`,
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
				isLoading={isLoading}
			/>
			{marqueeRect && (
				<div
					className="absolute z-[55] pointer-events-none bg-[#2563EB]/15 ring-1 ring-[#2563EB]/60"
					style={{
						left: `${marqueeRect.left}px`,
						top: `${marqueeRect.top}px`,
						width: `${marqueeRect.width}px`,
						height: `${marqueeRect.height}px`,
					}}
				/>
			)}
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
					selectedClipId={selectedClipId}
					selectedAnnotationId={selectedAnnotationId}
					selectedAudioId={selectedAudioId}
					selectedCameraId={selectedCameraId}
					selectedFillFrameId={selectedFillFrameId}
					showCameraTrack={showCameraTrack}
					showFillFrameTrack={showFillFrameTrack}
					cameraRegionsDimmed={cameraRegionsDimmed}
					onSelectZoom={onSelectZoom}
					onSelectClip={onSelectClip}
					onSelectAnnotation={onSelectAnnotation}
					onSelectAudio={onSelectAudio}
					onSelectCamera={onSelectCamera}
					onSelectFillFrame={onSelectFillFrame}
					onFillFrameRowDoubleClick={handleFillFrameRowDoubleClick}
					multiSelectedIds={multiSelectedIds}
					sourceAudioTracks={sourceAudioTracks}
					getSourceAudioTrackSettingsForClip={getSourceAudioTrackSettingsForClip}
					showSourceAudioTrack={showSourceAudioTrack}
					liveSpanPreviewById={liveSpanPreviewById}
					liveHiddenItemIds={liveHiddenItemIds}
					direction={direction}
					canShowGhostZoom={canShowGhostZoom}
					ghostStartMs={ghostStartMs}
					ghostStartOffsetPx={ghostStartOffsetPx}
					ghostWidthPx={ghostWidthPx}
					onZoomRowMouseEnter={handleZoomRowMouseEnter}
					onZoomRowMouseMove={handleZoomRowMouseMove}
					onZoomRowMouseLeave={handleZoomRowMouseLeave}
					onZoomRowMouseDown={handleZoomRowMouseDown}
					onZoomRowClick={handleZoomRowClick}
				/>
			</div>
		</div>
	);
}
