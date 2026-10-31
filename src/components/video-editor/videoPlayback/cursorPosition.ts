import type { CursorTelemetryPoint } from "../types";
/** Linearly interpolate the neighboring telemetry samples at a media timestamp. */
export function interpolateCursorPosition(
	samples: CursorTelemetryPoint[],
	timeMs: number,
): { cx: number; cy: number } | null {
	if (!samples || samples.length === 0) return null;

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
