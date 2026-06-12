import { useCallback, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { TimelineRegion } from "../core/timelineTypes";
import type { MarqueeSelectedItem } from "./utils/timelineMarqueeUtils";

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
	selectedCameraId?: string | null;
	selectedFillFrameId?: string | null;
	onZoomDelete: (id: string) => void;
	onClipDelete?: (id: string) => void;
	onAnnotationDelete?: (id: string) => void;
	onAudioDelete?: (id: string) => void;
	onCameraDelete?: (id: string) => void;
	onFillFrameDelete?: (id: string) => void;
	onSelectZoom: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectCamera?: (id: string | null) => void;
	onSelectFillFrame?: (id: string | null) => void;
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
	selectedCameraId,
	selectedFillFrameId,
	onZoomDelete,
	onClipDelete,
	onAnnotationDelete,
	onAudioDelete,
	onCameraDelete,
	onFillFrameDelete,
	onSelectZoom,
	onSelectClip,
	onSelectAnnotation,
	onSelectAudio,
	onSelectCamera,
	onSelectFillFrame,
}: UseTimelineSelectionParams) {
	const [keyframes, setKeyframes] = useState<{ id: string; time: number }[]>([]);
	const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
	const [selectAllBlocksActive, setSelectAllBlocksActive] = useState(false);
	const [multiSelectedItems, setMultiSelectedItems] = useState<MarqueeSelectedItem[]>([]);
	const hasAnyZoomBlocks = useMemo(() => zoomRegions.length > 0, [zoomRegions.length]);
	const multiSelectedIds = useMemo(
		() => new Set(multiSelectedItems.map((item) => item.id)),
		[multiSelectedItems],
	);

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
		if (selectAllBlocksActive) {
			zoomRegions.map((region) => region.id).forEach((id) => onZoomDelete(id));
		} else if (selectedZoomId) {
			onZoomDelete(selectedZoomId);
		} else {
			return;
		}

		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCamera?.(null);
		onSelectFillFrame?.(null);
		setSelectAllBlocksActive(false);
	}, [
		selectAllBlocksActive,
		zoomRegions,
		onZoomDelete,
		selectedZoomId,
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectCamera,
		onSelectFillFrame,
	]);

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

	const deleteSelectedCamera = useCallback(() => {
		if (!selectedCameraId || !onCameraDelete || !onSelectCamera) return;
		onCameraDelete(selectedCameraId);
		onSelectCamera(null);
	}, [selectedCameraId, onCameraDelete, onSelectCamera]);

	const deleteSelectedFillFrame = useCallback(() => {
		if (!selectedFillFrameId || !onFillFrameDelete || !onSelectFillFrame) return;
		onFillFrameDelete(selectedFillFrameId);
		onSelectFillFrame(null);
	}, [selectedFillFrameId, onFillFrameDelete, onSelectFillFrame]);

	// Marquee release: replace every selection (single + select-all) with the
	// box-selected items.
	const applyMarqueeSelection = useCallback(
		(items: MarqueeSelectedItem[]) => {
			onSelectZoom(null);
			onSelectClip?.(null);
			onSelectAnnotation?.(null);
			onSelectAudio?.(null);
			onSelectCamera?.(null);
			onSelectFillFrame?.(null);
			setSelectedKeyframeId(null);
			setSelectAllBlocksActive(false);
			setMultiSelectedItems(items);
		},
		[
			onSelectZoom,
			onSelectClip,
			onSelectAnnotation,
			onSelectAudio,
			onSelectCamera,
			onSelectFillFrame,
		],
	);

	// Routes every multi-selected item to its kind's existing delete handler.
	// "speed" chips have no delete handler today and are skipped.
	const deleteMultiSelectedItems = useCallback(() => {
		if (multiSelectedItems.length === 0) return;
		for (const item of multiSelectedItems) {
			if (item.kind === "zoom") {
				onZoomDelete(item.id);
			} else if (item.kind === "camera") {
				onCameraDelete?.(item.id);
			} else if (item.kind === "fillFrame") {
				onFillFrameDelete?.(item.id);
			} else if (item.kind === "annotation") {
				onAnnotationDelete?.(item.id);
			}
		}
		setMultiSelectedItems([]);
	}, [multiSelectedItems, onZoomDelete, onCameraDelete, onFillFrameDelete, onAnnotationDelete]);

	const clearSelectedBlocks = useCallback(() => {
		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCamera?.(null);
		onSelectFillFrame?.(null);
		setSelectAllBlocksActive(false);
		setMultiSelectedItems([]);
	}, [
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectCamera,
		onSelectFillFrame,
	]);

	const activateSelectAllZooms = useCallback(() => {
		onSelectZoom(null);
		onSelectClip?.(null);
		onSelectAnnotation?.(null);
		onSelectAudio?.(null);
		onSelectCamera?.(null);
		onSelectFillFrame?.(null);
		setSelectedKeyframeId(null);
		setMultiSelectedItems([]);
		setSelectAllBlocksActive(true);
	}, [
		onSelectZoom,
		onSelectClip,
		onSelectAnnotation,
		onSelectAudio,
		onSelectCamera,
		onSelectFillFrame,
	]);

	const handleSelectZoom = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setMultiSelectedItems([]);
			onSelectZoom(id);
		},
		[onSelectZoom],
	);

	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setMultiSelectedItems([]);
			onSelectClip?.(id);
		},
		[onSelectClip],
	);

	const handleSelectAnnotation = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setMultiSelectedItems([]);
			onSelectAnnotation?.(id);
		},
		[onSelectAnnotation],
	);

	const handleSelectAudio = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setMultiSelectedItems([]);
			onSelectAudio?.(id);
		},
		[onSelectAudio],
	);

	const handleSelectCamera = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setMultiSelectedItems([]);
			onSelectCamera?.(id);
		},
		[onSelectCamera],
	);

	const handleSelectFillFrame = useCallback(
		(id: string | null) => {
			setSelectAllBlocksActive(false);
			setMultiSelectedItems([]);
			onSelectFillFrame?.(id);
		},
		[onSelectFillFrame],
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
		hasAnyZoomBlocks,
		activateSelectAllZooms,
		addKeyframe,
		deleteSelectedKeyframe,
		handleKeyframeMove,
		deleteSelectedZoom,
		deleteSelectedClip,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCamera,
		deleteSelectedFillFrame,
		multiSelectedItems,
		multiSelectedIds,
		applyMarqueeSelection,
		deleteMultiSelectedItems,
		clearSelectedBlocks,
		handleSelectZoom,
		handleSelectClip,
		handleSelectAnnotation,
		handleSelectAudio,
		handleSelectCamera,
		handleSelectFillFrame,
		cycleAnnotationsAtCurrentTime,
	};
}
