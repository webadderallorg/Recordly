import type { Span } from "dnd-timeline";
import { useEffect, useRef } from "react";
import { DEFAULT_ZOOM_BLOCK_DURATION_MS } from "../timeline/core/constants";
import { buildInteractionZoomSuggestions } from "../timeline/zoomSuggestionUtils";
import type { ClipRegion, CursorTelemetryPoint, ZoomFocus, ZoomRegion } from "../types";

interface Input {
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

function isReady(input: Input): input is Input & { sourcePath: string } {
	return (
		input.ready &&
		Boolean(input.sourcePath) &&
		Number.isFinite(input.totalMs) &&
		input.totalMs > 0 &&
		input.cursorTelemetry.length >= 2 &&
		input.cursorTelemetrySourcePath === input.sourcePath
	);
}

/** Returns false only while the current source is still hydrating. */
export async function applyFirstRecordingAutoZooms(
	input: Input,
	isCurrent: () => boolean = () => true,
): Promise<boolean> {
	if (!isReady(input)) return false;
	const { sourcePath } = input;
	if (input.isSavedProject) return true;
	if (input.zoomRegions.length > 0) return true;
	const result = buildInteractionZoomSuggestions({
		cursorTelemetry: input.cursorTelemetry,
		clipRegions: input.clipRegions,
		totalMs: input.totalMs,
		defaultDurationMs: Math.min(DEFAULT_ZOOM_BLOCK_DURATION_MS, input.totalMs),
		reservedSpans: [],
	});
	if (result.suggestions.length === 0) return true;
	let claimed = false;
	try {
		claimed = (await window.electronAPI.claimFirstRecordingAutoZooms?.(sourcePath)) ?? false;
	} catch (error) {
		console.warn("Could not apply first-recording automatic zooms:", error);
	}
	if (!claimed || !isCurrent()) return true;
	for (const suggestion of result.suggestions) {
		input.onZoomSuggested({ start: suggestion.start, end: suggestion.end }, suggestion.focus);
	}
	return true;
}

export function useFirstRecordingAutoZooms(input: Input) {
	const latest = useRef(input);
	latest.current = input;
	const mounted = useRef(false);
	const checked = useRef(new Set<string>());
	const pending = useRef(new Set<string>());
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		if (!isReady(input)) return;
		const source = input.sourcePath;
		if (checked.current.has(source) || pending.current.has(source)) return;
		pending.current.add(source);
		// Keep one claim through StrictMode effect reattachment. Recheck live state
		// after IPC so a source replacement or manual edit cannot receive stale zooms.
		void applyFirstRecordingAutoZooms(
			input,
			() =>
				mounted.current &&
				isReady(latest.current) &&
				latest.current.sourcePath === source &&
				!latest.current.isSavedProject &&
				latest.current.zoomRegions.length === 0 &&
				latest.current.clipRegions === input.clipRegions,
		).then((handled) => {
			pending.current.delete(source);
			if (handled) checked.current.add(source);
		});
	}, [input]);
}
