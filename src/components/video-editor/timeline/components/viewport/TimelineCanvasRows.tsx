import { useTimelineContext } from "dnd-timeline";
import { memo, useContext, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { MagicWand, MinusIcon, Plus } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { getEmbeddedCaptionSpan, getRegionDisplaySpan } from "../../core/clipPresentation";
import {
	CAPTION_ROW_ID,
	CLIP_ROW_ID,
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
import { useTimelinePresentation } from "../../core/TimelinePresentation";
import type { TimelineRenderItem } from "../../core/timelineTypes";
import { getZoomDisplaySpan } from "../../core/zoomPresentation";
import Item from "../../Item";
import glassStyles from "../../ItemGlass.module.css";
import Row from "../../Row";
import { AutoZoomNudgeContext } from "../../useAutoZoomNudge";
import nudgeStyles from "./AutoZoomNudge.module.css";
import { AudioItemWithWaveform } from "./AudioItemWithWaveform";
import type { TimelineCanvasRowsProps } from "./TimelineCanvasTypes";

const HINT_CLIP = "Press C to split clip";

const HINT_ANNOTATION = "Press A to add annotation";

const HINT_AUDIO = "Click music icon to add audio";

export const TimelineCanvasRows = memo(function TimelineCanvasRows({
	videoPath,
	items,
	selectAllBlocksActive,
	selectedZoomId,
	selectedClipId,
	selectedClipIds,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	onApplyAutoZooms,
	onDismissAutoZooms,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCaption,
	sourceAudioTracks = [],
	getSourceAudioTrackSettingsForClip,
	showSourceAudioTrack = false,
	liveSpanPreviewById,
	liveHiddenItemIds,
	direction,
	canShowGhostZoom,
	ghostStartMs,
	ghostWidthPx,
	onZoomRowMouseEnter,
	onZoomRowMouseMove,
	onZoomRowMouseLeave,
	onZoomRowMouseDown,
	onZoomRowClick,
	captionsEnabled = false,
	canShowGhostCaption,
	captionGhostStartMs,
	captionGhostWidthPx,
	onCaptionRowMouseEnter,
	onCaptionRowMouseMove,
	onCaptionRowMouseLeave,
	onCaptionRowMouseDown,
	onCaptionRowClick,
}: TimelineCanvasRowsProps) {
	const t = useScopedT("timeline");
	const commonT = useScopedT("common");
	const shouldNudgeAutoZooms = useContext(AutoZoomNudgeContext);
	const {
		pixelsToValue,
		valueToPixels,
		range: { start: rangeStart },
	} = useTimelineContext();
	const hiddenIds = useMemo(() => new Set(liveHiddenItemIds ?? []), [liveHiddenItemIds]);
	const { clipItems, zoomItems, captionItems, annotationRows, audioRows } = useMemo(() => {
		const nextClipItems: TimelineRenderItem[] = [];
		const nextZoomItems: TimelineRenderItem[] = [];
		const nextCaptionItems: TimelineRenderItem[] = [];
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
			if (item.rowId === CAPTION_ROW_ID) {
				nextCaptionItems.push(item);
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
			captionItems: nextCaptionItems,
			annotationRows: annotationRowsSorted,
			audioRows: audioRowsSorted,
		};
	}, [items]);

	const presentation = useTimelinePresentation();
	const { clips } = presentation;
	const clipPresentation = useMemo(
		() =>
			clipItems.map((item) => ({
				...item,
				displaySpan: getRegionDisplaySpan(item.span, clips),
			})),
		[clipItems, clips],
	);

	const zoomGhostSpan =
		ghostStartMs === null
			? null
			: { start: ghostStartMs, end: ghostStartMs + pixelsToValue(ghostWidthPx) };
	const zoomGhostVisibleSpan =
		zoomGhostSpan && getZoomDisplaySpan(zoomGhostSpan, presentation.zoomTiming);
	const zoomGhost =
		zoomGhostVisibleSpan === null
			? null
			: getRegionDisplaySpan(
					{ ...zoomGhostVisibleSpan, end: Math.round(zoomGhostVisibleSpan.end) },
					clipPresentation,
				);
	const zoomGhostOffsetPx = zoomGhost ? valueToPixels(zoomGhost.start - rangeStart) : 0;
	const zoomGhostWidthPx = zoomGhost ? valueToPixels(zoomGhost.end - zoomGhost.start) : 0;
	const embeddedGhost =
		captionGhostStartMs === null
			? null
			: getEmbeddedCaptionSpan(
					{
						start: captionGhostStartMs,
						end: captionGhostStartMs + pixelsToValue(captionGhostWidthPx),
					},
					clipPresentation,
				);
	const embeddedGhostOffset = embeddedGhost ? valueToPixels(embeddedGhost.start - rangeStart) : 0;
	const embeddedGhostWidth = embeddedGhost
		? valueToPixels(embeddedGhost.end - embeddedGhost.start)
		: 0;

	return (
		<>
			{(captionsEnabled || captionItems.length > 0) && (
				<Row
					id={CAPTION_ROW_ID}
					caption
					isEmpty={captionItems.length === 0}
					onMouseEnter={onCaptionRowMouseEnter}
					onMouseMove={onCaptionRowMouseMove}
					onMouseLeave={onCaptionRowMouseLeave}
					onMouseDown={onCaptionRowMouseDown}
					onClick={onCaptionRowClick}
				>
					{clipPresentation.map((clip) => (
						<div
							key={clip.id}
							data-caption-add-target
							className="absolute inset-y-0 pointer-events-auto"
							style={{
								[direction === "rtl" ? "right" : "left"]: valueToPixels(
									clip.displaySpan.start - rangeStart,
								),
								width: valueToPixels(clip.displaySpan.end - clip.displaySpan.start),
							}}
						/>
					))}

					{canShowGhostCaption && embeddedGhost && (
						<div
							data-testid="timeline-add-preview"
							className="absolute inset-0 z-[3] pointer-events-none"
						>
							<div
								className="absolute top-1/2 -translate-y-1/2 h-[85%] min-h-[18px]"
								style={
									direction === "rtl"
										? {
												right: `${embeddedGhostOffset}px`,
												width: `${embeddedGhostWidth}px`,
											}
										: {
												left: `${embeddedGhostOffset}px`,
												width: `${embeddedGhostWidth}px`,
											}
								}
							>
								<div
									className={cn(
										glassStyles.glassCaption,
										glassStyles.embeddedCaption,
										"w-full h-full overflow-hidden flex items-center justify-center cursor-default relative opacity-80",
									)}
								>
									<div className="relative z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/45 bg-white/15 text-white">
										<Plus className="h-2.5 w-2.5" />
									</div>
								</div>
							</div>
						</div>
					)}
					{captionItems.map((item) => {
						const displaySpan = getEmbeddedCaptionSpan(item.span, clipPresentation);
						if (!displaySpan) return null;
						return (
							<Item
								id={item.id}
								key={item.id}
								rowId={item.rowId}
								span={item.span}
								isSelected={item.id === selectedCaptionId}
								onSelectId={onSelectCaption}
								onDoubleClick={() => {
									const editor = document.querySelector<HTMLTextAreaElement>(
										"[data-caption-text-editor]",
									);
									editor?.focus();
									editor?.select();
								}}
								variant="caption"
								clipPresentation={clipPresentation}
								embedded
								displaySpan={displaySpan}
							>
								{item.label}
							</Item>
						);
					})}
				</Row>
			)}
			<Row filmstrip id={CLIP_ROW_ID} isEmpty={clipItems.length === 0} hint={HINT_CLIP}>
				{clipPresentation.map((item) => (
					<Item
						id={item.id}
						key={item.id}
						rowId={item.rowId}
						span={item.span}
						isSelected={
							selectedClipIds?.includes(item.id) ?? item.id === selectedClipId
						}
						onSelectId={onSelectClip}
						variant="clip"
						displaySpan={item.displaySpan}
						sharedLeftGrip={clipPresentation.some(
							(other) => other.span.end === item.span.start,
						)}
						sharedRightGrip={clipPresentation.some(
							(other) => other.span.start === item.span.end,
						)}
						videoPath={videoPath}
						sourceSpan={item.sourceSpan ?? item.span}
						speedValue={item.speedValue}
					>
						{item.label}
					</Item>
				))}
				{clipPresentation.map((left) => {
					const right = clipPresentation.find(
						(clip) => clip.span.start === left.span.end,
					);
					if (!right) return null;
					const seam = (left.displaySpan.end + right.displaySpan.start) / 2;
					return (
						<div
							key={`seam-${left.id}`}
							data-testid="clip-seam-grip"
							aria-hidden="true"
							className={cn(glassStyles.zoomEndCap, glassStyles.clipHandle)}
							style={{
								height: "59.5%",
								pointerEvents: "none",
								[direction === "rtl" ? "right" : "left"]:
									valueToPixels(seam - rangeStart) - 2,
							}}
						/>
					);
				})}
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
										isSelected={
											selectedClipIds?.includes(item.id) ??
											item.id === selectedClipId
										}
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

			<Row
				id={ZOOM_ROW_ID}
				compact={
					annotationRows.length +
						audioRows.length +
						(showSourceAudioTrack ? sourceAudioTracks.length : 0) >
					0
				}
				isEmpty={zoomItems.length === 0}
				onMouseEnter={onZoomRowMouseEnter}
				onMouseMove={onZoomRowMouseMove}
				onMouseLeave={onZoomRowMouseLeave}
				onMouseDown={onZoomRowMouseDown}
				onClick={onZoomRowClick}
			>
				{zoomItems.length === 0 && onApplyAutoZooms && (
					<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
						<div className="relative">
							<Button
								variant="secondary"
								size="sm"
								className={cn(
									"pointer-events-auto h-7 gap-1.5 px-3 text-xs",
									shouldNudgeAutoZooms && nudgeStyles.nudge,
								)}
								onMouseEnter={() => onZoomRowMouseLeave()}
								onMouseMove={(event) => event.stopPropagation()}
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									onApplyAutoZooms();
								}}
							>
								<MagicWand className="h-3.5 w-3.5" />
								{t("zoom.applyAutoZooms", "Apply auto zooms")}
							</Button>
							<Button
								variant="secondary"
								size="icon"
								className="pointer-events-auto absolute -right-1.5 -top-1.5 z-10 h-4 w-4 min-w-0 rounded-full p-0"
								aria-label={commonT("announcements.dismiss", "Dismiss")}
								onMouseEnter={() => onZoomRowMouseLeave()}
								onMouseMove={(event) => event.stopPropagation()}
								onMouseDown={(event) => event.stopPropagation()}
								onClick={(event) => {
									event.stopPropagation();
									onDismissAutoZooms();
								}}
							>
								<MinusIcon className="size-2.5 text-red-500" />
							</Button>
						</div>
					</div>
				)}
				{canShowGhostZoom && ghostStartMs !== null && (
					<div
						data-testid="timeline-add-preview"
						className="absolute inset-0 z-[3] pointer-events-none"
					>
						<div
							className="absolute top-1/2 -translate-y-1/2 h-[85%] min-h-[22px]"
							style={
								direction === "rtl"
									? {
											right: `${zoomGhostOffsetPx}px`,
											width: `${zoomGhostWidthPx}px`,
										}
									: {
											left: `${zoomGhostOffsetPx}px`,
											width: `${zoomGhostWidthPx}px`,
										}
							}
						>
							<div
								className={cn(
									glassStyles.glassBlue,
									"w-full h-full overflow-hidden flex items-center justify-center cursor-default relative opacity-80",
								)}
							>
								<div className={cn(glassStyles.zoomEndCap, glassStyles.left)} />
								<div className={cn(glassStyles.zoomEndCap, glassStyles.right)} />
								<Plus className="relative z-10 size-4 text-white" weight="bold" />
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
							isSelected={item.id === selectedAnnotationId}
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
