import type { WebcamPositionRegion } from "./types";
import {
	DEFAULT_WEBCAM_POSITION_TRANSITION_IN_MS,
	DEFAULT_WEBCAM_POSITION_TRANSITION_OUT_MS,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
} from "./types";
import { clamp01, cubicBezier } from "./videoPlayback/mathUtils";

export const WEBCAM_POSITION_REGION_MIN_DURATION_MS = 250;
export const WEBCAM_POSITION_REGION_MIN_TRANSITION_MS = 0;
export const WEBCAM_POSITION_REGION_MAX_TRANSITION_MS = 2000;

export interface WebcamPositionTransitionDefaults {
	transitionInMs: number;
	transitionOutMs: number;
}

export interface WebcamPositionPoint {
	positionX: number;
	positionY: number;
}

const DEFAULT_TRANSITIONS: WebcamPositionTransitionDefaults = {
	transitionInMs: DEFAULT_WEBCAM_POSITION_TRANSITION_IN_MS,
	transitionOutMs: DEFAULT_WEBCAM_POSITION_TRANSITION_OUT_MS,
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

function easeWebcamPositionTransition(t: number): number {
	return cubicBezier(0.4, 0.0, 0.2, 1.0, t);
}

function resolveDefaults(
	defaults: WebcamPositionTransitionDefaults | undefined,
): WebcamPositionTransitionDefaults {
	return {
		transitionInMs: clamp(
			Math.round(defaults?.transitionInMs ?? DEFAULT_TRANSITIONS.transitionInMs),
			WEBCAM_POSITION_REGION_MIN_TRANSITION_MS,
			WEBCAM_POSITION_REGION_MAX_TRANSITION_MS,
		),
		transitionOutMs: clamp(
			Math.round(defaults?.transitionOutMs ?? DEFAULT_TRANSITIONS.transitionOutMs),
			WEBCAM_POSITION_REGION_MIN_TRANSITION_MS,
			WEBCAM_POSITION_REGION_MAX_TRANSITION_MS,
		),
	};
}

function getTransitionInMs(
	region: WebcamPositionRegion,
	defaults: WebcamPositionTransitionDefaults,
): number {
	return clamp(
		Math.round(region.transitionInMs ?? defaults.transitionInMs),
		WEBCAM_POSITION_REGION_MIN_TRANSITION_MS,
		WEBCAM_POSITION_REGION_MAX_TRANSITION_MS,
	);
}

function getTransitionOutMs(
	region: WebcamPositionRegion,
	defaults: WebcamPositionTransitionDefaults,
): number {
	return clamp(
		Math.round(region.transitionOutMs ?? defaults.transitionOutMs),
		WEBCAM_POSITION_REGION_MIN_TRANSITION_MS,
		WEBCAM_POSITION_REGION_MAX_TRANSITION_MS,
	);
}

export function clampWebcamPositionCoordinate(value: unknown, fallback: number): number {
	if (!isFiniteNumber(value)) {
		return clamp(fallback, 0, 1);
	}

	return clamp(value, 0, 1);
}

export function clampWebcamPositionRegionTransitionMs(
	durationMs: unknown,
): number | undefined {
	if (!isFiniteNumber(durationMs)) {
		return undefined;
	}

	return clamp(
		Math.round(durationMs),
		WEBCAM_POSITION_REGION_MIN_TRANSITION_MS,
		WEBCAM_POSITION_REGION_MAX_TRANSITION_MS,
	);
}

export function normalizeWebcamPositionRegions(
	input: unknown,
	totalDurationMs?: number,
): WebcamPositionRegion[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const hasDurationLimit = isFiniteNumber(totalDurationMs) && totalDurationMs > 0;
	const maxEndMs = hasDurationLimit ? Math.round(totalDurationMs) : null;

	const normalized: WebcamPositionRegion[] = [];

	for (let index = 0; index < input.length; index += 1) {
		const raw = input[index];

		if (!raw || typeof raw !== "object") {
			continue;
		}

		const candidate = raw as Partial<WebcamPositionRegion>;

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

		if (endMs - startMs < WEBCAM_POSITION_REGION_MIN_DURATION_MS) {
			continue;
		}

		const id =
			typeof candidate.id === "string" && candidate.id.trim().length > 0
				? candidate.id
				: `webcam-position-${index + 1}`;
		const transitionInMs = clampWebcamPositionRegionTransitionMs(candidate.transitionInMs);
		const transitionOutMs = clampWebcamPositionRegionTransitionMs(candidate.transitionOutMs);

		normalized.push({
			id,
			startMs,
			endMs,
			positionX: clampWebcamPositionCoordinate(candidate.positionX, DEFAULT_WEBCAM_POSITION_X),
			positionY: clampWebcamPositionCoordinate(candidate.positionY, DEFAULT_WEBCAM_POSITION_Y),
			...(transitionInMs !== undefined ? { transitionInMs } : {}),
			...(transitionOutMs !== undefined ? { transitionOutMs } : {}),
		});
	}

	return normalized.sort((left, right) => {
		if (left.startMs !== right.startMs) {
			return left.startMs - right.startMs;
		}

		return left.endMs - right.endMs;
	});
}

export function getActiveWebcamPositionRegion(
	regions: readonly WebcamPositionRegion[] | undefined,
	timeMs: number,
): WebcamPositionRegion | null {
	if (!regions?.length || !Number.isFinite(timeMs)) {
		return null;
	}

	const roundedTimeMs = Math.round(timeMs);
	let active: WebcamPositionRegion | null = null;

	for (const region of regions) {
		if (roundedTimeMs >= region.startMs && roundedTimeMs < region.endMs) {
			if (!active || region.startMs >= active.startMs) {
				active = region;
			}
		}
	}

	return active;
}

function getPreviousRegion(
	regions: readonly WebcamPositionRegion[],
	timeMs: number,
): WebcamPositionRegion | null {
	let previous: WebcamPositionRegion | null = null;
	for (const region of regions) {
		if (region.endMs <= timeMs && (!previous || region.endMs >= previous.endMs)) {
			previous = region;
		}
	}
	return previous;
}

function getNextRegion(
	regions: readonly WebcamPositionRegion[],
	timeMs: number,
): WebcamPositionRegion | null {
	let next: WebcamPositionRegion | null = null;
	for (const region of regions) {
		if (region.startMs >= timeMs && (!next || region.startMs < next.startMs)) {
			next = region;
		}
	}
	return next;
}

function regionToPoint(region: WebcamPositionRegion): WebcamPositionPoint {
	return {
		positionX: clampWebcamPositionCoordinate(region.positionX, DEFAULT_WEBCAM_POSITION_X),
		positionY: clampWebcamPositionCoordinate(region.positionY, DEFAULT_WEBCAM_POSITION_Y),
	};
}

function lerpPoint(start: WebcamPositionPoint, end: WebcamPositionPoint, amount: number) {
	return {
		positionX: lerp(start.positionX, end.positionX, amount),
		positionY: lerp(start.positionY, end.positionY, amount),
	};
}

export function getWebcamPositionAtTime(
	base: WebcamPositionPoint,
	regions: readonly WebcamPositionRegion[] | undefined,
	timeMs: number,
): WebcamPositionPoint {
	const basePoint: WebcamPositionPoint = {
		positionX: clampWebcamPositionCoordinate(base.positionX, DEFAULT_WEBCAM_POSITION_X),
		positionY: clampWebcamPositionCoordinate(base.positionY, DEFAULT_WEBCAM_POSITION_Y),
	};

	if (!Number.isFinite(timeMs)) {
		return basePoint;
	}

	const active = getActiveWebcamPositionRegion(regions, Math.round(timeMs));
	return active ? regionToPoint(active) : basePoint;
}

/**
 * Deterministic position resolver used by preview and export. Transitions start
 * before a region begins and finish after it ends; when neighboring transition
 * windows overlap, the position blends directly between the two region anchors.
 */
export function getInterpolatedWebcamPositionAtTime(
	base: WebcamPositionPoint,
	regions: readonly WebcamPositionRegion[] | undefined,
	timeMs: number,
	defaults?: WebcamPositionTransitionDefaults,
): WebcamPositionPoint {
	const basePoint: WebcamPositionPoint = {
		positionX: clampWebcamPositionCoordinate(base.positionX, DEFAULT_WEBCAM_POSITION_X),
		positionY: clampWebcamPositionCoordinate(base.positionY, DEFAULT_WEBCAM_POSITION_Y),
	};

	if (!Number.isFinite(timeMs) || !regions?.length) {
		return basePoint;
	}

	const roundedTimeMs = Math.round(timeMs);
	const resolvedDefaults = resolveDefaults(defaults);
	const activeRegion = getActiveWebcamPositionRegion(regions, roundedTimeMs);
	const nextRegion = getNextRegion(regions, roundedTimeMs);

	if (activeRegion) {
		if (nextRegion && nextRegion.startMs > roundedTimeMs) {
			const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
			const transitionStartMs = nextRegion.startMs - transitionInMs;

			if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
				const progress = easeWebcamPositionTransition(
					(roundedTimeMs - transitionStartMs) / transitionInMs,
				);
				return lerpPoint(regionToPoint(activeRegion), regionToPoint(nextRegion), progress);
			}
		}

		return regionToPoint(activeRegion);
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
				return regionToPoint(nextRegion);
			}

			const progress = easeWebcamPositionTransition(
				clamp01((roundedTimeMs - previousRegion.endMs) / gapMs),
			);
			return lerpPoint(regionToPoint(previousRegion), regionToPoint(nextRegion), progress);
		}
	}

	if (previousRegion) {
		const transitionOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const transitionEndMs = previousRegion.endMs + transitionOutMs;

		if (transitionOutMs > 0 && roundedTimeMs <= transitionEndMs) {
			const progress = easeWebcamPositionTransition(
				(roundedTimeMs - previousRegion.endMs) / transitionOutMs,
			);
			return lerpPoint(regionToPoint(previousRegion), basePoint, progress);
		}
	}

	if (nextRegion) {
		const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const transitionStartMs = nextRegion.startMs - transitionInMs;

		if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
			const progress = easeWebcamPositionTransition(
				(roundedTimeMs - transitionStartMs) / transitionInMs,
			);
			return lerpPoint(basePoint, regionToPoint(nextRegion), progress);
		}
	}

	return basePoint;
}

export function getNextWebcamPositionRegionId(
	regions: readonly WebcamPositionRegion[],
): string {
	const usedNumbers = new Set<number>();

	for (const region of regions) {
		const match = /^webcam-position-(\d+)$/.exec(region.id);
		if (match) {
			usedNumbers.add(Number(match[1]));
		}
	}

	let next = 1;
	while (usedNumbers.has(next)) {
		next += 1;
	}

	return `webcam-position-${next}`;
}
