import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import {
	createEditorHistoryStack,
	type EditorHistorySnapshot,
	recordEditorHistorySnapshot,
	redoEditorHistoryStack,
	resetEditorHistoryStack,
	undoEditorHistoryStack,
} from "../editorHistory";
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
		setSelectedZoomId,
		setSelectedClipId,
		setSelectedAnnotationId,
		setSelectedAudioId,
	} = timeline;
	const historyRef = useRef(createEditorHistoryStack());
	const applyingRef = useRef(false);
	const [historyFlags, setHistoryFlags] = useState({ canUndo: false, canRedo: false });
	const syncButtons = useCallback(() => {
		const next = {
			canUndo: historyRef.current.past.length > 0,
			canRedo: historyRef.current.future.length > 0,
		};
		setHistoryFlags((current) =>
			current.canUndo === next.canUndo && current.canRedo === next.canRedo ? current : next,
		);
	}, []);
	const buildSnapshot = useCallback(
		(): EditorHistorySnapshot => ({
			zoomRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
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
		syncButtons();
	}, [syncButtons]);

	useEffect(() => {
		const result = recordEditorHistorySnapshot(historyRef.current, buildSnapshot(), {
			applyingHistory: applyingRef.current,
		});
		if (result === "applied") applyingRef.current = false;
		if (result !== "unchanged") syncButtons();
	}, [buildSnapshot, syncButtons]);

	return {
		...historyFlags,
		handleUndo,
		handleRedo,
		resetHistory,
	};
}
