import { useCallback, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { TimelineRegion } from "../core/timelineTypes";

interface UseTimelineSelectionParams {
	totalMs: number;
	currentTimeMs: number;
	zoomRegions: TimelineRegion[];
	clipRegions: TimelineRegion[];
	annotationRegions: (TimelineRegion & { zIndex: number })[];
	audioRegions: TimelineRegion[];
	webcamSizeRegions: TimelineRegion[];
	webcamFocusRegions: TimelineRegion[];
	webcamPositionRegions: TimelineRegion[];
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedWebcamSizeRegionId?: string | null;
	selectedWebcamFocusRegionId?: string | null;
	selectedWebcamPositionRegionId?: string | null;
	onZoomDelete: (id: string) => void;
	onClipDelete?: (id: string) => void;
	onAnnotationDelete?: (id: string) => void;
	onAudioDelete?: (id: string) => void;
	onWebcamSizeDelete?: (id: string) => void;
	onWebcamFocusDelete?: (id: string) => void;
	onWebcamPositionDelete?: (id: string) => void;
	onSelectZoom: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectWebcamSize?: (id: string | null) => void;
	onSelectWebcamFocus?: (id: string | null) => void;
	onSelectWebcamPosition?: (id: string | null) => void;
}

export function useTimelineSelection({
	totalMs,
	currentTimeMs,
	zoomRegions,
	clipRegions,
	annotationRegions,
	audioRegions,
	webcamSizeRegions,
	webcamFocusRegions,
	webcamPositionRegions,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedWebcamSizeRegionId,
	selectedWebcamFocusRegionId,
	selectedWebcamPositionRegionId,
	onZoomDelete,
	onClipDelete,
	onAnnotationDelete,
	onAudioDelete,
	onWebcamSizeDelete,
	onWebcamFocusDelete,
	onWebcamPositionDelete,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectWebcamSize,
	onSelectWebcamFocus,
	onSelectWebcamPosition,
}: UseTimelineSelectionParams) {
	const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
	const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
	const [selectAllBlocksActive, setSelectAllBlocksActive] = useState(false);

	const addKeyframe = useCallback(() => {
		if (totalMs === 0) return;
		const time = Math.max(0, Math.min(currentTimeMs, totalMs));
		if (keyframes.some((kf) => Math.abs(kf.time - time) < 1)) return;
		setKeyframes((prev) => [...prev, { id: uuidv4(), time }]);
	}, [currentTimeMs, totalMs, keyframes]);

	const deleteSelectedKeyframe = useCallback(() => {
		if (!selectedKeyframeId) return;
		setKeyframes((prev) => prev.filter((kf) => kf.id !== selectedKeyframeId));
		setSelectedKeyframeId(null);
	}, [selectedKeyframeId]);

	const handleKeyframeMove = useCallback(
		(id: string, newTime: number) => {
			setKeyframes((prev) =>
				prev.map((kf) =>
					kf.id === id ? { ...kf, time: Math.max(0, Math.min(newTime, totalMs)) } : kf,
				),
			);
		},
		[totalMs],
	);

	const deleteSelectedZoom = useCallback(() => {
		if (!selectedZoomId) return;
		onZoomDelete(selectedZoomId);
		onSelectZoom(null);
	}, [selectedZoomId, onZoomDelete, onSelectZoom]);

	const deleteSelectedClip = useCallback(() => {
		if (!selectedClipId || !onClipDelete || !onSelectClip) return;
		onClipDelete(selectedClipId);
		onSelectClip(null);
	}, [selectedClipId, onClipDelete, onSelectClip]);

	const deleteSelectedAnnotation = useCallback(() => {
		if (!selectedAnnotationId || !onAnnotationDelete || !onSelectAnnotation) return;
		onAnnotationDelete(selectedAnnotationId);
		onSelectAnnotation(null);
	}, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

	const deleteSelectedAudio = useCallback(() => {
		if (!selectedAudioId || !onAudioDelete || !onSelectAudio) return;
		onAudioDelete(selectedAudioId);
		onSelectAudio(null);
	}, [selectedAudioId, onAudioDelete, onSelectAudio]);

	const deleteSelectedWebcamSize = useCallback(() => {
		if (!selectedWebcamSizeRegionId || !onWebcamSizeDelete || !onSelectWebcamSize) return;
		onWebcamSizeDelete(selectedWebcamSizeRegionId);
		onSelectWebcamSize(null);
	}, [selectedWebcamSizeRegionId, onWebcamSizeDelete, onSelectWebcamSize]);

	const deleteSelectedWebcamFocus = useCallback(() => {
		if (!selectedWebcamFocusRegionId || !onWebcamFocusDelete || !onSelectWebcamFocus) return;
		onWebcamFocusDelete(selectedWebcamFocusRegionId);
		onSelectWebcamFocus(null);
	}, [selectedWebcamFocusRegionId, onWebcamFocusDelete, onSelectWebcamFocus]);

	const deleteSelectedWebcamPosition = useCallback(() => {
		if (!selectedWebcamPositionRegionId || !onWebcamPositionDelete || !onSelectWebcamPosition)
			return;
		onWebcamPositionDelete(selectedWebcamPositionRegionId);
		onSelectWebcamPosition(null);
	}, [selectedWebcamPositionRegionId, onWebcamPositionDelete, onSelectWebcamPosition]);

	const clearSelectedBlocks = useCallback(() => {
		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectWebcamSize?.(null);
		onSelectWebcamFocus?.(null);
		onSelectWebcamPosition?.(null);
		setSelectAllBlocksActive(false);
	}, [
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectWebcamSize,
		onSelectWebcamFocus,
		onSelectWebcamPosition,
	]);

	const hasAnyTimelineBlocks = useMemo(
		() =>
			zoomRegions.length > 0 ||
			clipRegions.length > 0 ||
			annotationRegions.length > 0 ||
			audioRegions.length > 0 ||
			webcamSizeRegions.length > 0 ||
			webcamFocusRegions.length > 0 ||
			webcamPositionRegions.length > 0,
		[
			zoomRegions.length,
			clipRegions.length,
			annotationRegions.length,
			audioRegions.length,
			webcamSizeRegions.length,
			webcamFocusRegions.length,
			webcamPositionRegions.length,
		],
	);

	const deleteAllBlocks = useCallback(() => {
		zoomRegions.map((r) => r.id).forEach((id) => onZoomDelete(id));
		clipRegions.map((r) => r.id).forEach((id) => onClipDelete?.(id));
		annotationRegions.map((r) => r.id).forEach((id) => onAnnotationDelete?.(id));
		audioRegions.map((r) => r.id).forEach((id) => onAudioDelete?.(id));
		webcamSizeRegions.map((r) => r.id).forEach((id) => onWebcamSizeDelete?.(id));
		webcamFocusRegions.map((r) => r.id).forEach((id) => onWebcamFocusDelete?.(id));
		webcamPositionRegions.map((r) => r.id).forEach((id) => onWebcamPositionDelete?.(id));
		clearSelectedBlocks();
		setSelectedKeyframeId(null);
	}, [
		zoomRegions,
		clipRegions,
		annotationRegions,
		audioRegions,
		webcamSizeRegions,
		webcamFocusRegions,
		webcamPositionRegions,
		onZoomDelete,
		onClipDelete,
		onAnnotationDelete,
		onAudioDelete,
		onWebcamSizeDelete,
		onWebcamFocusDelete,
		onWebcamPositionDelete,
		clearSelectedBlocks,
	]);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectZoom(id);
		},
		[onSelectZoom],
	);

	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectClip?.(id);
		},
		[onSelectClip],
	);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectAnnotation?.(id);
		},
		[onSelectAnnotation],
	);

	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectAudio?.(id);
		},
		[onSelectAudio],
	);

	const handleSelectWebcamSize = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectWebcamSize?.(id);
		},
		[onSelectWebcamSize],
	);

	const handleSelectWebcamFocus = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectWebcamFocus?.(id);
		},
		[onSelectWebcamFocus],
	);

	const handleSelectWebcamPosition = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			onSelectWebcamPosition?.(id);
		},
		[onSelectWebcamPosition],
	);

	const cycleAnnotationsAtCurrentTime = useCallback(
		(backward = false) => {
			const overlapping = annotationRegions
				.filter((a) => currentTimeMs >= a.startMs && currentTimeMs <= a.endMs)
				.sort((a, b) => a.zIndex - b.zIndex);
			if (overlapping.length === 0) {
				return false;
			}

			if (!selectedAnnotationId || !overlapping.some((a) => a.id === selectedAnnotationId)) {
				onSelectAnnotation?.(overlapping[0].id);
				return true;
			}

			const currentIndex = overlapping.findIndex((a) => a.id === selectedAnnotationId);
			const nextIndex = backward
				? (currentIndex - 1 + overlapping.length) % overlapping.length
				: (currentIndex + 1) % overlapping.length;
			onSelectAnnotation?.(overlapping[nextIndex].id);
			return true;
		},
		[annotationRegions, currentTimeMs, selectedAnnotationId, onSelectAnnotation],
	);

	return {
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
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedWebcamSize,
		deleteSelectedWebcamFocus,
		deleteSelectedWebcamPosition,
		clearSelectedBlocks,
		deleteAllBlocks,
		handleSelectZoom,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectAudio,
		handleSelectWebcamSize,
		handleSelectWebcamFocus,
		handleSelectWebcamPosition,
		cycleAnnotationsAtCurrentTime,
	};
}
