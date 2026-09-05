import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
} from "react";
import { shouldAutoApplyFreshRecordingZoomsForSource } from "../timeline/zoomSuggestionUtils";
import type { CursorTelemetryPoint, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseFreshRecordingAutoZoomParams {
	appPlatform: string;
	videoPath: string | null;
	loading: boolean;
	isPreviewReady: boolean;
	duration: number;
	cursorTelemetryCount: number;
	normalizedCursorTelemetry: CursorTelemetryPoint[];
	zoomRegions: ZoomRegion[];
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	setAutoSuggestZoomsTrigger: Dispatch<SetStateAction<number>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoSuggestTimeoutRef: MutableRefObject<number | null>;
	pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
}

export function useFreshRecordingAutoZoom({
	appPlatform,
	videoPath,
	loading,
	isPreviewReady,
	duration,
	cursorTelemetryCount,
	normalizedCursorTelemetry,
	zoomRegions,
	setZoomRegions,
	setAutoSuggestZoomsTrigger,
	videoPlaybackRef,
	autoSuggestedVideoPathRef,
	pendingFreshRecordingAutoZoomPathRef,
	pendingFreshRecordingAutoSuggestTimeoutRef,
	pendingFreshRecordingAutoSuggestTelemetryCountRef,
}: UseFreshRecordingAutoZoomParams) {
	const handleAutoSuggestZoomsConsumed = useCallback(() => {
		setAutoSuggestZoomsTrigger(0);
	}, [setAutoSuggestZoomsTrigger]);

	useEffect(() => {
		if (!appPlatform) return;

		if (
			videoPath &&
			pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
			isPreviewReady &&
			!shouldAutoApplyFreshRecordingZoomsForSource(
				videoPlaybackRef.current?.video?.videoWidth,
				videoPlaybackRef.current?.video?.videoHeight,
				appPlatform,
			)
		) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
			return;
		}

		if (
			!videoPath ||
			loading ||
			!isPreviewReady ||
			duration <= 0 ||
			zoomRegions.length > 0 ||
			normalizedCursorTelemetry.length < 2
		) {
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
			return;
		}

		if (pendingFreshRecordingAutoZoomPathRef.current !== videoPath) return;
		if (autoSuggestedVideoPathRef.current === videoPath) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
			return;
		}
		if (pendingFreshRecordingAutoSuggestTelemetryCountRef.current === cursorTelemetryCount) {
			return;
		}

		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = cursorTelemetryCount;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
		}

		pendingFreshRecordingAutoSuggestTimeoutRef.current = window.setTimeout(() => {
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			if (
				pendingFreshRecordingAutoZoomPathRef.current !== videoPath ||
				autoSuggestedVideoPathRef.current === videoPath ||
				zoomRegions.length > 0
			) {
				return;
			}
			setAutoSuggestZoomsTrigger((value) => value + 1);
		}, 500);
	}, [
		videoPath,
		appPlatform,
		loading,
		isPreviewReady,
		duration,
		cursorTelemetryCount,
		normalizedCursorTelemetry,
		zoomRegions,
		autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoSuggestTelemetryCountRef,
		pendingFreshRecordingAutoSuggestTimeoutRef,
		pendingFreshRecordingAutoZoomPathRef,
		setAutoSuggestZoomsTrigger,
		videoPlaybackRef,
	]);

	useEffect(() => {
		if (!appPlatform) return;

		if (
			!videoPath ||
			!isPreviewReady ||
			zoomRegions.length === 0 ||
			autoSuggestedVideoPathRef.current !== videoPath ||
			shouldAutoApplyFreshRecordingZoomsForSource(
				videoPlaybackRef.current?.video?.videoWidth,
				videoPlaybackRef.current?.video?.videoHeight,
				appPlatform,
			)
		) {
			return;
		}

		autoSuggestedVideoPathRef.current = null;
		setZoomRegions((current) => {
			const next = current.filter((region) => region.mode !== "auto");
			return next.length === current.length ? current : next;
		});
	}, [
		autoSuggestedVideoPathRef,
		appPlatform,
		isPreviewReady,
		setZoomRegions,
		videoPath,
		videoPlaybackRef,
		zoomRegions,
	]);

	return { handleAutoSuggestZoomsConsumed };
}
