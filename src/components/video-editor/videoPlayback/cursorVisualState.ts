import { type CursorClickEffectStyle, type CursorStyle, type CursorTelemetryPoint } from "../types";
import { getCursorPressState } from "./cursorPress";
import { resolvePixelGlovePose } from "./pixelGloveMotion";

export function findLatestSample(samples: CursorTelemetryPoint[], timeMs: number) {
	if (samples.length === 0) return null;

	let lo = 0;
	let hi = samples.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (samples[mid].timeMs <= timeMs) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	return samples[lo]?.timeMs <= timeMs ? samples[lo] : null;
}

export function findLatestStableCursorType(samples: CursorTelemetryPoint[], timeMs: number) {
	// Binary search to find position at timeMs, then scan backwards
	let lo = 0;
	let hi = samples.length - 1;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (samples[mid].timeMs <= timeMs) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	// Scan backwards from the position to find a sample with cursorType
	// Skip click events only (not mouseup) to avoid transient re-type during clicks
	for (let index = lo; index >= 0; index -= 1) {
		const sample = samples[index];
		if (sample.timeMs > timeMs) {
			continue;
		}

		if (!sample.cursorType) {
			continue;
		}

		if (
			sample.interactionType === "click" ||
			sample.interactionType === "double-click" ||
			sample.interactionType === "right-click" ||
			sample.interactionType === "middle-click"
		) {
			continue;
		}

		return sample.cursorType;
	}

	return findLatestSample(samples, timeMs)?.cursorType ?? "arrow";
}

export function getCursorVisualState(
	samples: CursorTelemetryPoint[],
	timeMs: number,
	clickBounceDuration: number,
	clickEffectDurationMs: number,
	style?: CursorStyle,
	clickBounce = 1,
	clickEffect: CursorClickEffectStyle = "none",
) {
	const press = getCursorPressState(samples, timeMs, clickBounceDuration);
	const clickEffectAgeMs = press.ageMs - clickBounceDuration * 0.5;
	let clickProgress = press.pressed
		? 0.75
		: press.releaseAgeMs !== null
			? 0.75 * Math.max(0, 1 - press.releaseAgeMs / clickEffectDurationMs)
			: clickEffectAgeMs >= 0
				? Math.max(0, 1 - clickEffectAgeMs / clickEffectDurationMs)
				: 0;
	if ((clickEffect === "ripple" || clickEffect === "burst") && press.sample) {
		// Each click is a short expanding pulse that fades completely, even
		// when the mouse remains held. Time-based progress also supports seeking.
		clickProgress = Math.max(0, 1 - press.ageMs / (clickEffectDurationMs * 0.5));
	}
	return {
		cursorType: resolvePixelGlovePose(
			style,
			findLatestStableCursorType(samples, timeMs),
			press.pressed ? 0 : press.ageMs,
			clickBounceDuration,
			clickBounce,
		),
		clickSample: clickEffect === "burst" ? press.downSample : press.sample,
		isPressed: press.pressed,
		clickBounceProgress: press.bounceProgress,
		clickProgress,
	};
}
