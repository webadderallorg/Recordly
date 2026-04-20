/**
 * useEditorHistory – undo / redo stack for the editor.
 *
 * buildSnapshot / applySnapshot must be stable callbacks provided by the
 * caller (use useCallback with all relevant deps).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	ZoomRegion,
} from "../types";

export type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	selectedZoomId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

function deepEqual(first: unknown, second: unknown): boolean {
	return JSON.stringify(first) === JSON.stringify(second);
}

function cloneSnapshot(snapshot: EditorHistorySnapshot): EditorHistorySnapshot {
	return globalThis.structuredClone(snapshot);
}

interface UseEditorHistoryParams {
	buildSnapshot: () => EditorHistorySnapshot;
	applySnapshot: (snapshot: EditorHistorySnapshot) => void;
}

export function useEditorHistory({ buildSnapshot, applySnapshot }: UseEditorHistoryParams) {
	const [version, setVersion] = useState(0);
	const pastRef = useRef<EditorHistorySnapshot[]>([]);
	const futureRef = useRef<EditorHistorySnapshot[]>([]);
	const currentRef = useRef<EditorHistorySnapshot | null>(null);
	const applyingRef = useRef(false);

	const syncVersion = useCallback(() => setVersion((current) => current + 1), []);

	const canUndo = useMemo(() => pastRef.current.length > 0, [version]);
	const canRedo = useMemo(() => futureRef.current.length > 0, [version]);

	// Track every change to push onto the history stack
	useEffect(() => {
		const snapshot = buildSnapshot();
		if (!currentRef.current) {
			currentRef.current = cloneSnapshot(snapshot);
			syncVersion();
			return;
		}
		if (applyingRef.current) {
			currentRef.current = cloneSnapshot(snapshot);
			applyingRef.current = false;
			syncVersion();
			return;
		}
		if (deepEqual(currentRef.current, snapshot)) return;

		pastRef.current.push(cloneSnapshot(currentRef.current));
		if (pastRef.current.length > 100) pastRef.current.shift();
		currentRef.current = cloneSnapshot(snapshot);
		futureRef.current = [];
		syncVersion();
	}, [buildSnapshot, syncVersion]);

	const handleUndo = useCallback(() => {
		if (pastRef.current.length === 0) return;
		const current = currentRef.current ?? cloneSnapshot(buildSnapshot());
		const previous = pastRef.current.pop();
		if (!previous) return;
		futureRef.current.push(cloneSnapshot(current));
		currentRef.current = cloneSnapshot(previous);
		applyingRef.current = true;
		applySnapshot(previous);
		syncVersion();
	}, [applySnapshot, buildSnapshot, syncVersion]);

	const handleRedo = useCallback(() => {
		if (futureRef.current.length === 0) return;
		const current = currentRef.current ?? cloneSnapshot(buildSnapshot());
		const next = futureRef.current.pop();
		if (!next) return;
		pastRef.current.push(cloneSnapshot(current));
		currentRef.current = cloneSnapshot(next);
		applyingRef.current = true;
		applySnapshot(next);
		syncVersion();
	}, [applySnapshot, buildSnapshot, syncVersion]);

	/** Reset the history when loading a project. */
	const clearHistory = useCallback(() => {
		pastRef.current = [];
		futureRef.current = [];
		currentRef.current = null;
		applyingRef.current = false;
		syncVersion();
	}, [syncVersion]);

	return { canUndo, canRedo, handleUndo, handleRedo, clearHistory };
}