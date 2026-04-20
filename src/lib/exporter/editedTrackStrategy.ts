import type { AudioRegion, SpeedRegion, TrimRegion } from "@/components/video-editor/types";

const MIN_FILTERGRAPH_SPEED = 0.5;
const MAX_FILTERGRAPH_SPEED = 2;

export type EditedTrackStrategy = "filtergraph-fast-path" | "offline-render-fallback";

export interface EditedTrackSourceSegment {
	startMs: number;
	endMs: number;
	speed: number;
}

export interface EditedTrackStrategyInput {
	primaryAudioSourcePath: string | null;
	sourceDurationMs: number;
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
	sourceAudioFallbackPaths: string[];
}

function isSafeFiltergraphSpeed(speed: number): boolean {
	return (
		Number.isFinite(speed) && speed >= MIN_FILTERGRAPH_SPEED && speed <= MAX_FILTERGRAPH_SPEED
	);
}

function hasSafeFiltergraphSpeedRegions(speedRegions: SpeedRegion[]): boolean {
	return speedRegions.every((region) => isSafeFiltergraphSpeed(region.speed));
}

function buildKeptRanges(
	sourceDurationMs: number,
	trimRegions: TrimRegion[],
): Array<{ startMs: number; endMs: number }> {
	const sortedTrimRegions = [...trimRegions].sort((left, right) => left.startMs - right.startMs);
	const keptRanges: Array<{ startMs: number; endMs: number }> = [];
	let cursorMs = 0;

	for (const trimRegion of sortedTrimRegions) {
		const startMs = Math.max(0, trimRegion.startMs);
		const endMs = Math.min(sourceDurationMs, trimRegion.endMs);
		if (endMs <= startMs) {
			continue;
		}

		if (startMs > cursorMs) {
			keptRanges.push({ startMs: cursorMs, endMs: startMs });
		}

		cursorMs = Math.max(cursorMs, endMs);
	}

	if (cursorMs < sourceDurationMs) {
		keptRanges.push({ startMs: cursorMs, endMs: sourceDurationMs });
	}

	return keptRanges;
}

export function buildEditedTrackSourceSegments(
	sourceDurationMs: number,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
): EditedTrackSourceSegment[] {
	const segments: EditedTrackSourceSegment[] = [];
	const keptRanges = buildKeptRanges(sourceDurationMs, trimRegions);

	for (const keptRange of keptRanges) {
		const boundaries = new Set<number>([keptRange.startMs, keptRange.endMs]);
		for (const speedRegion of speedRegions) {
			const startMs = Math.max(keptRange.startMs, speedRegion.startMs);
			const endMs = Math.min(keptRange.endMs, speedRegion.endMs);
			if (endMs > startMs) {
				boundaries.add(startMs);
				boundaries.add(endMs);
			}
		}

		const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
		for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
			const startMs = orderedBoundaries[index] ?? 0;
			const endMs = orderedBoundaries[index + 1] ?? 0;
			if (endMs - startMs <= 0.5) {
				continue;
			}

			const midpointMs = startMs + (endMs - startMs) / 2;
			const speedRegion = speedRegions.find(
				(region) => midpointMs >= region.startMs && midpointMs < region.endMs,
			);
			const speed = speedRegion?.speed ?? 1;
			if (!isSafeFiltergraphSpeed(speed)) {
				return [];
			}

			segments.push({
				startMs,
				endMs,
				speed,
			});
		}
	}

	return segments;
}

export function classifyEditedTrackStrategy(input: EditedTrackStrategyInput): EditedTrackStrategy {
	if (!input.primaryAudioSourcePath) {
		return "offline-render-fallback";
	}

	if (input.audioRegions.length > 0) {
		return "offline-render-fallback";
	}

	if (input.speedRegions.length === 0) {
		return "offline-render-fallback";
	}

	if (!hasSafeFiltergraphSpeedRegions(input.speedRegions)) {
		return "offline-render-fallback";
	}

	if (input.sourceAudioFallbackPaths.length > 0) {
		return "offline-render-fallback";
	}

	if (
		buildEditedTrackSourceSegments(
			input.sourceDurationMs,
			input.trimRegions,
			input.speedRegions,
		).length === 0
	) {
		return "offline-render-fallback";
	}

	return "filtergraph-fast-path";
}
