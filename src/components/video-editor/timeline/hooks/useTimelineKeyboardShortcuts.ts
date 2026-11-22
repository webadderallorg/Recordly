import { type RefObject, useEffect } from "react";
import { CLEAR_ALL_ZOOMS_SHORTCUT, matchesShortcut, type ShortcutBinding } from "@/lib/shortcuts";
import type { TimelineShortcutBindings } from "../core/timelineTypes";
import { resolveDeleteSelectionTarget } from "./utils/timelineSelectionUtils";

interface UseTimelineKeyboardShortcutsParams {
	isMac: boolean;
	keyShortcuts: TimelineShortcutBindings;
	isTimelineFocusedRef: RefObject<boolean | null>;
	hasAnyZoomBlocks: boolean;
	activateSelectAllZooms: () => void;
	annotationCount: number;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
	selectAllBlocksActive: boolean;
	selectedZoomIds?: readonly string[];
	clearSelectedBlocks?: () => void;
	addKeyframe: () => void;
	handleAddZoom: () => void;
	handleSplitClip: () => void;
	handleTrimStart?: () => void;
	handleTrimEnd?: () => void;
	handleAddAnnotation: () => void;
	deleteSelectedKeyframe: () => void;
	deleteSelectedZoom: () => void;
	clearAllZooms: () => void;
	deleteSelectedClip: () => void;
	deleteSelectedAnnotation: () => void;
	deleteSelectedAudio: () => void;
	deleteSelectedCaption: () => void;
	onDuplicateSelectedRegion?: () => void;
	cycleAnnotationsAtCurrentTime: (backward?: boolean) => boolean;
}

export function useTimelineKeyboardShortcuts({
	isMac,
	keyShortcuts,
	isTimelineFocusedRef,
	hasAnyZoomBlocks,
	activateSelectAllZooms,
	annotationCount,
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
	selectAllBlocksActive,
	selectedZoomIds = [],
	clearSelectedBlocks,
	addKeyframe,
	handleAddZoom,
	handleSplitClip,
	handleTrimStart,
	handleTrimEnd,
	handleAddAnnotation,
	deleteSelectedKeyframe,
	deleteSelectedZoom,
	clearAllZooms,
	deleteSelectedClip,
	deleteSelectedAnnotation,
	deleteSelectedAudio,
	deleteSelectedCaption,
	onDuplicateSelectedRegion,
	cycleAnnotationsAtCurrentTime,
}: UseTimelineKeyboardShortcutsParams) {
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.isComposing) return;
			const eventTarget = e.target;
			if (
				eventTarget instanceof HTMLInputElement ||
				eventTarget instanceof HTMLTextAreaElement ||
				eventTarget instanceof HTMLSelectElement ||
				(eventTarget instanceof HTMLElement &&
					(eventTarget.isContentEditable ||
						eventTarget.closest(
							'[data-recording-library], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
						)))
			) {
				return;
			}

			// Selection survives inspector focus; deletion follows the selected block.
			if (
				((e.key === "Delete" || e.key === "Backspace") &&
					!e.ctrlKey &&
					!e.metaKey &&
					!e.altKey &&
					!e.shiftKey) ||
				matchesShortcut(e, keyShortcuts.deleteSelected, isMac)
			) {
				const target = resolveDeleteSelectionTarget({
					selectAllBlocksActive,
					selectedZoomIds,
					selectedKeyframeId,
					selectedZoomId,
					selectedClipId,
					selectedAnnotationId,
					selectedAudioId,
					selectedCaptionId,
				});
				if (target !== "none") {
					e.preventDefault();
				}
				if (target === "keyframe") {
					deleteSelectedKeyframe();
				} else if (target === "zoom") {
					deleteSelectedZoom();
				} else if (target === "clip") {
					if (!e.repeat) deleteSelectedClip();
				} else if (target === "annotation") {
					deleteSelectedAnnotation();
				} else if (target === "audio") {
					deleteSelectedAudio();
				} else if (target === "caption") {
					deleteSelectedCaption();
				}
				return;
			}

			if (e.key === "Escape" && (selectAllBlocksActive || selectedZoomIds.length > 0)) {
				e.preventDefault();
				clearSelectedBlocks?.();
				return;
			}

			// Keep literal bindings ahead of a physical-letter fallback for Option.
			const matchesTrim = (binding: ShortcutBinding) =>
				matchesShortcut(e, binding, isMac) ||
				(matchesShortcut(e, binding, isMac, true) &&
					!Object.values(keyShortcuts).some((other) => matchesShortcut(e, other, isMac)));
			// Trimming to the playhead works wherever the playhead was set, like Delete.
			if (keyShortcuts.trimStart && matchesTrim(keyShortcuts.trimStart)) {
				e.preventDefault();
				if (!e.repeat) handleTrimStart?.();
				return;
			}
			if (keyShortcuts.trimEnd && matchesTrim(keyShortcuts.trimEnd)) {
				e.preventDefault();
				if (!e.repeat) handleTrimEnd?.();
				return;
			}

			if (!isTimelineFocusedRef.current) {
				return;
			}

			if (
				onDuplicateSelectedRegion &&
				!selectAllBlocksActive &&
				!selectedKeyframeId &&
				(selectedZoomId || selectedAnnotationId || selectedAudioId) &&
				matchesShortcut(e, keyShortcuts.duplicateSelected, isMac) &&
				!Object.entries(keyShortcuts).some(
					([action, binding]) =>
						action !== "duplicateSelected" && matchesShortcut(e, binding, isMac),
				)
			) {
				e.preventDefault();
				if (!e.repeat) onDuplicateSelectedRegion();
				return;
			}

			if (
				hasAnyZoomBlocks &&
				matchesShortcut(e, CLEAR_ALL_ZOOMS_SHORTCUT, isMac) &&
				!Object.values(keyShortcuts).some((binding) => matchesShortcut(e, binding, isMac))
			) {
				e.preventDefault();
				if (!e.repeat) clearAllZooms();
				return;
			}

			if (matchesShortcut(e, { key: "a", ctrl: true }, isMac)) {
				if (!hasAnyZoomBlocks) {
					return;
				}
				e.preventDefault();
				activateSelectAllZooms();
				return;
			}

			if (matchesShortcut(e, keyShortcuts.addKeyframe, isMac)) addKeyframe();
			if (matchesShortcut(e, keyShortcuts.addZoom, isMac)) handleAddZoom();
			if (matchesShortcut(e, keyShortcuts.splitClip, isMac)) {
				e.preventDefault();
				if (!e.repeat) handleSplitClip();
			}
			if (matchesShortcut(e, keyShortcuts.addAnnotation, isMac)) {
				handleAddAnnotation();
			}

			if (e.key === "Tab" && annotationCount > 0) {
				if (cycleAnnotationsAtCurrentTime(e.shiftKey)) {
					e.preventDefault();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [
		activateSelectAllZooms,
		addKeyframe,
		annotationCount,
		clearAllZooms,
		clearSelectedBlocks,
		cycleAnnotationsAtCurrentTime,
		deleteSelectedAnnotation,
		deleteSelectedAudio,
		deleteSelectedCaption,
		deleteSelectedClip,
		deleteSelectedKeyframe,
		deleteSelectedZoom,
		handleAddAnnotation,
		handleAddZoom,
		handleSplitClip,
		handleTrimEnd,
		handleTrimStart,
		hasAnyZoomBlocks,
		isMac,
		isTimelineFocusedRef,
		keyShortcuts,
		onDuplicateSelectedRegion,
		selectAllBlocksActive,
		selectedZoomIds,
		selectedAnnotationId,
		selectedAudioId,
		selectedCaptionId,
		selectedClipId,
		selectedKeyframeId,
		selectedZoomId,
	]);
}
