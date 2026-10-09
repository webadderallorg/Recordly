import { useCallback, useEffect, useRef } from "react";
import type { EditorProjectData } from "../projectPersistence";
import { createPristineRecordingGate } from "./pristineRecordingGate";

const OBSERVE_INTERVAL_MS = 150;

export function usePristineRecordingGate({
	sourcePath,
	snapshot,
	isPipelineBusy,
}: {
	sourcePath: string | null;
	snapshot: EditorProjectData | null;
	isPipelineBusy: () => boolean;
}) {
	const gateRef = useRef(createPristineRecordingGate());
	const gateSourceRef = useRef(sourcePath);
	if (gateSourceRef.current !== sourcePath) {
		gateSourceRef.current = sourcePath;
		gateRef.current = createPristineRecordingGate();
	}
	const snapshotRef = useRef(snapshot);
	snapshotRef.current = snapshot;
	const busyRef = useRef(isPipelineBusy);
	busyRef.current = isPipelineBusy;

	useEffect(() => {
		if (!sourcePath) return;
		const observe = () => gateRef.current.observe(snapshotRef.current, busyRef.current());
		observe();
		const timer = window.setInterval(observe, OBSERVE_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [sourcePath]);

	return useCallback(() => gateRef.current.isPristine(snapshotRef.current), []);
}
