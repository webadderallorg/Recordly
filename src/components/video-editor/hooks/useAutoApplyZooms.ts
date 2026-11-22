import type { Span } from "dnd-timeline";
import { useEffect, useRef } from "react";
import { DEFAULT_ZOOM_BLOCK_DURATION_MS } from "../timeline/core/constants";
import {
	buildManualRecordingZoomRegions,
	type RecordingZoomMarker,
} from "../timeline/recordingZoomMarkers";
import { buildInteractionZoomSuggestions } from "../timeline/zoomSuggestionUtils";
import type { ClipRegion, CursorTelemetryPoint, ZoomFocus, ZoomMode, ZoomRegion } from "../types";

interface Input {
	enabled: boolean;
	sourcePath: string | null;
	ready: boolean;
	isSavedProject: boolean;
	totalMs: number;
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	cursorTelemetry: CursorTelemetryPoint[];
	cursorTelemetrySourcePath: string | null;
	recordingZoomMarkers: RecordingZoomMarker[];
	onZoomSuggested: (span: Span, focus: ZoomFocus, mode?: ZoomMode) => void;
}

/** Returns false while media or matching cursor data is still hydrating. */
export function applyAutomaticZooms(input: Input): boolean {
	if (!input.ready || !input.sourcePath || !Number.isFinite(input.totalMs) || input.totalMs <= 0)
		return false;
	if (input.isSavedProject || input.zoomRegions.length > 0) return true;
	// Imported sequences get new media paths too. Only start on an unedited take;
	// adding/trimming clips while telemetry loads must preserve the user's timeline.
	const clip = input.clipRegions[0];
	if (!clip) return false;
	if (
		input.clipRegions.length !== 1 ||
		clip.startMs !== 0 ||
		Math.abs(clip.endMs - input.totalMs) > 1 ||
		(clip.sourceStartMs ?? 0) !== 0 ||
		(clip.speed ?? 1) !== 1
	)
		return true;
	if (input.cursorTelemetrySourcePath !== input.sourcePath) return false;
	const manual = buildManualRecordingZoomRegions(
		input.recordingZoomMarkers,
		Math.round(input.totalMs),
	);
	if (manual.length > 0) {
		for (const region of manual) {
			input.onZoomSuggested({ start: region.start, end: region.end }, region.focus, "manual");
		}
		return true;
	}
	if (!input.enabled) return input.cursorTelemetry.length > 0;
	if (input.cursorTelemetry.length < 2) return false;
	const result = buildInteractionZoomSuggestions({
		cursorTelemetry: input.cursorTelemetry,
		clipRegions: input.clipRegions,
		totalMs: input.totalMs,
		defaultDurationMs: Math.min(DEFAULT_ZOOM_BLOCK_DURATION_MS, input.totalMs),
		reservedSpans: [],
	});
	for (const suggestion of result.suggestions) {
		input.onZoomSuggested({ start: suggestion.start, end: suggestion.end }, suggestion.focus);
	}
	return true;
}

export function useAutoApplyZooms(input: Input) {
	const checked = useRef(new Set<string>());
	useEffect(() => {
		if (!input.sourcePath || checked.current.has(input.sourcePath)) return;
		// Latch per source through StrictMode, undo, preference changes and autosaves.
		if (applyAutomaticZooms(input)) checked.current.add(input.sourcePath);
	}, [input]);
}
