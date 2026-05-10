import { type RefObject, useEffect } from "react";
import { matchesShortcut } from "@/lib/shortcuts";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import { resolveDeleteSelectionTarget } from "./utils/timelineSelectionUtils";

interface UseTimelineKeyboardShortcutsParams {
	isMac: boolean;
	keyShortcuts: TimelineShortcutBindings;
	isTimelineFocusedRef: RefObject<boolean>;
	hasAnyTimelineBlocks: boolean;
	annotationCount: number;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedTrimId?: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectAllBlocksActive: boolean;
	setSelectAllBlocksActive: (active: boolean) => void;
	setSelectedKeyframeId: (id: string | null) => void;
	addKeyframe: () => void;
	handleAddZoom: () => void;
	handleAddTrim: () => void;
	handleSplitClip: () => void;
	handleAddAnnotation: () => void;
	deleteAllBlocks: () => void;
	deleteSelectedKeyframe: () => void;
	deleteSelectedZoom: () => void;
	deleteSelectedTrim: () => void;
	deleteSelectedClip: () => void;
	deleteSelectedAnnotation: () => void;
	deleteSelectedAudio: () => void;
	cycleAnnotationsAtCurrentTime: (backward?: boolean) => boolean;
}

export function useTimelineKeyboardShortcuts({
	isMac,
	keyShortcuts,
	isTimelineFocusedRef,
	hasAnyTimelineBlocks,
	annotationCount,
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
	handleAddAnnotation,
	deleteAllBlocks,
	deleteSelectedKeyframe,
	deleteSelectedZoom,
	deleteSelectedTrim,
	deleteSelectedClip,
	deleteSelectedAnnotation,
	deleteSelectedAudio,
	cycleAnnotationsAtCurrentTime,
}: UseTimelineKeyboardShortcutsParams) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const eventTarget = e.target;
			if (
				eventTarget instanceof HTMLInputElement ||
				eventTarget instanceof HTMLTextAreaElement ||
				eventTarget instanceof HTMLSelectElement ||
				(eventTarget instanceof HTMLElement && eventTarget.isContentEditable)
			) {
				return;
			}

			if (!isTimelineFocusedRef.current) {
				return;
			}

			if (matchesShortcut(e, { key: "a", ctrl: true }, isMac)) {
				if (!hasAnyTimelineBlocks) {
					return;
				}
				e.preventDefault();
				setSelectedKeyframeId(null);
				setSelectAllBlocksActive(true);
				return;
			}

			if (matchesShortcut(e, keyShortcuts.addKeyframe, isMac)) addKeyframe();
			if (matchesShortcut(e, keyShortcuts.addZoom, isMac)) handleAddZoom();
			if (matchesShortcut(e, keyShortcuts.addTrim, isMac)) handleAddTrim();
			if (matchesShortcut(e, keyShortcuts.splitClip, isMac)) handleSplitClip();
			if (matchesShortcut(e, keyShortcuts.addAnnotation, isMac)) {
				handleAddAnnotation();
			}

			if (e.key === "Tab" && annotationCount > 0) {
				if (cycleAnnotationsAtCurrentTime(e.shiftKey)) {
					e.preventDefault();
				}
			}

			if (
				e.key === "Delete" ||
				e.key === "Backspace" ||
				matchesShortcut(e, keyShortcuts.deleteSelected, isMac)
			) {
				const target = resolveDeleteSelectionTarget({
					selectAllBlocksActive,
					selectedKeyframeId,
					selectedZoomId,
					selectedTrimId,
					selectedClipId,
					selectedAnnotationId,
					selectedAudioId,
				});
				if (target !== "none") {
					e.preventDefault();
				}
				if (target === "all") {
					deleteAllBlocks();
				} else if (target === "keyframe") {
					deleteSelectedKeyframe();
				} else if (target === "zoom") {
					deleteSelectedZoom();
				} else if (target === "trim") {
					deleteSelectedTrim();
				} else if (target === "clip") {
					deleteSelectedClip();
				} else if (target === "annotation") {
					deleteSelectedAnnotation();
				} else if (target === "audio") {
					deleteSelectedAudio();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		addKeyframe,
		annotationCount,
		cycleAnnotationsAtCurrentTime,
		deleteAllBlocks,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedClip,
		deleteSelectedKeyframe,
		deleteSelectedTrim,
		deleteSelectedZoom,
		handleAddAnnotation,
		handleAddTrim,
		handleAddZoom,
		handleSplitClip,
		hasAnyTimelineBlocks,
		isMac,
		isTimelineFocusedRef,
		keyShortcuts,
		selectAllBlocksActive,
		selectedAnnotationId,
		selectedAudioId,
		selectedClipId,
		selectedKeyframeId,
		selectedTrimId,
		selectedZoomId,
		setSelectAllBlocksActive,
		setSelectedKeyframeId,
	]);
}
