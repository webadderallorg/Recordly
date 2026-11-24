import type { Span } from "dnd-timeline";
import type { ForwardedRef, RefObject } from "react";
import { useCallback, useImperativeHandle } from "react";
import { type ClipTrimEdge, planClipTrimToPlayhead } from "../../clipTrim";
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
import type { ClipSequenceSpan, TimelineShortcutBindings } from "../core/timelineTypes";
import type { TimelineEditorHandle } from "../TimelineEditor";
import { useTimelineAudioActions } from "./actions/useTimelineAudioActions";
import { useTimelineCaptionActions } from "./actions/useTimelineCaptionActions";
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
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (target: string | readonly string[]) => void;
	onDuplicateSelectedRegion?: () => void;
	onClearZooms?: () => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions: TrimRegion[];
	onTrimSpanChange?: (id: string, span: Span) => void;
	clipRegions: ClipRegion[];
	onClipSplit?: (splitMs: number) => void;
	onSeek?: (time: number) => void;
	onClipSpanChange?: (id: string, span: ClipSequenceSpan) => void;
	onClipDelete?: (id: string) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	annotationRegions: AnnotationRegion[];
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
	speedRegions: SpeedRegion[];
	onSpeedSpanChange?: (id: string, span: Span) => void;
	audioRegions: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onAudioDelete?: (id: string) => void;
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
	isTimelineFocusedRef: RefObject<boolean | null>;
	zoomTimelineIn: () => void;
	zoomTimelineOut: () => void;
}

export function useTimelineEditorRuntime({
	ref,
	videoDuration,
	totalMs,
	currentTimeMs,
	safeMinDurationMs,
	cursorTelemetry,
	zoomRegions,
	onZoomAdded,
	onZoomSuggested,
	onZoomSpanChange,
	onZoomDelete,
	onDuplicateSelectedRegion,
	onClearZooms,
	selectedZoomId,
	onSelectZoom,
	trimRegions,
	onTrimSpanChange,
	clipRegions,
	onClipSplit,
	onSeek,
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
	captionCues,
	onCaptionSpanChange,
	onCaptionDelete,
	onCaptionAdded,
	selectedCaptionId,
	onSelectCaption,
	isMac,
	keyShortcuts,
	isTimelineFocusedRef,
	zoomTimelineIn,
	zoomTimelineOut,
}: UseTimelineEditorRuntimeParams) {
	const {
		keyframes,
		selectedKeyframeId,
		setSelectedKeyframeId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		selectedZoomIds,
		setSelectedZoomIds,
		selectZoomIds,
		hasAnyZoomBlocks,
		activateSelectAllZooms,
		addKeyframe,
		deleteSelectedKeyframe,
		handleKeyframeMove,
		deleteSelectedZoom,
		clearAllZooms,
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
		onClearZooms,
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

	const addZoomAndClearGroup = useCallback(
		(span: Span) => {
			onZoomAdded(span);
			setSelectedZoomIds((ids) => (ids.length ? [] : ids));
		},
		[onZoomAdded, setSelectedZoomIds],
	);
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
		onZoomAdded: addZoomAndClearGroup,
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

	const trimClipToPlayhead = useCallback(
		(edge: ClipTrimEdge) => {
			if (!onClipSpanChange || totalMs === 0) return;
			const plan = planClipTrimToPlayhead(
				clipRegions,
				currentTimeMs,
				edge,
				safeMinDurationMs,
			);
			if (!plan) return;
			onClipSpanChange(plan.clip.id, plan.span);
			// The footage after a start trim moves back to where the clip began.
			if (edge === "start") onSeek?.(plan.clip.startMs / 1000);
		},
		[clipRegions, currentTimeMs, onClipSpanChange, onSeek, safeMinDurationMs, totalMs],
	);
	const handleTrimStart = useCallback(() => trimClipToPlayhead("start"), [trimClipToPlayhead]);
	const handleTrimEnd = useCallback(() => trimClipToPlayhead("end"), [trimClipToPlayhead]);

	const { handleAddAudio } = useTimelineAudioActions({
		timeline: { videoDuration, totalMs, currentTimeMs },
		regions: { audio: audioRegions },
		onAudioAdded,
	});

	const handleAddAnnotation = useCallback(
		(
			trackIndex = 0,
			type: AnnotationRegion["type"] = "text",
			placement?: Pick<AnnotationRegion, "position" | "size">,
		) => {
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
			onAnnotationAdded({ start: startPos, end: endPos }, trackIndex, type, placement);
		},
		[videoDuration, totalMs, currentTimeMs, defaultRegionDurationMs, onAnnotationAdded],
	);

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
		selectedZoomIds,
		clearSelectedBlocks,
		addKeyframe,
		handleAddZoom,
		handleSplitClip,
		handleTrimStart,
		handleTrimEnd,
		handleAddAnnotation: () => handleAddAnnotation(),
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		clearAllZooms,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCaption,
		onDuplicateSelectedRegion,
		cycleAnnotationsAtCurrentTime,
	});

	useImperativeHandle(
		ref,
		() => ({
			addZoom: handleAddZoom,
			suggestZooms: handleSuggestZooms,
			clearAllZooms,
			splitClip: handleSplitClip,
			trimStart: handleTrimStart,
			trimEnd: handleTrimEnd,
			addAnnotation: handleAddAnnotation,
			addAudio: handleAddAudio,
			zoomTimelineIn,
			zoomTimelineOut,
			keyframes,
		}),
		[
			clearAllZooms,
			handleAddAnnotation,
			handleAddAudio,
			handleAddZoom,
			handleSuggestZooms,
			handleSplitClip,
			handleTrimEnd,
			handleTrimStart,
			keyframes,
			zoomTimelineIn,
			zoomTimelineOut,
		],
	);

	return {
		keyframes,
		selectedKeyframeId,
		setSelectedKeyframeId,
		selectAllBlocksActive,
		setSelectAllBlocksActive,
		selectedZoomIds,
		setSelectedZoomIds,
		selectZoomIds,
		deleteSelectedZoom,
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
