import { useSyncExternalStore } from "react";
import { getSharedWebcamBackgroundBlurEngine } from "@/lib/webcamBackgroundBlurEngine";

export function useWebcamBackgroundBlurStatus() {
	const engine = getSharedWebcamBackgroundBlurEngine();
	const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
	return {
		...snapshot,
		retry: () => engine.retry(),
	};
}
