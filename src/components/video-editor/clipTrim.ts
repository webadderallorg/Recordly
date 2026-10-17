import type { ClipSequenceSpan } from "./timeline/core/timelineTypes";
import { type ClipRegion, findClipAtTimelineTime } from "./types";

export type ClipTrimEdge = "start" | "end";

/**
 * The span that trims the clip under the playhead so it starts or ends at the
 * playhead, or null when the playhead is outside a clip or the clip would end up
 * shorter than `minDurationMs`.
 */
export function planClipTrimToPlayhead(
	clips: ClipRegion[],
	playheadMs: number,
	edge: ClipTrimEdge,
	minDurationMs: number,
): { clip: ClipRegion; span: ClipSequenceSpan } | null {
	const clip = findClipAtTimelineTime(playheadMs, clips);
	if (!clip) return null;
	const span =
		edge === "start"
			? { start: playheadMs, end: clip.endMs }
			: { start: clip.startMs, end: playheadMs };
	if (span.start === clip.startMs && span.end === clip.endMs) return null;
	if (span.end - span.start < minDurationMs) return null;
	return { clip, span };
}
