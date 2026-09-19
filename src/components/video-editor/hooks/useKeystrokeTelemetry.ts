import { type MutableRefObject, useEffect, useRef } from "react";
import type { useTimelineState } from "../state/useTimelineState";

type Input = {
	videoPath: string | null;
	videoSourcePath: string | null;
	timeline: ReturnType<typeof useTimelineState>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
};

export function useKeystrokeTelemetry({
	videoPath,
	videoSourcePath,
	timeline,
	pendingFreshRecordingAutoZoomPathRef,
	autoSuggestedVideoPathRef,
}: Input) {
	const pendingRetryTimeoutRef = useRef<number | null>(null);
	const { setKeystrokeTelemetry } = timeline;

	useEffect(() => {
		let mounted = true;
		let retryAttempts = 0;
		const scheduleRetry = () => {
			if (
				pendingFreshRecordingAutoZoomPathRef.current !== videoPath ||
				autoSuggestedVideoPathRef.current === videoPath ||
				retryAttempts >= 12
			) {
				return;
			}
			retryAttempts += 1;
			pendingRetryTimeoutRef.current = window.setTimeout(() => {
				pendingRetryTimeoutRef.current = null;
				if (mounted) void load();
			}, 350);
		};
		async function load() {
			if (!videoPath || !videoSourcePath) {
				if (mounted) {
					setKeystrokeTelemetry([]);
				}
				return;
			}
			setKeystrokeTelemetry([]);
			try {
				const result = await window.electronAPI.getKeystrokeTelemetry?.(videoSourcePath);
				if (!mounted) return;
				setKeystrokeTelemetry(result?.success ? result.samples : []);
				if (!result?.success || result.samples.length === 0) scheduleRetry();
			} catch (error) {
				console.warn("Unable to load keystroke telemetry:", error);
				if (!mounted) return;
				setKeystrokeTelemetry([]);
				scheduleRetry();
			}
		}

		if (pendingRetryTimeoutRef.current !== null) {
			window.clearTimeout(pendingRetryTimeoutRef.current);
			pendingRetryTimeoutRef.current = null;
		}
		void load();
		return () => {
			mounted = false;
			if (pendingRetryTimeoutRef.current !== null) {
				window.clearTimeout(pendingRetryTimeoutRef.current);
				pendingRetryTimeoutRef.current = null;
			}
		};
	}, [
		videoPath,
		videoSourcePath,
		setKeystrokeTelemetry,
		pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef,
	]);
}
