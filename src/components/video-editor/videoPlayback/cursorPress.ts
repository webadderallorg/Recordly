import type { CursorTelemetryPoint } from "../types";

type Press = { down: CursorTelemetryPoint; up?: CursorTelemetryPoint };
type Index = { length: number; presses: Press[]; buttons: Map<number, Press[]> };
const indexes = new WeakMap<CursorTelemetryPoint[], Index>();

export function isCursorPress(sample: { interactionType?: string }) {
	return (
		sample.interactionType === "click" ||
		sample.interactionType === "double-click" ||
		sample.interactionType === "right-click" ||
		sample.interactionType === "middle-click"
	);
}

function buttonOf(sample: CursorTelemetryPoint) {
	return (
		sample.mouseButton ??
		(sample.interactionType === "right-click"
			? 2
			: sample.interactionType === "middle-click"
				? 3
				: 1)
	);
}

/** Build once per telemetry array; frame lookups also work when seeking backwards. */
function pressIndex(samples: CursorTelemetryPoint[]) {
	const cached = indexes.get(samples);
	if (cached?.length === samples.length) return cached;
	const presses: Press[] = [];
	const active = new Map<number, Press>();
	const buttons = new Map<number, Press[]>();
	for (const sample of samples) {
		if (isCursorPress(sample)) {
			const button = buttonOf(sample);
			const previous = active.get(button);
			// Old unpaired clicks are pulses; only known downs imply a held button.
			if (previous?.down.mouseButton) previous.up = sample;
			const press = { down: sample };
			presses.push(press);
			const group = buttons.get(button) ?? [];
			group.push(press);
			buttons.set(button, group);
			active.set(button, press);
		} else if (sample.interactionType === "mouseup") {
			// Old recordings did not identify which button was released.
			for (const [button, press] of active) {
				if (sample.mouseButton && sample.mouseButton !== button) continue;
				press.up = sample;
				active.delete(button);
			}
		}
	}
	const index = { length: samples.length, presses, buttons };
	indexes.set(samples, index);
	return index;
}

function latestPress(presses: Press[], timeMs: number) {
	let lo = 0;
	let hi = presses.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (presses[mid].down.timeMs <= timeMs) lo = mid + 1;
		else hi = mid;
	}
	return presses[lo - 1];
}

/** A held button is one interaction, including its full drag before release. */
export function getCursorPressIntervals(samples: CursorTelemetryPoint[], recordingEndMs: number) {
	return pressIndex(samples).presses.map(({ down, up }) => ({
		down,
		up,
		endTimeMs: up?.timeMs ?? (down.mouseButton ? recordingEndMs : down.timeMs),
	}));
}

export function getCursorPressState(
	samples: CursorTelemetryPoint[],
	timeMs: number,
	bounceMs: number,
) {
	const index = pressIndex(samples);
	let press = latestPress(index.presses, timeMs);
	// Check each button independently: releasing right must not release held left.
	let held: Press | undefined;
	let latestTransition = press?.down.timeMs ?? -Infinity;
	for (const group of index.buttons.values()) {
		const candidate = latestPress(group, timeMs);
		const transition =
			candidate?.up && candidate.up.timeMs <= timeMs
				? candidate.up.timeMs
				: (candidate?.down.timeMs ?? -Infinity);
		if (candidate && transition >= latestTransition) {
			press = candidate;
			latestTransition = transition;
		}
		if (
			candidate &&
			(candidate.up || candidate.down.mouseButton) &&
			(!candidate.up || timeMs < candidate.up.timeMs) &&
			(!held || candidate.down.timeMs >= held.down.timeMs)
		)
			held = candidate;
	}
	if (held) press = held;
	if (!press)
		return {
			sample: null,
			downSample: null,
			pressed: false,
			ageMs: Infinity,
			bounceProgress: 0,
			releaseAgeMs: null,
		};
	const ageMs = Math.max(0, timeMs - press.down.timeMs);
	const hasReleaseTracking = Boolean(press.up || press.down.mouseButton);
	const pressed = hasReleaseTracking && (!press.up || timeMs < press.up.timeMs);
	const releaseAgeMs = press.up && !pressed ? timeMs - press.up.timeMs : null;
	const half = Math.max(1, bounceMs / 2);
	const pressProgress = Math.min(0.5, ageMs / (half * 2));
	const bounceProgress = hasReleaseTracking
		? pressed
			? pressProgress
			: Math.max(
					0,
					Math.min(0.5, (press.up!.timeMs - press.down.timeMs) / (half * 2)) *
						(1 - releaseAgeMs! / half),
				)
		: Math.max(0, 1 - ageMs / Math.max(1, bounceMs));
	return {
		sample: press.up && !pressed ? press.up : press.down,
		downSample: press.down,
		pressed,
		ageMs,
		bounceProgress,
		releaseAgeMs,
	};
}
