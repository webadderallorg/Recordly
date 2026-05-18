import type { WebcamSizeRegion } from "./types";
import {
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_WEBCAM_SIZE_TRANSITION_IN_MS,
	DEFAULT_WEBCAM_SIZE_TRANSITION_OUT_MS,
} from "./types";
import { clamp01, cubicBezier } from "./videoPlayback/mathUtils";

export const WEBCAM_SIZE_REGION_MIN_SIZE = 10;
export const WEBCAM_SIZE_REGION_MAX_SIZE = 100;
export const WEBCAM_SIZE_REGION_MIN_DURATION_MS = 250;
export const WEBCAM_SIZE_REGION_MIN_TRANSITION_MS = 0;
export const WEBCAM_SIZE_REGION_MAX_TRANSITION_MS = 2000;

export interface WebcamSizeTransitionDefaults {
	transitionInMs: number;
	transitionOutMs: number;
}

export interface WebcamSizeDimensions {
	size: number;
	height: number;
}

const DEFAULT_TRANSITIONS: WebcamSizeTransitionDefaults = {
	transitionInMs: DEFAULT_WEBCAM_SIZE_TRANSITION_IN_MS,
	transitionOutMs: DEFAULT_WEBCAM_SIZE_TRANSITION_OUT_MS,
};

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function toIntegerMs(value: unknown): number | null {
	if (!isFiniteNumber(value)) return null;
	return Math.round(value);
}

function lerp(start: number, end: number, amount: number) {
	return start + (end - start) * amount;
}

function easeWebcamSizeTransition(t: number): number {
	return cubicBezier(0.4, 0.0, 0.2, 1.0, clamp01(t));
}

function resolveDefaults(
	defaults: WebcamSizeTransitionDefaults | undefined,
): WebcamSizeTransitionDefaults {
	return {
		transitionInMs: clamp(
			Math.round(defaults?.transitionInMs ?? DEFAULT_TRANSITIONS.transitionInMs),
			WEBCAM_SIZE_REGION_MIN_TRANSITION_MS,
			WEBCAM_SIZE_REGION_MAX_TRANSITION_MS,
		),
		transitionOutMs: clamp(
			Math.round(defaults?.transitionOutMs ?? DEFAULT_TRANSITIONS.transitionOutMs),
			WEBCAM_SIZE_REGION_MIN_TRANSITION_MS,
			WEBCAM_SIZE_REGION_MAX_TRANSITION_MS,
		),
	};
}

function getTransitionInMs(
	region: WebcamSizeRegion,
	defaults: WebcamSizeTransitionDefaults,
): number {
	return clamp(
		Math.round(region.transitionInMs ?? defaults.transitionInMs),
		WEBCAM_SIZE_REGION_MIN_TRANSITION_MS,
		WEBCAM_SIZE_REGION_MAX_TRANSITION_MS,
	);
}

function getTransitionOutMs(
	region: WebcamSizeRegion,
	defaults: WebcamSizeTransitionDefaults,
): number {
	return clamp(
		Math.round(region.transitionOutMs ?? defaults.transitionOutMs),
		WEBCAM_SIZE_REGION_MIN_TRANSITION_MS,
		WEBCAM_SIZE_REGION_MAX_TRANSITION_MS,
	);
}

export function clampWebcamSizeRegionSize(size: unknown): number {
	if (!isFiniteNumber(size)) {
		return DEFAULT_WEBCAM_SIZE;
	}

	return clamp(size, WEBCAM_SIZE_REGION_MIN_SIZE, WEBCAM_SIZE_REGION_MAX_SIZE);
}

export function clampWebcamSizeRegionHeight(height: unknown, fallback?: unknown): number {
	if (!isFiniteNumber(height)) {
		return clampWebcamSizeRegionSize(fallback);
	}

	return clamp(height, WEBCAM_SIZE_REGION_MIN_SIZE, WEBCAM_SIZE_REGION_MAX_SIZE);
}

export function clampWebcamSizeRegionTransitionMs(durationMs: unknown): number | undefined {
	if (!isFiniteNumber(durationMs)) {
		return undefined;
	}

	return clamp(
		Math.round(durationMs),
		WEBCAM_SIZE_REGION_MIN_TRANSITION_MS,
		WEBCAM_SIZE_REGION_MAX_TRANSITION_MS,
	);
}

export function normalizeWebcamSizeRegions(
	input: unknown,
	totalDurationMs?: number,
): WebcamSizeRegion[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const hasDurationLimit = isFiniteNumber(totalDurationMs) && totalDurationMs > 0;
	const maxEndMs = hasDurationLimit ? Math.round(totalDurationMs) : null;

	const normalized: WebcamSizeRegion[] = [];
	const usedIds = new Set<string>();

	for (let index = 0; index < input.length; index += 1) {
		const raw = input[index];

		if (!raw || typeof raw !== "object") {
			continue;
		}

		const candidate = raw as Partial<WebcamSizeRegion>;

		const start = toIntegerMs(candidate.startMs);
		const end = toIntegerMs(candidate.endMs);

		if (start === null || end === null) {
			continue;
		}

		let startMs = Math.max(0, start);
		let endMs = Math.max(0, end);

		if (maxEndMs !== null) {
			startMs = clamp(startMs, 0, maxEndMs);
			endMs = clamp(endMs, 0, maxEndMs);
		}

		if (endMs - startMs < WEBCAM_SIZE_REGION_MIN_DURATION_MS) {
			continue;
		}

		let id =
			typeof candidate.id === "string" && candidate.id.trim().length > 0
				? candidate.id
				: `webcam-size-${index + 1}`;
		if (usedIds.has(id)) {
			let suffix = index + 1;
			let candidateId = `webcam-size-${suffix}`;
			while (usedIds.has(candidateId)) {
				suffix += 1;
				candidateId = `webcam-size-${suffix}`;
			}
			id = candidateId;
		}
		usedIds.add(id);
		const transitionInMs = clampWebcamSizeRegionTransitionMs(candidate.transitionInMs);
		const transitionOutMs = clampWebcamSizeRegionTransitionMs(candidate.transitionOutMs);
		const height = isFiniteNumber(candidate.height)
			? clampWebcamSizeRegionHeight(candidate.height, candidate.size)
			: undefined;

		normalized.push({
			id,
			startMs,
			endMs,
			size: clampWebcamSizeRegionSize(candidate.size),
			...(height !== undefined ? { height } : {}),
			...(transitionInMs !== undefined ? { transitionInMs } : {}),
			...(transitionOutMs !== undefined ? { transitionOutMs } : {}),
		});
	}

	const sorted = normalized.sort((left, right) => {
		if (left.startMs !== right.startMs) {
			return left.startMs - right.startMs;
		}

		return left.endMs - right.endMs;
	});

	// Resolve overlaps deterministically so preview and export always agree
	// on a single active region per instant. Two phases:
	//  1. Greedily keep regions, dropping any earlier one that would be left
	//     shorter than the minimum once clipped to a later region's start.
	//     Dropping re-checks the new tail, so a short middle region can't
	//     leave a false gap between its neighbours.
	//  2. Clip every kept region to end where the next kept region begins.
	const kept: WebcamSizeRegion[] = [];
	for (const region of sorted) {
		while (kept.length > 0) {
			const previous = kept[kept.length - 1];
			if (region.startMs >= previous.endMs) {
				break;
			}
			if (region.startMs - previous.startMs >= WEBCAM_SIZE_REGION_MIN_DURATION_MS) {
				break;
			}
			kept.pop();
		}
		kept.push(region);
	}

	return kept.map((region, index) => {
		const next = kept[index + 1];
		return next && region.endMs > next.startMs
			? { ...region, endMs: next.startMs }
			: region;
	});
}

export function getActiveWebcamSizeRegion(
	regions: readonly WebcamSizeRegion[] | undefined,
	timeMs: number,
): WebcamSizeRegion | null {
	if (!regions?.length || !Number.isFinite(timeMs)) {
		return null;
	}

	const roundedTimeMs = Math.round(timeMs);
	let active: WebcamSizeRegion | null = null;

	for (const region of regions) {
		if (roundedTimeMs >= region.startMs && roundedTimeMs < region.endMs) {
			if (!active || region.startMs >= active.startMs) {
				active = region;
			}
		}
	}

	return active;
}

function rawWebcamSizeAt(
	baseSize: number,
	regions: readonly WebcamSizeRegion[] | undefined,
	timeMs: number,
): number {
	const activeRegion = getActiveWebcamSizeRegion(regions, timeMs);
	if (!activeRegion) {
		return clampWebcamSizeRegionSize(baseSize);
	}
	return clampWebcamSizeRegionSize(activeRegion.size);
}

function getPreviousRegion(
	regions: readonly WebcamSizeRegion[],
	timeMs: number,
): WebcamSizeRegion | null {
	let previous: WebcamSizeRegion | null = null;
	for (const region of regions) {
		if (region.endMs <= timeMs && (!previous || region.endMs >= previous.endMs)) {
			previous = region;
		}
	}
	return previous;
}

function getNextRegion(
	regions: readonly WebcamSizeRegion[],
	timeMs: number,
): WebcamSizeRegion | null {
	let next: WebcamSizeRegion | null = null;
	for (const region of regions) {
		if (region.startMs >= timeMs && (!next || region.startMs < next.startMs)) {
			next = region;
		}
	}
	return next;
}

export function getWebcamSizeAtTime(
	baseSize: number,
	regions: readonly WebcamSizeRegion[] | undefined,
	timeMs: number,
): number {
	if (!Number.isFinite(timeMs)) {
		return clampWebcamSizeRegionSize(baseSize);
	}

	return rawWebcamSizeAt(baseSize, regions, Math.round(timeMs));
}

/**
 * Deterministic size resolver used by preview and export. Transitions start
 * before a region begins and finish after it ends; when neighboring transition
 * windows overlap, the size blends directly between the two region sizes.
 */
export function getInterpolatedWebcamSizeAtTime(
	baseSize: number,
	regions: readonly WebcamSizeRegion[] | undefined,
	timeMs: number,
	defaults?: WebcamSizeTransitionDefaults,
): number {
	const base = clampWebcamSizeRegionSize(baseSize);
	if (!Number.isFinite(timeMs) || !regions?.length) {
		return base;
	}

	const roundedTimeMs = Math.round(timeMs);
	const resolvedDefaults = resolveDefaults(defaults);
	const activeRegion = getActiveWebcamSizeRegion(regions, roundedTimeMs);
	const nextRegion = getNextRegion(regions, roundedTimeMs);

	if (activeRegion) {
		if (nextRegion && nextRegion.startMs > roundedTimeMs) {
			const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
			const transitionStartMs = nextRegion.startMs - transitionInMs;

			if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
				const progress = easeWebcamSizeTransition(
					(roundedTimeMs - transitionStartMs) / transitionInMs,
				);
				return lerp(
					clampWebcamSizeRegionSize(activeRegion.size),
					clampWebcamSizeRegionSize(nextRegion.size),
					progress,
				);
			}
		}

		return clampWebcamSizeRegionSize(activeRegion.size);
	}

	const previousRegion = getPreviousRegion(regions, roundedTimeMs);

	if (previousRegion && nextRegion && previousRegion.endMs <= roundedTimeMs) {
		const previousOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const nextInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const gapMs = nextRegion.startMs - previousRegion.endMs;
		const transitionsOverlap =
			gapMs >= 0 && gapMs <= previousOutMs + nextInMs && roundedTimeMs <= nextRegion.startMs;

		if (transitionsOverlap) {
			if (gapMs <= 0) {
				return clampWebcamSizeRegionSize(nextRegion.size);
			}

			// Use the same blend origin as the active-region branch so the
			// curve is continuous across previousRegion.endMs even when
			// nextRegion's transition-in started before the previous region
			// ended. Falls back to the plain gap blend when it didn't.
			const blendStartMs = Math.min(
				previousRegion.endMs,
				nextRegion.startMs - nextInMs,
			);
			const blendDurationMs = nextRegion.startMs - blendStartMs;
			const progress = easeWebcamSizeTransition(
				clamp01((roundedTimeMs - blendStartMs) / blendDurationMs),
			);
			return lerp(
				clampWebcamSizeRegionSize(previousRegion.size),
				clampWebcamSizeRegionSize(nextRegion.size),
				progress,
			);
		}
	}

	if (previousRegion) {
		const transitionOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const transitionEndMs = previousRegion.endMs + transitionOutMs;

		if (transitionOutMs > 0 && roundedTimeMs <= transitionEndMs) {
			const progress = easeWebcamSizeTransition(
				(roundedTimeMs - previousRegion.endMs) / transitionOutMs,
			);
			return lerp(clampWebcamSizeRegionSize(previousRegion.size), base, progress);
		}
	}

	if (nextRegion) {
		const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const transitionStartMs = nextRegion.startMs - transitionInMs;

		if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
			const progress = easeWebcamSizeTransition(
				(roundedTimeMs - transitionStartMs) / transitionInMs,
			);
			return lerp(base, clampWebcamSizeRegionSize(nextRegion.size), progress);
		}
	}

	return base;
}

function getRegionDimensions(region: WebcamSizeRegion): WebcamSizeDimensions {
	const size = clampWebcamSizeRegionSize(region.size);
	return {
		size,
		height: clampWebcamSizeRegionHeight(region.height, size),
	};
}

function lerpDimensions(
	start: WebcamSizeDimensions,
	end: WebcamSizeDimensions,
	amount: number,
): WebcamSizeDimensions {
	return {
		size: lerp(start.size, end.size, amount),
		height: lerp(start.height, end.height, amount),
	};
}

export function getInterpolatedWebcamDimensionsAtTime(
	baseSize: number,
	baseHeight: number,
	regions: readonly WebcamSizeRegion[] | undefined,
	timeMs: number,
	defaults?: WebcamSizeTransitionDefaults,
): WebcamSizeDimensions {
	const base: WebcamSizeDimensions = {
		size: clampWebcamSizeRegionSize(baseSize),
		height: clampWebcamSizeRegionHeight(baseHeight, baseSize),
	};
	if (!Number.isFinite(timeMs) || !regions?.length) {
		return base;
	}

	const roundedTimeMs = Math.round(timeMs);
	const resolvedDefaults = resolveDefaults(defaults);
	const activeRegion = getActiveWebcamSizeRegion(regions, roundedTimeMs);
	const nextRegion = getNextRegion(regions, roundedTimeMs);

	if (activeRegion) {
		const activeDimensions = getRegionDimensions(activeRegion);
		if (nextRegion && nextRegion.startMs > roundedTimeMs) {
			const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
			const transitionStartMs = nextRegion.startMs - transitionInMs;

			if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
				const progress = easeWebcamSizeTransition(
					(roundedTimeMs - transitionStartMs) / transitionInMs,
				);
				return lerpDimensions(activeDimensions, getRegionDimensions(nextRegion), progress);
			}
		}

		return activeDimensions;
	}

	const previousRegion = getPreviousRegion(regions, roundedTimeMs);

	if (previousRegion && nextRegion && previousRegion.endMs <= roundedTimeMs) {
		const previousOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const nextInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const gapMs = nextRegion.startMs - previousRegion.endMs;
		const transitionsOverlap =
			gapMs >= 0 && gapMs <= previousOutMs + nextInMs && roundedTimeMs <= nextRegion.startMs;

		if (transitionsOverlap) {
			if (gapMs <= 0) {
				return getRegionDimensions(nextRegion);
			}

			// Same continuous blend origin as getInterpolatedWebcamSizeAtTime.
			const blendStartMs = Math.min(
				previousRegion.endMs,
				nextRegion.startMs - nextInMs,
			);
			const blendDurationMs = nextRegion.startMs - blendStartMs;
			const progress = easeWebcamSizeTransition(
				clamp01((roundedTimeMs - blendStartMs) / blendDurationMs),
			);
			return lerpDimensions(
				getRegionDimensions(previousRegion),
				getRegionDimensions(nextRegion),
				progress,
			);
		}
	}

	if (previousRegion) {
		const transitionOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const transitionEndMs = previousRegion.endMs + transitionOutMs;

		if (transitionOutMs > 0 && roundedTimeMs <= transitionEndMs) {
			const progress = easeWebcamSizeTransition(
				(roundedTimeMs - previousRegion.endMs) / transitionOutMs,
			);
			return lerpDimensions(getRegionDimensions(previousRegion), base, progress);
		}
	}

	if (nextRegion) {
		const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const transitionStartMs = nextRegion.startMs - transitionInMs;

		if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
			const progress = easeWebcamSizeTransition(
				(roundedTimeMs - transitionStartMs) / transitionInMs,
			);
			return lerpDimensions(base, getRegionDimensions(nextRegion), progress);
		}
	}

	return base;
}

export function getNextWebcamSizeRegionId(regions: readonly WebcamSizeRegion[]): string {
	const usedNumbers = new Set<number>();

	for (const region of regions) {
		const match = /^webcam-size-(\d+)$/.exec(region.id);
		if (match) {
			usedNumbers.add(Number(match[1]));
		}
	}

	let next = 1;
	while (usedNumbers.has(next)) {
		next += 1;
	}

	return `webcam-size-${next}`;
}
