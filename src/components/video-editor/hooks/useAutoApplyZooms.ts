import type { Span } from "dnd-timeline";
import { useEffect, useRef } from "react";
import { DEFAULT_ZOOM_BLOCK_DURATION_MS } from "../timeline/core/constants";
import { buildInteractionZoomSuggestions } from "../timeline/zoomSuggestionUtils";
import type { ClipRegion, CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../types";

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
	onZoomSuggested: (span: Span, focus: ZoomFocus) => void;
}

/** Returns false while media or matching cursor data is still hydrating. */
export function applyAutomaticZooms(input: Input): boolean {
	if (!input.ready || !input.sourcePath || !Number.isFinite(input.totalMs) || input.totalMs <= 0)
		return false;
	if (!input.enabled || input.isSavedProject || input.zoomRegions.length > 0) return true;
	if (input.cursorTelemetrySourcePath !== input.sourcePath || input.cursorTelemetry.length < 2)
		return false;
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
