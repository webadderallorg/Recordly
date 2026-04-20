import type { Span } from "dnd-timeline";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { toFileUrl } from "../../projectPersistence";
import type {
	AudioRegion,
	CursorTelemetryPoint,
	TrimRegion,
	ZoomFocus,
	ZoomRegion,
	SpeedRegion,
} from "../../types";
import { buildInteractionZoomSuggestions } from "../zoomSuggestionUtils";

interface UseTimelineRegionOperationsParams {
	videoDuration: number;
	totalMs: number;
	currentTimeMs: number;
	defaultRegionDurationMs: number;
	cursorTelemetry: CursorTelemetryPoint[];
	autoSuggestZoomsTrigger: number;
	onAutoSuggestZoomsConsumed?: () => void;
	disableSuggestedZooms: boolean;
	zoomRegions: ZoomRegion[];
	onZoomAdded: (span: Span) => void;
	onZoomSuggested?: (span: Span, focus: ZoomFocus) => void;
	trimRegions: TrimRegion[];
	onTrimAdded?: (span: Span) => void;
	onClipSplit?: (splitMs: number) => void;
	speedRegions: SpeedRegion[];
	onSpeedAdded?: (span: Span) => void;
	audioRegions: AudioRegion[];
	onAudioAdded?: (span: Span, audioPath: string, trackIndex?: number) => void;
	onAnnotationAdded?: (span: Span, trackIndex?: number) => void;
}

export function useTimelineRegionOperations({
	videoDuration,
	totalMs,
	currentTimeMs,
	defaultRegionDurationMs,
	cursorTelemetry,
	autoSuggestZoomsTrigger,
	onAutoSuggestZoomsConsumed,
	disableSuggestedZooms,
	zoomRegions,
	onZoomAdded,
	onZoomSuggested,
	trimRegions,
	onTrimAdded,
	onClipSplit,
	speedRegions,
	onSpeedAdded,
	audioRegions,
	onAudioAdded,
	onAnnotationAdded,
}: UseTimelineRegionOperationsParams) {
	const addRegionAtPlayhead = useCallback(
		(
			regions: Array<{ startMs: number; endMs: number }>,
			onAdd: ((span: Span) => void) | undefined,
			errorTitle: string,
			errorDescription: string,
		) => {
			if (!videoDuration || totalMs === 0 || !onAdd) {
				return;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return;
			}

			const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
			const sorted = [...regions].sort((left, right) => left.startMs - right.startMs);
			const nextRegion = sorted.find((region) => region.startMs > startPos);
			const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;
			const isOverlapping = sorted.some(
				(region) => startPos >= region.startMs && startPos < region.endMs,
			);

			if (isOverlapping || gapToNext <= 0) {
				toast.error(errorTitle, { description: errorDescription });
				return;
			}

			onAdd({ start: startPos, end: startPos + Math.min(defaultRegionDurationMs, gapToNext) });
		},
		[currentTimeMs, defaultRegionDurationMs, totalMs, videoDuration],
	);

	const handleAddZoom = useCallback(() => {
		addRegionAtPlayhead(
			zoomRegions,
			onZoomAdded,
			"Cannot place zoom here",
			"Zoom already exists at this location or not enough space available.",
		);
	}, [addRegionAtPlayhead, onZoomAdded, zoomRegions]);

	const handleSuggestZooms = useCallback(() => {
		if (!videoDuration || totalMs === 0) {
			return;
		}
		if (disableSuggestedZooms) {
			toast.info("Suggested zooms are unavailable while cursor looping is enabled.");
			return;
		}
		if (!onZoomSuggested) {
			toast.error("Zoom suggestion handler unavailable");
			return;
		}
		if (cursorTelemetry.length < 2) {
			toast.info("No cursor telemetry available", {
				description: "Record a screencast first to generate cursor-based suggestions.",
			});
			return;
		}

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry,
			totalMs,
			defaultDurationMs: Math.min(defaultRegionDurationMs, totalMs),
			reservedSpans: zoomRegions
				.map((region) => ({ start: region.startMs, end: region.endMs }))
				.sort((left, right) => left.start - right.start),
		});

		if (result.status === "no-telemetry") {
			toast.info("No usable cursor telemetry", {
				description: "The recording does not include enough cursor movement data.",
			});
			return;
		}
		if (result.status === "no-interactions") {
			toast.info("No clear interaction moments found", {
				description: "Try a recording with pauses or clicks around important actions.",
			});
			return;
		}
		if (result.status === "no-slots" || result.suggestions.length === 0) {
			toast.info("No auto-zoom slots available", {
				description: "Detected dwell points overlap existing zoom regions.",
			});
			return;
		}

		for (const region of result.suggestions) {
			onZoomSuggested({ start: region.start, end: region.end }, region.focus);
		}

		toast.success(
			`Added ${result.suggestions.length} interaction-based zoom suggestion${result.suggestions.length === 1 ? "" : "s"}`,
		);
	}, [
		cursorTelemetry,
		defaultRegionDurationMs,
		disableSuggestedZooms,
		onZoomSuggested,
		totalMs,
		videoDuration,
		zoomRegions,
	]);

	useEffect(() => {
		if (autoSuggestZoomsTrigger <= 0) {
			return;
		}

		onAutoSuggestZoomsConsumed?.();
		handleSuggestZooms();
	}, [autoSuggestZoomsTrigger, handleSuggestZooms, onAutoSuggestZoomsConsumed]);

	const handleAddTrim = useCallback(() => {
		addRegionAtPlayhead(
			trimRegions,
			onTrimAdded,
			"Cannot place trim here",
			"Trim already exists at this location or not enough space available.",
		);
	}, [addRegionAtPlayhead, onTrimAdded, trimRegions]);

	const handleSplitClip = useCallback(() => {
		if (!videoDuration || totalMs === 0 || !onClipSplit) {
			return;
		}
		onClipSplit(currentTimeMs);
	}, [currentTimeMs, onClipSplit, totalMs, videoDuration]);

	const handleAddSpeed = useCallback(() => {
		addRegionAtPlayhead(
			speedRegions,
			onSpeedAdded,
			"Cannot place speed here",
			"Speed region already exists at this location or not enough space available.",
		);
	}, [addRegionAtPlayhead, onSpeedAdded, speedRegions]);

	const handleAddAudio = useCallback(async () => {
		if (!videoDuration || totalMs === 0 || !onAudioAdded) {
			return;
		}

		const result = await window.electronAPI.openAudioFilePicker();
		if (!result?.success || !result.path) {
			return;
		}

		const audioPath = result.path;
		const audioDurationMs = await new Promise<number>((resolve) => {
			const audio = new Audio(toFileUrl(audioPath));
			audio.addEventListener("loadedmetadata", () => resolve(Math.round(audio.duration * 1000)));
			audio.addEventListener("error", () => resolve(0));
		});

		if (audioDurationMs <= 0) {
			toast.error("Could not read audio file", {
				description: "The selected file may be corrupted or in an unsupported format.",
			});
			return;
		}

		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
		const sorted = [...audioRegions].sort((left, right) => left.startMs - right.startMs);
		const nextRegion = sorted.find((region) => region.startMs > startPos);
		const gapToNext = nextRegion ? nextRegion.startMs - startPos : totalMs - startPos;
		const isOverlapping = sorted.some(
			(region) => startPos >= region.startMs && startPos < region.endMs,
		);

		if (isOverlapping || gapToNext <= 0) {
			toast.error("Cannot place audio here", {
				description: "Audio region already exists at this location or not enough space available.",
			});
			return;
		}

		onAudioAdded(
			{ start: startPos, end: startPos + Math.min(audioDurationMs, gapToNext, totalMs - startPos) },
			audioPath,
		);
	}, [audioRegions, currentTimeMs, onAudioAdded, totalMs, videoDuration]);

	const handleAddAnnotation = useCallback(
		(trackIndex = 0) => {
			if (!videoDuration || totalMs === 0 || !onAnnotationAdded) {
				return;
			}

			const defaultDuration = Math.min(defaultRegionDurationMs, totalMs);
			if (defaultDuration <= 0) {
				return;
			}

			const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));
			onAnnotationAdded(
				{ start: startPos, end: Math.min(startPos + defaultDuration, totalMs) },
				trackIndex,
			);
		},
		[currentTimeMs, defaultRegionDurationMs, onAnnotationAdded, totalMs, videoDuration],
	);

	return {
		handleAddZoom,
		handleSuggestZooms,
		handleAddTrim,
		handleSplitClip,
		handleAddSpeed,
		handleAddAudio,
		handleAddAnnotation,
	};
}