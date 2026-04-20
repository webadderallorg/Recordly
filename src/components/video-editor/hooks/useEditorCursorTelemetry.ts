/**
 * useEditorCursorTelemetry – loads and manages cursor telemetry data
 * for the current video, with retry logic for fresh recordings.
 */
import type { MutableRefObject } from "react";
import { useEffect, useRef, useState } from "react";
import type { CursorTelemetryPoint } from "../types";

interface UseEditorCursorTelemetryParams {
	videoPath: string | null;
	videoSourcePath: string | null;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
}

export function useEditorCursorTelemetry({
	videoPath,
	videoSourcePath,
	pendingFreshRecordingAutoZoomPathRef,
	autoSuggestedVideoPathRef,
}: UseEditorCursorTelemetryParams) {
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const retryTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		let mounted = true;
		let retryAttempts = 0;

		if (retryTimeoutRef.current !== null) {
			window.clearTimeout(retryTimeoutRef.current);
			retryTimeoutRef.current = null;
		}

		async function loadTelemetry() {
			if (!videoPath || !videoSourcePath) {
				if (mounted) setCursorTelemetry([]);
				return;
			}
			try {
				const result = await window.electronAPI.getCursorTelemetry(videoSourcePath);
				if (!mounted) return;
				setCursorTelemetry(result.success ? result.samples : []);
				const shouldRetry =
					pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
					autoSuggestedVideoPathRef.current !== videoPath &&
					retryAttempts < 12;
				if (shouldRetry) {
					retryAttempts += 1;
					retryTimeoutRef.current = window.setTimeout(() => {
						retryTimeoutRef.current = null;
						if (mounted) void loadTelemetry();
					}, 350);
				}
			} catch {
				if (!mounted) return;
				setCursorTelemetry([]);
				const shouldRetry =
					pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
					autoSuggestedVideoPathRef.current !== videoPath &&
					retryAttempts < 12;
				if (shouldRetry) {
					retryAttempts += 1;
					retryTimeoutRef.current = window.setTimeout(() => {
						retryTimeoutRef.current = null;
						if (mounted) void loadTelemetry();
					}, 350);
				}
			}
		}

		void loadTelemetry();

		return () => {
			mounted = false;
			if (retryTimeoutRef.current !== null) {
				window.clearTimeout(retryTimeoutRef.current);
				retryTimeoutRef.current = null;
			}
		};
	}, [videoPath, videoSourcePath, pendingFreshRecordingAutoZoomPathRef, autoSuggestedVideoPathRef]);

	return { cursorTelemetry };
}