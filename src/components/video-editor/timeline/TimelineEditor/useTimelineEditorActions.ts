import type { Span } from "dnd-timeline";
import { useCallback, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject } from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "../../types";
import type { Keyframe } from "./shared";
import { hasOverlapForSpan, normalizeRegionSpans } from "./timelineActionUtils";
import { useTimelineKeyboardShortcuts } from "./useTimelineKeyboardShortcuts";
import { useTimelineRegionOperations } from "./useTimelineRegionOperations";

interface UseTimelineEditorActionsParams {
	videoDuration: number;
	totalMs: number;
	currentTimeMs: number;
	safeMinDurationMs: number;
	defaultRegionDurationMs: number;
	cursorTelemetry: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger: number;
	onAutoSuggestZoomsConsumed?: () => void;
	disableSuggestedZooms: boolean;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: { cx: number; cy: number }) => void;
	onZoomSpanChange: (id: string, span: Span) => void;
	onZoomDelete: (id: string) => void;
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	trimRegions: TrimRegion[];
	onTrimAdded?: (span: Span) => void;
	onTrimSpanChange?: (id: string, span: Span) => void;
	onTrimDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onSelectTrim?: (id: string | null) => void;
	clipRegions: ClipRegion[];
	onClipSplit?: (splitMs: number) => void;
	onClipDelete?: (id: string) => void;
	selectedClipId?: string | null;
	onSelectClip?: (id: string | null) => void;
	annotationRegions: AnnotationRegion[];
	onAnnotationAdded?: (span: Span, trackIndex?: number) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	speedRegions: SpeedRegion[];
	onSpeedAdded?: (span: Span) => void;
	onSpeedSpanChange?: (id: string, span: Span) => void;
	onSpeedDelete?: (id: string) => void;
	selectedSpeedId?: string | null;
	onSelectSpeed?: (id: string | null) => void;
	audioRegions: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAudioSpanChange?: (id: string, span: Span) => void;
	onAudioDelete?: (id: string) => void;
	selectedAudioId?: string | null;
	onSelectAudio?: (id: string | null) => void;
	onAspectRatioChange?: (aspectRatio: AspectRatio) => void;
	customAspectWidth: string;
	customAspectHeight: string;
	setKeyframes: React.Dispatch<React.SetStateAction<Keyframe[]>>;
	selectedKeyframeId: string | null;
	setSelectedKeyframeId: React.Dispatch<React.SetStateAction<string | null>>;
	setSelectAllBlocksActive: React.Dispatch<React.SetStateAction<boolean>>;
	isTimelineFocusedRef: MutableRefObject<boolean>;
}

export function useTimelineEditorActions({
	videoDuration,
	totalMs,
	currentTimeMs,
	safeMinDurationMs,
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
	customAspectWidth,
	customAspectHeight,
	setKeyframes,
	selectedKeyframeId,
	setSelectedKeyframeId,
	setSelectAllBlocksActive,
	isTimelineFocusedRef,
}: UseTimelineEditorActionsParams) {
	const hasAnyTimelineBlocks = useMemo(
		() =>
			zoomRegions.length > 0 ||
			trimRegions.length > 0 ||
			clipRegions.length > 0 ||
			annotationRegions.length > 0 ||
			speedRegions.length > 0 ||
			audioRegions.length > 0,
		[annotationRegions, audioRegions, clipRegions, speedRegions, trimRegions, zoomRegions],
	);

	const applyCustomAspectRatio = useCallback(() => {
		const width = Number.parseInt(customAspectWidth, 10);
		const height = Number.parseInt(customAspectHeight, 10);

		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
			toast.error("Custom aspect ratio must be positive numbers.");
			return;
		}

		onAspectRatioChange?.(`${width}:${height}` as AspectRatio);
	}, [customAspectHeight, customAspectWidth, onAspectRatioChange]);

	const handleCustomAspectRatioKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			event.stopPropagation();
			if (event.key === "Enter") {
				event.preventDefault();
				applyCustomAspectRatio();
			}
		},
		[applyCustomAspectRatio],
	);

	const addKeyframe = useCallback(() => {
		if (totalMs === 0) return;
		const time = Math.max(0, Math.min(currentTimeMs, totalMs));
		setKeyframes((previous) => {
			if (previous.some((keyframe) => Math.abs(keyframe.time - time) < 1)) {
				return previous;
			}
			return [...previous, { id: uuidv4(), time }];
		});
	}, [currentTimeMs, setKeyframes, totalMs]);

	const deleteSelectedKeyframe = useCallback(() => {
		if (!selectedKeyframeId) return;
		setKeyframes((previous) => previous.filter((keyframe) => keyframe.id !== selectedKeyframeId));
		setSelectedKeyframeId(null);
	}, [selectedKeyframeId, setKeyframes, setSelectedKeyframeId]);

	const handleKeyframeMove = useCallback(
		(id: string, newTime: number) => {
			setKeyframes((previous) =>
				previous.map((keyframe) =>
					keyframe.id === id
						? { ...keyframe, time: Math.max(0, Math.min(newTime, totalMs)) }
						: keyframe,
				),
			);
		},
		[setKeyframes, totalMs],
	);

	const clearSelectedBlocks = useCallback(() => {
		onSelectZoom(null);
		onSelectTrim?.(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectSpeed?.(null);
		onSelectAudio?.(null);
		setSelectAllBlocksActive(false);
	}, [
		onSelectAnnotation,
		onSelectAudio,
		onSelectClip,
		onSelectSpeed,
		onSelectTrim,
		onSelectZoom,
		setSelectAllBlocksActive,
	]);

	const deleteAllBlocks = useCallback(() => {
		zoomRegions.forEach((region) => onZoomDelete(region.id));
		trimRegions.forEach((region) => onTrimDelete?.(region.id));
		clipRegions.forEach((region) => onClipDelete?.(region.id));
		annotationRegions.forEach((region) => onAnnotationDelete?.(region.id));
		speedRegions.forEach((region) => onSpeedDelete?.(region.id));
		audioRegions.forEach((region) => onAudioDelete?.(region.id));
		clearSelectedBlocks();
		setSelectedKeyframeId(null);
	}, [
		annotationRegions,
		audioRegions,
		clearSelectedBlocks,
		clipRegions,
		onAnnotationDelete,
		onAudioDelete,
		onClipDelete,
		onSpeedDelete,
		onTrimDelete,
		onZoomDelete,
		setSelectedKeyframeId,
		speedRegions,
		trimRegions,
		zoomRegions,
	]);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectZoom(id);
		},
		[onSelectZoom, setSelectAllBlocksActive],
	);

	const handleSelectTrim = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectTrim?.(id);
		},
		[onSelectTrim, setSelectAllBlocksActive],
	);

	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectClip?.(id);
		},
		[onSelectClip, setSelectAllBlocksActive],
	);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectAnnotation?.(id);
		},
		[onSelectAnnotation, setSelectAllBlocksActive],
	);

	const handleSelectSpeed = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectSpeed?.(id);
		},
		[onSelectSpeed, setSelectAllBlocksActive],
	);

	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectAudio?.(id);
		},
		[onSelectAudio, setSelectAllBlocksActive],
	);

	useEffect(() => {
		normalizeRegionSpans(zoomRegions, totalMs, safeMinDurationMs, onZoomSpanChange);
		normalizeRegionSpans(trimRegions, totalMs, safeMinDurationMs, onTrimSpanChange);
		normalizeRegionSpans(speedRegions, totalMs, safeMinDurationMs, onSpeedSpanChange);
		normalizeRegionSpans(audioRegions, totalMs, safeMinDurationMs, onAudioSpanChange);
	}, [
		audioRegions,
		onAudioSpanChange,
		onSpeedSpanChange,
		onTrimSpanChange,
		onZoomSpanChange,
		safeMinDurationMs,
		speedRegions,
		totalMs,
		trimRegions,
		zoomRegions,
	]);

	const hasOverlap = useCallback(
		(newSpan: Span, excludeId?: string) => {
			return hasOverlapForSpan(
				newSpan,
				excludeId,
				annotationRegions,
				zoomRegions,
				trimRegions,
				clipRegions,
				speedRegions,
				audioRegions,
			);
		},
		[annotationRegions, audioRegions, clipRegions, speedRegions, trimRegions, zoomRegions],
	);

	const {
		handleAddZoom,
		handleSuggestZooms,
		handleAddTrim,
		handleSplitClip,
		handleAddSpeed,
		handleAddAudio,
		handleAddAnnotation,
	} = useTimelineRegionOperations({
		videoDuration,
		totalMs,
		currentTimeMs,
		defaultRegionDurationMs,
		cursorTelemetry,
		autoSuggestZoomsTrigger,
		onAutoSuggestZoomsConsumed,
		disableSuggestedZooms,
		zoomRegions,
		onZoomAdded,
		onZoomSuggested,
		trimRegions,
		onTrimAdded,
		onClipSplit,
		speedRegions,
		onSpeedAdded,
		audioRegions,
		onAudioAdded,
		onAnnotationAdded,
	});

	useTimelineKeyboardShortcuts({
		annotationRegions,
		currentTimeMs,
		hasAnyTimelineBlocks,
		isTimelineFocusedRef,
		addKeyframe,
		handleAddZoom,
		handleAddTrim,
		handleSplitClip,
		handleAddAnnotation: () => handleAddAnnotation(),
		handleAddSpeed,
		deleteSelectedKeyframe,
		deleteAllBlocks,
		selectedAnnotationId,
		selectedAudioId,
		selectedClipId,
		selectedKeyframeId,
		selectedSpeedId,
		selectedTrimId,
		selectedZoomId,
		onSelectAnnotation,
		onSelectAudio,
		onSelectClip,
		onSelectSpeed,
		onSelectTrim,
		onSelectZoom,
		onAnnotationDelete,
		onAudioDelete,
		onClipDelete,
		onSpeedDelete,
		onTrimDelete,
		onZoomDelete,
		setSelectedKeyframeId,
		setSelectAllBlocksActive,
	});

	return {
		applyCustomAspectRatio,
		handleCustomAspectRatioKeyDown,
		addKeyframe,
		deleteSelectedKeyframe,
		handleKeyframeMove,
		handleAddZoom,
		handleSuggestZooms,
		handleAddTrim,
		handleSplitClip,
		handleAddSpeed,
		handleAddAudio,
		handleAddAnnotation,
		handleSelectZoom,
		handleSelectTrim,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectSpeed,
		handleSelectAudio,
		clearSelectedBlocks,
		hasAnyTimelineBlocks,
		hasOverlap,
	};
}