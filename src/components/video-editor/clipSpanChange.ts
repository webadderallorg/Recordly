import { type ClipRegion, getClipSourceStartMs } from "./types";

export function changeClipSpan(
	clip: ClipRegion,
	startMs: number,
	endMs: number,
	sourceDurationMs: number,
): ClipRegion {
	const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const sourceStart = getClipSourceStartMs(clip);
	const isMove = startMs - clip.startMs === endMs - clip.endMs;
	if (isMove) return { ...clip, startMs, endMs, sourceStartMs: sourceStart };

	// Resizing reveals/hides footage; it cannot manufacture source before 0 or after EOF.
	const start = Math.max(
		startMs,
		Math.ceil(clip.startMs - (sourceStart - (clip.sourceMinMs ?? 0)) / speed),
	);
	const sourceStartMs = Math.round(sourceStart + (start - clip.startMs) * speed);
	const end = Math.min(
		endMs,
		Math.floor(
			start +
				(Math.min(sourceDurationMs, clip.sourceMaxMs ?? sourceDurationMs) - sourceStartMs) /
					speed,
		),
	);
	return { ...clip, startMs: start, endMs: end, sourceStartMs };
}
