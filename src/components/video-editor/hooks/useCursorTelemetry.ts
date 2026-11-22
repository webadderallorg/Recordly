import { useEffect, useMemo, useRef, useState } from "react";
import type { useTimelineState } from "../state/useTimelineState";
import type { RecordingZoomMarker } from "../timeline/recordingZoomMarkers";
import { normalizeCursorTelemetry } from "../timeline/zoomSuggestionUtils";
import type { CursorTelemetryPoint } from "../types";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "../videoPlayback/cursorLoopTelemetry";
import { applyDefaultCursorShape } from "../videoPlayback/cursorShapeOverride";

type UseCursorTelemetryInput = {
	videoPath: string | null;
	videoSourcePath: string | null;
	duration: number;
	loopCursor: boolean;
	alwaysUsePointerCursor: boolean;
	timeline: ReturnType<typeof useTimelineState>;
};

export function useCursorTelemetry({
	videoPath,
	videoSourcePath,
	duration,
	loopCursor,
	alwaysUsePointerCursor,
	timeline,
}: UseCursorTelemetryInput) {
	const pendingRetryTimeoutRef = useRef<number | null>(null);
	const [recordingZoomMarkers, setRecordingZoomMarkers] = useState<RecordingZoomMarker[]>([]);
	const { setCursorTelemetry, setCursorTelemetrySourcePath } = timeline;

	useEffect(() => {
		let mounted = true;
		let retryAttempts = 0;
		// A new recording may expose its video before the telemetry sidecar is ready.
		const scheduleRetry = () => {
			if (retryAttempts >= 12) {
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
					setRecordingZoomMarkers([]);
				}
				return;
			}
			try {
				const result = await window.electronAPI.getCursorTelemetry(videoSourcePath);
				if (!mounted) return;
				setCursorTelemetry(result.success ? result.samples : []);
				setRecordingZoomMarkers(result.success ? (result.recordingZoomMarkers ?? []) : []);
				setCursorTelemetrySourcePath(videoSourcePath);
				if (
					!result.success ||
					(!result.samples.length && !result.recordingZoomMarkers?.length)
				)
					scheduleRetry();
			} catch (error) {
				console.warn("Unable to load cursor telemetry:", error);
				if (!mounted) return;
				setCursorTelemetry([]);
				setRecordingZoomMarkers([]);
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
	}, [videoPath, videoSourcePath, setCursorTelemetry, setCursorTelemetrySourcePath]);

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
		const renderSamples = applyDefaultCursorShape(normalized, alwaysUsePointerCursor);
		if (
			!loopCursor ||
			renderSamples.length < 2 ||
			displayedWindow.endMs <= displayedWindow.startMs
		) {
			return renderSamples;
		}
		return buildLoopedCursorTelemetry(
			renderSamples,
			displayedWindow.endMs,
			displayedWindow.startMs,
		);
	}, [alwaysUsePointerCursor, loopCursor, normalized, displayedWindow]);

	return {
		normalizedCursorTelemetry: normalized,
		effectiveCursorTelemetry: effective,
		recordingZoomMarkers,
	};
}
