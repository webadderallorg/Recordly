export interface AudioDuckRange {
	startMs: number;
	endMs: number;
}

export interface AudioEnvelope {
	fadeInMs?: number;
	fadeOutMs?: number;
	duck?: { level: number; ranges: AudioDuckRange[] };
}

export const DUCK_RAMP_MS = 80;

export function hasEnvelope(envelope: AudioEnvelope) {
	return Boolean(
		(envelope.fadeInMs ?? 0) > 0 ||
			(envelope.fadeOutMs ?? 0) > 0 ||
			(envelope.duck && envelope.duck.level < 1 && envelope.duck.ranges.length > 0),
	);
}

export function envelopeGainAt(
	envelope: AudioEnvelope,
	lengthMs: number,
	ranges: AudioDuckRange[],
	tMs: number,
) {
	const fadeIn = envelope.fadeInMs ?? 0;
	const fadeOut = envelope.fadeOutMs ?? 0;
	const rampIn = fadeIn > 0 ? Math.min(1, tMs / fadeIn) : 1;
	const rampOut = fadeOut > 0 ? Math.min(1, (lengthMs - tMs) / fadeOut) : 1;
	let gain = Math.max(0, Math.min(rampIn, rampOut));
	const level = envelope.duck?.level ?? 1;
	for (const range of ranges) {
		const distance = Math.max(range.startMs - tMs, tMs - range.endMs, 0);
		gain = Math.min(gain, level + (1 - level) * Math.min(1, distance / DUCK_RAMP_MS));
	}
	return gain;
}

export function envelopeBreakpointsMs(
	envelope: AudioEnvelope,
	lengthMs: number,
	ranges: AudioDuckRange[],
) {
	const points = new Set<number>([0, lengthMs]);
	const fadeIn = envelope.fadeInMs ?? 0;
	const fadeOut = envelope.fadeOutMs ?? 0;
	if (fadeIn > 0) points.add(fadeIn);
	if (fadeOut > 0) points.add(lengthMs - fadeOut);
	if (fadeIn > 0 && fadeOut > 0 && fadeIn + fadeOut > lengthMs) {
		points.add((lengthMs * fadeIn) / (fadeIn + fadeOut));
	}
	for (const range of ranges) {
		points.add(range.startMs - DUCK_RAMP_MS);
		points.add(range.startMs);
		points.add(range.endMs);
		points.add(range.endMs + DUCK_RAMP_MS);
	}
	return [...points].filter((t) => t >= 0 && t <= lengthMs).sort((a, b) => a - b);
}
