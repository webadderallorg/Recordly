import { useCallback, useMemo, useState } from "react";
import type { TimelineRegion } from "../core/timelineTypes";

interface UseTimelineSelectionParams {
	totalMs: number;
	currentTimeMs: number;
	zoomRegions: TimelineRegion[];
	clipRegions: TimelineRegion[];
	annotationRegions: (TimelineRegion & { zIndex: number })[];
	audioRegions: TimelineRegion[];
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	onZoomDeleteMany: (ids: readonly string[]) => void;
	onClipDelete?: (id: string) => void;
	onAnnotationDelete?: (id: string) => void;
	onAudioDelete?: (id: string) => void;
	onCaptionDelete?: (id: string) => void;
	onSelectZoom: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCaption?: (id: string | null) => void;
}

export function useTimelineSelection({
	totalMs,
	currentTimeMs,
	zoomRegions,
	annotationRegions,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	onZoomDeleteMany,
	onClipDelete,
	onAnnotationDelete,
	onAudioDelete,
	onCaptionDelete,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCaption,
}: UseTimelineSelectionParams) {
	const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
	const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
	const [zoomSelectionIds, setZoomSelectionIds] = useState<ReadonlySet<string>>(() => new Set());
	const selectedZoomIds = useMemo(
		() => new Set(zoomRegions.filter(({ id }) => zoomSelectionIds.has(id)).map(({ id }) => id)),
		[zoomRegions, zoomSelectionIds],
	);
	const clearZoomSelection = useCallback(() => {
		setZoomSelectionIds((previous) => (previous.size ? new Set() : previous));
	}, []);
	const hasAnyZoomBlocks = useMemo(() => zoomRegions.length > 0, [zoomRegions.length]);

	const addKeyframe = useCallback(() => {
		if (totalMs === 0) return;
		const time = Math.max(0, Math.min(currentTimeMs, totalMs));
		if (keyframes.some((kf) => Math.abs(kf.time - time) < 1)) return;
		setKeyframes((prev) => [...prev, { id: globalThis.crypto.randomUUID(), time }]);
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

	const deleteSelectedClip = useCallback(() => {
		if (!selectedClipId || !onClipDelete) return;
		onClipDelete(selectedClipId);
		onSelectClip?.(null);
	}, [selectedClipId, onClipDelete, onSelectClip]);

	const deleteSelectedAnnotation = useCallback(() => {
		if (!selectedAnnotationId || !onAnnotationDelete) return;
		onAnnotationDelete(selectedAnnotationId);
		onSelectAnnotation?.(null);
	}, [selectedAnnotationId, onAnnotationDelete, onSelectAnnotation]);

	const deleteSelectedAudio = useCallback(() => {
		if (!selectedAudioId || !onAudioDelete) return;
		onAudioDelete(selectedAudioId);
		onSelectAudio?.(null);
	}, [selectedAudioId, onAudioDelete, onSelectAudio]);

	const deleteSelectedCaption = useCallback(() => {
		if (!selectedCaptionId || !onCaptionDelete) return;
		onCaptionDelete(selectedCaptionId);
		onSelectCaption?.(null);
	}, [selectedCaptionId, onCaptionDelete, onSelectCaption]);

	const clearSelectedBlocks = useCallback(() => {
		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCaption?.(null);
		clearZoomSelection();
	}, [
		clearZoomSelection,
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectCaption,
	]);

	const handleSelectZooms = useCallback(
		(ids: readonly string[]) => {
			clearSelectedBlocks();
			setSelectedKeyframeId(null);
			setZoomSelectionIds(new Set(ids));
		},
		[clearSelectedBlocks],
	);

	const activateSelectAllZooms = useCallback(() => {
		handleSelectZooms(zoomRegions.map(({ id }) => id));
	}, [handleSelectZooms, zoomRegions]);

	const deleteSelectedZoom = useCallback(() => {
		const ids = selectedZoomIds.size
			? [...selectedZoomIds]
			: selectedZoomId
				? [selectedZoomId]
				: [];
		if (!ids.length) return;
		onZoomDeleteMany(ids);
		clearSelectedBlocks();
	}, [clearSelectedBlocks, onZoomDeleteMany, selectedZoomId, selectedZoomIds]);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			clearZoomSelection();
			setSelectedKeyframeId(null);
			onSelectZoom(id);
		},
		[clearZoomSelection, onSelectZoom],
	);

	const handleSelectClip = useCallback(
		(id: string | null) => {
			clearZoomSelection();
			setSelectedKeyframeId(null);
			onSelectClip?.(id);
		},
		[clearZoomSelection, onSelectClip],
	);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			clearZoomSelection();
			setSelectedKeyframeId(null);
			onSelectAnnotation?.(id);
		},
		[clearZoomSelection, onSelectAnnotation],
	);

	const handleSelectAudio = useCallback(
		(id: string | null) => {
			clearZoomSelection();
			setSelectedKeyframeId(null);
			onSelectAudio?.(id);
		},
		[clearZoomSelection, onSelectAudio],
	);

	const handleSelectCaption = useCallback(
		(id: string | null) => {
			clearZoomSelection();
			setSelectedKeyframeId(null);
			onSelectCaption?.(id);
		},
		[clearZoomSelection, onSelectCaption],
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
		selectedZoomIds,
		clearZoomSelection,
		handleSelectZooms,
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
	};
}
