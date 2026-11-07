import type { Span } from "dnd-timeline";
import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TimelineLoadingSkeleton } from "../layout/TimelineLoadingSkeleton";
import type {
	SourceAudioTrackMeta,
	SourceAudioTrackSettings,
} from "@/components/video-editor/audio/audioTypes";
import { useScopedT } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { selectClipRange } from "../clipMerge";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
} from "../types";
import { getClipSourceStartMs } from "../types";
import KeyframeMarkers from "./components/markers/KeyframeMarkers";
import TimelineCanvas from "./components/viewport/TimelineCanvas";
import TimelineWrapper from "./components/wrapper/TimelineWrapper";
import { calculateTimelineScale } from "./core/time";
import type { ClipSequenceSpan } from "./core/timelineTypes";
import type { ZoomPresentationOptions } from "./core/zoomPresentation";
import { useTimelineEditorRuntime } from "./hooks/useTimelineEditorRuntime";
import { useTimelineRange } from "./hooks/useTimelineRange";
import { useTimelineSourceAudioTracks } from "./hooks/useTimelineSourceAudioTracks";

export interface TimelineEditorProps {
	zoomPresentationOptions?: ZoomPresentationOptions;
	videoDuration: number;
	sourceDuration?: number;
	currentTime: number;
	playheadTime?: number;
	onSeek?: (time: number) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions?: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
	clipRegions?: ClipRegion[];
	onClipSplit?: (splitMs: number) => void;
	onClipMerge?: (ids: string[]) => void;
	canMergeClips?: (ids: string[]) => boolean;
	onClipSpanChange?: (id: string, span: ClipSequenceSpan) => void;
	onClipDelete?: (id: string) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	annotationRegions?: AnnotationRegion[];
	onAnnotationAdded?: (
		span: Span,
		trackIndex?: number,
		type?: AnnotationRegion["type"],
		placement?: Pick<AnnotationRegion, "position" | "size">,
	) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions?: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	audioRegions?: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	captionRegions?: CaptionCue[];
	onCaptionSpanChange?: (id: string, span: Span) => void;
	onCaptionDelete?: (id: string) => void;
	onCaptionAdded?: (span: Span) => void;
	captionsEnabled?: boolean;
	captionQuickAddEnabled?: boolean;
	selectedCaptionId?: string | null;
	onSelectCaption?: (id: string | null) => void;
	videoPath?: string | null;
	videoSourcePath?: string | null;
	cursorTelemetrySourcePath?: string | null;
	showSourceAudioTrack?: boolean;
	sourceAudioResourceVersion?: number;
	onSourceAudioAvailabilityChange?: (available: boolean) => void;
	sourceAudioTrackSettings?: SourceAudioTrackSettings;
	getSourceAudioTrackSettingsForClip?: (clipId: string | null) => SourceAudioTrackSettings;
	onSourceAudioTracksMetaChange?: (tracks: SourceAudioTrackMeta) => void;
}

export interface TimelineEditorHandle {
	addZoom: () => void;
	suggestZooms: () => void;
	splitClip: () => void;
	addAnnotation: (
		trackIndex?: number,
		type?: AnnotationRegion["type"],
		placement?: Pick<AnnotationRegion, "position" | "size">,
	) => void;
	addAudio: (trackIndex?: number) => Promise<void>;
	keyframes: { id: string; time: number }[];
}

const TimelineEditor = forwardRef<TimelineEditorHandle, TimelineEditorProps>(
	function TimelineEditor(
		{
			videoDuration,
			sourceDuration = videoDuration,
			currentTime,
			playheadTime,
			onSeek,
			cursorTelemetry = [],
			zoomRegions,
			zoomPresentationOptions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions = [],
			onTrimSpanChange,
			clipRegions = [],
			onClipMerge,
			canMergeClips,
			onClipSplit,
			onClipSpanChange,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			annotationRegions = [],
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions = [],
			onSpeedSpanChange,
			audioRegions = [],
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			captionRegions = [],
			onCaptionSpanChange,
			onCaptionDelete,
			onCaptionAdded,
			captionsEnabled = false,
			captionQuickAddEnabled = true,
			selectedCaptionId,
			onSelectCaption,
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			showSourceAudioTrack = false,
			sourceAudioResourceVersion = 0,
			onSourceAudioAvailabilityChange,
			sourceAudioTrackSettings = {},
			getSourceAudioTrackSettingsForClip,
			onSourceAudioTracksMetaChange,
		},
		ref,
	) {
		const te = useScopedT("editing");
		const totalMs = useMemo(
			() => Math.max(0, Math.round(videoDuration * 1000)),
			[videoDuration],
		);
		const currentTimeMs = useMemo(
			() => Math.round((playheadTime ?? currentTime) * 1000),
			[currentTime, playheadTime],
		);
		const clipResizeEndById = useMemo(
			() =>
				Object.fromEntries(
					clipRegions.map((clip) => [
						clip.id,
						Math.max(
							clip.endMs,
							Math.floor(
								clip.startMs +
									(Math.min(sourceDuration * 1000, clip.sourceMaxMs ?? Infinity) -
										getClipSourceStartMs(clip)) /
										(Number.isFinite(clip.speed) && clip.speed > 0
											? clip.speed
											: 1),
							),
						),
					]),
				),
			[clipRegions, sourceDuration],
		);
		const timelineScale = useMemo(() => calculateTimelineScale(videoDuration), [videoDuration]);
		const safeMinDurationMs = useMemo(
			() =>
				totalMs > 0
					? Math.min(timelineScale.minItemDurationMs, totalMs)
					: timelineScale.minItemDurationMs,
			[timelineScale.minItemDurationMs, totalMs],
		);

		const timelineContainerRef = useRef<HTMLDivElement>(null);
		const isTimelineFocusedRef = useRef(false);
		const { setRange, clampedRange, handleTimelineWheel } = useTimelineRange({
			totalMs,
			timelineContainerRef,
		});

		const [liveSpanPreviewById, setLiveSpanPreviewById] = useState<Record<string, Span>>({});
		const [isDragging, setIsDragging] = useState(false);
		const liveZoomPreview = useMemo(() => {
			const previewSpans: Record<string, Span> = { ...liveSpanPreviewById };
			const hiddenZoomIds = new Set<string>();

			for (const [previewId, previewSpan] of Object.entries(liveSpanPreviewById)) {
				const oldClip = clipRegions.find((clip) => clip.id === previewId);
				if (!oldClip) continue;

				const newStart = Math.round(previewSpan.start);
				const newEnd = Math.round(previewSpan.end);
				const removedSegments = [
					...(newStart > oldClip.startMs
						? [{ startMs: oldClip.startMs, endMs: newStart }]
						: []),
					...(newEnd < oldClip.endMs ? [{ startMs: newEnd, endMs: oldClip.endMs }] : []),
				];

				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				const isMove = Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;

				if (isMove) {
					const delta = startDelta;
					for (const zoom of zoomRegions) {
						const overlaps =
							zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs;
						if (!overlaps) continue;
						previewSpans[zoom.id] = {
							start: zoom.startMs + delta,
							end: zoom.endMs + delta,
						};
					}
				}

				if (removedSegments.length > 0) {
					for (const zoom of zoomRegions) {
						const removed = removedSegments.some(
							(segment) =>
								zoom.startMs < segment.endMs && zoom.endMs > segment.startMs,
						);
						if (removed) hiddenZoomIds.add(zoom.id);
					}
				}
			}

			return { previewSpans, hiddenZoomIds };
		}, [clipRegions, liveSpanPreviewById, zoomRegions]);
		const { shortcuts: keyShortcuts, isMac } = useShortcuts();
		const { sourceAudioTracks, sourceAudioLoading, micSidecarLoading, systemSidecarLoading } =
			useTimelineSourceAudioTracks({
				videoPath,
				sourceAudioResourceVersion,
				onSourceAudioTracksMetaChange,
				onSourceAudioAvailabilityChange,
			});

		const isLoading = useMemo(() => {
			// If we are still actively trying to load audio peaks (main or sidecars)
			if (videoPath && (sourceAudioLoading || micSidecarLoading || systemSidecarLoading))
				return true;

			// Robust telemetry loading detection:
			// If a source path is set but telemetry hasn't arrived (or failed/retried) for it yet.
			if (videoSourcePath && cursorTelemetrySourcePath !== videoSourcePath) return true;

			return false;
		}, [
			videoPath,
			videoSourcePath,
			cursorTelemetrySourcePath,
			sourceAudioLoading,
			micSidecarLoading,
			systemSidecarLoading,
		]);
		void sourceAudioTrackSettings;
		const autoZoomSourceReady = Boolean(
			videoPath &&
				Number.isFinite(videoDuration) &&
				videoDuration > 0 &&
				(!videoSourcePath || cursorTelemetrySourcePath === videoSourcePath),
		);
		// The imperative toolbar action shares this runtime: never suggest regions
		// from telemetry that belongs to a previous source while the new one loads.
		const autoZoomTelemetry = useMemo(
			() => (autoZoomSourceReady ? cursorTelemetry : []),
			[autoZoomSourceReady, cursorTelemetry],
		);

		const {
			keyframes,
			selectedKeyframeId,
			setSelectedKeyframeId,
			selectAllBlocksActive,
			setSelectAllBlocksActive,
			handleKeyframeMove,
			clearSelectedBlocks,
			handleSelectZoom,
			handleSelectClip,
			handleSelectAnnotation,
			handleSelectAudio,
			handleSelectCaption,
			hasOverlap,
			timelineItems,
			allRegionSpans,
			getResolvedDropRowId,
			handleItemSpanChange,
			canPlaceZoomAtMs,
			addZoomAtMs,
			handleSuggestZooms,
			canPlaceCaptionAtMs,
			addCaptionAtMs,
			resolveCaptionSpanAtMs,
		} = useTimelineEditorRuntime({
			ref,
			videoDuration,
			totalMs,
			currentTimeMs,
			safeMinDurationMs,
			cursorTelemetry: autoZoomTelemetry,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions,
			onTrimSpanChange,
			clipRegions,
			onClipSplit,
			onClipSpanChange,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			annotationRegions,
			onAnnotationAdded,
			onAnnotationSpanChange,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions,
			onSpeedSpanChange,
			audioRegions,
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			captionCues: captionRegions,
			onCaptionSpanChange,
			onCaptionDelete,
			onCaptionAdded,
			selectedCaptionId,
			onSelectCaption,
			isMac,
			keyShortcuts,
			isTimelineFocusedRef,
		});
		const [clipSelection, setClipSelection] = useState<{
			anchorId: string;
			primaryId: string;
			ids: string[];
			clips: ClipRegion[];
		} | null>(null);
		const selectedClipIds =
			clipSelection?.primaryId === selectedClipId && clipSelection?.clips === clipRegions
				? clipSelection.ids
				: selectedClipId
					? [selectedClipId]
					: [];
		useEffect(() => {
			if (
				clipSelection &&
				(selectedClipId !== clipSelection.primaryId || clipRegions !== clipSelection.clips)
			) {
				setClipSelection(null);
			}
		}, [selectedClipId, clipRegions, clipSelection]);
		const selectClip = (id: string | null, extend = false) => {
			const anchorId =
				extend && selectedClipId
					? selectedClipIds.length > 1
						? clipSelection!.anchorId
						: selectedClipId
					: id;
			setClipSelection(
				id && anchorId
					? {
							anchorId,
							primaryId: id,
							clips: clipRegions,
							ids: extend ? selectClipRange(clipRegions, anchorId, id) : [id],
						}
					: null,
			);
			handleSelectClip(id);
		};

		if (!videoDuration || videoDuration === 0) {
			return <TimelineLoadingSkeleton />;
		}

		return (
			<div className="relative flex-1 min-h-0 flex flex-col bg-transparent overflow-hidden">
				{selectedClipIds.length > 1 && onClipMerge && (
					<div className="absolute right-3 top-1 z-30 flex items-center gap-2 rounded-lg bg-editor-surface/95 px-2 py-1 text-xs text-muted-foreground">
						<span>
							{te("selectedClips", "{{count}} clips selected", {
								count: selectedClipIds.length,
							})}
						</span>
						<span
							title={
								canMergeClips?.(selectedClipIds)
									? te("mergeSelectedClips", "Merge selected clips")
									: te(
											"mergeClipsUnavailable",
											"Merge requires continuous footage with matching speed and audio settings.",
										)
							}
						>
							<Button
								size="sm"
								variant="secondary"
								disabled={!canMergeClips?.(selectedClipIds)}
								onClick={() => onClipMerge(selectedClipIds)}
							>
								{te("mergeClips", "Merge clips")}
							</Button>
						</span>
					</div>
				)}
				<div
					ref={timelineContainerRef}
					data-testid="timeline-scroll"
					style={{ outline: "none", boxShadow: "none" }}
					className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto bg-transparent relative px-3"
					tabIndex={0}
					onFocus={() => {
						isTimelineFocusedRef.current = true;
					}}
					onBlur={() => {
						isTimelineFocusedRef.current = false;
					}}
					onPointerDownCapture={() => {
						timelineContainerRef.current?.focus({ preventScroll: true });
						isTimelineFocusedRef.current = true;
					}}
					onClick={() => {
						setSelectedKeyframeId(null);
						setSelectAllBlocksActive(false);
					}}
					onWheel={handleTimelineWheel}
				>
					<TimelineWrapper
						zoomPresentationOptions={zoomPresentationOptions}
						range={clampedRange}
						videoDuration={videoDuration}
						clipResizeEndById={clipResizeEndById}
						hasOverlap={hasOverlap}
						onRangeChange={setRange}
						minItemDurationMs={timelineScale.minItemDurationMs}
						minVisibleRangeMs={timelineScale.minVisibleRangeMs}
						onItemSpanChange={handleItemSpanChange}
						resolveTargetRowId={getResolvedDropRowId}
						allRegionSpans={allRegionSpans}
						onDraggingChange={setIsDragging}
						onLiveSpanPreviewChange={(id, span) => {
							setLiveSpanPreviewById((prev) => {
								if (!span) {
									if (!(id in prev)) return prev;
									const next = { ...prev };
									delete next[id];
									return next;
								}
								const current = prev[id];
								if (
									current &&
									current.start === span.start &&
									current.end === span.end
								) {
									return prev;
								}
								return { ...prev, [id]: span };
							});
						}}
					>
						<KeyframeMarkers
							keyframes={keyframes}
							selectedKeyframeId={selectedKeyframeId}
							setSelectedKeyframeId={setSelectedKeyframeId}
							onKeyframeMove={handleKeyframeMove}
							videoDurationMs={totalMs}
							timelineRef={timelineContainerRef}
						/>
						<TimelineCanvas
							videoPath={videoPath}
							items={timelineItems}
							videoDurationMs={totalMs}
							currentTimeMs={currentTimeMs}
							onSeek={onSeek}
							onApplyAutoZooms={
								onZoomSuggested && autoZoomTelemetry.length >= 2
									? handleSuggestZooms
									: undefined
							}
							onAddZoomAtMs={addZoomAtMs}
							canPlaceZoomAtMs={canPlaceZoomAtMs}
							onAddCaptionAtMs={addCaptionAtMs}
							canPlaceCaptionAtMs={canPlaceCaptionAtMs}
							resolveCaptionSpanAtMs={resolveCaptionSpanAtMs}
							captionsEnabled={captionsEnabled}
							captionQuickAddEnabled={captionQuickAddEnabled}
							onSelectZoom={handleSelectZoom}
							onSelectClip={selectClip}
							onSelectAnnotation={handleSelectAnnotation}
							onSelectAudio={handleSelectAudio}
							onSelectCaption={handleSelectCaption}
							selectedZoomId={selectedZoomId}
							selectedClipId={selectedClipId}
							selectedClipIds={selectedClipIds}
							selectedAnnotationId={selectedAnnotationId}
							selectedAudioId={selectedAudioId}
							selectedCaptionId={selectedCaptionId}
							selectAllBlocksActive={selectAllBlocksActive}
							onClearBlockSelection={clearSelectedBlocks}
							keyframes={keyframes}
							sourceAudioTracks={sourceAudioTracks}
							getSourceAudioTrackSettingsForClip={getSourceAudioTrackSettingsForClip}
							showSourceAudioTrack={showSourceAudioTrack}
							liveSpanPreviewById={liveZoomPreview.previewSpans}
							liveHiddenItemIds={Array.from(liveZoomPreview.hiddenZoomIds)}
							isDragging={isDragging}
							isLoading={isLoading}
						/>
					</TimelineWrapper>
				</div>
			</div>
		);
	},
);

TimelineEditor.displayName = "TimelineEditor";

export default TimelineEditor;
