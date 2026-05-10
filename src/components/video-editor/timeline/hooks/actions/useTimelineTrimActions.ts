import { useCallback, useMemo } from "react";
import type { TrimRegion } from "../../../types";
import { timelineNotifications } from "../utils/timelineNotifications";

interface UseTimelineTrimActionsParams {
	timeline: {
		videoDuration: number;
		totalMs: number;
		currentTimeMs: number;
	};
	regions: {
		trim: TrimRegion[];
	};
	onTrimAdded?: (splitMs: number, trimDurationMs: number) => void;
}

export function useTimelineTrimActions({
	timeline,
	regions,
	onTrimAdded,
}: UseTimelineTrimActionsParams) {
	const { videoDuration, totalMs, currentTimeMs } = timeline;
	const { trim: trimRegions } = regions;
	const defaultTrimDurationMs = useMemo(() => Math.min(2000, totalMs), [totalMs]);

	const handleAddTrim = useCallback(() => {
		if (!videoDuration || videoDuration === 0 || totalMs === 0 || !onTrimAdded) {
			return;
		}

		if (defaultTrimDurationMs <= 0) {
			return;
		}

		// Check if playhead is inside any existing trim region
		const isOverlapping = trimRegions.some(
			(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
		);

		if (isOverlapping) {
			timelineNotifications.error(
				"Cannot place trim here",
				"Trim already exists at this location or not enough space available.",
			);
			return;
		}

		// Find the next trim region after the playhead
		const sorted = [...trimRegions].sort((a, b) => a.startMs - b.startMs);
		const nextRegion = sorted.find((region) => region.startMs > currentTimeMs);
		const gapToNext = nextRegion ? nextRegion.startMs - currentTimeMs : totalMs - currentTimeMs;

		if (gapToNext <= 0) {
			timelineNotifications.error(
				"Cannot place trim here",
				"Trim already exists at this location or not enough space available.",
			);
			return;
		}

		const actualDuration = Math.min(defaultTrimDurationMs, gapToNext);
		const startPos = Math.max(0, Math.min(currentTimeMs, totalMs));

		onTrimAdded(Math.round(startPos), Math.round(actualDuration));
	}, [videoDuration, totalMs, currentTimeMs, defaultTrimDurationMs, trimRegions, onTrimAdded]);

	return { handleAddTrim, defaultTrimDurationMs };
}
