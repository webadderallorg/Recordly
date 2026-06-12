import type { SpeedRegion, TrimRegion } from "@/components/video-editor/types";

export interface OutputSlice {
	kind: "source" | "black";
	sourceStartMs: number;
	sourceEndMs: number;
	outputStartMs: number;
	outputEndMs: number;
	speed: number;
}

/**
 * Splits [0, durationMs] into source slices (kept material, speed-adjusted)
 * and — when gapsAsBlack — black slices for trimmed ranges (real-time, speed 1).
 * When gapsAsBlack is false, trimmed time is removed (output cursor does not
 * advance), matching the exporter's existing semantics.
 */
export function buildOutputTimeline(
	durationMs: number,
	trimRegions: TrimRegion[],
	speedRegions: SpeedRegion[],
	gapsAsBlack: boolean,
): OutputSlice[] {
	// Collect all boundaries from trims, speeds, and the full range endpoints.
	const boundaries = new Set<number>();
	boundaries.add(0);
	boundaries.add(durationMs);

	for (const trim of trimRegions) {
		if (trim.startMs >= 0 && trim.startMs <= durationMs) boundaries.add(trim.startMs);
		if (trim.endMs >= 0 && trim.endMs <= durationMs) boundaries.add(trim.endMs);
	}
	for (const speed of speedRegions) {
		if (speed.startMs >= 0 && speed.startMs <= durationMs) boundaries.add(speed.startMs);
		if (speed.endMs >= 0 && speed.endMs <= durationMs) boundaries.add(speed.endMs);
	}

	const sorted = [...boundaries].sort((a, b) => a - b);
	const slices: OutputSlice[] = [];
	let outputCursor = 0;

	for (let i = 0; i < sorted.length - 1; i++) {
		const start = sorted[i];
		const end = sorted[i + 1];
		if (end - start < 0.001) continue;

		const midpoint = (start + end) / 2;
		const trimmed = trimRegions.some((t) => midpoint >= t.startMs && midpoint < t.endMs);
		const intervalMs = end - start;

		if (trimmed) {
			if (gapsAsBlack) {
				// Black slice: real-time duration, speed 1, output cursor advances.
				const outputStart = outputCursor;
				const outputEnd = outputCursor + intervalMs;
				slices.push({
					kind: "black",
					sourceStartMs: start,
					sourceEndMs: end,
					outputStartMs: outputStart,
					outputEndMs: outputEnd,
					speed: 1,
				});
				outputCursor = outputEnd;
			}
			// When gapsAsBlack is false, trimmed intervals are skipped entirely.
		} else {
			// Source slice: speed-adjusted output duration.
			const speedRegion = speedRegions.find(
				(s) => midpoint >= s.startMs && midpoint < s.endMs,
			);
			const speed = speedRegion?.speed ?? 1;
			const outputDuration = intervalMs / speed;
			const outputStart = outputCursor;
			const outputEnd = outputCursor + outputDuration;
			slices.push({
				kind: "source",
				sourceStartMs: start,
				sourceEndMs: end,
				outputStartMs: outputStart,
				outputEndMs: outputEnd,
				speed,
			});
			outputCursor = outputEnd;
		}
	}

	return slices;
}

export function sourceToOutputMs(slices: OutputSlice[], sourceMs: number): number {
	for (const slice of slices) {
		if (sourceMs <= slice.sourceStartMs) {
			// Source time is before this slice — return the slice's output start.
			return slice.outputStartMs;
		}
		if (sourceMs >= slice.sourceEndMs) {
			continue;
		}
		// Source time falls within this slice.
		if (slice.kind === "black") {
			// Black slices: map proportionally (speed is 1, so output range = source range).
			const relativeMs = sourceMs - slice.sourceStartMs;
			return slice.outputStartMs + relativeMs;
		}
		// Source slice: account for speed.
		const relativeMs = sourceMs - slice.sourceStartMs;
		return slice.outputStartMs + relativeMs / slice.speed;
	}
	// Source time is past all slices — return the end of the last slice.
	return slices.length > 0 ? slices[slices.length - 1].outputEndMs : 0;
}

export function outputDurationMs(slices: OutputSlice[]): number {
	return slices.length > 0 ? slices[slices.length - 1].outputEndMs : 0;
}
