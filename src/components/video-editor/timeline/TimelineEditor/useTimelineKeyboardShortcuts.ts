import { useEffect, type MutableRefObject } from "react";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { matchesShortcut } from "@/lib/shortcuts";
import type { AnnotationRegion } from "../../types";
import { deleteSelectedRegion } from "./timelineActionUtils";

interface UseTimelineKeyboardShortcutsParams {
	annotationRegions: AnnotationRegion[];
	currentTimeMs: number;
	hasAnyTimelineBlocks: boolean;
	isTimelineFocusedRef: MutableRefObject<boolean>;
	addKeyframe: () => void;
	handleAddZoom: () => void;
	handleAddTrim: () => void;
	handleSplitClip: () => void;
	handleAddAnnotation: () => void;
	handleAddSpeed: () => void;
	deleteSelectedKeyframe: () => void;
	deleteAllBlocks: () => void;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedClipId?: string | null;
	selectedKeyframeId?: string | null;
	selectedSpeedId?: string | null;
	selectedTrimId?: string | null;
	selectedZoomId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onSelectAudio?: (id: string | null) => void;
	onSelectClip?: (id: string | null) => void;
	onSelectSpeed?: (id: string | null) => void;
	onSelectTrim?: (id: string | null) => void;
	onSelectZoom: (id: string | null) => void;
	onAnnotationDelete?: (id: string) => void;
	onAudioDelete?: (id: string) => void;
	onClipDelete?: (id: string) => void;
	onSpeedDelete?: (id: string) => void;
	onTrimDelete?: (id: string) => void;
	onZoomDelete: (id: string) => void;
	setSelectedKeyframeId: React.Dispatch<React.SetStateAction<string | null>>;
	setSelectAllBlocksActive: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useTimelineKeyboardShortcuts({
	annotationRegions,
	currentTimeMs,
	hasAnyTimelineBlocks,
	isTimelineFocusedRef,
	addKeyframe,
	handleAddZoom,
	handleAddTrim,
	handleSplitClip,
	handleAddAnnotation,
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
}: UseTimelineKeyboardShortcutsParams) {
	const { shortcuts: keyShortcuts, isMac } = useShortcuts();

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
				return;
			}

			if (matchesShortcut(event, { key: "a", ctrl: true }, isMac)) {
				if (!hasAnyTimelineBlocks || !isTimelineFocusedRef.current) {
					return;
				}

				event.preventDefault();
				setSelectedKeyframeId(null);
				setSelectAllBlocksActive(true);
				return;
			}

			if (matchesShortcut(event, keyShortcuts.addKeyframe, isMac)) addKeyframe();
			if (matchesShortcut(event, keyShortcuts.addZoom, isMac)) handleAddZoom();
			if (matchesShortcut(event, keyShortcuts.addTrim, isMac)) handleAddTrim();
			if (matchesShortcut(event, keyShortcuts.splitClip, isMac)) handleSplitClip();
			if (matchesShortcut(event, keyShortcuts.addAnnotation, isMac)) handleAddAnnotation();
			if (matchesShortcut(event, keyShortcuts.addSpeed, isMac)) handleAddSpeed();

			if (event.key === "Tab" && annotationRegions.length > 0) {
				const overlapping = annotationRegions
					.filter((annotation) => currentTimeMs >= annotation.startMs && currentTimeMs <= annotation.endMs)
					.sort((left, right) => left.zIndex - right.zIndex);

				if (overlapping.length > 0) {
					event.preventDefault();
					if (!selectedAnnotationId || !overlapping.some((annotation) => annotation.id === selectedAnnotationId)) {
						onSelectAnnotation?.(overlapping[0].id);
					} else {
						const currentIndex = overlapping.findIndex((annotation) => annotation.id === selectedAnnotationId);
						const nextIndex = event.shiftKey
							? (currentIndex - 1 + overlapping.length) % overlapping.length
							: (currentIndex + 1) % overlapping.length;
						onSelectAnnotation?.(overlapping[nextIndex].id);
					}
				}
			}

			if (
				event.key === "Delete" ||
				event.key === "Backspace" ||
				matchesShortcut(event, keyShortcuts.deleteSelected, isMac)
			) {
				if (selectedKeyframeId) {
					deleteSelectedKeyframe();
					return;
				}

				if (selectedZoomId) deleteSelectedRegion(selectedZoomId, onZoomDelete, onSelectZoom);
				else if (selectedTrimId) deleteSelectedRegion(selectedTrimId, onTrimDelete, onSelectTrim);
				else if (selectedClipId) deleteSelectedRegion(selectedClipId, onClipDelete, onSelectClip);
				else if (selectedAnnotationId)
					deleteSelectedRegion(selectedAnnotationId, onAnnotationDelete, onSelectAnnotation);
				else if (selectedSpeedId) deleteSelectedRegion(selectedSpeedId, onSpeedDelete, onSelectSpeed);
				else if (selectedAudioId) deleteSelectedRegion(selectedAudioId, onAudioDelete, onSelectAudio);
				else if (hasAnyTimelineBlocks) deleteAllBlocks();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		addKeyframe,
		annotationRegions,
		currentTimeMs,
		deleteAllBlocks,
		deleteSelectedKeyframe,
		handleAddAnnotation,
		handleAddSpeed,
		handleAddTrim,
		handleAddZoom,
		handleSplitClip,
		hasAnyTimelineBlocks,
		isMac,
		isTimelineFocusedRef,
		keyShortcuts,
		onAnnotationDelete,
		onAudioDelete,
		onClipDelete,
		onSelectAnnotation,
		onSelectAudio,
		onSelectClip,
		onSelectSpeed,
		onSelectTrim,
		onSelectZoom,
		onSpeedDelete,
		onTrimDelete,
		onZoomDelete,
		selectedAnnotationId,
		selectedAudioId,
		selectedClipId,
		selectedKeyframeId,
		selectedSpeedId,
		selectedTrimId,
		selectedZoomId,
		setSelectAllBlocksActive,
		setSelectedKeyframeId,
	]);
}