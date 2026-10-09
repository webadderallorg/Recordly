import { packClipSequence } from "./clipSequence";
import type { ClipRegion } from "./types";

export type ImportedMedia = {
	sourceStartMs: number;
	durationMs: number;
};

export function appendImportedClip(
	clips: ClipRegion[],
	media: ImportedMedia,
	id: string,
	insertAt: number,
): ClipRegion[] {
	const bounded = clips.map((clip) => ({
		...clip,
		sourceMinMs: clip.sourceMinMs ?? 0,
		sourceMaxMs: clip.sourceMaxMs ?? media.sourceStartMs,
	}));
	const at = Math.min(bounded.length, Math.max(0, insertAt));
	bounded.splice(at, 0, {
		id,
		startMs: 0,
		endMs: media.durationMs,
		sourceStartMs: media.sourceStartMs,
		sourceMinMs: media.sourceStartMs,
		sourceMaxMs: media.sourceStartMs + media.durationMs,
		speed: 1,
	});
	return packClipSequence(bounded);
}
