import type { AudioPeaksData } from "./timelineTypes";

type Span = { start: number; end: number };

/** dnd-timeline pads offscreen content, so its canvas covers only this intersection. */
export function getVisibleWaveformSourceSpan(
	timeline: Span,
	source: Span,
	viewport: Span,
): Span | null {
	const start = Math.max(timeline.start, viewport.start);
	const end = Math.min(timeline.end, viewport.end);
	if (end <= start || timeline.end <= timeline.start || source.end <= source.start) return null;
	const scale = (source.end - source.start) / (timeline.end - timeline.start);
	return {
		start: source.start + (start - timeline.start) * scale,
		end: source.start + (end - timeline.start) * scale,
	};
}

/** Retain short transients when many source peaks occupy one screen pixel. */
export function getWaveformPixelPeak(data: AudioPeaksData, startMs: number, endMs: number) {
	if (data.durationMs <= 0 || data.peaks.length === 0 || endMs <= 0 || startMs >= data.durationMs)
		return 0;
	const first = Math.max(0, Math.floor((startMs / data.durationMs) * data.peaks.length));
	const last = Math.min(
		data.peaks.length,
		Math.max(first + 1, Math.ceil((endMs / data.durationMs) * data.peaks.length)),
	);
	let peak = 0;
	for (let i = first; i < last; i++) peak = Math.max(peak, data.peaks[i]);
	return peak;
}
