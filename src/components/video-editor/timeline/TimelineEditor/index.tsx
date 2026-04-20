import { Plus } from "@phosphor-icons/react";
import { forwardRef, useImperativeHandle, useMemo } from "react";
import KeyframeMarkers from "../KeyframeMarkers";
import TimelineWrapper from "../TimelineWrapper";
import { TimelineRows } from "./TimelineSurface";
import { TimelineToolbar } from "./TimelineToolbar";
import { type TimelineEditorHandle, type TimelineEditorProps } from "./shared";
import { useTimelineEditorActions } from "./useTimelineEditorActions";
import { useTimelineEditorState } from "./useTimelineEditorState";
import { useTimelineEditorTimeline } from "./useTimelineEditorTimeline";

const TimelineEditor = forwardRef<TimelineEditorHandle, TimelineEditorProps>(
	function TimelineEditor(
		{
			videoDuration,
			currentTime,
			playheadTime,
			onSeek,
			cursorTelemetry = [],
			autoSuggestZoomsTrigger = 0,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms = false,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions = [],
			onTrimAdded,
			onTrimSpanChange,
			onTrimDelete,
			selectedTrimId,
			onSelectTrim,
			clipRegions = [],
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
			onSpeedAdded,
			onSpeedSpanChange,
			onSpeedDelete,
			selectedSpeedId,
			onSelectSpeed,
			audioRegions = [],
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			aspectRatio = "native",
			onAspectRatioChange,
			onOpenCropEditor,
			isCropped = false,
			videoPath,
			hideToolbar = false,
		},
		ref,
	) {
		const state = useTimelineEditorState({
			videoDuration,
			currentTime,
			playheadTime,
			aspectRatio,
			videoPath,
		});

		const defaultRegionDurationMs = useMemo(
			() => Math.min(1000, state.totalMs),
			[state.totalMs],
		);

		const actions = useTimelineEditorActions({
			videoDuration,
			totalMs: state.totalMs,
			currentTimeMs: state.currentTimeMs,
			safeMinDurationMs: state.safeMinDurationMs,
			defaultRegionDurationMs,
			cursorTelemetry,
			autoSuggestZoomsTrigger,
			onAutoSuggestZoomsConsumed,
			disableSuggestedZooms,
			zoomRegions,
			onZoomAdded,
			onZoomSuggested,
			onZoomSpanChange,
			onZoomDelete,
			selectedZoomId,
			onSelectZoom,
			trimRegions,
			onTrimAdded,
			onTrimSpanChange,
			onTrimDelete,
			selectedTrimId,
			onSelectTrim,
			clipRegions,
			onClipSplit,
			onClipDelete,
			selectedClipId,
			onSelectClip,
			annotationRegions,
			onAnnotationAdded,
			onAnnotationDelete,
			selectedAnnotationId,
			onSelectAnnotation,
			speedRegions,
			onSpeedAdded,
			onSpeedSpanChange,
			onSpeedDelete,
			selectedSpeedId,
			onSelectSpeed,
			audioRegions,
			onAudioAdded,
			onAudioSpanChange,
			onAudioDelete,
			selectedAudioId,
			onSelectAudio,
			onAspectRatioChange,
			customAspectWidth: state.customAspectWidth,
			customAspectHeight: state.customAspectHeight,
			setKeyframes: state.setKeyframes,
			selectedKeyframeId: state.selectedKeyframeId,
			setSelectedKeyframeId: state.setSelectedKeyframeId,
			setSelectAllBlocksActive: state.setSelectAllBlocksActive,
			isTimelineFocusedRef: state.isTimelineFocusedRef,
		});

		const timeline = useTimelineEditorTimeline({
			totalMs: state.totalMs,
			range: state.range,
			setRange: state.setRange,
			timelineContainerRef: state.timelineContainerRef,
			zoomRegions,
			trimRegions,
			clipRegions,
			annotationRegions,
			speedRegions,
			audioRegions,
			onZoomSpanChange,
			onTrimSpanChange,
			onClipSpanChange,
			onAnnotationSpanChange,
			onSpeedSpanChange,
			onAudioSpanChange,
		});

		useImperativeHandle(
			ref,
			() => ({
				addZoom: actions.handleAddZoom,
				suggestZooms: actions.handleSuggestZooms,
				splitClip: actions.handleSplitClip,
				addAnnotation: actions.handleAddAnnotation,
				addAudio: actions.handleAddAudio,
				keyframes: state.keyframes,
			}),
			[
				actions.handleAddAnnotation,
				actions.handleAddAudio,
				actions.handleAddZoom,
				actions.handleSuggestZooms,
				actions.handleSplitClip,
				state.keyframes,
			],
		);

		if (!videoDuration || videoDuration === 0) {
			return (
				<div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-editor-surface gap-3">
					<div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center">
						<Plus className="w-6 h-6 text-muted-foreground" />
					</div>
					<div className="text-center">
						<p className="text-sm font-medium text-muted-foreground">No Video Loaded</p>
						<p className="text-xs text-muted-foreground/70 mt-1">
							Drag and drop a video to start editing
						</p>
					</div>
				</div>
			);
		}

		return (
			<div className="flex-1 min-h-0 flex flex-col bg-editor-bg overflow-auto">
				{hideToolbar ? null : (
					<TimelineToolbar
						aspectRatio={aspectRatio}
						onAspectRatioChange={onAspectRatioChange}
						customAspectWidth={state.customAspectWidth}
						customAspectHeight={state.customAspectHeight}
						onCustomAspectWidthChange={state.setCustomAspectWidth}
						onCustomAspectHeightChange={state.setCustomAspectHeight}
						onCustomAspectRatioKeyDown={actions.handleCustomAspectRatioKeyDown}
						onApplyCustomAspectRatio={actions.applyCustomAspectRatio}
						onAddZoom={actions.handleAddZoom}
						onSuggestZooms={actions.handleSuggestZooms}
						onAddAnnotation={() => actions.handleAddAnnotation()}
						onAddAudio={actions.handleAddAudio}
						onSplitClip={actions.handleSplitClip}
						onOpenCropEditor={onOpenCropEditor}
						isCropped={isCropped}
						scrollLabels={state.scrollLabels}
					/>
				)}
				<div
					ref={state.timelineContainerRef}
					className="flex-1 min-h-0 overflow-auto bg-editor-bg relative"
					tabIndex={0}
					onFocus={() => {
						state.isTimelineFocusedRef.current = true;
					}}
					onBlur={() => {
						state.isTimelineFocusedRef.current = false;
					}}
					onMouseDown={() => {
						state.timelineContainerRef.current?.focus();
						state.isTimelineFocusedRef.current = true;
					}}
					onClick={() => {
						state.setSelectedKeyframeId(null);
						state.setSelectAllBlocksActive(false);
					}}
					onWheel={timeline.handleTimelineWheel}
				>
					<TimelineWrapper
						range={timeline.clampedRange}
						videoDuration={videoDuration}
						hasOverlap={actions.hasOverlap}
						onRangeChange={state.setRange}
						minItemDurationMs={state.timelineScale.minItemDurationMs}
						minVisibleRangeMs={state.timelineScale.minVisibleRangeMs}
						onItemSpanChange={timeline.handleItemSpanChange}
						allRegionSpans={timeline.allRegionSpans}
					>
						<KeyframeMarkers
							keyframes={state.keyframes}
							selectedKeyframeId={state.selectedKeyframeId}
							setSelectedKeyframeId={state.setSelectedKeyframeId}
							onKeyframeMove={actions.handleKeyframeMove}
							videoDurationMs={state.totalMs}
							timelineRef={state.timelineContainerRef}
						/>
						<TimelineRows
							items={timeline.timelineItems}
							videoDurationMs={state.totalMs}
							currentTimeMs={state.currentTimeMs}
							onSeek={onSeek}
							onSelectZoom={actions.handleSelectZoom}
							onSelectClip={actions.handleSelectClip}
							onSelectAnnotation={actions.handleSelectAnnotation}
							onSelectAudio={actions.handleSelectAudio}
							selectedZoomId={selectedZoomId}
							selectedClipId={selectedClipId}
							selectedAnnotationId={selectedAnnotationId}
							selectedAudioId={selectedAudioId}
							selectAllBlocksActive={state.selectAllBlocksActive}
							onClearBlockSelection={actions.clearSelectedBlocks}
							keyframes={state.keyframes}
							audioPeaks={state.audioPeaks}
						/>
					</TimelineWrapper>
				</div>
			</div>
		);
	},
);

TimelineEditor.displayName = "TimelineEditor";

export default TimelineEditor;