import {
	type ClipRegion,
	getClipSourceStartMs,
	isBlankClip,
} from "@/components/video-editor/types";

/** Trim-only native paths concatenate source ranges; they cannot place clips. */
export function requiresClipTimelineRendering(clips?: ClipRegion[]): boolean {
	if (!clips) return false;
	return (
		clips.some(isBlankClip) ||
		clips.length !== 1 ||
		clips[0].startMs !== 0 ||
		getClipSourceStartMs(clips[0]) !== 0 ||
		clips[0].speed !== 1
	);
}
