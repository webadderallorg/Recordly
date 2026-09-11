import { type RefObject, useEffect } from "react";
import type { useShortcuts } from "@/contexts/ShortcutsContext";
import { matchesShortcut } from "@/lib/shortcuts";
import type { useTimelineState } from "../state/useTimelineState";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Input = {
	timeline: ReturnType<typeof useTimelineState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	shortcuts: ReturnType<typeof useShortcuts>["shortcuts"];
	isMac: boolean;
	handleUndo: () => void;
	handleRedo: () => void;
	startPlayback: () => void;
};

export function useEditorGlobalInteractions({
	timeline,
	videoPlaybackRef,
	shortcuts,
	isMac,
	handleUndo,
	handleRedo,
	startPlayback,
}: Input) {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const editable =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable;
			const primaryModifier = isMac ? event.metaKey : event.ctrlKey;
			const key = event.key.toLowerCase();

			if (primaryModifier && !event.altKey && key === "z") {
				if (!editable) {
					event.preventDefault();
					if (event.shiftKey) handleRedo();
					else handleUndo();
				}
				return;
			}
			if (!isMac && event.ctrlKey && !event.metaKey && !event.altKey && key === "y") {
				if (!editable) {
					event.preventDefault();
					handleRedo();
				}
				return;
			}
			if (!matchesShortcut(event, shortcuts.playPause, isMac) || editable) return;
			event.preventDefault();
			const playback = videoPlaybackRef.current;
			if (!playback?.video) return;
			if (playback.isPlaybackActive()) playback.pause();
			else startPlayback();
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [shortcuts, isMac, handleUndo, handleRedo, startPlayback, videoPlaybackRef]);

	useEffect(() => {
		if (
			timeline.selectedZoomId &&
			!timeline.zoomRegions.some(({ id }) => id === timeline.selectedZoomId)
		) {
			timeline.setSelectedZoomId(null);
		}
	}, [timeline.selectedZoomId, timeline.zoomRegions, timeline.setSelectedZoomId]);
	useEffect(() => {
		if (
			timeline.selectedAnnotationId &&
			!timeline.annotationRegions.some(({ id }) => id === timeline.selectedAnnotationId)
		) {
			timeline.setSelectedAnnotationId(null);
		}
	}, [
		timeline.selectedAnnotationId,
		timeline.annotationRegions,
		timeline.setSelectedAnnotationId,
	]);
	useEffect(() => {
		if (
			timeline.selectedAudioId &&
			!timeline.audioRegions.some(({ id }) => id === timeline.selectedAudioId)
		) {
			timeline.setSelectedAudioId(null);
		}
	}, [timeline.selectedAudioId, timeline.audioRegions, timeline.setSelectedAudioId]);
	useEffect(() => {
		if (
			timeline.selectedCaptionId &&
			!timeline.autoCaptions.some(({ id }) => id === timeline.selectedCaptionId)
		) {
			timeline.setSelectedCaptionId(null);
		}
	}, [timeline.selectedCaptionId, timeline.autoCaptions, timeline.setSelectedCaptionId]);
}
