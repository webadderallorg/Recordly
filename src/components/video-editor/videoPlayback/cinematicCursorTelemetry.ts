import { isCinematicCursorMotion, isFocusedCursorMotion } from "../cursorMotionPresets";
import type { CursorTelemetryPoint } from "../types";
import { isCursorPress } from "./cursorPress";
import type { CursorSpringTuning } from "./motionSmoothing";

export const CINEMATIC_HOVER_MIN_MS = 500;
const PATH_TOLERANCE_PX = 10;
const PATH_WINDOW_MS = 250;

type CursorType = NonNullable<CursorTelemetryPoint["cursorType"]>;
const cache = new WeakMap<
	CursorTelemetryPoint[],
	{ length: number; samples: CursorTelemetryPoint[] }
>();
const focusedCache = new WeakMap<
	CursorTelemetryPoint[],
	{ length: number; samples: CursorTelemetryPoint[] }
>();

/** Analyze the recording once. Media timestamps and interaction positions stay intact,
 * so preview, seeking and export remove short accents without delaying long hovers.
 */
export function prepareCinematicCursorTelemetry(
	samples: CursorTelemetryPoint[],
	smoothing: number,
	tuning: CursorSpringTuning,
): CursorTelemetryPoint[] {
	const cinematic = isCinematicCursorMotion(smoothing, tuning);
	if (samples.length < 2 || (!cinematic && !isFocusedCursorMotion(smoothing, tuning)))
		return samples;
	const presetCache = cinematic ? cache : focusedCache;
	const cached = presetCache.get(samples);
	if (cached?.length === samples.length) return cached.samples;
	const result = samples.map((sample) => ({ ...sample }));
	const runs: Array<{ index: number; type: CursorType }> = [{ index: 0, type: "arrow" }];
	for (let index = 0; index < samples.length; index++) {
		const sample = samples[index];
		if (!sample.cursorType || isCursorPress(sample)) continue;
		if (index === 0) runs[0].type = sample.cursorType;
		else if (sample.cursorType !== runs[runs.length - 1].type)
			runs.push({ index, type: sample.cursorType });
	}
	let acceptedType = runs[0].type;
	for (let r = 0; r < runs.length; r++) {
		const run = runs[r];
		const endIndex = runs[r + 1]?.index ?? samples.length;
		const endMs = samples[Math.min(endIndex, samples.length - 1)].timeMs;
		if (r === 0 || endMs - samples[run.index].timeMs >= CINEMATIC_HOVER_MIN_MS)
			acceptedType = run.type;
		for (let i = run.index; i < endIndex; i++) result[i].cursorType = acceptedType;
	}

	// Focused shares hover filtering while retaining its original cursor path.
	if (!cinematic) {
		presetCache.set(samples, { length: samples.length, samples: result });
		return result;
	}

	// Fit short, time-linear segments within 10 reference pixels of the recording.
	// Large turns, pauses and every interaction remain anchors; small hand wobble
	// becomes a straight glide. Use an explicit stack to handle dense telemetry.
	const straighten = (start: number, end: number) => {
		const pending: Array<[number, number]> = [[start, end]];
		while (pending.length) {
			const [a, b] = pending.pop()!;
			const span = samples[b].timeMs - samples[a].timeMs;
			if (b <= a + 1 || span <= 0) continue;
			let maxError = PATH_TOLERANCE_PX;
			let split = -1;
			for (let i = a + 1; i < b; i++) {
				const t = (samples[i].timeMs - samples[a].timeMs) / span;
				const cx = samples[a].cx + (samples[b].cx - samples[a].cx) * t;
				const cy = samples[a].cy + (samples[b].cy - samples[a].cy) * t;
				const error = Math.hypot((samples[i].cx - cx) * 1920, (samples[i].cy - cy) * 1080);
				if (error > maxError) {
					maxError = error;
					split = i;
				}
			}
			if (split >= 0) pending.push([a, split], [split, b]);
			else
				for (let i = a + 1; i < b; i++) {
					const t = (samples[i].timeMs - samples[a].timeMs) / span;
					result[i].cx = samples[a].cx + (samples[b].cx - samples[a].cx) * t;
					result[i].cy = samples[a].cy + (samples[b].cy - samples[a].cy) * t;
				}
		}
	};
	let anchor = 0;
	for (let i = 1; i < samples.length; i++) {
		const sample = samples[i];
		const previous = samples[i - 1];
		if (sample.cx === previous.cx && sample.cy === previous.cy) {
			straighten(anchor, i - 1);
			anchor = i;
			continue;
		}
		if (
			i === samples.length - 1 ||
			sample.timeMs - samples[anchor].timeMs >= PATH_WINDOW_MS ||
			(sample.interactionType && sample.interactionType !== "move")
		) {
			straighten(anchor, i);
			anchor = i;
		}
	}
	presetCache.set(samples, { length: samples.length, samples: result });
	return result;
}
