import type { ClipRegion } from "../types";
import { getClipSourceEndMs, getClipSourceStartMs, sortClipRegionsBySource } from "../types";

export function getActiveClipIdAtSourceTime(
	sourceTimeSeconds: number,
	clipRegions: ClipRegion[],
): string | null {
	const sourceMs = Math.round(sourceTimeSeconds * 1000);
	const activeClip = sortClipRegionsBySource(clipRegions).find(
		(clip) => sourceMs >= getClipSourceStartMs(clip) && sourceMs < getClipSourceEndMs(clip),
	);
	return activeClip?.id ?? null;
}

export function isClipMutedById(clipId: string | null, clipRegions: ClipRegion[]): boolean {
	if (!clipId) return false;
	return clipRegions.find((clip) => clip.id === clipId)?.muted ?? false;
}
