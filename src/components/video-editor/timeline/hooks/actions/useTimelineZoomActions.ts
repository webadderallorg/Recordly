import type { Span } from "dnd-timeline";
import { useCallback, useEffect, useMemo } from "react";
import type { CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../../../types";
import { buildInteractionZoomSuggestions } from "../../zoomSuggestionUtils";
import { timelineNotifications } from "../utils/timelineNotifications";

interface UseTimelineZoomActionsParams {
	timeline: {
		videoDuration: number;
		totalMs: number;
		currentTimeMs: number;
	};
	regions: {
		zoom: ZoomRegion[];
		clip: { startMs: number; endMs: number }[];
	};
	cursorTelemetry: CursorTelemetryPoint[];
	options: {
		disableSuggestedZooms: boolean;
	};
	autoSuggestZoomsTrigger: number;
	onAutoSuggestZoomsConsumed?: () => void;
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
}

export function useTimelineZoomActions({
	timeline,
	regions,
	cursorTelemetry,
	options,
	autoSuggestZoomsTrigger,
	onAutoSuggestZoomsConsumed,
	onZoomAdded,
	onZoomSuggested,
}: UseTimelineZoomActionsParams) {
	const { videoDuration, totalMs, currentTimeMs } = timeline;
	const { zoom: zoomRegions, clip: clipRegions } = regions;
	const { disableSuggestedZooms } = options;
	const defaultRegionDurationMs = useMemo(() => Math.min(1000, totalMs), [totalMs]);

	const canPlaceZoomAtMs = useCallback(
		(startMs: number) => {
			if (!videoDuration || videoDuration === 0 || totalMs === 0) {
				return false;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return false;
			}

			const startPos = Math.max(0, Math.min(startMs, totalMs));
			const activeClip =
				clipRegions.length === 0
					? { startMs: 0, endMs: totalMs }
					: clipRegions.find((clip) => startPos >= clip.startMs && startPos < clip.endMs);
			if (!activeClip) {
				return false;
			}

			const sorted = [...zoomRegions].sort((a, b) => a.startMs - b.startMs);
			const nextRegion = sorted.find((region) => region.startMs > startPos);
			const gapToNextClipEdge = activeClip.endMs - startPos;
			const gapToNextRegion = nextRegion ? nextRegion.startMs - startPos : gapToNextClipEdge;
			const availableDuration = Math.min(gapToNextClipEdge, gapToNextRegion);

			const isOverlapping = sorted.some(
				(region) => startPos >= region.startMs && startPos < region.endMs,
			);

			return !isOverlapping && availableDuration >= defaultDuration;
		},
		[videoDuration, totalMs, defaultRegionDurationMs, clipRegions, zoomRegions],
	);

	const addZoomAtMs = useCallback(
		(startMs: number) => {
			if (!videoDuration || videoDuration === 0 || totalMs === 0) {
				return;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return;
			}

			const startPos = Math.max(0, Math.min(startMs, totalMs));
			if (!canPlaceZoomAtMs(startPos)) {
				timelineNotifications.error(
					"Cannot place zoom here",
					"Zoom already exists here or there is not enough room before the next zoom or clip end.",
				);
				return;
			}

			onZoomAdded({ start: startPos, end: startPos + defaultDuration });
		},
		[videoDuration, totalMs, defaultRegionDurationMs, canPlaceZoomAtMs, onZoomAdded],
	);

	const handleAddZoom = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		addZoomAtMs(currentTimeMs);
	}, [videoDuration, totalMs, currentTimeMs, addZoomAtMs]);

	const handleSuggestZooms = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0) {
			return;
		}

		if (disableSuggestedZooms) {
			timelineNotifications.info("Suggested zooms are unavailable while cursor looping is enabled.");
			return;
		}

		if (!onZoomSuggested) {
			timelineNotifications.error("Zoom suggestion handler unavailable");
			return;
		}

		if (cursorTelemetry.length < 2) {
			timelineNotifications.info(
				"No cursor telemetry available",
				"Record a screencast first to generate cursor-based suggestions.",
			);
			return;
		}

		const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
		if (defaultDuration <= 0) {
			return;
		}

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry,
			totalMs,
			defaultDurationMs: defaultDuration,
			reservedSpans: zoomRegions
				.map((region) => ({ start: region.startMs, end: region.endMs }))
				.sort((a, b) => a.start - b.start),
		});

		if (result.status === "no-telemetry") {
			timelineNotifications.info(
				"No usable cursor telemetry",
				"The recording does not include enough cursor movement data.",
			);
			return;
		}

		if (result.status === "no-interactions") {
			timelineNotifications.info(
				"No clear interaction moments found",
				"Try a recording with pauses or clicks around important actions.",
			);
			return;
		}

		if (result.status === "no-slots" || result.suggestions.length === 0) {
			timelineNotifications.info(
				"No auto-zoom slots available",
				"Detected dwell points overlap existing zoom regions.",
			);
			return;
		}

		for (const region of result.suggestions) {
			onZoomSuggested({ start: region.start, end: region.end }, region.focus);
		}

		timelineNotifications.success(
			`Added ${result.suggestions.length} interaction-based zoom suggestion${result.suggestions.length === 1 ? "" : "s"}`,
		);
	}, [
		videoDuration,
		totalMs,
		disableSuggestedZooms,
		onZoomSuggested,
		cursorTelemetry,
		defaultRegionDurationMs,
		zoomRegions,
	]);

	useEffect(() => {
		if (autoSuggestZoomsTrigger <= 0) {
			return;
		}

		onAutoSuggestZoomsConsumed?.();
		handleSuggestZooms();
	}, [autoSuggestZoomsTrigger, handleSuggestZooms, onAutoSuggestZoomsConsumed]);

	return {
		defaultRegionDurationMs,
		canPlaceZoomAtMs,
		addZoomAtMs,
		handleAddZoom,
		handleSuggestZooms,
	};
}
