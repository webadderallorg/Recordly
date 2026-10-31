import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import type { useTimelineState } from "../state/useTimelineState";
import { normalizeCursorTelemetry } from "../timeline/zoomSuggestionUtils";
import type { CursorTelemetryPoint } from "../types";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "../videoPlayback/cursorLoopTelemetry";

type UseCursorTelemetryInput = {
	videoPath: string | null;
	videoSourcePath: string | null;
	duration: number;
	loopCursor: boolean;
	timeline: ReturnType<typeof useTimelineState>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
};

export function useCursorTelemetry({
	videoPath,
	videoSourcePath,
	duration,
	loopCursor,
	timeline,
	pendingFreshRecordingAutoZoomPathRef,
	autoSuggestedVideoPathRef,
}: UseCursorTelemetryInput) {
	const pendingRetryTimeoutRef = useRef<number | null>(null);
	const { setCursorTelemetry, setCursorTelemetrySourcePath } = timeline;

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
					setCursorTelemetry([]);
					setCursorTelemetrySourcePath(null);
				}
				return;
			}
			try {
				const result = await window.electronAPI.getCursorTelemetry(videoSourcePath);
				if (!mounted) return;
				setCursorTelemetry(result.success ? result.samples : []);
				setCursorTelemetrySourcePath(videoSourcePath);
				if (!result.success || result.samples.length === 0) scheduleRetry();
			} catch (error) {
				console.warn("Unable to load cursor telemetry:", error);
				if (!mounted) return;
				setCursorTelemetry([]);
				setCursorTelemetrySourcePath(videoSourcePath);
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
		setCursorTelemetry,
		setCursorTelemetrySourcePath,
		pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef,
	]);

	const normalized = useMemo(() => {
		if (timeline.cursorTelemetry.length === 0) return [] as CursorTelemetryPoint[];
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return normalizeCursorTelemetry(
			timeline.cursorTelemetry,
			totalMs > 0 ? totalMs : Number.MAX_SAFE_INTEGER,
		);
	}, [timeline.cursorTelemetry, duration]);
	const displayedWindow = useMemo(
		() =>
			getDisplayedTimelineWindowMs(
				Math.max(0, Math.round(duration * 1000)),
				timeline.trimRegions,
			),
		[duration, timeline.trimRegions],
	);
	const effective = useMemo(() => {
		if (
			!loopCursor ||
			normalized.length < 2 ||
			displayedWindow.endMs <= displayedWindow.startMs
		) {
			return normalized;
		}
		return buildLoopedCursorTelemetry(
			normalized,
			displayedWindow.endMs,
			displayedWindow.startMs,
		);
	}, [loopCursor, normalized, displayedWindow]);

	return { normalizedCursorTelemetry: normalized, effectiveCursorTelemetry: effective };
}
