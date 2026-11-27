import { isRecordedCursorVisible } from "./cursorPosition";
import type { CursorTelemetryPoint, TrimRegion } from "../types";

const LOOP_CURSOR_FREEZE_DURATION_MS = 670;
const LOOP_CURSOR_RETURN_STEPS = 20;
const LOOP_CURSOR_SETTLE_DURATION_MS = 120;
const CURSOR_TRAILING_MOVEMENT_EPSILON = 0.0015;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function interpolateCursorPosition(
	samples: CursorTelemetryPoint[],
	timeMs: number,
): { cx: number; cy: number } | null {
	if (!samples || samples.length === 0) return null;

	if (timeMs <= samples[0].timeMs) {
		return { cx: samples[0].cx, cy: samples[0].cy };
	}

	if (timeMs >= samples[samples.length - 1].timeMs) {
		return { cx: samples[samples.length - 1].cx, cy: samples[samples.length - 1].cy };
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

function findFirstStableCursorType(samples: CursorTelemetryPoint[]) {
	for (const sample of samples) {
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

	return samples[0]?.cursorType ?? "arrow";
}

function easeOutQuint(progress: number) {
	return 1 - (1 - progress) ** 5;
}

function findLastMovingSampleTime(samples: CursorTelemetryPoint[]) {
	if (samples.length <= 1) {
		return samples[0]?.timeMs ?? 0;
	}

	for (let index = samples.length - 1; index > 0; index -= 1) {
		const curr = samples[index];
		const prev = samples[index - 1];
		const distance = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);
		if (distance > CURSOR_TRAILING_MOVEMENT_EPSILON) {
			return curr.timeMs;
		}
	}

	return samples[samples.length - 1].timeMs;
}

function findLatestStableCursorType(samples: CursorTelemetryPoint[], timeMs: number) {
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

function findLatestSample(samples: CursorTelemetryPoint[], timeMs: number) {
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

export function buildLoopedCursorTelemetry(
	samples: CursorTelemetryPoint[],
	totalDurationMs: number,
	timelineStartMs = 0,
): CursorTelemetryPoint[] {
	if (!samples || samples.length === 0) {
		return [];
	}

	const timelineEndMs = Math.max(0, Math.round(totalDurationMs));
	const timelineStartClampedMs = clamp(Math.round(timelineStartMs), 0, timelineEndMs);
	if (
		timelineEndMs <= timelineStartClampedMs ||
		!isRecordedCursorVisible(samples, timelineStartClampedMs) ||
		!isRecordedCursorVisible(samples, timelineEndMs)
	) {
		return samples;
	}

	const boundedSamples = samples.filter(
		(sample) => sample.timeMs >= timelineStartClampedMs && sample.timeMs <= timelineEndMs,
	);
	if (boundedSamples.length === 0) {
		return samples;
	}

	const firstSample = boundedSamples[0];
	const lastSample = boundedSamples[boundedSamples.length - 1];
	let lastTransitionMs: number | undefined;
	for (let index = boundedSamples.length - 1; index >= 0; index -= 1) {
		if (boundedSamples[index].cursorVisible !== undefined) {
			lastTransitionMs = boundedSamples[index].timeMs;
			break;
		}
	}
	const hasVisibilityTransitions = lastTransitionMs !== undefined;
	const sourceStartMs = hasVisibilityTransitions ? timelineStartClampedMs : firstSample.timeMs;
	const maxFreezeWindowMs = timelineEndMs - sourceStartMs;
	if (hasVisibilityTransitions && maxFreezeWindowMs <= LOOP_CURSOR_FREEZE_DURATION_MS) {
		// The return would leave no time for the original visibility changes.
		return samples;
	}
	if (maxFreezeWindowMs <= 1) {
		return boundedSamples;
	}

	const freezeDurationMs = Math.min(LOOP_CURSOR_FREEZE_DURATION_MS, maxFreezeWindowMs);
	const motionEndMs = timelineEndMs - freezeDurationMs;
	const clampedSettleDurationMs = Math.min(
		LOOP_CURSOR_SETTLE_DURATION_MS,
		Math.max(0, freezeDurationMs - 1),
	);
	const returnMotionDurationMs = Math.max(1, freezeDurationMs - clampedSettleDurationMs);
	const startingPoint = hasVisibilityTransitions
		? (interpolateCursorPosition(samples, timelineStartClampedMs) ?? firstSample)
		: firstSample;
	const sourceEndMs = Math.max(
		sourceStartMs,
		findLastMovingSampleTime(boundedSamples),
		lastTransitionMs ?? sourceStartMs,
	);
	const sourceDurationMs = Math.max(1, sourceEndMs - sourceStartMs);
	// Keep remapped times in source-time coordinates so cursor lookups
	// (which always use video.currentTime, i.e. source time) stay correct
	// even when the visible timeline window doesn't start at 0.
	const motionDurationMs = Math.max(1, motionEndMs - timelineStartClampedMs);
	const startingCursorType = findFirstStableCursorType(boundedSamples);
	const loopedSamples: CursorTelemetryPoint[] = [
		{
			...firstSample,
			timeMs: timelineStartClampedMs,
			cx: startingPoint.cx,
			cy: startingPoint.cy,
			interactionType: undefined,
			cursorType: startingCursorType,
			...(hasVisibilityTransitions ? { cursorVisible: true } : {}),
		},
	];

	let lastVisibilityEdge = {
		visible: true,
		sourceTimeMs: sourceStartMs,
		loopTimeMs: timelineStartClampedMs,
	};

	for (const sample of boundedSamples) {
		const progress = clamp((sample.timeMs - sourceStartMs) / sourceDurationMs, 0, 1);
		let mappedTimeMs = Math.round(timelineStartClampedMs + motionDurationMs * progress);
		if (
			sample.timeMs > sourceStartMs &&
			mappedTimeMs <= timelineStartClampedMs &&
			sample.cursorVisible !== undefined &&
			loopedSamples[0]?.cursorVisible !== undefined &&
			sample.cursorVisible !== loopedSamples[0].cursorVisible
		) {
			mappedTimeMs = Math.min(motionEndMs, timelineStartClampedMs + 1);
		}

		const previous = loopedSamples[loopedSamples.length - 1];
		const timeMs = Math.max(mappedTimeMs, previous.timeMs);
		if (
			sample.cursorVisible !== undefined &&
			sample.cursorVisible !== lastVisibilityEdge.visible
		) {
			// Keep the recorded timing if remapping would erase a real visibility interval.
			if (
				timeMs === lastVisibilityEdge.loopTimeMs &&
				sample.timeMs > lastVisibilityEdge.sourceTimeMs
			) {
				return samples;
			}
			lastVisibilityEdge = {
				visible: sample.cursorVisible,
				sourceTimeMs: sample.timeMs,
				loopTimeMs: timeMs,
			};
		}
		if (timeMs === previous.timeMs) {
			loopedSamples[loopedSamples.length - 1] = {
				...sample,
				timeMs: previous.timeMs,
				...(sample.cursorVisible === undefined && previous.cursorVisible !== undefined
					? { cursorVisible: previous.cursorVisible }
					: {}),
			};
			continue;
		}

		loopedSamples.push({
			...sample,
			timeMs,
		});
	}

	const returnStartPoint = interpolateCursorPosition(loopedSamples, motionEndMs) ?? {
		cx: lastSample.cx,
		cy: lastSample.cy,
	};
	const returnStartCursorType = findLatestStableCursorType(loopedSamples, motionEndMs);
	const returnMotionStartMs = motionEndMs;

	for (let step = 0; step <= LOOP_CURSOR_RETURN_STEPS; step += 1) {
		const progress = step / LOOP_CURSOR_RETURN_STEPS;
		const easedProgress = easeOutQuint(progress);
		const timeMs = Math.round(returnMotionStartMs + returnMotionDurationMs * progress);
		loopedSamples.push({
			timeMs,
			cx: returnStartPoint.cx + (startingPoint.cx - returnStartPoint.cx) * easedProgress,
			cy: returnStartPoint.cy + (startingPoint.cy - returnStartPoint.cy) * easedProgress,
			interactionType: progress > 0 ? "move" : undefined,
			cursorType:
				progress >= 1
					? startingCursorType
					: progress <= 0
						? returnStartCursorType
						: undefined,
		});
	}

	if (clampedSettleDurationMs > 0) {
		const settleSteps = Math.max(
			2,
			Math.round(
				(clampedSettleDurationMs / LOOP_CURSOR_FREEZE_DURATION_MS) *
					LOOP_CURSOR_RETURN_STEPS,
			),
		);
		const settleStartMs = returnMotionStartMs + returnMotionDurationMs;

		for (let step = 1; step <= settleSteps; step += 1) {
			const progress = step / settleSteps;
			const timeMs = Math.round(settleStartMs + clampedSettleDurationMs * progress);
			loopedSamples.push({
				timeMs,
				cx: startingPoint.cx,
				cy: startingPoint.cy,
				interactionType: "move",
				cursorType: startingCursorType,
			});
		}
	}

	return loopedSamples;
}

export function getDisplayedTimelineEndMs(totalDurationMs: number, trimRegions: TrimRegion[]) {
	return getDisplayedTimelineWindowMs(totalDurationMs, trimRegions).endMs;
}

export function getDisplayedTimelineWindowMs(totalDurationMs: number, trimRegions: TrimRegion[]) {
	const durationMs = Math.max(0, Math.round(totalDurationMs));
	if (durationMs <= 0) {
		return { startMs: 0, endMs: 0 };
	}

	if (!trimRegions || trimRegions.length === 0) {
		return { startMs: 0, endMs: durationMs };
	}

	const sortedTrimRegions = trimRegions
		.map((region) => ({
			startMs: clamp(Math.round(region.startMs), 0, durationMs),
			endMs: clamp(Math.round(region.endMs), 0, durationMs),
		}))
		.filter((region) => region.endMs > region.startMs)
		.sort((a, b) => a.startMs - b.startMs);

	if (sortedTrimRegions.length === 0) {
		return { startMs: 0, endMs: durationMs };
	}

	let cursorMs = 0;
	let firstVisibleStartMs: number | null = null;
	let lastVisibleEndMs = 0;

	for (const trimRegion of sortedTrimRegions) {
		if (trimRegion.startMs > cursorMs) {
			if (firstVisibleStartMs === null) {
				firstVisibleStartMs = cursorMs;
			}
			lastVisibleEndMs = trimRegion.startMs;
		}
		cursorMs = Math.max(cursorMs, trimRegion.endMs);
	}

	if (cursorMs < durationMs) {
		if (firstVisibleStartMs === null) {
			firstVisibleStartMs = cursorMs;
		}
		lastVisibleEndMs = durationMs;
	}

	const clampedEndMs = clamp(lastVisibleEndMs, 0, durationMs);
	const clampedStartMs = clamp(firstVisibleStartMs ?? 0, 0, clampedEndMs);
	return { startMs: clampedStartMs, endMs: clampedEndMs };
}
