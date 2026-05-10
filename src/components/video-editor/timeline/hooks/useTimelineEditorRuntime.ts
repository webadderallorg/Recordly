import type { Span } from "dnd-timeline";
import type { ForwardedRef, RefObject } from "react";
import { useCallback, useImperativeHandle } from "react";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
} from "../../types";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import type { TimelineEditorHandle } from "../TimelineEditor";
import { useTimelineAudioActions } from "./actions/useTimelineAudioActions";
import { useTimelineTrimActions } from "./actions/useTimelineTrimActions";
import { useTimelineZoomActions } from "./actions/useTimelineZoomActions";
import { useTimelineDndBindings } from "./useTimelineDndBindings";
import { useTimelineKeyboardShortcuts } from "./useTimelineKeyboardShortcuts";
import { useTimelineNormalization } from "./useTimelineNormalization";
import { useTimelineSelection } from "./useTimelineSelection";

interface UseTimelineEditorRuntimeParams {
	ref: ForwardedRef<TimelineEditorHandle>;
	videoDuration: number;
	totalMs: number;
	currentTimeMs: number;
	safeMinDurationMs: number;
	cursorTelemetry: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger: number;
	onAutoSuggestZoomsConsumed?: () => void;
	disableSuggestedZooms: boolean;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
	onTrimAdded?: (splitMs: number, trimDurationMs: number) => void;
	onTrimDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onSelectTrim?: (id: string | null) => void;
	clipRegions: ClipRegion[];
	onClipSplit?: (splitMs: number) => void;
	onClipSpanChange?: (id: string, span: Span) => void;
	onClipDelete?: (id: string) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	annotationRegions: AnnotationRegion[];
	onAnnotationAdded?: (span: Span, trackIndex?: number) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	audioRegions: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	isMac: boolean;
	keyShortcuts: TimelineShortcutBindings;
	isTimelineFocusedRef: RefObject<boolean>;
}

export function useTimelineEditorRuntime({
	ref,
	videoDuration,
	totalMs,
	currentTimeMs,
	safeMinDurationMs,
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
	onTrimSpanChange,
	onTrimAdded,
	onTrimDelete,
	selectedTrimId,
	onSelectTrim,
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
	isMac,
	keyShortcuts,
	isTimelineFocusedRef,
}: UseTimelineEditorRuntimeParams) {
	const {
		keyframes,
		selectedKeyframeId,
		setSelectedKeyframeId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		hasAnyTimelineBlocks,
		addKeyframe,
		deleteSelectedKeyframe,
		handleKeyframeMove,
		deleteSelectedZoom,
		deleteSelectedTrim,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		clearSelectedBlocks,
		deleteAllBlocks,
		handleSelectZoom,
		handleSelectTrim,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectAudio,
		cycleAnnotationsAtCurrentTime,
	} = useTimelineSelection({
		totalMs,
		currentTimeMs,
		zoomRegions,
		trimRegions,
		clipRegions,
		annotationRegions,
		audioRegions,
		selectedZoomId,
		selectedTrimId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
		onZoomDelete,
		onTrimDelete,
		onClipDelete,
		onAnnotationDelete,
		onAudioDelete,
		onSelectZoom,
		onSelectTrim,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
	});

	useTimelineNormalization({
		totalMs,
		safeMinDurationMs,
		zoomRegions,
		trimRegions,
		speedRegions,
		audioRegions,
		onZoomSpanChange,
		onTrimSpanChange,
		onSpeedSpanChange,
		onAudioSpanChange,
	});

	const {
		hasOverlap,
		timelineItems,
		allRegionSpans,
		getResolvedDropRowId,
		handleItemSpanChange,
	} = useTimelineDndBindings({
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

	const {
		defaultRegionDurationMs,
		canPlaceZoomAtMs,
		addZoomAtMs,
		handleAddZoom,
		handleSuggestZooms,
	} = useTimelineZoomActions({
		timeline: { videoDuration, totalMs, currentTimeMs },
		regions: { zoom: zoomRegions, clip: clipRegions },
		cursorTelemetry,
		options: { disableSuggestedZooms },
		autoSuggestZoomsTrigger,
		onAutoSuggestZoomsConsumed,
		onZoomAdded,
		onZoomSuggested,
	});

	const handleSplitClip = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onClipSplit) {
			return;
		}
		onClipSplit(currentTimeMs);
	}, [videoDuration, totalMs, currentTimeMs, onClipSplit]);

	const { handleAddTrim } = useTimelineTrimActions({
		timeline: { videoDuration, totalMs, currentTimeMs },
		regions: { trim: trimRegions },
		onTrimAdded,
	});

	const { handleAddAudio } = useTimelineAudioActions({
		timeline: { videoDuration, totalMs, currentTimeMs },
		regions: { audio: audioRegions },
		onAudioAdded,
	});

	const handleAddAnnotation = useCallback(
		(trackIndex = 0) => {
			if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onAnnotationAdded) {
				return;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return;
			}

			const latestStartPos = Math.max(0, totalMs - defaultDuration);
			const startPos = Math.max(0, Math.min(currentTimeMs, latestStartPos));
			const endPos = Math.min(startPos + defaultDuration, totalMs);
			onAnnotationAdded({ start: startPos, end: endPos }, trackIndex);
		},
		[videoDuration, totalMs, currentTimeMs, defaultRegionDurationMs, onAnnotationAdded],
	);

	useTimelineKeyboardShortcuts({
		isMac,
		keyShortcuts,
		isTimelineFocusedRef,
		hasAnyTimelineBlocks,
		annotationCount: annotationRegions.length,
		selectedKeyframeId,
		selectedZoomId,
		selectedTrimId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		setSelectedKeyframeId,
		addKeyframe,
		handleAddZoom,
		handleAddTrim,
		handleSplitClip,
		handleAddAnnotation: () => handleAddAnnotation(),
		deleteAllBlocks,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		deleteSelectedTrim,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		cycleAnnotationsAtCurrentTime,
	});

	useImperativeHandle(
		ref,
		() => ({
			addZoom: handleAddZoom,
			addTrim: handleAddTrim,
			suggestZooms: handleSuggestZooms,
			splitClip: handleSplitClip,
			addAnnotation: handleAddAnnotation,
			addAudio: handleAddAudio,
			keyframes,
		}),
		[
			handleAddAnnotation,
			handleAddAudio,
			handleAddTrim,
			handleAddZoom,
			handleSuggestZooms,
			handleSplitClip,
			keyframes,
		],
	);

	return {
		keyframes,
		selectedKeyframeId,
		setSelectedKeyframeId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		handleKeyframeMove,
		clearSelectedBlocks,
		handleSelectZoom,
		handleSelectTrim,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectAudio,
		hasOverlap,
		timelineItems,
		allRegionSpans,
		getResolvedDropRowId,
		handleItemSpanChange,
		canPlaceZoomAtMs,
		addZoomAtMs,
		handleAddZoom,
		handleAddTrim,
		handleSuggestZooms,
		handleSplitClip,
		handleAddAudio,
		handleAddAnnotation,
	};
}
