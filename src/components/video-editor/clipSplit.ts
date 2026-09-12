import { type ClipRegion, getClipSourceEndMs } from "./types";

export interface ClipSplitPlan {
	targetId: string;
	left: ClipRegion;
	right: ClipRegion;
}

/**
 * Split the clip under the playhead into two clips.
 *
 * `splitMs` is a timeline position, so the halves stay put on the timeline and
 * only their source in-points differ. At non-1x speed the split consumes more
 * (or less) source than timeline, so the right half reads from
 * `getClipSourceEndMs(left)` — otherwise it re-reads footage the left half
 * already covers and the tail of the recording falls outside every clip.
 */
export function planClipSplit(params: {
	clipRegions: ClipRegion[];
	splitMs: number;
	createId: () => string;
}): ClipSplitPlan | null {
	const { clipRegions, splitMs, createId } = params;
	if (!Number.isFinite(splitMs)) {
		return null;
	}

	const splitAtMs = Math.round(splitMs);
	const target = clipRegions.find((clip) => splitAtMs > clip.startMs && splitAtMs < clip.endMs);
	if (!target) {
		return null;
	}

	const left: ClipRegion = {
		...target,
		id: createId(),
		endMs: splitAtMs,
	};
	const right: ClipRegion = {
		...target,
		id: createId(),
		startMs: splitAtMs,
		endMs: target.endMs,
		sourceStartMs: getClipSourceEndMs(left),
	};

	return { targetId: target.id, left, right };
}
