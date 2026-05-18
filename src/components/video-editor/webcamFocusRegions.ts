import type { WebcamCorner, WebcamFocusRegion, WebcamFocusScreenMode } from "./types";
import {
	DEFAULT_WEBCAM_FOCUS_SCREEN_MODE,
	DEFAULT_WEBCAM_FOCUS_SCREEN_PIP_SIZE,
	DEFAULT_WEBCAM_FOCUS_SIZE,
	DEFAULT_WEBCAM_FOCUS_TRANSITION_IN_MS,
	DEFAULT_WEBCAM_FOCUS_TRANSITION_OUT_MS,
} from "./types";
import { clamp01, cubicBezier } from "./videoPlayback/mathUtils";
import { clampWebcamSizeRegionSize } from "./webcamSizeRegions";

export const WEBCAM_FOCUS_REGION_MIN_DURATION_MS = 250;
export const WEBCAM_FOCUS_REGION_MIN_SIZE = 50;
export const WEBCAM_FOCUS_REGION_MAX_SIZE = 100;
export const WEBCAM_FOCUS_REGION_MIN_PIP_SIZE = 8;
export const WEBCAM_FOCUS_REGION_MAX_PIP_SIZE = 40;
export const WEBCAM_FOCUS_REGION_MIN_TRANSITION_MS = 0;
export const WEBCAM_FOCUS_REGION_MAX_TRANSITION_MS = 2000;

export interface WebcamFocusTransitionDefaults {
	transitionInMs: number;
	transitionOutMs: number;
}

export interface WebcamFocusState {
	region: WebcamFocusRegion;
	progress: number;
	webcamSize: number;
	screenMode: WebcamFocusScreenMode;
	screenSize: number;
	screenOpacity: number;
	screenCorner: WebcamCorner;
}

export interface WebcamFocusScreenTransform {
	scale: number;
	x: number;
	y: number;
}

const DEFAULT_TRANSITIONS: WebcamFocusTransitionDefaults = {
	transitionInMs: DEFAULT_WEBCAM_FOCUS_TRANSITION_IN_MS,
	transitionOutMs: DEFAULT_WEBCAM_FOCUS_TRANSITION_OUT_MS,
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

function easeFocusTransition(t: number): number {
	return cubicBezier(0.4, 0.0, 0.2, 1.0, clamp01(t));
}

function isWebcamCorner(value: unknown): value is WebcamCorner {
	return (
		value === "top-left" ||
		value === "top-right" ||
		value === "bottom-left" ||
		value === "bottom-right"
	);
}

function isWebcamFocusScreenMode(value: unknown): value is WebcamFocusScreenMode {
	return value === "pip" || value === "hidden";
}

function resolveDefaults(
	defaults: WebcamFocusTransitionDefaults | undefined,
): WebcamFocusTransitionDefaults {
	return {
		transitionInMs: clamp(
			Math.round(defaults?.transitionInMs ?? DEFAULT_TRANSITIONS.transitionInMs),
			WEBCAM_FOCUS_REGION_MIN_TRANSITION_MS,
			WEBCAM_FOCUS_REGION_MAX_TRANSITION_MS,
		),
		transitionOutMs: clamp(
			Math.round(defaults?.transitionOutMs ?? DEFAULT_TRANSITIONS.transitionOutMs),
			WEBCAM_FOCUS_REGION_MIN_TRANSITION_MS,
			WEBCAM_FOCUS_REGION_MAX_TRANSITION_MS,
		),
	};
}

function getTransitionInMs(
	region: WebcamFocusRegion,
	defaults: WebcamFocusTransitionDefaults,
): number {
	return clamp(
		Math.round(region.transitionInMs ?? defaults.transitionInMs),
		WEBCAM_FOCUS_REGION_MIN_TRANSITION_MS,
		WEBCAM_FOCUS_REGION_MAX_TRANSITION_MS,
	);
}

function getTransitionOutMs(
	region: WebcamFocusRegion,
	defaults: WebcamFocusTransitionDefaults,
): number {
	return clamp(
		Math.round(region.transitionOutMs ?? defaults.transitionOutMs),
		WEBCAM_FOCUS_REGION_MIN_TRANSITION_MS,
		WEBCAM_FOCUS_REGION_MAX_TRANSITION_MS,
	);
}

export function clampWebcamFocusRegionSize(size: unknown): number {
	if (!isFiniteNumber(size)) {
		return DEFAULT_WEBCAM_FOCUS_SIZE;
	}

	return clamp(size, WEBCAM_FOCUS_REGION_MIN_SIZE, WEBCAM_FOCUS_REGION_MAX_SIZE);
}

export function clampWebcamFocusRegionPipSize(size: unknown): number {
	if (!isFiniteNumber(size)) {
		return DEFAULT_WEBCAM_FOCUS_SCREEN_PIP_SIZE;
	}

	return clamp(size, WEBCAM_FOCUS_REGION_MIN_PIP_SIZE, WEBCAM_FOCUS_REGION_MAX_PIP_SIZE);
}

export function clampWebcamFocusRegionTransitionMs(durationMs: unknown): number | undefined {
	if (!isFiniteNumber(durationMs)) {
		return undefined;
	}

	return clamp(
		Math.round(durationMs),
		WEBCAM_FOCUS_REGION_MIN_TRANSITION_MS,
		WEBCAM_FOCUS_REGION_MAX_TRANSITION_MS,
	);
}

export function getOppositeWebcamCorner(corner: WebcamCorner): WebcamCorner {
	switch (corner) {
		case "top-left":
			return "bottom-right";
		case "top-right":
			return "bottom-left";
		case "bottom-left":
			return "top-right";
		case "bottom-right":
			return "top-left";
	}
}

export function normalizeWebcamFocusRegions(
	input: unknown,
	totalDurationMs?: number,
): WebcamFocusRegion[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const hasDurationLimit = isFiniteNumber(totalDurationMs) && totalDurationMs > 0;
	const maxEndMs = hasDurationLimit ? Math.round(totalDurationMs) : null;
	const normalized: WebcamFocusRegion[] = [];
	const usedIds = new Set<string>();

	for (let index = 0; index < input.length; index += 1) {
		const raw = input[index];
		if (!raw || typeof raw !== "object") {
			continue;
		}

		const candidate = raw as Partial<WebcamFocusRegion>;
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
		if (endMs - startMs < WEBCAM_FOCUS_REGION_MIN_DURATION_MS) {
			continue;
		}

		const transitionInMs = clampWebcamFocusRegionTransitionMs(candidate.transitionInMs);
		const transitionOutMs = clampWebcamFocusRegionTransitionMs(candidate.transitionOutMs);

		let id =
			typeof candidate.id === "string" && candidate.id.trim().length > 0
				? candidate.id
				: `webcam-focus-${index + 1}`;
		if (usedIds.has(id)) {
			let suffix = index + 1;
			let candidateId = `webcam-focus-${suffix}`;
			while (usedIds.has(candidateId)) {
				suffix += 1;
				candidateId = `webcam-focus-${suffix}`;
			}
			id = candidateId;
		}
		usedIds.add(id);

		normalized.push({
			id,
			startMs,
			endMs,
			focusSize: clampWebcamFocusRegionSize(candidate.focusSize),
			screenMode: isWebcamFocusScreenMode(candidate.screenMode)
				? candidate.screenMode
				: DEFAULT_WEBCAM_FOCUS_SCREEN_MODE,
			screenPipSize: clampWebcamFocusRegionPipSize(candidate.screenPipSize),
			...(isWebcamCorner(candidate.screenPipCorner)
				? { screenPipCorner: candidate.screenPipCorner }
				: {}),
			...(transitionInMs !== undefined ? { transitionInMs } : {}),
			...(transitionOutMs !== undefined ? { transitionOutMs } : {}),
		});
	}

	const sorted = normalized.sort((left, right) => {
		if (left.startMs !== right.startMs) return left.startMs - right.startMs;
		return left.endMs - right.endMs;
	});

	// Resolve overlaps deterministically so preview and export always agree
	// on a single active region per instant. Two phases:
	//  1. Greedily keep regions, dropping any earlier one that would be left
	//     shorter than the minimum once clipped to a later region's start.
	//     Dropping re-checks the new tail, so a short middle region can't
	//     leave a false gap between its neighbours.
	//  2. Clip every kept region to end where the next kept region begins.
	const kept: WebcamFocusRegion[] = [];
	for (const region of sorted) {
		while (kept.length > 0) {
			const previous = kept[kept.length - 1];
			if (region.startMs >= previous.endMs) {
				break;
			}
			if (region.startMs - previous.startMs >= WEBCAM_FOCUS_REGION_MIN_DURATION_MS) {
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

export function getActiveWebcamFocusRegion(
	regions: readonly WebcamFocusRegion[] | undefined,
	timeMs: number,
): WebcamFocusRegion | null {
	if (!regions?.length || !Number.isFinite(timeMs)) {
		return null;
	}

	const roundedTimeMs = Math.round(timeMs);
	let active: WebcamFocusRegion | null = null;
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
	regions: readonly WebcamFocusRegion[],
	timeMs: number,
): WebcamFocusRegion | null {
	let previous: WebcamFocusRegion | null = null;
	for (const region of regions) {
		if (region.endMs <= timeMs && (!previous || region.endMs >= previous.endMs)) {
			previous = region;
		}
	}
	return previous;
}

function getNextRegion(
	regions: readonly WebcamFocusRegion[],
	timeMs: number,
): WebcamFocusRegion | null {
	let next: WebcamFocusRegion | null = null;
	for (const region of regions) {
		if (region.startMs >= timeMs && (!next || region.startMs < next.startMs)) {
			next = region;
		}
	}
	return next;
}

function buildFocusState({
	baseWebcamSize,
	region,
	progress,
	webcamCorner,
}: {
	baseWebcamSize: number;
	region: WebcamFocusRegion;
	progress: number;
	webcamCorner: WebcamCorner;
}): WebcamFocusState {
	const easedProgress = clamp01(progress);
	const screenMode = region.screenMode ?? DEFAULT_WEBCAM_FOCUS_SCREEN_MODE;
	const targetPipSize = clampWebcamFocusRegionPipSize(region.screenPipSize);
	const screenSize = screenMode === "pip" ? lerp(100, targetPipSize, easedProgress) : 100;

	return {
		region,
		progress: easedProgress,
		webcamSize: lerp(
			clampWebcamSizeRegionSize(baseWebcamSize),
			clampWebcamFocusRegionSize(region.focusSize),
			easedProgress,
		),
		screenMode,
		screenSize,
		screenOpacity: screenMode === "hidden" ? 1 - easedProgress : 1,
		screenCorner: region.screenPipCorner ?? getOppositeWebcamCorner(webcamCorner),
	};
}

function buildFullFocusState({
	baseWebcamSize,
	region,
	webcamCorner,
}: {
	baseWebcamSize: number;
	region: WebcamFocusRegion;
	webcamCorner: WebcamCorner;
}): WebcamFocusState {
	return buildFocusState({ baseWebcamSize, region, progress: 1, webcamCorner });
}

function blendFocusStates(
	fromState: WebcamFocusState,
	toState: WebcamFocusState,
	progress: number,
): WebcamFocusState {
	const amount = clamp01(progress);
	return {
		region: amount < 0.5 ? fromState.region : toState.region,
		progress: 1,
		webcamSize: lerp(fromState.webcamSize, toState.webcamSize, amount),
		screenMode: amount < 0.5 ? fromState.screenMode : toState.screenMode,
		screenSize: lerp(fromState.screenSize, toState.screenSize, amount),
		screenOpacity: lerp(fromState.screenOpacity, toState.screenOpacity, amount),
		screenCorner: amount < 0.5 ? fromState.screenCorner : toState.screenCorner,
	};
}

export function getInterpolatedFocusStateAtTime(
	baseWebcamSize: number,
	regions: readonly WebcamFocusRegion[] | undefined,
	timeMs: number,
	webcamCorner: WebcamCorner = "bottom-right",
	defaults?: WebcamFocusTransitionDefaults,
): WebcamFocusState | null {
	if (!Number.isFinite(timeMs) || !regions?.length) {
		return null;
	}

	const roundedTimeMs = Math.round(timeMs);
	const resolvedDefaults = resolveDefaults(defaults);
	const activeRegion = getActiveWebcamFocusRegion(regions, roundedTimeMs);
	const nextRegion = getNextRegion(regions, roundedTimeMs);

	if (activeRegion) {
		const activeState = buildFullFocusState({
			baseWebcamSize,
			region: activeRegion,
			webcamCorner,
		});
		if (nextRegion && nextRegion.startMs > roundedTimeMs) {
			const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
			const transitionStartMs = nextRegion.startMs - transitionInMs;
			if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
				const progress = easeFocusTransition(
					(roundedTimeMs - transitionStartMs) / transitionInMs,
				);
				return blendFocusStates(
					activeState,
					buildFullFocusState({ baseWebcamSize, region: nextRegion, webcamCorner }),
					progress,
				);
			}
		}
		return activeState;
	}

	const previousRegion = getPreviousRegion(regions, roundedTimeMs);

	if (previousRegion && nextRegion && previousRegion.endMs <= roundedTimeMs) {
		const previousOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const nextInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const gapMs = nextRegion.startMs - previousRegion.endMs;
		if (
			gapMs >= 0 &&
			gapMs <= previousOutMs + nextInMs &&
			roundedTimeMs <= nextRegion.startMs
		) {
			// Use the same blend origin as the active-region branch so the
			// curve is continuous across previousRegion.endMs even when
			// nextRegion's transition-in started before the previous region
			// ended. Falls back to the plain gap blend when it didn't.
			const blendStartMs = Math.min(
				previousRegion.endMs,
				nextRegion.startMs - nextInMs,
			);
			const blendDurationMs = nextRegion.startMs - blendStartMs;
			const progress =
				gapMs <= 0 || blendDurationMs <= 0
					? 1
					: easeFocusTransition(
							clamp01((roundedTimeMs - blendStartMs) / blendDurationMs),
						);
			return blendFocusStates(
				buildFullFocusState({ baseWebcamSize, region: previousRegion, webcamCorner }),
				buildFullFocusState({ baseWebcamSize, region: nextRegion, webcamCorner }),
				progress,
			);
		}
	}

	if (previousRegion) {
		const transitionOutMs = getTransitionOutMs(previousRegion, resolvedDefaults);
		const transitionEndMs = previousRegion.endMs + transitionOutMs;
		if (transitionOutMs > 0 && roundedTimeMs <= transitionEndMs) {
			return buildFocusState({
				baseWebcamSize,
				region: previousRegion,
				progress:
					1 -
					easeFocusTransition((roundedTimeMs - previousRegion.endMs) / transitionOutMs),
				webcamCorner,
			});
		}
	}

	if (nextRegion) {
		const transitionInMs = getTransitionInMs(nextRegion, resolvedDefaults);
		const transitionStartMs = nextRegion.startMs - transitionInMs;
		if (transitionInMs > 0 && roundedTimeMs >= transitionStartMs) {
			return buildFocusState({
				baseWebcamSize,
				region: nextRegion,
				progress: easeFocusTransition((roundedTimeMs - transitionStartMs) / transitionInMs),
				webcamCorner,
			});
		}
	}

	return null;
}

export function getWebcamFocusScreenTransform({
	containerWidth,
	containerHeight,
	screenSizePercent,
	screenCorner,
	margin = 24,
}: {
	containerWidth: number;
	containerHeight: number;
	screenSizePercent: number;
	screenCorner: WebcamCorner;
	margin?: number;
}): WebcamFocusScreenTransform {
	const scale = clamp(screenSizePercent, 0, 100) / 100;
	const scaledWidth = containerWidth * scale;
	const scaledHeight = containerHeight * scale;
	const safeMargin = Math.max(0, margin);
	const x =
		screenCorner === "top-right" || screenCorner === "bottom-right"
			? containerWidth - scaledWidth - safeMargin
			: safeMargin;
	const y =
		screenCorner === "bottom-left" || screenCorner === "bottom-right"
			? containerHeight - scaledHeight - safeMargin
			: safeMargin;

	return {
		scale,
		x: Math.max(0, x),
		y: Math.max(0, y),
	};
}

export function getNextWebcamFocusRegionId(regions: readonly WebcamFocusRegion[]): string {
	const usedNumbers = new Set<number>();
	for (const region of regions) {
		const match = /^webcam-focus-(\d+)$/.exec(region.id);
		if (match) {
			usedNumbers.add(Number(match[1]));
		}
	}

	let next = 1;
	while (usedNumbers.has(next)) {
		next += 1;
	}

	return `webcam-focus-${next}`;
}
