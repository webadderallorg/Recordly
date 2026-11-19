import type { Span } from "dnd-timeline";
import { isCinematicZoomMotion } from "../../cursorMotionPresets";
import { DEFAULT_ZOOM_IN_DURATION_MS, DEFAULT_ZOOM_OUT_DURATION_MS } from "../../types";
import type { DominantRegionOptions } from "../../videoPlayback/zoomRegionUtils";
import {
	getZoomTransitionDurationMs,
	getZoomTransitionVisibleDurationMs,
} from "../../videoPlayback/zoomTransition";

export type ZoomPresentationOptions = Pick<
	DominantRegionOptions,
	"zoomInDurationMs" | "zoomOutDurationMs"
>;

export function getZoomPresentationTiming(options: ZoomPresentationOptions = {}) {
	const cinematic = isCinematicZoomMotion(options);
	const duration = (value: number | undefined, fallback: number) =>
		Number.isFinite(value) ? Math.max(1, value!) : fallback;
	const entry = getZoomTransitionDurationMs(
		duration(options.zoomInDurationMs, DEFAULT_ZOOM_IN_DURATION_MS),
		cinematic,
	);
	const entryTarget = duration(options.zoomInDurationMs, DEFAULT_ZOOM_IN_DURATION_MS);
	const exitTarget = duration(options.zoomOutDurationMs, DEFAULT_ZOOM_OUT_DURATION_MS);
	const exit = getZoomTransitionDurationMs(exitTarget, cinematic);
	return {
		zoomInDurationMs: entryTarget,
		zoomOutDurationMs: exitTarget,
		entryMs: entry,
		exitMs: exit,
		durationMs: entry + exit,
		tailMs: exit - getZoomTransitionVisibleDurationMs(exitTarget, cinematic),
	};
}

export type ZoomPresentationTiming = ReturnType<typeof getZoomPresentationTiming>;

/** Timeline edges are the authored motion bounds, including the full release.
 * Spring presets affect playback inside this interval, never its displayed size.
 */
export function getZoomDisplaySpan(span: Span, _timing: ZoomPresentationTiming): Span {
	return { start: span.start, end: Math.max(span.start, span.end) };
}

/** Displayed edges and stored edges share the same clock. */
export function getZoomMotionSpan(displaySpan: Span, timing: ZoomPresentationTiming): Span {
	return getZoomDisplaySpan(displaySpan, timing);
}

/** Clamp only the dragged edge, keeping its opposite authored edge fixed. */
export function getZoomResizeSpan(
	displaySpan: Span,
	_timing: ZoomPresentationTiming,
	edge: "start" | "end",
	limits: { start: number; end: number; minDurationMs: number },
): Span {
	const lower = Number.isFinite(limits.start) ? limits.start : 0;
	const desiredStart = Number.isFinite(displaySpan.start) ? displaySpan.start : lower;
	const desiredEnd = Number.isFinite(displaySpan.end) ? displaySpan.end : desiredStart;
	const minimum = Number.isFinite(limits.minDurationMs) ? Math.max(1, limits.minDurationMs) : 1;
	const upper = Number.isFinite(limits.end)
		? Math.max(lower, limits.end)
		: Math.max(lower, desiredStart, desiredEnd) + minimum;
	if (upper <= lower) return { start: lower, end: lower };
	const minDuration = Math.min(minimum, upper - lower);
	const clamp = (value: number, start: number, end: number) =>
		Math.max(start, Math.min(end, value));
	if (edge === "end") {
		const start = clamp(desiredStart, lower, upper - minDuration);
		return { start, end: clamp(desiredEnd, start + minDuration, upper) };
	}
	const end = clamp(desiredEnd, lower + minDuration, upper);
	return { start: clamp(desiredStart, lower, end - minDuration), end };
}
