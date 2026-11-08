import type { Span } from "dnd-timeline";
import { isCinematicZoomMotion } from "../../cursorMotionPresets";
import { DEFAULT_ZOOM_IN_DURATION_MS, DEFAULT_ZOOM_OUT_DURATION_MS } from "../../types";
import {
	computeRegionStrength,
	type DominantRegionOptions,
} from "../../videoPlayback/zoomRegionUtils";
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

const visibleDurations = new Map<string, number>();

/**
 * Project authored bounds using the block's own nominal exit. Connections only
 * affect playback: adding, moving or deleting a neighbor must never resize a block.
 * The stored span retains the full settling tail, which playback may extend when connected.
 */
export function getZoomDisplaySpan(span: Span, timing: ZoomPresentationTiming): Span {
	if (span.end <= span.start) return { start: span.start, end: span.start };
	if (timing.durationMs <= span.end - span.start) {
		return { start: span.start, end: span.end - timing.tailMs };
	}
	const duration = span.end - span.start;
	const key = `${duration}:${timing.zoomInDurationMs}:${timing.zoomOutDurationMs}`;
	const cached = visibleDurations.get(key);
	if (cached !== undefined) return { start: span.start, end: span.start + cached };
	const strength = (timeMs: number) =>
		computeRegionStrength({ startMs: 0, endMs: duration }, timeMs, timing);
	// Overlapping, uncompressed ramps have a shallower peak. Measure the tail
	// relative to the visible part of this block so tiny blocks remain editable.
	let left = 0;
	let right = duration;
	for (let i = 0; i < 32; i += 1) {
		const a = left + (right - left) / 3;
		const b = right - (right - left) / 3;
		if (strength(a) < strength(b)) left = a;
		else right = b;
	}
	const peakTime = (left + right) / 2;
	const cutoff = Math.max(strength(0), strength(peakTime)) * 0.01;
	left = peakTime;
	right = duration;
	for (let i = 0; i < 32; i += 1) {
		const middle = (left + right) / 2;
		if (strength(middle) > cutoff) left = middle;
		else right = middle;
	}
	const visibleDuration = (left + right) / 2;
	if (visibleDurations.size >= 256)
		visibleDurations.delete(visibleDurations.keys().next().value!);
	visibleDurations.set(key, visibleDuration);
	return { start: span.start, end: span.start + visibleDuration };
}

/** Invert authored UI bounds after either visible edge is resized. */
export function getZoomMotionSpan(displaySpan: Span, timing: ZoomPresentationTiming): Span {
	if (displaySpan.end <= displaySpan.start)
		return { start: displaySpan.start, end: displaySpan.start };
	let left = displaySpan.end;
	let right = Math.max(left, displaySpan.end + timing.tailMs);
	for (let i = 0; i < 32; i += 1) {
		const end = (left + right) / 2;
		if (getZoomDisplaySpan({ start: displaySpan.start, end }, timing).end < displaySpan.end)
			left = end;
		else right = end;
	}
	return { start: displaySpan.start, end: (left + right) / 2 };
}

/** Constrain the dragged edge before converting its fixed visible edge to stored bounds. */
export function getZoomResizeSpan(
	displaySpan: Span,
	timing: ZoomPresentationTiming,
	edge: "start" | "end",
	limits: { start: number; end: number; minDurationMs: number },
): Span {
	const lower = Number.isFinite(limits.start) ? limits.start : 0;
	const desiredStart = Number.isFinite(displaySpan.start) ? displaySpan.start : lower;
	const desiredEnd = Number.isFinite(displaySpan.end) ? displaySpan.end : desiredStart;
	const minimum = Number.isFinite(limits.minDurationMs) ? Math.max(1, limits.minDurationMs) : 1;
	const upper = Number.isFinite(limits.end)
		? Math.max(lower, limits.end)
		: Math.max(lower, desiredStart, desiredEnd) + timing.tailMs + minimum;
	const available = upper - lower;
	if (available <= 0) return { start: lower, end: lower };
	const minDuration = Math.min(minimum, available);
	const clamp = (value: number, start: number, end: number) =>
		Math.max(start, Math.min(end, value));

	if (edge === "end") {
		// An undersized legacy interval may need its fixed start moved just enough
		// to fit the minimum. Otherwise the left visible edge stays untouched.
		const start = clamp(desiredStart, lower, upper - minDuration);
		const motion = getZoomMotionSpan({ start, end: Math.max(start, desiredEnd) }, timing);
		return { start, end: Math.min(upper, Math.max(start + minDuration, motion.end)) };
	}

	const minVisibleDuration = getZoomDisplaySpan({ start: 0, end: minDuration }, timing).end;
	// If the fixed visible edge itself cannot fit, use the nearest feasible
	// minimum span rather than letting the generic engine translate both edges.
	const fixedEnd = clamp(
		desiredEnd,
		lower + minVisibleDuration,
		upper - minDuration + minVisibleDuration,
	);
	const spanAtDuration = (duration: number): Span => {
		const visibleDuration = getZoomDisplaySpan({ start: 0, end: duration }, timing).end;
		const start = fixedEnd - visibleDuration;
		return { start, end: start + duration };
	};
	// Increasing duration moves the visible left edge earlier and its hidden
	// tail later. Find the longest span that fits both raw bounds first.
	let left = minDuration;
	let right = available;
	for (let i = 0; i < 48; i += 1) {
		const middle = (left + right) / 2;
		const span = spanAtDuration(middle);
		if (span.start >= lower && span.end <= upper) left = middle;
		else right = middle;
	}
	const desired = getZoomMotionSpan(
		{ start: Math.min(desiredStart, fixedEnd), end: fixedEnd },
		timing,
	);
	const duration = clamp(desired.end - desired.start, minDuration, left);
	const motion = spanAtDuration(duration);
	return { start: Math.max(lower, motion.start), end: Math.min(upper, motion.end) };
}
