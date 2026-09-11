import {
	type ClipFreezeFrame,
	type ClipRegion,
	DEFAULT_FREEZE_FRAME_DURATION_MS,
	getClipFreezeTimelineSpans,
	getClipSourceEndMs,
	getSafeClipSpeed,
	getSortedClipFreezeFrames,
	MAX_FREEZE_FRAME_DURATION_MS,
	MIN_FREEZE_FRAME_DURATION_MS,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	sortClipRegions,
	type ZoomRegion,
} from "./types";

export type ClipFreezeFrameBlockReason = "no-clip" | "clip-overlap" | "zoom-overlap";

export interface ClipFreezeFramePlan {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	clipId: string;
	freezeFrameId: string;
}

export interface AddClipFreezeFramePlan extends ClipFreezeFramePlan {
	/** False when the playhead already sat on a hold, which is returned instead of a new one. */
	created: boolean;
}

export interface BlockedClipFreezeFrameChange {
	blockedReason: ClipFreezeFrameBlockReason;
}

/**
 * A freeze requested on a clip's last frame holds a frame this far before the clip's source end,
 * so that both preview playback and export reach the held frame before the clip ends.
 */
const LAST_HOLDABLE_FRAME_MARGIN_MS = 100;

interface TimeSpan {
	startMs: number;
	endMs: number;
}

export function clampFreezeFrameDurationMs(durationMs: number): number {
	if (!Number.isFinite(durationMs)) {
		return DEFAULT_FREEZE_FRAME_DURATION_MS;
	}

	return Math.min(
		MAX_FREEZE_FRAME_DURATION_MS,
		Math.max(MIN_FREEZE_FRAME_DURATION_MS, Math.round(durationMs)),
	);
}

function withFreezeFrames(clip: ClipRegion, freezeFrames: ClipFreezeFrame[]): ClipRegion {
	const { freezeFrames: _previousFreezeFrames, ...clipWithoutFreezeFrames } = clip;
	return freezeFrames.length > 0
		? { ...clipWithoutFreezeFrames, freezeFrames }
		: clipWithoutFreezeFrames;
}

function spansOverlap(left: TimeSpan, right: TimeSpan): boolean {
	return left.startMs < right.endMs && left.endMs > right.startMs;
}

function findClipAtPlayhead(clips: ClipRegion[], timelineMs: number): ClipRegion | null {
	const sortedClips = sortClipRegions(clips);
	return (
		sortedClips.find((clip) => timelineMs >= clip.startMs && timelineMs < clip.endMs) ??
		sortedClips.find((clip) => timelineMs === clip.endMs) ??
		null
	);
}

function findFollowingClip(clips: ClipRegion[], clip: ClipRegion): ClipRegion | undefined {
	return sortClipRegions(clips).find(
		(candidate) => candidate.id !== clip.id && candidate.startMs >= clip.endMs,
	);
}

function remapTimelineTimeForClipChange(
	timeMs: number,
	previousClip: ClipRegion,
	nextClip: ClipRegion,
): number {
	if (timeMs < previousClip.startMs) {
		return timeMs;
	}
	if (timeMs > previousClip.endMs) {
		return timeMs + (nextClip.endMs - previousClip.endMs);
	}

	return mapSourceTimeToTimelineTime(mapTimelineTimeToSourceTime(timeMs, [previousClip]), [
		nextClip,
	]);
}

/**
 * Moves zooms that start inside a clip so they keep covering the same footage after the
 * clip's holds change. Zooms that end up entirely inside a removed hold are dropped.
 */
export function remapZoomRegionsForClipChange(
	zoomRegions: ZoomRegion[],
	previousClip: ClipRegion,
	nextClip: ClipRegion,
): { zoomRegions: ZoomRegion[]; hasOverlap: boolean } {
	const changedZoomIds = new Set<string>();
	const remappedZoomRegions: ZoomRegion[] = [];

	for (const zoom of zoomRegions) {
		if (zoom.startMs < previousClip.startMs || zoom.startMs >= previousClip.endMs) {
			remappedZoomRegions.push(zoom);
			continue;
		}

		const startMs = remapTimelineTimeForClipChange(zoom.startMs, previousClip, nextClip);
		const endMs = remapTimelineTimeForClipChange(zoom.endMs, previousClip, nextClip);
		if (startMs === zoom.startMs && endMs === zoom.endMs) {
			remappedZoomRegions.push(zoom);
			continue;
		}
		if (endMs - startMs < 1) {
			continue;
		}

		changedZoomIds.add(zoom.id);
		remappedZoomRegions.push({ ...zoom, startMs, endMs });
	}

	const hasOverlap = remappedZoomRegions.some(
		(zoom, index) =>
			changedZoomIds.has(zoom.id) &&
			remappedZoomRegions.some(
				(other, otherIndex) => otherIndex !== index && spansOverlap(zoom, other),
			),
	);

	return { zoomRegions: remappedZoomRegions, hasOverlap };
}

function planGrowingClipChange(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	previousClip: ClipRegion;
	nextClip: ClipRegion;
	freezeFrameId: string;
}): ClipFreezeFramePlan | BlockedClipFreezeFrameChange {
	const { clipRegions, zoomRegions, previousClip, nextClip, freezeFrameId } = params;
	const followingClip = findFollowingClip(clipRegions, previousClip);
	if (followingClip && nextClip.endMs > followingClip.startMs) {
		return { blockedReason: "clip-overlap" };
	}

	const zoomPlan = remapZoomRegionsForClipChange(zoomRegions, previousClip, nextClip);
	if (zoomPlan.hasOverlap) {
		return { blockedReason: "zoom-overlap" };
	}

	return {
		clipRegions: clipRegions.map((clip) => (clip.id === previousClip.id ? nextClip : clip)),
		zoomRegions: zoomPlan.zoomRegions,
		clipId: previousClip.id,
		freezeFrameId,
	};
}

/** Adds a hold of the frame under the playhead, lengthening its clip by the hold duration. */
export function planAddClipFreezeFrame(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	timelineMs: number;
	durationMs: number;
	freezeFrameId: string;
}): AddClipFreezeFramePlan | BlockedClipFreezeFrameChange {
	const { clipRegions, zoomRegions, freezeFrameId } = params;
	const timelineMs = Math.round(params.timelineMs);
	const clip = findClipAtPlayhead(clipRegions, timelineMs);
	if (!clip) {
		return { blockedReason: "no-clip" };
	}

	const existingHold = getClipFreezeTimelineSpans(clip).find(
		(span) => timelineMs >= span.startMs && timelineMs < span.endMs,
	);
	if (existingHold) {
		return {
			clipRegions,
			zoomRegions,
			clipId: clip.id,
			freezeFrameId: existingHold.id,
			created: false,
		};
	}

	const sourceDurationMs = getClipSourceEndMs(clip) - clip.startMs;
	if (sourceDurationMs < 1) {
		return { blockedReason: "no-clip" };
	}

	const offsetMs = Math.max(
		0,
		Math.min(
			sourceDurationMs - LAST_HOLDABLE_FRAME_MARGIN_MS,
			mapTimelineTimeToSourceTime(timelineMs, [clip]) - clip.startMs,
		),
	);
	const sameFrameHold = clip.freezeFrames?.find(
		(freezeFrame) => freezeFrame.offsetMs === offsetMs,
	);
	if (sameFrameHold) {
		return {
			clipRegions,
			zoomRegions,
			clipId: clip.id,
			freezeFrameId: sameFrameHold.id,
			created: false,
		};
	}

	const durationMs = clampFreezeFrameDurationMs(params.durationMs);
	const nextClip = withFreezeFrames({ ...clip, endMs: clip.endMs + durationMs }, [
		...(clip.freezeFrames ?? []),
		{ id: freezeFrameId, offsetMs, durationMs },
	]);
	const plan = planGrowingClipChange({
		clipRegions,
		zoomRegions,
		previousClip: clip,
		nextClip,
		freezeFrameId,
	});

	return "blockedReason" in plan ? plan : { ...plan, created: true };
}

export function planClipFreezeFrameDurationChange(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	clipId: string;
	freezeFrameId: string;
	durationMs: number;
}): ClipFreezeFramePlan | BlockedClipFreezeFrameChange | null {
	const { clipRegions, zoomRegions, clipId, freezeFrameId } = params;
	const clip = clipRegions.find((candidate) => candidate.id === clipId);
	const freezeFrame = clip?.freezeFrames?.find((candidate) => candidate.id === freezeFrameId);
	if (!clip || !freezeFrame) {
		return null;
	}

	const durationMs = clampFreezeFrameDurationMs(params.durationMs);
	if (durationMs === freezeFrame.durationMs) {
		return { clipRegions, zoomRegions, clipId, freezeFrameId };
	}

	const nextClip = withFreezeFrames(
		{ ...clip, endMs: clip.endMs + durationMs - freezeFrame.durationMs },
		getSortedClipFreezeFrames(clip).map((candidate) =>
			candidate.id === freezeFrameId ? { ...candidate, durationMs } : candidate,
		),
	);

	return planGrowingClipChange({
		clipRegions,
		zoomRegions,
		previousClip: clip,
		nextClip,
		freezeFrameId,
	});
}

/**
 * Removes a hold and shortens its clip. Shrinking only moves zooms earlier within the clip,
 * so it can never create an overlap.
 */
export function planRemoveClipFreezeFrame(params: {
	clipRegions: ClipRegion[];
	zoomRegions: ZoomRegion[];
	clipId: string;
	freezeFrameId: string;
}): ClipFreezeFramePlan | null {
	const { clipRegions, zoomRegions, clipId, freezeFrameId } = params;
	const clip = clipRegions.find((candidate) => candidate.id === clipId);
	const freezeFrame = clip?.freezeFrames?.find((candidate) => candidate.id === freezeFrameId);
	if (!clip || !freezeFrame) {
		return null;
	}

	const nextClip = withFreezeFrames(
		{ ...clip, endMs: clip.endMs - freezeFrame.durationMs },
		getSortedClipFreezeFrames(clip).filter((candidate) => candidate.id !== freezeFrameId),
	);

	return {
		clipRegions: clipRegions.map((candidate) =>
			candidate.id === clipId ? nextClip : candidate,
		),
		zoomRegions: remapZoomRegionsForClipChange(zoomRegions, clip, nextClip).zoomRegions,
		clipId,
		freezeFrameId,
	};
}

/**
 * Drops holds that no longer fit inside a clip after its edges were trimmed: holds whose
 * frame is before the clip start, or whose hold would not leave any footage after it.
 */
export function fitClipFreezeFrames(clip: ClipRegion): ClipRegion {
	if (!clip.freezeFrames || clip.freezeFrames.length === 0) {
		return clip;
	}

	const speed = getSafeClipSpeed(clip);
	const keptFreezeFrames: ClipFreezeFrame[] = [];
	let heldBeforeMs = 0;
	for (const freezeFrame of getSortedClipFreezeFrames(clip)) {
		const holdStartMs = clip.startMs + freezeFrame.offsetMs / speed + heldBeforeMs;
		if (freezeFrame.offsetMs < 0 || holdStartMs + freezeFrame.durationMs >= clip.endMs) {
			continue;
		}

		keptFreezeFrames.push(freezeFrame);
		heldBeforeMs += freezeFrame.durationMs;
	}

	return keptFreezeFrames.length === clip.freezeFrames.length
		? clip
		: withFreezeFrames(clip, keptFreezeFrames);
}

/**
 * Returns the holds the right-hand clip keeps when `clip` is split at `splitMs`, or null when
 * a hold starts before the split point. Clip start times are shared between the timeline and
 * the source, so a right-hand clip after a hold would silently skip the held duration.
 */
export function getRightClipFreezeFramesAfterSplit(
	clip: ClipRegion,
	splitMs: number,
): ClipFreezeFrame[] | null {
	if (getClipFreezeTimelineSpans(clip).some((span) => span.startMs < splitMs)) {
		return null;
	}

	const splitOffsetMs = Math.round((splitMs - clip.startMs) * getSafeClipSpeed(clip));
	return getSortedClipFreezeFrames(clip).map((freezeFrame) => ({
		...freezeFrame,
		offsetMs: freezeFrame.offsetMs - splitOffsetMs,
	}));
}
