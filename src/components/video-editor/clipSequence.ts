import { type ClipRegion, getClipSourceStartMs, sortClipRegions } from "./types";

/** Primary footage is a sequence. Source in-points survive every ripple edit. */
export function closeClipGaps(clips: ClipRegion[]): ClipRegion[] {
	return packClipSequence(sortClipRegions(clips));
}

/** Repack authored sequence order; trim positions must never determine clip order. */
export function packClipSequence(clips: ClipRegion[]): ClipRegion[] {
	let cursor = 0;
	return clips.map((clip) => {
		const duration = clip.endMs - clip.startMs;
		const next =
			clip.startMs === cursor
				? clip
				: {
						...clip,
						sourceStartMs: getClipSourceStartMs(clip),
						startMs: cursor,
						endMs: cursor + duration,
					};
		cursor += duration;
		return next;
	});
}

/** Insert by sequence index, independent of temporarily overlapping drag positions. */
export function reorderClipSequence(
	clips: ClipRegion[],
	id: string,
	sequenceIndex: number,
): ClipRegion[] {
	const ordered = sortClipRegions(clips);
	const activeIndex = ordered.findIndex((clip) => clip.id === id);
	if (activeIndex < 0 || !Number.isFinite(sequenceIndex)) return closeClipGaps(clips);
	const [active] = ordered.splice(activeIndex, 1);
	ordered.splice(Math.max(0, Math.min(ordered.length, Math.round(sequenceIndex))), 0, active);
	return packClipSequence(ordered);
}

function safeSpeed(clip: ClipRegion): number {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

function mapWithinClip(time: number, before: ClipRegion, after: ClipRegion): number {
	const source = getClipSourceStartMs(before) + (time - before.startMs) * safeSpeed(before);
	return Math.round(
		Math.max(
			after.startMs,
			Math.min(
				after.endMs,
				after.startMs + (source - getClipSourceStartMs(after)) / safeSpeed(after),
			),
		),
	);
}

/** Map an anchor directly: rounding a tiny synthetic span can erase valid anchors. */
export function mapClipSequenceTime(
	time: number,
	before: ClipRegion[],
	after: ClipRegion[],
): number {
	if (before.length === 0) return time;
	const sorted = sortClipRegions(before);
	const owner = sorted.find((clip) => time >= clip.startMs && time < clip.endMs);
	const next = owner && after.find((clip) => clip.id === owner.id);
	if (owner && next) return mapWithinClip(time, owner, next);

	const beforeEnd = Math.max(...before.map((clip) => clip.endMs));
	const afterEnd = Math.max(0, ...after.map((clip) => clip.endMs));
	// Independently timed content beyond footage keeps its distance from the end.
	if (time >= beforeEnd) return Math.round(afterEnd + time - beforeEnd);
	const following = sorted.find(
		(clip) => clip.startMs >= time && after.some((nextClip) => nextClip.id === clip.id),
	);
	return following ? after.find((clip) => clip.id === following.id)!.startMs : afterEnd;
}

/** Imported audio keeps its duration while its timeline anchor follows the edit. */
export function rippleRegionAnchors<T extends { startMs: number; endMs: number }>(
	regions: T[],
	before: ClipRegion[],
	after: ClipRegion[],
): T[] {
	return regions.map((region) => {
		const startMs = mapClipSequenceTime(region.startMs, before, after);
		return { ...region, startMs, endMs: startMs + region.endMs - region.startMs };
	});
}

/** Map the retained footage covered by each connected effect through a sequence edit. */
export function rippleRegions<T extends { startMs: number; endMs: number }>(
	regions: T[],
	before: ClipRegion[],
	after: ClipRegion[],
): T[] {
	return regions.flatMap((region) => {
		const retainedSpans = before.flatMap((clip) => {
			const next = after.find((candidate) => candidate.id === clip.id);
			const start = Math.max(region.startMs, clip.startMs);
			const end = Math.min(region.endMs, clip.endMs);
			if (!next || end <= start) return [];
			const startMs = mapWithinClip(start, clip, next);
			const endMs = mapWithinClip(end, clip, next);
			return endMs > startMs ? [{ startMs, endMs }] : [];
		});
		if (retainedSpans.length === 0) return [];
		// Reordering can reverse the original endpoints. Include every retained
		// segment instead of deleting the effect because its endpoints inverted.
		const startMs = Math.min(...retainedSpans.map((span) => span.startMs));
		const endMs = Math.max(...retainedSpans.map((span) => span.endMs));
		return [{ ...region, startMs, endMs }];
	});
}
