import {
	type ClipRegion,
	getClipSourceEndMs,
	getTimelineDurationMs,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	sortClipRegions,
} from "./types";

/**
 * Magnet-ON display mapping.
 *
 * Spaces:
 * - SOURCE space: raw media time (annotation and camera regions, video element
 *   currentTime).
 * - TIMELINE space: clip-anchored time where each clip starts at its source
 *   startMs but runs at displayDuration = sourceDuration / speed (clip spans,
 *   zoom and audio regions, timelinePlayheadTime). Gaps left by deleted clips
 *   exist in both source and timeline space.
 * - DISPLAY space: timeline space with the inter-clip gaps collapsed, so clips
 *   pack contiguously from 0. This is what the timeline UI shows when the
 *   magnet is on.
 *
 * All functions are pure and treat an empty clip list as the identity mapping.
 */

export interface DisplayClipRegion extends ClipRegion {
	/** Original source-space span, carried for reverse mapping / debugging. */
	sourceStartMs: number;
	sourceEndMs: number;
}

interface DisplaySegment {
	clip: ClipRegion;
	timelineStartMs: number;
	timelineEndMs: number;
	displayStartMs: number;
	displayEndMs: number;
}

function buildDisplaySegments(clips: ClipRegion[]): DisplaySegment[] {
	const segments: DisplaySegment[] = [];
	let displayCursorMs = 0;

	for (const clip of sortClipRegions(clips)) {
		const displayDurationMs = Math.max(0, Math.round(clip.endMs) - Math.round(clip.startMs));
		segments.push({
			clip,
			timelineStartMs: Math.round(clip.startMs),
			timelineEndMs: Math.round(clip.startMs) + displayDurationMs,
			displayStartMs: displayCursorMs,
			displayEndMs: displayCursorMs + displayDurationMs,
		});
		displayCursorMs += displayDurationMs;
	}

	return segments;
}

/** Packs clips contiguously from 0, preserving order, duration and metadata. */
export function clipsToDisplay(clips: ClipRegion[]): DisplayClipRegion[] {
	return buildDisplaySegments(clips).map((segment) => ({
		...segment.clip,
		startMs: segment.displayStartMs,
		endMs: segment.displayEndMs,
		sourceStartMs: segment.clip.startMs,
		sourceEndMs: getClipSourceEndMs(segment.clip),
	}));
}

/** Total duration of the collapsed display (sum of clip display durations). */
export function getDisplayDurationMs(clips: ClipRegion[]): number {
	const segments = buildDisplaySegments(clips);
	return segments.length > 0 ? segments[segments.length - 1].displayEndMs : 0;
}

/**
 * Maps a TIMELINE-space time into DISPLAY space. Times inside a gap clamp to
 * the preceding clip boundary; times beyond the last clip clamp to the
 * display end.
 */
export function timelineMsToDisplay(timelineMs: number, clips: ClipRegion[]): number {
	const roundedMs = Math.round(timelineMs);
	const segments = buildDisplaySegments(clips);
	if (segments.length === 0) {
		return roundedMs;
	}

	for (const segment of segments) {
		if (roundedMs < segment.timelineStartMs) {
			// Inside the gap before this clip: clamp to the preceding boundary,
			// which is exactly this clip's display start.
			return segment.displayStartMs;
		}
		if (roundedMs <= segment.timelineEndMs) {
			return segment.displayStartMs + (roundedMs - segment.timelineStartMs);
		}
	}

	return segments[segments.length - 1].displayEndMs;
}

/**
 * Maps a DISPLAY-space time back into TIMELINE space. Times beyond the display
 * end clamp to the last clip's timeline end.
 */
export function displayMsToTimeline(displayMs: number, clips: ClipRegion[]): number {
	const roundedMs = Math.round(displayMs);
	const segments = buildDisplaySegments(clips);
	if (segments.length === 0) {
		return roundedMs;
	}

	for (const segment of segments) {
		// Strict inequality: a display time sitting exactly on a clip boundary
		// belongs to the NEXT clip's start (display space is contiguous), so the
		// round-trip of a clip start returns that clip's own timeline start.
		if (roundedMs < segment.displayEndMs) {
			const offsetMs = Math.max(0, roundedMs - segment.displayStartMs);
			return segment.timelineStartMs + offsetMs;
		}
	}

	return segments[segments.length - 1].timelineEndMs;
}

/** Maps a SOURCE-space time into DISPLAY space (speed-aware). */
export function msToDisplay(sourceMs: number, clips: ClipRegion[]): number {
	return timelineMsToDisplay(mapSourceTimeToTimelineTime(sourceMs, clips), clips);
}

/** Maps a DISPLAY-space time back into SOURCE space (speed-aware). */
export function msToSource(displayMs: number, clips: ClipRegion[]): number {
	return mapTimelineTimeToSourceTime(displayMsToTimeline(displayMs, clips), clips);
}

/** Maps a SOURCE-space region into DISPLAY space, preserving other fields. */
export function regionToDisplay<T extends { startMs: number; endMs: number }>(
	region: T,
	clips: ClipRegion[],
): T {
	return {
		...region,
		startMs: msToDisplay(region.startMs, clips),
		endMs: msToDisplay(region.endMs, clips),
	};
}

/** Maps a DISPLAY-space span back into SOURCE space. */
export function spanToSource(
	span: { start: number; end: number },
	clips: ClipRegion[],
): { start: number; end: number } {
	return {
		start: msToSource(span.start, clips),
		end: msToSource(span.end, clips),
	};
}

// --- Magnet-OFF gap-aware mapping ---
//
// With the magnet off the timeline renders clips at their TIMELINE-space
// anchors ([startMs, endMs], speed-adjusted widths) with the inter-clip gaps
// visible, and trimmed source ranges play back as black time. The plain
// mapSourceTimeToTimelineTime/mapTimelineTimeToSourceTime pair clamps in-gap
// times to the nearest clip boundary, which parks the playhead during a gap
// and makes gap positions unreachable by seeking. The gap-aware pair instead
// treats gaps as first-class: a SOURCE-space gap [sourceEnd(i), start(i+1)]
// maps linearly onto its rendered TIMELINE-space span [endMs(i), start(i+1)],
// so the playhead enters the gap at the previous clip's rendered end, leaves
// it at the next clip's rendered start, and moves linearly in between (an
// identity offset when both neighbors run at speed 1).

interface GapAwareSegment {
	sourceStartMs: number;
	sourceEndMs: number;
	timelineStartMs: number;
	timelineEndMs: number;
	speed: number;
}

function buildGapAwareSegments(clips: ClipRegion[]): GapAwareSegment[] {
	return sortClipRegions(clips).map((clip) => ({
		sourceStartMs: Math.round(clip.startMs),
		sourceEndMs: getClipSourceEndMs(clip),
		timelineStartMs: Math.round(clip.startMs),
		timelineEndMs: Math.round(clip.endMs),
		speed: Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1,
	}));
}

/** Linearly maps a point from one span onto another, clamping degenerate spans. */
function lerpSpan(
	value: number,
	fromStart: number,
	fromEnd: number,
	toStart: number,
	toEnd: number,
): number {
	const fromWidth = fromEnd - fromStart;
	if (fromWidth <= 0) {
		return Math.round(toEnd);
	}
	const ratio = Math.min(1, Math.max(0, (value - fromStart) / fromWidth));
	return Math.round(toStart + ratio * (toEnd - toStart));
}

/**
 * Like mapSourceTimeToTimelineTime, but SOURCE times inside a gap advance
 * through the gap's rendered span instead of clamping to a clip boundary.
 * `sourceDurationMs` (when known) scales the trailing gap onto the ruler end
 * (getTimelineDurationMs); without it the trailing gap is a plain offset from
 * the last clip's rendered end.
 */
export function gapAwareSourceToTimelineMs(
	sourceMs: number,
	clips: ClipRegion[],
	sourceDurationMs?: number,
): number {
	const roundedMs = Math.round(sourceMs);
	const segments = buildGapAwareSegments(clips);
	if (segments.length === 0) {
		return roundedMs;
	}

	let previousSourceEndMs = 0;
	let previousTimelineEndMs = 0;
	for (const segment of segments) {
		if (roundedMs < segment.sourceStartMs) {
			// Inside the gap before this clip (leading or inter-clip).
			return lerpSpan(
				roundedMs,
				previousSourceEndMs,
				segment.sourceStartMs,
				previousTimelineEndMs,
				segment.timelineStartMs,
			);
		}
		if (roundedMs <= segment.sourceEndMs) {
			return Math.round(
				segment.timelineStartMs + (roundedMs - segment.sourceStartMs) / segment.speed,
			);
		}
		previousSourceEndMs = segment.sourceEndMs;
		previousTimelineEndMs = segment.timelineEndMs;
	}

	// Trailing gap after the last clip.
	if (sourceDurationMs !== undefined && sourceDurationMs > previousSourceEndMs) {
		return lerpSpan(
			roundedMs,
			previousSourceEndMs,
			Math.round(sourceDurationMs),
			previousTimelineEndMs,
			getTimelineDurationMs(clips, sourceDurationMs),
		);
	}
	return previousTimelineEndMs + (roundedMs - previousSourceEndMs);
}

/**
 * Inverse of gapAwareSourceToTimelineMs: TIMELINE times inside a rendered gap
 * span map into the trimmed SOURCE range instead of clamping to a boundary.
 */
export function gapAwareTimelineToSourceMs(
	timelineMs: number,
	clips: ClipRegion[],
	sourceDurationMs?: number,
): number {
	const roundedMs = Math.round(timelineMs);
	const segments = buildGapAwareSegments(clips);
	if (segments.length === 0) {
		return roundedMs;
	}

	let previousSourceEndMs = 0;
	let previousTimelineEndMs = 0;
	for (const segment of segments) {
		if (roundedMs < segment.timelineStartMs) {
			return lerpSpan(
				roundedMs,
				previousTimelineEndMs,
				segment.timelineStartMs,
				previousSourceEndMs,
				segment.sourceStartMs,
			);
		}
		if (roundedMs <= segment.timelineEndMs) {
			return Math.round(
				segment.sourceStartMs + (roundedMs - segment.timelineStartMs) * segment.speed,
			);
		}
		previousSourceEndMs = segment.sourceEndMs;
		previousTimelineEndMs = segment.timelineEndMs;
	}

	if (sourceDurationMs !== undefined && sourceDurationMs > previousSourceEndMs) {
		return lerpSpan(
			roundedMs,
			previousTimelineEndMs,
			getTimelineDurationMs(clips, sourceDurationMs),
			previousSourceEndMs,
			Math.round(sourceDurationMs),
		);
	}
	return previousSourceEndMs + (roundedMs - previousTimelineEndMs);
}

/** Maps a TIMELINE-space region into DISPLAY space, preserving other fields. */
export function timelineRegionToDisplay<T extends { startMs: number; endMs: number }>(
	region: T,
	clips: ClipRegion[],
): T {
	return {
		...region,
		startMs: timelineMsToDisplay(region.startMs, clips),
		endMs: timelineMsToDisplay(region.endMs, clips),
	};
}

/** Maps a DISPLAY-space span back into TIMELINE space. */
export function spanToTimeline(
	span: { start: number; end: number },
	clips: ClipRegion[],
): { start: number; end: number } {
	return {
		start: displayMsToTimeline(span.start, clips),
		end: displayMsToTimeline(span.end, clips),
	};
}
