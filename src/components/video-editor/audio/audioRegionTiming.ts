/** A stretch of the output timeline whose footage plays at `speed`. */
export interface TimelineSpeedSpan {
	startMs: number;
	endMs: number;
	speed: number;
}

/** A run of an audio region that reads its file at one constant rate. */
export interface AudioRegionPlaybackSegment {
	timelineStartMs: number;
	timelineEndMs: number;
	/** Position in the audio file that plays at `timelineStartMs`. */
	audioOffsetMs: number;
	speed: number;
}

function safeSpeed(speed: number): number {
	return Number.isFinite(speed) && speed > 0 ? speed : 1;
}

/**
 * Imported audio is independent of the footage and plays at 1x. Only a region that opts in
 * with `matchClipSpeed` reads its file at the speed of the footage under each part of it;
 * gaps and time beyond the footage stay at 1x.
 */
export function buildAudioRegionPlaybackSegments(
	region: { startMs: number; endMs: number; matchClipSpeed?: boolean },
	speedSpans: TimelineSpeedSpan[],
): AudioRegionPlaybackSegment[] {
	const { startMs, endMs } = region;
	if (!(endMs > startMs)) return [];
	if (!region.matchClipSpeed) {
		return [{ timelineStartMs: startMs, timelineEndMs: endMs, audioOffsetMs: 0, speed: 1 }];
	}

	const boundaries = new Set([startMs, endMs]);
	for (const span of speedSpans) {
		if (span.startMs > startMs && span.startMs < endMs) boundaries.add(span.startMs);
		if (span.endMs > startMs && span.endMs < endMs) boundaries.add(span.endMs);
	}
	const sorted = [...boundaries].sort((a, b) => a - b);

	const segments: AudioRegionPlaybackSegment[] = [];
	let audioOffsetMs = 0;
	for (let index = 0; index < sorted.length - 1; index += 1) {
		const segmentStartMs = sorted[index];
		const segmentEndMs = sorted[index + 1];
		const midpointMs = (segmentStartMs + segmentEndMs) / 2;
		const speed = safeSpeed(
			speedSpans.find((span) => midpointMs >= span.startMs && midpointMs < span.endMs)
				?.speed ?? 1,
		);
		const previous = segments[segments.length - 1];
		if (previous && previous.speed === speed) {
			previous.timelineEndMs = segmentEndMs;
		} else {
			segments.push({
				timelineStartMs: segmentStartMs,
				timelineEndMs: segmentEndMs,
				audioOffsetMs,
				speed,
			});
		}
		audioOffsetMs += (segmentEndMs - segmentStartMs) * speed;
	}
	return segments;
}

/** Where the audio file should be, and how fast it should play, at a timeline time. */
export function getAudioRegionPlaybackPosition(
	segments: AudioRegionPlaybackSegment[],
	timeMs: number,
): { audioOffsetMs: number; speed: number } | null {
	const segment = segments.find(
		(candidate) => timeMs >= candidate.timelineStartMs && timeMs < candidate.timelineEndMs,
	);
	if (!segment) return null;
	return {
		audioOffsetMs: segment.audioOffsetMs + (timeMs - segment.timelineStartMs) * segment.speed,
		speed: segment.speed,
	};
}
