import type { ZoomFocus, ZoomRegion } from "../types";
import { ZOOM_DEPTH_SCALES } from "../types";
import {
	TRANSITION_WINDOW_MS,
	ZOOM_IN_TRANSITION_WINDOW_MS,
	ZOOM_OUT_EARLY_START_MS,
} from "./constants";
import { clampFocusToScale } from "./focusUtils";
import { clamp01, easeOutZoom } from "./mathUtils";

const CHAINED_ZOOM_PAN_GAP_MS = 1350;
const CONNECTED_ZOOM_PAN_DURATION_MS = 1000;
const ZOOM_IN_OVERLAP_MS = 1000;
const ZOOM_ANIMATION_LEAD_MS = 200;

type DominantRegionOptions = {
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomOutDurationMs?: number;
};

type ConnectedRegionPair = {
	currentRegion: ZoomRegion;
	nextRegion: ZoomRegion;
	transitionStart: number;
	transitionEnd: number;
};

type ConnectedPanTransition = {
	progress: number;
	startFocus: ZoomFocus;
	endFocus: ZoomFocus;
	startScale: number;
	endScale: number;
};

export function computeRegionStrength(
	region: ZoomRegion,
	timeMs: number,
	options: Pick<DominantRegionOptions, "zoomInDurationMs" | "zoomOutDurationMs"> = {},
) {
	const zoomInDurationMs = Math.max(1, options.zoomInDurationMs ?? ZOOM_IN_TRANSITION_WINDOW_MS);
	const zoomOutDurationMs = Math.max(1, options.zoomOutDurationMs ?? TRANSITION_WINDOW_MS);
	const adjustedTimeMs = timeMs - ZOOM_ANIMATION_LEAD_MS;
	const leadInStart = region.startMs + ZOOM_IN_OVERLAP_MS - ZOOM_IN_TRANSITION_WINDOW_MS;
	let zoomOutStart = region.endMs - ZOOM_OUT_EARLY_START_MS;
	let zoomInEnd = leadInStart + zoomInDurationMs;

	if (zoomInEnd > zoomOutStart) {
		const midpoint = (zoomInEnd + zoomOutStart) / 2;
		zoomInEnd = midpoint;
		zoomOutStart = midpoint;
	}

	const leadOutEnd = zoomOutStart + zoomOutDurationMs;

	if (adjustedTimeMs < leadInStart || adjustedTimeMs > leadOutEnd) {
		return 0;
	}

	if (adjustedTimeMs < zoomInEnd) {
		const progress = (adjustedTimeMs - leadInStart) / zoomInDurationMs;
		return easeOutZoom(progress);
	}

	if (adjustedTimeMs <= zoomOutStart) {
		return 1;
	}

	const progress = clamp01((adjustedTimeMs - zoomOutStart) / zoomOutDurationMs);
	return 1 - easeOutZoom(progress);
}

function getResolvedFocus(region: ZoomRegion, zoomScale: number): ZoomFocus {
	return clampFocusToScale(region.focus, zoomScale);
}

function getConnectedRegionPairs(regions: ZoomRegion[]) {
	const sortedRegions = [...regions].sort((a, b) => a.startMs - b.startMs);
	const pairs: ConnectedRegionPair[] = [];

	for (let index = 0; index < sortedRegions.length - 1; index += 1) {
		const currentRegion = sortedRegions[index];
		const nextRegion = sortedRegions[index + 1];
		const gapMs = nextRegion.startMs - currentRegion.endMs;

		if (gapMs > CHAINED_ZOOM_PAN_GAP_MS) {
			continue;
		}

		pairs.push({
			currentRegion,
			nextRegion,
			transitionStart: currentRegion.endMs + ZOOM_ANIMATION_LEAD_MS,
			transitionEnd:
				currentRegion.endMs + ZOOM_ANIMATION_LEAD_MS + CONNECTED_ZOOM_PAN_DURATION_MS,
		});
	}

	return pairs;
}

function getActiveRegion(
	regions: ZoomRegion[],
	timeMs: number,
	connectedPairs: ConnectedRegionPair[],
	options: DominantRegionOptions,
) {
	const activeRegions = regions
		.map((region) => {
			const outgoingPair = connectedPairs.find((pair) => pair.currentRegion.id === region.id);
			if (outgoingPair) {
				if (timeMs >= outgoingPair.transitionStart) {
					return { region, strength: 0 };
				}

				const zoomOutStart =
					outgoingPair.currentRegion.endMs -
					ZOOM_OUT_EARLY_START_MS +
					ZOOM_ANIMATION_LEAD_MS;
				if (timeMs >= zoomOutStart) {
					return { region, strength: 1 };
				}
			}

			const incomingPair = connectedPairs.find((pair) => pair.nextRegion.id === region.id);
			if (incomingPair) {
				if (timeMs < incomingPair.transitionStart) {
					return { region, strength: 0 };
				}

				const nextRegionZoomOutStart =
					incomingPair.nextRegion.endMs -
					ZOOM_OUT_EARLY_START_MS +
					ZOOM_ANIMATION_LEAD_MS;
				if (timeMs < nextRegionZoomOutStart) {
					return { region, strength: 1 };
				}
			}

			return { region, strength: computeRegionStrength(region, timeMs, options) };
		})
		.filter((entry) => entry.strength > 0)
		.sort((left, right) => {
			if (right.strength !== left.strength) {
				return right.strength - left.strength;
			}

			return right.region.startMs - left.region.startMs;
		});

	if (activeRegions.length === 0) {
		return null;
	}

	const activeRegion = activeRegions[0].region;
	const activeScale = ZOOM_DEPTH_SCALES[activeRegion.depth];

	return {
		region: {
			...activeRegion,
			focus: getResolvedFocus(activeRegion, activeScale),
		},
		strength: activeRegions[0].strength,
		blendedScale: null,
	};
}

function getConnectedRegionHold(timeMs: number, connectedPairs: ConnectedRegionPair[]) {
	for (const pair of connectedPairs) {
		if (timeMs >= pair.transitionEnd && timeMs < pair.nextRegion.startMs) {
			const nextScale = ZOOM_DEPTH_SCALES[pair.nextRegion.depth];
			return {
				region: {
					...pair.nextRegion,
					focus: getResolvedFocus(pair.nextRegion, nextScale),
				},
				strength: 1,
				blendedScale: null,
			};
		}
	}

	return null;
}

export function findDominantRegion(
	regions: ZoomRegion[],
	timeMs: number,
	options: DominantRegionOptions = {},
): {
	region: ZoomRegion | null;
	strength: number;
	blendedScale: number | null;
	transition: ConnectedPanTransition | null;
} {
	const connectedPairs = options.connectZooms ? getConnectedRegionPairs(regions) : [];

	if (options.connectZooms) {
		const connectedHold = getConnectedRegionHold(timeMs, connectedPairs);
		if (connectedHold) {
			return { ...connectedHold, transition: null };
		}
	}

	const activeRegion = getActiveRegion(regions, timeMs, connectedPairs, options);
	return activeRegion
		? { ...activeRegion, transition: null }
		: { region: null, strength: 0, blendedScale: null, transition: null };
}
