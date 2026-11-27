import type { CursorTelemetryPoint } from "../types";

type CursorVisibilitySample = { timeMs: number; cursorVisible?: boolean };

const visibilityCache = new WeakMap<
	readonly CursorVisibilitySample[],
	{ length: number; transitions: CursorVisibilitySample[] }
>();

export function isRecordedCursorVisible(
	samples: readonly CursorVisibilitySample[],
	timeMs: number,
) {
	let entry = visibilityCache.get(samples);
	if (entry?.length !== samples.length) {
		entry = {
			length: samples.length,
			transitions: samples.filter((sample) => typeof sample.cursorVisible === "boolean"),
		};
		visibilityCache.set(samples, entry);
	}
	const { transitions } = entry;
	if (transitions.length === 0) return true;

	let lo = 0;
	let hi = transitions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (transitions[mid].timeMs <= timeMs) lo = mid + 1;
		else hi = mid;
	}
	return transitions[lo - 1]?.cursorVisible === true;
}

/** Linearly interpolate the neighboring telemetry samples at a media timestamp. */
export function interpolateCursorPosition(
	samples: CursorTelemetryPoint[],
	timeMs: number,
): { cx: number; cy: number } | null {
	if (!samples || samples.length === 0 || !isRecordedCursorVisible(samples, timeMs)) return null;

	if (timeMs <= samples[0].timeMs) {
		return { cx: samples[0].cx, cy: samples[0].cy };
	}

	if (timeMs >= samples[samples.length - 1].timeMs) {
		return {
			cx: samples[samples.length - 1].cx,
			cy: samples[samples.length - 1].cy,
		};
	}

	let lo = 0;
	let hi = samples.length - 1;
	while (lo < hi - 1) {
		const mid = (lo + hi) >> 1;
		if (samples[mid].timeMs <= timeMs) {
			lo = mid;
		} else {
			hi = mid;
		}
	}

	const a = samples[lo];
	const b = samples[hi];
	const span = b.timeMs - a.timeMs;
	if (span <= 0) return { cx: a.cx, cy: a.cy };

	const t = (timeMs - a.timeMs) / span;
	return {
		cx: a.cx + (b.cx - a.cx) * t,
		cy: a.cy + (b.cy - a.cy) * t,
	};
}
