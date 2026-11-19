import { translate } from "@/i18n/runtime";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback } from "react";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import type { useShortcuts } from "@/contexts/ShortcutsContext";
import { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { EditorEffectSection } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { getErrorMessage, summarizeErrorMessage } from "../videoEditorUtils";
import { useAnnotationRegionCommands } from "./useAnnotationRegionCommands";
import { useAudioRegionCommands } from "./useAudioRegionCommands";
import { useCaptionCommands } from "./useCaptionCommands";
import { useClipRegionCommands } from "./useClipRegionCommands";
import { useCursorTelemetry } from "./useCursorTelemetry";
import { useEditorGlobalInteractions } from "./useEditorGlobalInteractions";
import { useEditorPlaybackControls } from "./useEditorPlaybackControls";
import { useTimelineProjection } from "./useTimelineProjection";
import { useZoomRegionCommands } from "./useZoomRegionCommands";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	shortcuts: ReturnType<typeof useShortcuts>["shortcuts"];
	isMac: boolean;
	timeline: ReturnType<typeof useTimelineState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPath: string | null;
	videoSourcePath: string | null;
	currentSourcePath: string | null;
	duration: number;
	currentTime: number;
	isPlaying: boolean;
	previewVolume: number;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	clipInitializedRef: MutableRefObject<boolean>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	handleUndo: () => void;
	handleRedo: () => void;
};

export function useTimelineEditingController(input: Input) {
	const { timeline } = input;
	const handleSourceFallbackLoadError = useCallback((error: unknown) => {
		toast.warning(
			translate(
				"notifications.companionAudioError",
				"Could not load companion audio source: {{error}}",
				{ error: summarizeErrorMessage(getErrorMessage(error)) },
			),
			{ duration: 10000 },
		);
	}, []);
	const cursor = useCursorTelemetry({
		videoPath: input.videoPath,
		videoSourcePath: input.videoSourcePath,
		duration: input.duration,
		loopCursor: input.appearance.loopCursor,
		timeline,
	});
	const projection = useTimelineProjection({
		timeline,
		duration: input.duration,
		currentTime: input.currentTime,
		nextClipIdRef: input.nextClipIdRef,
		initializedRef: input.clipInitializedRef,
		autoFullTrackIdRef: input.autoFullTrackClipIdRef,
		autoFullTrackEndRef: input.autoFullTrackClipEndMsRef,
	});
	const audio = useVideoEditorAudio({
		currentSourcePath: input.currentSourcePath,
		selectedClipId: timeline.selectedClipId,
		clipRegions: timeline.clipRegions,
		audioRegions: timeline.audioRegions,
		sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
		setSourceAudioTrackSettingsByClip: timeline.setSourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings: timeline.defaultSourceAudioTrackSettings,
		setDefaultSourceAudioTrackSettings: timeline.setDefaultSourceAudioTrackSettings,
		timelineTime: projection.timelinePlayheadTime,
		currentTime: projection.mapTimelineTimeToSourceTime(input.currentTime * 1000) / 1000,
		duration: input.duration,
		isPlaying: input.isPlaying,
		previewVolume: input.previewVolume,
		sourceAudioFallbackRefreshKey: timeline.sourceAudioFallbackRefreshKey,
		summarizeErrorMessage,
		onSourceFallbackLoadError: handleSourceFallbackLoadError,
	});
	const playback = useEditorPlaybackControls({
		videoPlaybackRef: input.videoPlaybackRef,
		timelineRef: input.timelineRef,
		playSourceAudioPreview: audio.playSourceAudioPreview,
		timelinePlayheadTime: projection.timelinePlayheadTime,
		timelineDuration: projection.timelineDuration,
	});
	const captionCommands = useCaptionCommands({
		clipRegions: timeline.clipRegions,
		autoCaptions: timeline.autoCaptions,
		setAutoCaptions: timeline.setAutoCaptions,
		setAutoCaptionSettings: timeline.setAutoCaptionSettings,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedClipId: timeline.setSelectedClipId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setActiveEffectSection: input.setActiveEffectSection,
		videoPlaybackRef: input.videoPlaybackRef,
		mapSourceTimeToTimelineTime: projection.mapSourceTimeToTimelineTime,
		handleSeek: playback.handleSeek,
	});
	const zoomCommands = useZoomRegionCommands({
		setSelectedClipId: timeline.setSelectedClipId,
		setZoomRegions: timeline.setZoomRegions,
		selectedZoomId: timeline.selectedZoomId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextZoomIdRef: input.nextZoomIdRef,
	});
	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			timeline.setSelectedAnnotationId(id);
			if (id) {
				timeline.setSelectedClipId(null);
				timeline.setSelectedZoomId(null);
				timeline.setSelectedAudioId(null);
				timeline.setSelectedCaptionId(null);
			}
		},
		[
			timeline.setSelectedAnnotationId,
			timeline.setSelectedClipId,
			timeline.setSelectedZoomId,
			timeline.setSelectedAudioId,
			timeline.setSelectedCaptionId,
		],
	);
	const clipCommands = useClipRegionCommands({
		getSourceAudioTrackSettingsForClip: audio.getSourceAudioTrackSettingsForClip,
		setAnnotationRegions: timeline.setAnnotationRegions,
		setAudioRegions: timeline.setAudioRegions,
		sourceDurationMs: input.duration * 1000,
		clipRegions: timeline.clipRegions,
		setClipRegions: timeline.setClipRegions,
		setSourceAudioTrackSettingsByClip: timeline.setSourceAudioTrackSettingsByClip,
		zoomRegions: timeline.zoomRegions,
		setZoomRegions: timeline.setZoomRegions,
		selectedClipId: timeline.selectedClipId,
		setSelectedClipId: timeline.setSelectedClipId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextClipIdRef: input.nextClipIdRef,
		nextZoomIdRef: input.nextZoomIdRef,
		t: input.t,
	});
	const audioCommands = useAudioRegionCommands({
		setSelectedClipId: timeline.setSelectedClipId,
		setAudioRegions: timeline.setAudioRegions,
		selectedAudioId: timeline.selectedAudioId,
		setSelectedAudioId: timeline.setSelectedAudioId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedCaptionId: timeline.setSelectedCaptionId,
		setActiveEffectSection: input.setActiveEffectSection,
		nextAudioIdRef: input.nextAudioIdRef,
	});
	const annotationCommands = useAnnotationRegionCommands({
		onSelectAnnotation: handleSelectAnnotation,
		setAnnotationRegions: timeline.setAnnotationRegions,
		selectedAnnotationId: timeline.selectedAnnotationId,
		setSelectedAnnotationId: timeline.setSelectedAnnotationId,
		setSelectedZoomId: timeline.setSelectedZoomId,
		nextAnnotationIdRef: input.nextAnnotationIdRef,
		nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
	});

	useEditorGlobalInteractions({
		timeline,
		videoPlaybackRef: input.videoPlaybackRef,
		shortcuts: input.shortcuts,
		isMac: input.isMac,
		handleUndo: input.handleUndo,
		handleRedo: input.handleRedo,
		startPlayback: playback.startPlayback,
	});

	return {
		cursor,
		projection,
		audio,
		playback,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
		handleSelectAnnotation,
	};
}
