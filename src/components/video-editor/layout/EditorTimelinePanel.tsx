import { type RefObject, useState } from "react";
import { Button } from "@/components/ui/button";
import { CaretUpIcon } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import { retimeCaptionFragment } from "../captionTimeline";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useEditorPlaybackControls } from "../hooks/useEditorPlaybackControls";
import type { useTimelineProjection } from "../hooks/useTimelineProjection";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import type { useTimelineState } from "../state/useTimelineState";
import type { ZoomPresentationOptions } from "../timeline/core/zoomPresentation";
import TimelineEditor, { type TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Props = {
	zoomPresentationOptions?: ZoomPresentationOptions;
	panelRef?: RefObject<HTMLDivElement | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	getAnnotationPlacement?: VideoPlaybackRef["getAnnotationPlacement"];
	timeline: ReturnType<typeof useTimelineState>;
	projection: ReturnType<typeof useTimelineProjection>;
	playback: ReturnType<typeof useEditorPlaybackControls>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	videoPath: string | null;
	videoSourcePath: string | null;
	cursorTelemetrySourcePath: string | null;
	normalizedCursorTelemetry: ReturnType<typeof useTimelineState>["cursorTelemetry"];
	currentTime: number;
	handleSelectAnnotation: (id: string | null) => void;
	onDuplicateSelectedRegion: () => void;
	onCopySelectedRegion: () => boolean;
	onPasteCopiedRegion: () => boolean;
};

const EXPANDABLE_TRACK_THRESHOLD = 3;

export function EditorTimelinePanel(props: Props) {
	const t = useScopedT("editor");
	const [expandRequested, setExpandRequested] = useState(false);
	const [trackCount, setTrackCount] = useState(0);
	const canExpand = trackCount > EXPANDABLE_TRACK_THRESHOLD;
	const expanded = canExpand && expandRequested;
	const toggleLabel = expanded
		? t("timeline.collapse", "Collapse Timeline")
		: t("timeline.expand", "Expand Timeline");
	const {
		timelineRef,
		timeline,
		projection,
		playback,
		audio,
		zoomCommands,
		clipCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		videoPath,
		videoSourcePath,
		cursorTelemetrySourcePath,
		normalizedCursorTelemetry,
		currentTime,
		handleSelectAnnotation,
	} = props;

	return (
		<div
			ref={props.panelRef}
			tabIndex={-1}
			data-timeline-panel
			data-expanded={expanded || undefined}
			className="relative outline-none flex flex-shrink-0 flex-col bg-transparent px-4 pb-4 transition-[height,max-height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
			style={{
				height: expanded ? "48%" : "calc(22% + 8px)",
				minHeight: 188,
				maxHeight: expanded ? "100%" : 288,
			}}
		>
			{canExpand ? (
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="absolute top-0 left-1/2 z-40 h-5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-separator bg-editor-bg text-muted-foreground animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none"
					title={toggleLabel}
					aria-label={toggleLabel}
					aria-expanded={expanded}
					onClick={() => setExpandRequested(!expanded)}
				>
					<CaretUpIcon
						className={`size-3 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
						aria-hidden="true"
					/>
				</Button>
			) : null}
			<TimelineEditor
				zoomPresentationOptions={props.zoomPresentationOptions}
				ref={timelineRef}
				videoDuration={projection.timelineDuration}
				sourceDuration={projection.sourceDuration}
				currentTime={currentTime}
				playheadTime={projection.timelinePlayheadTime}
				onSeek={playback.handleTimelineSeek}
				videoPath={videoPath}
				videoSourcePath={videoSourcePath}
				cursorTelemetrySourcePath={cursorTelemetrySourcePath}
				cursorTelemetry={normalizedCursorTelemetry}
				zoomRegions={timeline.zoomRegions}
				onZoomAdded={zoomCommands.handleZoomAdded}
				onZoomSuggested={zoomCommands.handleZoomSuggested}
				onZoomSpanChange={zoomCommands.handleZoomSpanChange}
				onZoomDelete={zoomCommands.handleZoomDelete}
				onDuplicateSelectedRegion={props.onDuplicateSelectedRegion}
				onCopySelectedRegion={props.onCopySelectedRegion}
				onPasteCopiedRegion={props.onPasteCopiedRegion}
				onClearZooms={zoomCommands.handleClearZooms}
				selectedZoomId={timeline.selectedZoomId}
				onSelectZoom={zoomCommands.handleSelectZoom}
				trimRegions={timeline.trimRegions}
				clipRegions={timeline.clipRegions}
				onClipSplit={clipCommands.handleClipSplit}
				onClipMerge={clipCommands.handleClipMerge}
				canMergeClips={clipCommands.canMergeClips}
				onClipDelete={clipCommands.handleClipDelete}
				onClipSpanChange={clipCommands.handleClipSpanChange}
				selectedClipId={timeline.selectedClipId}
				onSelectClip={clipCommands.handleSelectClip}
				audioRegions={timeline.audioRegions}
				onAudioAdded={audioCommands.handleAudioAdded}
				onAudioSpanChange={audioCommands.handleAudioSpanChange}
				onAudioDelete={audioCommands.handleAudioDelete}
				selectedAudioId={timeline.selectedAudioId}
				onSelectAudio={audioCommands.handleSelectAudio}
				captionRegions={projection.effectiveCaptionRegions}
				onCaptionSpanChange={(id, span) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					if (!fragment) return;
					captionCommands.handleCaptionRetime(
						fragment.sourceCueId,
						retimeCaptionFragment(fragment, span),
					);
				}}
				selectedCaptionId={
					projection.effectiveCaptionRegions.find(
						(cue) =>
							cue.sourceCueId === timeline.selectedCaptionId &&
							currentTime * 1000 >= cue.startMs &&
							currentTime * 1000 < cue.endMs,
					)?.id ??
					projection.effectiveCaptionRegions.find(
						(cue) => cue.sourceCueId === timeline.selectedCaptionId,
					)?.id ??
					null
				}
				onSelectCaption={(id) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					captionCommands.handleSelectCaption(fragment?.sourceCueId ?? null);
					if (fragment) playback.handleTimelineSeek(fragment.startMs / 1000);
				}}
				onCaptionDelete={(id) => {
					const fragment = projection.effectiveCaptionRegions.find(
						(cue) => cue.id === id,
					);
					if (fragment) captionCommands.handleCaptionDelete(fragment.sourceCueId);
				}}
				onCaptionAdded={captionCommands.handleCaptionAdded}
				captionsEnabled={timeline.autoCaptionSettings.enabled}
				captionQuickAddEnabled={timeline.autoCaptionSettings.timelineQuickAdd}
				annotationRegions={timeline.annotationRegions}
				onAnnotationAdded={(span, trackIndex, type, placement) =>
					annotationCommands.handleAnnotationAdded(
						span,
						trackIndex,
						type,
						placement ?? props.getAnnotationPlacement?.() ?? undefined,
					)
				}
				onAnnotationSpanChange={annotationCommands.handleAnnotationSpanChange}
				onAnnotationDelete={annotationCommands.handleAnnotationDelete}
				selectedAnnotationId={timeline.selectedAnnotationId}
				onSelectAnnotation={(id) => {
					handleSelectAnnotation(id);
					const region = timeline.annotationRegions.find((region) => region.id === id);
					if (
						region &&
						(currentTime * 1000 < region.startMs || currentTime * 1000 >= region.endMs)
					) {
						playback.handleTimelineSeek(
							(region.startMs + Math.min(1, (region.endMs - region.startMs) / 2)) /
								1000,
						);
					}
				}}
				onTrackCountChange={setTrackCount}
				showSourceAudioTrack={timeline.clipRegions.some((clip) => clip.showSourceAudio)}
				sourceAudioResourceVersion={timeline.sourceAudioFallbackRefreshKey}
				sourceAudioTrackSettings={audio.getSourceAudioTrackSettingsForClip(
					timeline.selectedClipId,
				)}
				getSourceAudioTrackSettingsForClip={audio.getSourceAudioTrackSettingsForClip}
				onSelectedClipSourceAudioTrackVolumeChange={
					audio.onSelectedClipSourceAudioTrackVolumeChange
				}
				onSourceAudioAvailabilityChange={timeline.setHasClipSourceAudio}
				onSourceAudioTracksMetaChange={audio.onSourceAudioTracksMetaChange}
			/>
		</div>
	);
}
