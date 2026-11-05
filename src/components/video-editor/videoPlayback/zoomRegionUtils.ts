import { isCinematicZoomMotion } from "../cursorMotionPresets";
import type { CropRegion, ZoomFocus, ZoomRegion } from "../types";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	ZOOM_DEPTH_SCALES,
} from "../types";
import { clampFocusToScale, projectZoomFocusToViewport } from "./focusUtils";
import { easeOutZoom } from "./mathUtils";
import { getZoomTransitionDurationMs, sampleZoomTransition } from "./zoomTransition";

export type DominantRegionOptions = {
	sourceCrop?: CropRegion;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomOutDurationMs?: number;
	connectedZoomGapMs?: number;
	connectedZoomDurationMs?: number;
};

type ConnectedRegionPair = {
	currentRegion: ZoomRegion;
	nextRegion: ZoomRegion;
	transitionStart: number;
	transitionEnd: number;
};

type ConnectedPanTransition = {
	key: string;
	progress: number;
	startFocus: ZoomFocus;
	endFocus: ZoomFocus;
	startScale: number;
	endScale: number;
};

function connectionKey(pair: ConnectedRegionPair) {
	return `${pair.currentRegion.id}:${pair.nextRegion.id}:${pair.transitionStart}`;
}

function positiveDuration(value: number | undefined, fallback: number) {
	return Number.isFinite(value) ? Math.max(1, value!) : fallback;
}

/** Transition clocks are independent; short blocks overlap their ramps. */
export function getZoomRegionTiming(
	region: Pick<ZoomRegion, "startMs" | "endMs">,
	options: Pick<DominantRegionOptions, "zoomInDurationMs" | "zoomOutDurationMs"> = {},
) {
	const cinematic = isCinematicZoomMotion(options);
	const zoomInDurationMs = getZoomTransitionDurationMs(
		positiveDuration(options.zoomInDurationMs, DEFAULT_ZOOM_IN_DURATION_MS),
		cinematic,
	);
	const zoomOutDurationMs = getZoomTransitionDurationMs(
		positiveDuration(options.zoomOutDurationMs, DEFAULT_ZOOM_OUT_DURATION_MS),
		cinematic,
	);
	return {
		zoomInEnd: region.startMs + zoomInDurationMs,
		zoomOutStart: region.endMs - zoomOutDurationMs,
	};
}

export function computeRegionStrength(
	region: Pick<ZoomRegion, "startMs" | "endMs">,
	timeMs: number,
	options: Pick<DominantRegionOptions, "zoomInDurationMs" | "zoomOutDurationMs"> = {},
) {
	if (timeMs <= region.startMs || timeMs >= region.endMs) {
		return 0;
	}
	const { zoomInEnd, zoomOutStart } = getZoomRegionTiming(region, options);
	const cinematic = isCinematicZoomMotion(options);

	const entry = sampleZoomTransition(
		(timeMs - region.startMs) / (zoomInEnd - region.startMs),
		positiveDuration(options.zoomInDurationMs, DEFAULT_ZOOM_IN_DURATION_MS),
		cinematic,
	);
	const exit = sampleZoomTransition(
		(timeMs - zoomOutStart) / (region.endMs - zoomOutStart),
		positiveDuration(options.zoomOutDurationMs, DEFAULT_ZOOM_OUT_DURATION_MS),
		cinematic,
	);
	return entry * (1 - exit);
}

/** A connected destination must arrive before its final release can start. */
export function getConnectedZoomEndMs(
	region: Pick<ZoomRegion, "startMs" | "endMs">,
	options: Pick<DominantRegionOptions, "zoomInDurationMs" | "zoomOutDurationMs"> = {},
) {
	const exitDurationMs = getZoomTransitionDurationMs(
		positiveDuration(options.zoomOutDurationMs, DEFAULT_ZOOM_OUT_DURATION_MS),
		isCinematicZoomMotion(options),
	);
	return Math.max(region.endMs, region.startMs + exitDurationMs);
}

function getChainRegion(
	region: ZoomRegion,
	pairs: ConnectedRegionPair[],
	options: DominantRegionOptions,
): ZoomRegion {
	let first = region;
	let last = region;
	for (let i = 0; i < pairs.length; i += 1) {
		const incoming = pairs.find((pair) => pair.nextRegion.id === first.id);
		if (!incoming) break;
		first = incoming.currentRegion;
	}
	for (let i = 0; i < pairs.length; i += 1) {
		const outgoing = pairs.find((pair) => pair.currentRegion.id === last.id);
		if (!outgoing) break;
		last = outgoing.nextRegion;
	}
	return {
		...region,
		startMs: first.startMs,
		endMs: first.id === last.id ? last.endMs : getConnectedZoomEndMs(last, options),
	};
}

function sampleEnvelope(
	region: ZoomRegion,
	timeMs: number,
	pairs: ConnectedRegionPair[],
	options: DominantRegionOptions,
) {
	const chain = getChainRegion(region, pairs, options);
	const strength = computeRegionStrength(chain, timeMs, options);
	return {
		strength,
		zoomingOut:
			strength > 0 &&
			computeRegionStrength(chain, timeMs + 0.5, options) <
				computeRegionStrength(chain, timeMs - 0.5, options),
	};
}

function getResolvedFocus(
	region: ZoomRegion,
	zoomScale: number,
	sourceCrop?: CropRegion,
): ZoomFocus {
	// Project the original point before clamping, otherwise edge targets lose
	// their source location before they can be mapped into the crop.
	return clampFocusToScale(projectZoomFocusToViewport(region, sourceCrop), zoomScale);
}

function getConnectedRegionPairs(regions: ZoomRegion[], options: DominantRegionOptions) {
	const sortedRegions = [...regions].sort((a, b) => a.startMs - b.startMs);
	const pairs: ConnectedRegionPair[] = [];

	for (let index = sortedRegions.length - 2; index >= 0; index -= 1) {
		const currentRegion = sortedRegions[index];
		const nextRegion = sortedRegions[index + 1];
		const gapMs = nextRegion.startMs - currentRegion.endMs;
		const gapLimit = options.connectedZoomGapMs ?? DEFAULT_CONNECTED_ZOOM_GAP_MS;

		if (
			gapMs <= 0 ||
			gapMs > gapLimit ||
			currentRegion.endMs <= currentRegion.startMs ||
			nextRegion.endMs <= nextRegion.startMs
		) {
			continue;
		}
		const following = sortedRegions[index + 2];
		const destinationEnd = getConnectedZoomEndMs(nextRegion, options);
		if (
			destinationEnd > nextRegion.endMs &&
			following &&
			following.endMs > following.startMs &&
			following.startMs < destinationEnd &&
			!pairs.some((pair) => pair.currentRegion.id === nextRegion.id)
		) {
			// Keep this zoom independent if a later block leaves no room for its
			// connected exit. Rendering and the timeline must agree on its bounds.
			continue;
		}
		const targetDurationMs = positiveDuration(
			options.connectedZoomDurationMs,
			DEFAULT_CONNECTED_ZOOM_DURATION_MS,
		);
		// Connected pans belong to the gap, never to either zoom block.
		const transitionStart = currentRegion.endMs;
		const transitionEnd = Math.min(nextRegion.startMs, transitionStart + targetDurationMs);
		if (transitionEnd <= transitionStart) continue;

		pairs.push({
			currentRegion,
			nextRegion,
			transitionStart,
			transitionEnd,
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
			const incomingPair = connectedPairs.find((pair) => pair.nextRegion.id === region.id);
			const activeStart = incomingPair?.transitionEnd ?? region.startMs;
			const activeEnd =
				incomingPair && !connectedPairs.some((pair) => pair.currentRegion.id === region.id)
					? getConnectedZoomEndMs(region, options)
					: region.endMs;
			return {
				region,
				...(timeMs >= activeStart && timeMs < activeEnd
					? sampleEnvelope(region, timeMs, connectedPairs, options)
					: { strength: 0, zoomingOut: false }),
			};
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
	const incomingPair = connectedPairs.find((pair) => pair.nextRegion.id === activeRegion.id);

	return {
		region: {
			...activeRegion,
			focus: getResolvedFocus(activeRegion, activeScale, options.sourceCrop),
			focusSpace: "viewport" as const,
		},
		strength: activeRegions[0].strength,
		zoomingOut: activeRegions[0].zoomingOut,
		blendedScale: null,
		completedTransition:
			incomingPair && timeMs >= incomingPair.transitionEnd
				? {
						key: connectionKey(incomingPair),
						progress: 1,
						startFocus: getResolvedFocus(
							incomingPair.currentRegion,
							ZOOM_DEPTH_SCALES[incomingPair.currentRegion.depth],
							options.sourceCrop,
						),
						endFocus: getResolvedFocus(activeRegion, activeScale, options.sourceCrop),
						startScale: ZOOM_DEPTH_SCALES[incomingPair.currentRegion.depth],
						endScale: activeScale,
					}
				: undefined,
	};
}

function getConnectedRegionTransition(
	timeMs: number,
	connectedPairs: ConnectedRegionPair[],
	options: DominantRegionOptions,
) {
	for (const pair of connectedPairs) {
		if (timeMs >= pair.transitionStart && timeMs < pair.transitionEnd) {
			const startScale = ZOOM_DEPTH_SCALES[pair.currentRegion.depth];
			const endScale = ZOOM_DEPTH_SCALES[pair.nextRegion.depth];
			// This is a moving goal, not a simulated camera. The renderer's one
			// live spring supplies acceleration and settling for the connected move.
			const progress = easeOutZoom(
				(timeMs - pair.transitionStart) / (pair.transitionEnd - pair.transitionStart),
			);
			const startFocus = getResolvedFocus(pair.currentRegion, startScale, options.sourceCrop);
			const endFocus = getResolvedFocus(pair.nextRegion, endScale, options.sourceCrop);
			const scale = startScale + (endScale - startScale) * progress;
			return {
				region: {
					...pair.nextRegion,
					focus: clampFocusToScale(
						{
							cx: startFocus.cx + (endFocus.cx - startFocus.cx) * progress,
							cy: startFocus.cy + (endFocus.cy - startFocus.cy) * progress,
						},
						scale,
					),
					focusSpace: "viewport" as const,
				},
				...sampleEnvelope(pair.currentRegion, timeMs, connectedPairs, options),
				blendedScale: scale,
				transition: {
					key: connectionKey(pair),
					progress,
					startFocus,
					endFocus,
					startScale,
					endScale,
				},
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
	zoomingOut: boolean;
	blendedScale: number | null;
	transition: ConnectedPanTransition | null;
	completedTransition?: ConnectedPanTransition;
} {
	const connectedPairs = options.connectZooms ? getConnectedRegionPairs(regions, options) : [];

	if (options.connectZooms) {
		const connectedTransition = getConnectedRegionTransition(timeMs, connectedPairs, options);
		if (connectedTransition) {
			return connectedTransition;
		}
	}

	const activeRegion = getActiveRegion(regions, timeMs, connectedPairs, options);
	return activeRegion
		? { ...activeRegion, transition: null }
		: { region: null, strength: 0, zoomingOut: false, blendedScale: null, transition: null };
}
