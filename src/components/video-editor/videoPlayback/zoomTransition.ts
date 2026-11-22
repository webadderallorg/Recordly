import { clamp01, easeOutZoom } from "./mathUtils";
import { createSpringState, getZoomSpringConfig, stepSpringValue } from "./motionSmoothing";

const SAMPLE_STEP_MS = 1000 / 240;
const SETTLED_PROGRESS = 0.999;
const MAX_CACHED_PROFILES = 32;
type TransitionProfile = { durationMs: number; samples: number[] };
const profiles = new Map<string, TransitionProfile>();

/**
 * Preserve the former eased target plus camera spring as a finite curve.
 * Sampling by timestamp keeps its visible pace without a renderer-dependent tail.
 */
function getProfile(targetDurationMs: number, cinematic = false): TransitionProfile {
	const key = `${targetDurationMs}:${cinematic}`;
	const cached = profiles.get(key);
	if (cached) return cached;
	const spring = createSpringState(0);
	spring.initialized = true;
	const config = getZoomSpringConfig(0.5, undefined, cinematic);
	const samples = [0];
	const maxSamples = Math.ceil((targetDurationMs + 3000) / SAMPLE_STEP_MS);
	for (let frame = 1; frame <= maxSamples; frame += 1) {
		const timeMs = frame * SAMPLE_STEP_MS;
		const value = stepSpringValue(
			spring,
			easeOutZoom(timeMs / targetDurationMs),
			SAMPLE_STEP_MS,
			config,
		);
		samples.push(value);
		if (timeMs >= targetDurationMs && value >= SETTLED_PROGRESS) break;
	}
	const finalValue = samples[samples.length - 1];
	const profile = {
		durationMs: (samples.length - 1) * SAMPLE_STEP_MS,
		samples: samples.map((value) => clamp01(value / finalValue)),
	};
	if (profiles.size >= MAX_CACHED_PROFILES) {
		profiles.delete(profiles.keys().next().value!);
	}
	profiles.set(key, profile);
	return profile;
}

export function getZoomTransitionDurationMs(targetDurationMs: number, cinematic = false) {
	return getProfile(targetDurationMs, cinematic).durationMs;
}

/** Presentation only: locate visible completion without trimming the motion profile. */
export function getZoomTransitionVisibleDurationMs(targetDurationMs: number, cinematic = false) {
	const { samples } = getProfile(targetDurationMs, cinematic);
	const index = samples.findIndex((value) => value >= 0.99);
	const before = samples[index - 1];
	const fraction = (0.99 - before) / (samples[index] - before);
	return (index - 1 + fraction) * SAMPLE_STEP_MS;
}

export function sampleZoomTransition(
	progress: number,
	targetDurationMs: number,
	cinematic = false,
) {
	if (progress <= 0) return 0;
	if (progress >= 1) return 1;
	const { samples } = getProfile(targetDurationMs, cinematic);
	const index = progress * (samples.length - 1);
	const before = Math.floor(index);
	return samples[before] + (samples[before + 1] - samples[before]) * (index - before);
}
