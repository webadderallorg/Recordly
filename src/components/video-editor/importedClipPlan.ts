import type { ClipRegion } from "./types";

export function buildImportedClipPlan(options: {
	clips: ClipRegion[];
	sourceDurationMs: number;
	importedDurationMs: number;
	nextClipId: number;
}) {
	if (
		!Number.isFinite(options.sourceDurationMs) ||
		options.sourceDurationMs <= 0 ||
		!Number.isFinite(options.importedDurationMs) ||
		options.importedDurationMs <= 0
	) {
		throw new Error("Imported clip timing is invalid.");
	}

	const timelineStartMs = options.clips.reduce(
		(latestEndMs, clip) => Math.max(latestEndMs, clip.endMs),
		0,
	);
	const clip: ClipRegion = {
		id: `clip-${Math.max(1, Math.round(options.nextClipId))}`,
		startMs: timelineStartMs,
		endMs: timelineStartMs + Math.round(options.importedDurationMs),
		sourceStartMs: Math.round(options.sourceDurationMs),
		speed: 1,
		showSourceAudio: true,
	};

	return { clip, timelineStartMs };
}
