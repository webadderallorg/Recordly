import type { CursorTelemetryPoint, ZoomFocus } from "../types";

export const MANUAL_ZOOM_INTERACTION_TYPE = "manual-zoom";

export interface ManualRecordingZoomRegion {
	start: number;
	end: number;
	focus: ZoomFocus;
}

export function buildManualRecordingZoomRegions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	defaultDurationMs: number;
	reservedSpans?: Array<{ start: number; end: number }>;
}): ManualRecordingZoomRegion[] {
	const { cursorTelemetry, totalMs, defaultDurationMs, reservedSpans = [] } = params;
	const duration = Math.min(defaultDurationMs, totalMs);
	if (duration <= 0) {
		return [];
	}

	const reserved = reservedSpans
		.filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end))
		.map((span) => ({
			start: Math.max(0, Math.min(Math.round(span.start), totalMs)),
			end: Math.max(0, Math.min(Math.round(span.end), totalMs)),
		}))
		.filter((span) => span.end > span.start)
		.sort((a, b) => a.start - b.start);

	const regions: ManualRecordingZoomRegion[] = [];
	const markers = cursorTelemetry
		.filter(
			(sample) =>
				sample.interactionType === MANUAL_ZOOM_INTERACTION_TYPE &&
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs);

	for (const marker of markers) {
		const start = Math.max(0, Math.min(Math.round(marker.timeMs), totalMs));
		if (start >= totalMs) {
			continue;
		}

		const overlapsExisting = reserved.some((span) => start >= span.start && start < span.end);
		if (overlapsExisting) {
			continue;
		}

		const nextSpan = reserved.find((span) => span.start > start);
		const end = Math.min(start + duration, nextSpan?.start ?? totalMs, totalMs);
		if (end <= start) {
			continue;
		}

		const region = {
			start,
			end,
			focus: {
				cx: Math.max(0, Math.min(marker.cx, 1)),
				cy: Math.max(0, Math.min(marker.cy, 1)),
			},
		};
		regions.push(region);
		reserved.push(region);
		reserved.sort((a, b) => a.start - b.start);
	}

	return regions;
}
