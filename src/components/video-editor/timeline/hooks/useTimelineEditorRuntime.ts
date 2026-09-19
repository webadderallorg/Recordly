import type { Span } from "dnd-timeline";
import type { ForwardedRef, RefObject } from "react";
import { useCallback, useImperativeHandle } from "react";
import { toast } from "sonner";
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
} from "../../types";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import type { TimelineEditorHandle } from "../TimelineEditor";
import { useTimelineAudioActions } from "./actions/useTimelineAudioActions";
import { useTimelineCaptionActions } from "./actions/useTimelineCaptionActions";
import { useTimelineZoomActions } from "./actions/useTimelineZoomActions";
import { useTimelineDndBindings } from "./useTimelineDndBindings";
import { useTimelineKeyboardShortcuts } from "./useTimelineKeyboardShortcuts";
import { useTimelineNormalization } from "./useTimelineNormalization";
import { useTimelineSelection } from "./useTimelineSelection";
import { resolveDuplicateSelectionTarget } from "./utils/timelineSelectionUtils";

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
	onZoomDuplicate?: (id: string) => boolean;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
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
	onAnnotationDuplicate?: (id: string) => boolean;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	audioRegions: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
	onAudioDuplicate?: (id: string) => boolean;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	captionCues: CaptionCue[];
	onCaptionSpanChange?: (id: string, span: Span) => void;
	onCaptionDelete?: (id: string) => void;
	onCaptionAdded?: (span: Span) => void;
	selectedCaptionId?: string | null;
	onSelectCaption?: (id: string | null) => void;
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
	onZoomDuplicate,
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
	onAnnotationDuplicate,
	selectedAnnotationId,
	onSelectAnnotation,
	speedRegions,
	onSpeedSpanChange,
	audioRegions,
	onAudioAdded,
	onAudioSpanChange,
	onAudioDelete,
	onAudioDuplicate,
	selectedAudioId,
	onSelectAudio,
	captionCues,
	onCaptionSpanChange,
	onCaptionDelete,
	onCaptionAdded,
	selectedCaptionId,
	onSelectCaption,
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
		hasAnyZoomBlocks,
		activateSelectAllZooms,
		addKeyframe,
		deleteSelectedKeyframe,
		handleKeyframeMove,
		deleteSelectedZoom,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCaption,
		clearSelectedBlocks,
		handleSelectZoom,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectAudio,
		handleSelectCaption,
		cycleAnnotationsAtCurrentTime,
	} = useTimelineSelection({
		totalMs,
		currentTimeMs,
		zoomRegions,
		clipRegions,
		annotationRegions,
		audioRegions,
		selectedZoomId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
		selectedCaptionId,
		onZoomDelete,
		onClipDelete,
		onAnnotationDelete,
		onAudioDelete,
		onCaptionDelete,
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectCaption,
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
		captionCues,
		onZoomSpanChange,
		onTrimSpanChange,
		onClipSpanChange,
		onAnnotationSpanChange,
		onSpeedSpanChange,
		onAudioSpanChange,
		onCaptionSpanChange,
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

	const { canPlaceCaptionAtMs, addCaptionAtMs, resolveCaptionSpanAtMs } =
		useTimelineCaptionActions({
			totalMs,
			captionRegions: captionCues,
			onCaptionAdded,
		});

	const handleSplitClip = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onClipSplit) {
			return;
		}
		onClipSplit(currentTimeMs);
	}, [videoDuration, totalMs, currentTimeMs, onClipSplit]);

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

	const handleDuplicateSelected = useCallback(() => {
		const target = resolveDuplicateSelectionTarget({
			selectedZoomId,
			selectedAnnotationId,
			selectedAudioId,
		});

		let ok = false;
		if (target === "zoom" && selectedZoomId && onZoomDuplicate) {
			ok = onZoomDuplicate(selectedZoomId);
		} else if (target === "annotation" && selectedAnnotationId && onAnnotationDuplicate) {
			ok = onAnnotationDuplicate(selectedAnnotationId);
		} else if (target === "audio" && selectedAudioId && onAudioDuplicate) {
			ok = onAudioDuplicate(selectedAudioId);
		} else {
			return;
		}

		if (!ok) {
			toast.error("Not enough space to duplicate after the selected item");
		}
	}, [
		onAnnotationDuplicate,
		onAudioDuplicate,
		onZoomDuplicate,
		selectedAnnotationId,
		selectedAudioId,
		selectedZoomId,
	]);

	useTimelineKeyboardShortcuts({
		isMac,
		keyShortcuts,
		isTimelineFocusedRef,
		hasAnyZoomBlocks,
		activateSelectAllZooms,
		annotationCount: annotationRegions.length,
		selectedKeyframeId,
		selectedZoomId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
		selectedCaptionId,
		selectAllBlocksActive,
		addKeyframe,
		handleAddZoom,
		handleSplitClip,
		handleAddAnnotation: () => handleAddAnnotation(),
		handleDuplicateSelected,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCaption,
		cycleAnnotationsAtCurrentTime,
	});

	useImperativeHandle(
		ref,
		() => ({
			addZoom: handleAddZoom,
			suggestZooms: handleSuggestZooms,
			splitClip: handleSplitClip,
			addAnnotation: handleAddAnnotation,
			addAudio: handleAddAudio,
			keyframes,
		}),
		[
			handleAddAnnotation,
			handleAddAudio,
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
		canPlaceCaptionAtMs,
		addCaptionAtMs,
		resolveCaptionSpanAtMs,
		handleAddZoom,
		handleSuggestZooms,
		handleSplitClip,
		handleAddAudio,
		handleAddAnnotation,
	};
}
