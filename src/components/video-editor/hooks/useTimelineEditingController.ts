import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import type { useShortcuts } from "@/contexts/ShortcutsContext";
import { translate } from "@/i18n/runtime";
import { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import { placeSpanAfter } from "../timeline/hooks/utils/timelineDuplicateUtils";
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

type CopiedTimelineRegion =
	| { kind: "zoom"; region: ReturnType<typeof useTimelineState>["zoomRegions"][number] }
	| {
			kind: "annotation";
			region: ReturnType<typeof useTimelineState>["annotationRegions"][number];
	  }
	| { kind: "audio"; region: ReturnType<typeof useTimelineState>["audioRegions"][number] };

export function useTimelineEditingController(input: Input) {
	const { timeline } = input;
	const [previewSeekVersion, setPreviewSeekVersion] = useState(0);
	const handlePreviewSeek = useCallback(() => {
		setPreviewSeekVersion((version) => version + 1);
	}, []);
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
		alwaysUsePointerCursor: input.appearance.alwaysUsePointerCursor,
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
		previewSeekVersion,
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
		onPreviewSeek: handlePreviewSeek,
		clipRegions: timeline.clipRegions,
		zoomRegions: projection.effectiveZoomRegions,
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

	const copiedRegionRef = useRef<CopiedTimelineRegion | null>(null);

	const getSelectedRegion = (): CopiedTimelineRegion | null => {
		const zoom = timeline.zoomRegions.find(({ id }) => id === timeline.selectedZoomId);
		if (zoom) return { kind: "zoom", region: zoom };
		const annotation = timeline.annotationRegions.find(
			({ id }) => id === timeline.selectedAnnotationId,
		);
		if (annotation) return { kind: "annotation", region: annotation };
		const audioRegion = timeline.audioRegions.find(({ id }) => id === timeline.selectedAudioId);
		if (audioRegion) return { kind: "audio", region: audioRegion };
		return null;
	};

	const copySelectedRegion = () => {
		const selected = getSelectedRegion();
		if (!selected) return false;
		copiedRegionRef.current = selected;
		return true;
	};

	/** Places a copy after the source and returns it, or null when there is no room. */
	const insertRegionCopy = (copied: CopiedTimelineRegion): CopiedTimelineRegion | null => {
		const totalMs = Math.round(projection.timelineDuration * 1000);

		if (copied.kind === "zoom") {
			const span = placeSpanAfter(copied.region, totalMs, timeline.zoomRegions);
			if (span) {
				const region = {
					...copied.region,
					...span,
					id: `zoom-${input.nextZoomIdRef.current++}`,
				};
				timeline.setZoomRegions((current) => [...current, region]);
				zoomCommands.handleSelectZoom(region.id);
				return { kind: "zoom", region };
			}
		} else if (copied.kind === "annotation") {
			const span = placeSpanAfter(copied.region, totalMs);
			if (span) {
				const region = {
					...copied.region,
					...span,
					id: `annotation-${input.nextAnnotationIdRef.current++}`,
					zIndex: input.nextAnnotationZIndexRef.current++,
				};
				timeline.setAnnotationRegions((current) => [...current, region]);
				handleSelectAnnotation(region.id);
				return { kind: "annotation", region };
			}
		} else {
			const trackIndex = copied.region.trackIndex ?? 0;
			const sameTrack = timeline.audioRegions.filter(
				(region) => (region.trackIndex ?? 0) === trackIndex,
			);
			const span = placeSpanAfter(copied.region, totalMs, sameTrack);
			if (span) {
				const region = {
					...copied.region,
					...span,
					id: `audio-${input.nextAudioIdRef.current++}`,
				};
				timeline.setAudioRegions((current) => [...current, region]);
				audioCommands.handleSelectAudio(region.id);
				return { kind: "audio", region };
			}
		}

		toast.warning(
			translate(
				"notifications.timelineDuplicateNoRoom",
				"There is no room to duplicate this item.",
			),
		);
		return null;
	};

	const pasteCopiedRegion = () => {
		const copied = copiedRegionRef.current;
		if (!copied) return false;
		// Chain repeated pastes so each copy lands after the previous one.
		copiedRegionRef.current = insertRegionCopy(copied) ?? copied;
		return true;
	};

	const duplicateSelectedRegion = () => {
		const selected = getSelectedRegion();
		if (selected) insertRegionCopy(selected);
	};

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
		duplicateSelectedRegion,
		copySelectedRegion,
		pasteCopiedRegion,
	};
}
