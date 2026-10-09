import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import type { useTimelineState } from "../state/useTimelineState";
import type { TypingTelemetryPoint } from "../types";

/**
 * Loads keystroke telemetry for the current recording.
 *
 * Deliberately simpler than `useCursorTelemetry`: typing telemetry drives
 * suggestion generation only, so it needs no cursor-looping rebuild and no
 * back-painting. It still retries, because a fresh recording's sidecar is
 * written during stop and the editor can mount before the file lands.
 *
 * A recording with no keyboard hook (macOS today, or any recording made before
 * this feature) yields an empty stream. That is a normal result: the typing
 * zoom action reports it and no zoom is added.
 */
type UseTypingTelemetryInput = {
	videoPath: string | null;
	videoSourcePath: string | null;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	timeline: ReturnType<typeof useTimelineState>;
};

export function useTypingTelemetry({
	videoPath,
	videoSourcePath,
	pendingFreshRecordingAutoZoomPathRef,
	autoSuggestedVideoPathRef,
	timeline,
}: UseTypingTelemetryInput) {
	const retryTimeoutRef = useRef<number | null>(null);
	const { setTypingTelemetry, setTypingTelemetrySourcePath } = timeline;

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
			retryTimeoutRef.current = window.setTimeout(() => {
				retryTimeoutRef.current = null;
				if (mounted) void load();
			}, 350);
		};

		async function load() {
			if (!videoPath || !videoSourcePath) {
				if (mounted) {
					setTypingTelemetry([]);
					setTypingTelemetrySourcePath(null);
				}
				return;
			}
			try {
				const result = await window.electronAPI.getTypingTelemetry(videoSourcePath);
				if (!mounted) return;
				setTypingTelemetry(result.success ? result.samples : []);
				setTypingTelemetrySourcePath(videoSourcePath);
				if (!result.success || result.samples.length === 0) scheduleRetry();
			} catch (error) {
				console.warn("Unable to load typing telemetry:", error);
				if (!mounted) return;
				setTypingTelemetry([]);
				setTypingTelemetrySourcePath(videoSourcePath);
				scheduleRetry();
			}
		}

		if (retryTimeoutRef.current !== null) {
			window.clearTimeout(retryTimeoutRef.current);
			retryTimeoutRef.current = null;
		}
		void load();

		return () => {
			mounted = false;
			if (retryTimeoutRef.current !== null) {
				window.clearTimeout(retryTimeoutRef.current);
				retryTimeoutRef.current = null;
			}
		};
	}, [
		videoPath,
		videoSourcePath,
		setTypingTelemetry,
		setTypingTelemetrySourcePath,
		pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef,
	]);

	return useMemo(
		() => timeline.typingTelemetry as TypingTelemetryPoint[],
		[timeline.typingTelemetry],
	);
}