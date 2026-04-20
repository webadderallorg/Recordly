import { useTimelineContext } from "dnd-timeline";
import { type MouseEvent as ReactMouseEvent, type RefObject, useCallback, useMemo, useRef } from "react";
import AudioWaveform from "../AudioWaveform";
import Item from "../Item";
import Row from "../Row";
import type { AudioPeaksData } from "../useAudioPeaks";
import { ClipMarkerOverlay, PlaybackCursor, TimelineAxis } from "./TimelineDecorations";
import {
	CLIP_ROW_ID,
	ZOOM_ROW_ID,
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
	type Keyframe,
	type TimelineRenderItem,
} from "./shared";

interface TimelineRowsProps {
	items: TimelineRenderItem[];
	videoDurationMs: number;
	currentTimeMs: number;
	onSeek?: (time: number) => void;
	onSelectZoom?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectAllBlocksActive?: boolean;
	onClearBlockSelection?: () => void;
	keyframes?: Keyframe[];
	audioPeaks?: AudioPeaksData | null;
}

export function TimelineRows({
	items,
	videoDurationMs,
	currentTimeMs,
	onSeek,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectAllBlocksActive = false,
	onClearBlockSelection,
	keyframes = [],
	audioPeaks,
}: TimelineRowsProps) {
	const { setTimelineRef, style, sidebarWidth, range, pixelsToValue } = useTimelineContext();
	const localTimelineRef = useRef<HTMLDivElement | null>(null);

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			setTimelineRef(node);
			localTimelineRef.current = node;
		},
		[setTimelineRef],
	);

	const handleTimelineClick = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			if (!onSeek || videoDurationMs <= 0) return;

			onSelectZoom?.(null);
			onSelectClip?.(null);
			onSelectAnnotation?.(null);
			onSelectAudio?.(null);
			onClearBlockSelection?.();

			const rect = event.currentTarget.getBoundingClientRect();
			const clickX = event.clientX - rect.left - sidebarWidth;
			if (clickX < 0) return;

			const absoluteMs = Math.max(
				0,
				Math.min(range.start + pixelsToValue(clickX), videoDurationMs),
			);
			onSeek(absoluteMs / 1000);
		},
		[
			onSeek,
			onSelectZoom,
			onSelectClip,
			onSelectAnnotation,
			onSelectAudio,
			onClearBlockSelection,
			videoDurationMs,
			sidebarWidth,
			range.start,
			pixelsToValue,
		],
	);

	const zoomItems = items.filter((item) => item.rowId === ZOOM_ROW_ID);
	const clipItems = items.filter((item) => item.rowId === CLIP_ROW_ID);
	const annotationItems = items.filter((item) => isAnnotationTrackRowId(item.rowId));
	const audioItems = items.filter((item) => isAudioTrackRowId(item.rowId));

	const audioRowIds = useMemo(
		() =>
			Array.from(
				new Set(audioItems.map((item) => getAudioTrackRowId(getAudioTrackIndex(item.rowId)))),
			).sort((left, right) => getAudioTrackIndex(left) - getAudioTrackIndex(right)),
		[audioItems],
	);

	const annotationRowIds = useMemo(
		() =>
			Array.from(
				new Set(
					annotationItems.map((item) =>
						getAnnotationTrackRowId(getAnnotationTrackIndex(item.rowId)),
					),
				),
			).sort((left, right) => getAnnotationTrackIndex(left) - getAnnotationTrackIndex(right)),
		[annotationItems],
	);

	return (
		<div
			ref={setRefs}
			style={style}
			className="select-none bg-editor-bg h-full min-h-0 relative cursor-pointer group flex flex-col"
			onClick={handleTimelineClick}
		>
			<div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--foreground)/0.03)_1px,transparent_1px)] bg-[length:20px_100%] pointer-events-none" />
			<TimelineAxis videoDurationMs={videoDurationMs} currentTimeMs={currentTimeMs} />
			<PlaybackCursor
				currentTimeMs={currentTimeMs}
				videoDurationMs={videoDurationMs}
				onSeek={onSeek}
				timelineRef={localTimelineRef as RefObject<HTMLDivElement>}
				keyframes={keyframes}
			/>

			<div className="relative z-10 flex flex-1 min-h-0 flex-col">
				<Row id={CLIP_ROW_ID} isEmpty={clipItems.length === 0} hint="Press C to split clip">
					{audioPeaks ? <AudioWaveform peaks={audioPeaks} /> : null}
					<ClipMarkerOverlay videoDurationMs={videoDurationMs} />
					{clipItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectAllBlocksActive || item.id === selectedClipId}
							onSelect={() => onSelectClip?.(item.id)}
							variant="clip"
						>
							{item.label}
						</Item>
					))}
				</Row>

				<Row id={ZOOM_ROW_ID} isEmpty={zoomItems.length === 0} hint="Press Z to add zoom">
					{zoomItems.map((item) => (
						<Item
							id={item.id}
							key={item.id}
							rowId={item.rowId}
							span={item.span}
							isSelected={selectAllBlocksActive || item.id === selectedZoomId}
							onSelect={() => onSelectZoom?.(item.id)}
							zoomDepth={item.zoomDepth}
							zoomMode={item.zoomMode}
							variant="zoom"
						>
							{item.label}
						</Item>
					))}
				</Row>

				{annotationRowIds.map((rowId, index) => {
					const rowItems = annotationItems.filter(
						(item) => getAnnotationTrackRowId(getAnnotationTrackIndex(item.rowId)) === rowId,
					);

					return (
						<Row
							key={rowId}
							id={rowId}
							isEmpty={rowItems.length === 0}
							hint={index === 0 ? "Press A to add annotation" : undefined}
						>
							{rowItems.map((item) => (
								<Item
									id={item.id}
									key={item.id}
									rowId={item.rowId}
									span={item.span}
									isSelected={
										selectAllBlocksActive || item.id === selectedAnnotationId
									}
									onSelect={() => onSelectAnnotation?.(item.id)}
									variant="annotation"
								>
									{item.label}
								</Item>
							))}
						</Row>
					);
				})}

				{audioRowIds.map((rowId, index) => {
					const rowItems = audioItems.filter(
						(item) => getAudioTrackRowId(getAudioTrackIndex(item.rowId)) === rowId,
					);

					return (
						<Row
							key={rowId}
							id={rowId}
							isEmpty={rowItems.length === 0}
							hint={index === 0 ? "Click music icon to add audio" : undefined}
						>
							{rowItems.map((item) => (
								<Item
									id={item.id}
									key={item.id}
									rowId={item.rowId}
									span={item.span}
									isSelected={selectAllBlocksActive || item.id === selectedAudioId}
									onSelect={() => onSelectAudio?.(item.id)}
									variant="audio"
								>
									{item.label}
								</Item>
							))}
						</Row>
					);
				})}
			</div>
		</div>
	);
}