import type { Span } from "dnd-timeline";
import { useCallback } from "react";
import type { CaptionCue } from "../../../types";
import { timelineNotifications } from "../utils/timelineNotifications";

// Default length of a caption added manually from the timeline. Shared with the
// hover ghost so the preview width matches what actually gets created.
export const DEFAULT_CAPTION_DURATION_MS = 1500;

interface UseTimelineCaptionActionsParams {
	totalMs: number;
	// Caption regions in timeline-ms (matches the hover position passed in).
	captionRegions: CaptionCue[];
	onCaptionAdded?: (span: Span) => void;
}

export function useTimelineCaptionActions({
	totalMs,
	captionRegions,
	onCaptionAdded,
}: UseTimelineCaptionActionsParams) {
	const canPlaceCaptionAtMs = useCallback(
		(startMs: number) => {
			if (totalMs === 0) {
				return false;
			}
			const startPos = Math.max(0, Math.min(startMs, totalMs));
			// Only block when the cursor sits inside an existing caption — tight
			// gaps are fine because the new caption is clamped to fit (see below).
			return !captionRegions.some((cue) => startPos >= cue.startMs && startPos < cue.endMs);
		},
		[totalMs, captionRegions],
	);

	// Resolve the exact span an add would create at `startMs`, clamped to the next caption
	// and the end of the timeline. Shared with the hover ghost so the preview matches the
	// inserted caption exactly. Returns null when no caption can be placed there.
	const resolveCaptionSpanAtMs = useCallback(
		(startMs: number): Span | null => {
			if (totalMs === 0) {
				return null;
			}
			const startPos = Math.max(0, Math.min(startMs, totalMs));
			if (!canPlaceCaptionAtMs(startPos)) {
				return null;
			}
			const nextCaptionStartMs = captionRegions
				.filter((cue) => cue.startMs > startPos)
				.reduce((min, cue) => Math.min(min, cue.startMs), totalMs);
			const endPos = Math.min(
				startPos + DEFAULT_CAPTION_DURATION_MS,
				totalMs,
				nextCaptionStartMs,
			);
			if (endPos <= startPos) {
				return null;
			}
			return { start: startPos, end: endPos };
		},
		[totalMs, canPlaceCaptionAtMs, captionRegions],
	);

	const addCaptionAtMs = useCallback(
		(startMs: number) => {
			if (!onCaptionAdded || totalMs === 0) {
				return;
			}
			const startPos = Math.max(0, Math.min(startMs, totalMs));
			if (!canPlaceCaptionAtMs(startPos)) {
				timelineNotifications.error(
					"Cannot place caption here",
					"A caption already exists at this position.",
				);
				return;
			}
			const span = resolveCaptionSpanAtMs(startPos);
			if (!span) {
				return;
			}
			onCaptionAdded(span);
		},
		[onCaptionAdded, totalMs, canPlaceCaptionAtMs, resolveCaptionSpanAtMs],
	);

	return {
		canPlaceCaptionAtMs,
		addCaptionAtMs,
		resolveCaptionSpanAtMs,
	};
}
