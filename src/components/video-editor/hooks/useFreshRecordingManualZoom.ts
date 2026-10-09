import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useEffect,
} from "react";
import { buildManualRecordingZoomRegions } from "../timeline/recordingZoomMarkers";
import {
	clampFocusToDepth,
	DEFAULT_ZOOM_DEPTH,
	type CursorTelemetryPoint,
	type ZoomRegion,
} from "../types";

interface UseFreshRecordingManualZoomParams {
	videoPath: string | null;
	loading: boolean;
	duration: number;
	normalizedCursorTelemetry: CursorTelemetryPoint[];
	zoomRegions: ZoomRegion[];
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	nextZoomIdRef: MutableRefObject<number>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingManualZoomPathRef: MutableRefObject<string | null>;
	manualRecordingZoomsAppliedVideoPathRef: MutableRefObject<string | null>;
}

export function useFreshRecordingManualZoom({
	videoPath,
	loading,
	duration,
	normalizedCursorTelemetry,
	zoomRegions,
	setZoomRegions,
	nextZoomIdRef,
	autoSuggestedVideoPathRef,
	pendingFreshRecordingAutoZoomPathRef,
	pendingFreshRecordingManualZoomPathRef,
	manualRecordingZoomsAppliedVideoPathRef,
}: UseFreshRecordingManualZoomParams) {
	useEffect(() => {
		if (!videoPath || loading || duration <= 0 || normalizedCursorTelemetry.length === 0) {
			return;
		}

		if (pendingFreshRecordingManualZoomPathRef.current !== videoPath) {
			return;
		}

		if (manualRecordingZoomsAppliedVideoPathRef.current === videoPath) {
			return;
		}

		const totalMs = Math.round(duration * 1000);
		const manualRegions = buildManualRecordingZoomRegions({
			cursorTelemetry: normalizedCursorTelemetry,
			totalMs,
			defaultDurationMs: Math.min(1000, totalMs),
			reservedSpans: zoomRegions.map((region) => ({
				start: region.startMs,
				end: region.endMs,
			})),
		});

		manualRecordingZoomsAppliedVideoPathRef.current = videoPath;
		pendingFreshRecordingManualZoomPathRef.current = null;

		if (manualRegions.length === 0) {
			return;
		}

		setZoomRegions((previous) => [
			...previous,
			...manualRegions.map((region) => ({
				id: `zoom-${nextZoomIdRef.current++}`,
				startMs: region.start,
				endMs: region.end,
				depth: DEFAULT_ZOOM_DEPTH,
				focus: clampFocusToDepth(region.focus, DEFAULT_ZOOM_DEPTH),
				mode: "manual" as const,
			})),
		]);
		autoSuggestedVideoPathRef.current = videoPath;
		pendingFreshRecordingAutoZoomPathRef.current = null;
	}, [
		videoPath,
		loading,
		duration,
		normalizedCursorTelemetry,
		zoomRegions,
		setZoomRegions,
		nextZoomIdRef,
		autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingManualZoomPathRef,
		manualRecordingZoomsAppliedVideoPathRef,
	]);
}
