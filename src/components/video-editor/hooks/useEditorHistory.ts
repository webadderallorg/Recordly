import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	type EditorHistoryStack,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "../editorHistory";
import { persistEditorHistory } from "../editorHistoryPersistence";
import { deriveNextId } from "../projectPersistence";
import type { useTimelineState } from "../state/useTimelineState";
import { cloneStructured } from "../videoEditorUtils";

type Input = {
	timeline: ReturnType<typeof useTimelineState>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
};

export function useEditorHistory({
	timeline,
	nextZoomIdRef,
	nextClipIdRef,
	nextAnnotationIdRef,
	nextAudioIdRef,
	nextAnnotationZIndexRef,
}: Input) {
	const {
		zoomRegions,
		clipRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		autoCaptions,
		sourceAudioTrackSettingsByClip,
		defaultSourceAudioTrackSettings,
		selectedZoomId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
		setZoomRegions,
		setClipRegions,
		setSpeedRegions,
		setAnnotationRegions,
		setAudioRegions,
		setAutoCaptions,
		setSourceAudioTrackSettingsByClip,
		setDefaultSourceAudioTrackSettings,
		setSelectedZoomId,
		setSelectedClipId,
		setSelectedAnnotationId,
		setSelectedAudioId,
	} = timeline;
	const historyRef = useRef(createEditorHistoryStack());
	const [historyState, setHistoryState] = useState(createEditorHistoryStack);
	const applyingRef = useRef(false);
	const annotationTypingSessionRef = useRef<string | null>(null);
	const syncButtons = useCallback(() => {
		const stack = historyRef.current;
		setHistoryState({
			past: [...stack.past],
			current: stack.current,
			future: [...stack.future],
		});
	}, []);
	const buildSnapshot = useCallback(
		(): EditorHistorySnapshot => ({
			zoomRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			sourceAudioTrackSettingsByClip,
			defaultSourceAudioTrackSettings,
			selectedZoomId,
			selectedClipId,
			selectedAnnotationId,
			selectedAudioId,
		}),
		[
			zoomRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			sourceAudioTrackSettingsByClip,
			defaultSourceAudioTrackSettings,
			selectedZoomId,
			selectedClipId,
			selectedAnnotationId,
			selectedAudioId,
		],
	);
	const applySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			applyingRef.current = true;
			const cloned = cloneStructured(snapshot);
			setZoomRegions(cloned.zoomRegions);
			setClipRegions(cloned.clipRegions);
			setSpeedRegions(cloned.speedRegions);
			setAnnotationRegions(cloned.annotationRegions);
			setAudioRegions(cloned.audioRegions);
			setAutoCaptions(cloned.autoCaptions);
			setSourceAudioTrackSettingsByClip(cloned.sourceAudioTrackSettingsByClip);
			setDefaultSourceAudioTrackSettings(cloned.defaultSourceAudioTrackSettings);
			setSelectedZoomId(cloned.selectedZoomId);
			setSelectedClipId(cloned.selectedClipId);
			setSelectedAnnotationId(cloned.selectedAnnotationId);
			setSelectedAudioId(cloned.selectedAudioId);
			nextZoomIdRef.current = deriveNextId(
				"zoom",
				cloned.zoomRegions.map(({ id }) => id),
			);
			nextClipIdRef.current = deriveNextId(
				"clip",
				cloned.clipRegions.map(({ id }) => id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				cloned.annotationRegions.map(({ id }) => id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				cloned.audioRegions.map(({ id }) => id),
			);
			nextAnnotationZIndexRef.current =
				cloned.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) +
				1;
		},
		[
			setZoomRegions,
			setClipRegions,
			setSpeedRegions,
			setAnnotationRegions,
			setAudioRegions,
			setAutoCaptions,
			setSourceAudioTrackSettingsByClip,
			setDefaultSourceAudioTrackSettings,
			setSelectedZoomId,
			setSelectedClipId,
			setSelectedAnnotationId,
			setSelectedAudioId,
			nextZoomIdRef,
			nextClipIdRef,
			nextAnnotationIdRef,
			nextAudioIdRef,
			nextAnnotationZIndexRef,
		],
	);
	const handleUndo = useCallback(() => {
		const previous = undoEditorHistoryStack(historyRef.current, buildSnapshot());
		if (previous) {
			applySnapshot(previous);
			syncButtons();
		}
	}, [applySnapshot, buildSnapshot, syncButtons]);
	const handleRedo = useCallback(() => {
		const next = redoEditorHistoryStack(historyRef.current, buildSnapshot());
		if (next) {
			applySnapshot(next);
			syncButtons();
		}
	}, [applySnapshot, buildSnapshot, syncButtons]);
	const resetHistory = useCallback(() => {
		resetEditorHistoryStack(historyRef.current);
		applyingRef.current = false;
		annotationTypingSessionRef.current = null;
		syncButtons();
	}, [syncButtons]);
	const restoreHistory = useCallback(
		(stack: EditorHistoryStack) => {
			historyRef.current = stack;
			applyingRef.current = stack.current !== null;
			annotationTypingSessionRef.current = null;
			syncButtons();
		},
		[syncButtons],
	);
	const persistedHistory = useMemo(() => persistEditorHistory(historyState), [historyState]);

	useEffect(() => {
		const activeInput = document.activeElement as HTMLElement | null;
		const typingSession = activeInput?.dataset.annotationEditSession ?? null;
		const result = recordEditorHistorySnapshot(historyRef.current, buildSnapshot(), {
			applyingHistory: applyingRef.current,
			ignoreSelectionOnly: true,
			coalesce:
				typingSession !== null && typingSession === annotationTypingSessionRef.current,
		});
		if (result === "recorded") annotationTypingSessionRef.current = typingSession;
		if (result === "applied") annotationTypingSessionRef.current = null;
		if (result === "applied") applyingRef.current = false;
		if (result !== "unchanged") syncButtons();
	}, [buildSnapshot, syncButtons]);

	return {
		canUndo: historyState.past.length > 0,
		canRedo: historyState.future.length > 0,
		handleUndo,
		handleRedo,
		resetHistory,
		restoreHistory,
		persistedHistory,
	};
}
