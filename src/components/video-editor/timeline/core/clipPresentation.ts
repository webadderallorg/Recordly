import type { Span } from "dnd-timeline";

export const CLIP_SEAM_GAP_PX = 24;

/** Visual gutters never become gaps in the media timeline. */
export function getClipDisplaySpan(span: Span, allClips: Span[], msPerPixel: number): Span {
	if (!(msPerPixel > 0)) return span;
	const hasBefore = allClips.some((other) => other !== span && other.end <= span.start);
	const hasAfter = allClips.some((other) => other !== span && other.start >= span.end);
	// Keep a visible body even for clips smaller than the normal seam gutter.
	const inset = Math.min((CLIP_SEAM_GAP_PX / 2) * msPerPixel, (span.end - span.start) / 3);
	return { start: span.start + (hasBefore ? inset : 0), end: span.end - (hasAfter ? inset : 0) };
}

export function getEmbeddedCaptionSpan(
	span: Span,
	clips: { span: Span; displaySpan: Span }[],
): Span | null {
	const clip = clips.find((clip) => span.start < clip.span.end && span.end > clip.span.start);
	if (!clip) return null;
	const start = mapSpanTime(Math.max(span.start, clip.span.start), clip.span, clip.displaySpan);
	const end = mapSpanTime(Math.min(span.end, clip.span.end), clip.span, clip.displaySpan);
	return end > start ? { start, end } : null;
}

export type ClipPresentation = { span: Span; displaySpan: Span };

function mapSpanTime(time: number, from: Span, to: Span): number {
	if (from.end <= from.start) return to.start;
	return to.start + ((time - from.start) / (from.end - from.start)) * (to.end - to.start);
}

/**
 * Intentionally skip across split-clip gaps, following iMovie-like logic:
 * gaps consume zero timeline time (e.g. 2.8s → 2.8s), with no simulated playback.
 */
export function getPlayheadDisplayTime(
	time: number,
	clips: ClipPresentation[],
	edge: "start" | "end" = "start",
): number {
	if (edge === "end") {
		const ending = clips.find(({ span }) => time > span.start && time <= span.end);
		if (ending) return mapSpanTime(time, ending.span, ending.displaySpan);
	}
	const clip =
		clips.find(({ span }) => time >= span.start && time < span.end) ??
		clips.find(({ span }) => time === span.end);
	if (!clip) return time;
	return mapSpanTime(time, clip.span, clip.displaySpan);
}

/** Scrubbing a shared gutter selects the cut, which has no media duration. */
export function getTimeAtClipSeam(time: number, clips: ClipPresentation[]): number {
	for (const left of clips) {
		const right = clips.find(({ span }) => span.start === left.span.end);
		if (right && time >= left.displaySpan.end && time <= right.displaySpan.start) {
			return right.span.start;
		}
	}
	const clip = clips.find(
		({ displaySpan }) => time >= displaySpan.start && time <= displaySpan.end,
	);
	return clip ? mapSpanTime(time, clip.displaySpan, clip.span) : time;
}

/** Both sides of a cut share a timestamp, but occupy different visual edges. */
export function getRegionDisplaySpan(span: Span, clips: ClipPresentation[]): Span {
	return {
		start: getPlayheadDisplayTime(span.start, clips, "start"),
		end: getPlayheadDisplayTime(span.end, clips, "end"),
	};
}

/** A small screen-space magnet; moving farther away releases it without changing duration. */
export function snapRegionSpan(
	span: Span,
	targets: number[],
	clips: ClipPresentation[],
	msPerPixel: number,
	edge?: "start" | "end",
): Span {
	if (!(msPerPixel > 0)) return span;
	let best = 8 * msPerPixel;
	let delta = 0;
	for (const side of edge ? [edge] : (["start", "end"] as const)) {
		const position = getPlayheadDisplayTime(span[side], clips, side);
		for (const target of targets) {
			const distance = Math.abs(position - getPlayheadDisplayTime(target, clips, side));
			if (distance <= best) {
				best = distance;
				delta = target - span[side];
			}
		}
	}
	return edge
		? { ...span, [edge]: span[edge] + delta }
		: { start: span.start + delta, end: span.end + delta };
}
