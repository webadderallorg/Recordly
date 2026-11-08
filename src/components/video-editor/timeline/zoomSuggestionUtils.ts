import {
	type ClipRegion,
	type CursorTelemetryPoint,
	getClipSourceEndMs,
	getClipSourceStartMs,
	type ZoomFocus,
} from "../types";
import { getCursorPressIntervals } from "../videoPlayback/cursorPress";
import { detectInteractionCandidates } from "./cursorInteractionCandidates";

export {
	DWELL_MOVE_THRESHOLD,
	detectInteractionCandidates,
	detectZoomDwellCandidates,
	MAX_DWELL_DURATION_MS,
	MIN_DWELL_DURATION_MS,
} from "./cursorInteractionCandidates";

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

export interface CursorInteractionCandidate extends ZoomDwellCandidate {
	endTimeMs?: number;
	kind:
		| "dwell"
		| "click-like"
		| "double-click-like"
		| "text-focus-like"
		| "dropdown-open"
		| "text-selection"
		| "text-field-click";
	source: "explicit" | "heuristic";
}

export interface SuggestedZoomRegion {
	start: number;
	end: number;
	focus: ZoomFocus;
}

export type InteractionZoomSuggestionStatus =
	| "ok"
	| "no-telemetry"
	| "no-interactions"
	| "no-slots";

export interface InteractionZoomSuggestionResult {
	status: InteractionZoomSuggestionStatus;
	suggestions: SuggestedZoomRegion[];
}

/** Max gap between consecutive clicks before they are split into separate zoom clusters. */
export const CLICK_CLUSTER_MERGE_GAP_MS = 2500;

/** Padding added before the first click and after the last click in a cluster. */
export const CLICK_CLUSTER_PAD_MS = 500;

const EXPLICIT_CLICK_TYPES = new Set<NonNullable<CursorTelemetryPoint["interactionType"]>>([
	"click",
	"double-click",
	"right-click",
	"middle-click",
]);

function isExplicitClickType(
	interactionType: CursorTelemetryPoint["interactionType"],
): interactionType is NonNullable<CursorTelemetryPoint["interactionType"]> {
	return typeof interactionType === "string" && EXPLICIT_CLICK_TYPES.has(interactionType);
}

function normalizeTelemetrySample(
	sample: CursorTelemetryPoint,
	totalMs: number,
): CursorTelemetryPoint {
	return {
		timeMs: Math.max(0, Math.min(sample.timeMs, totalMs)),
		cx: Math.max(0, Math.min(sample.cx, 1)),
		cy: Math.max(0, Math.min(sample.cy, 1)),
		interactionType: sample.interactionType,
		...(sample.mouseButton ? { mouseButton: sample.mouseButton } : {}),
		cursorType: sample.cursorType,
	};
}

function applyCursorTypeInRange(
	samples: CursorTelemetryPoint[],
	startMs: number,
	endMs: number,
	cursorType: NonNullable<CursorTelemetryPoint["cursorType"]>,
) {
	for (const sample of samples) {
		if (sample.timeMs < startMs || sample.timeMs > endMs) continue;
		if (!sample.cursorType) {
			sample.cursorType = cursorType;
		}
	}
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	const normalized = [...telemetry]
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));

	const interactions = detectInteractionCandidates(normalized, totalMs);
	for (const candidate of interactions) {
		if (candidate.kind === "text-selection") {
			applyCursorTypeInRange(
				normalized,
				candidate.centerTimeMs - 140,
				candidate.centerTimeMs + 1200,
				"text",
			);
			continue;
		}

		if (candidate.kind === "text-field-click" || candidate.kind === "text-focus-like") {
			applyCursorTypeInRange(
				normalized,
				candidate.centerTimeMs - 100,
				candidate.centerTimeMs + 900,
				"text",
			);
			continue;
		}
	}

	for (const { down: sample, up: mouseUp } of getCursorPressIntervals(normalized, totalMs)) {
		if (sample.interactionType !== "click" && sample.interactionType !== "double-click") {
			continue;
		}

		if (!mouseUp) {
			continue;
		}

		const dragDuration = mouseUp.timeMs - sample.timeMs;
		const dragDistance = Math.hypot(mouseUp.cx - sample.cx, mouseUp.cy - sample.cy);
		if (dragDuration >= 160 && dragDistance > 0.015) {
			const isTextDrag =
				Math.abs(mouseUp.cx - sample.cx) > Math.abs(mouseUp.cy - sample.cy) * 1.8;
			applyCursorTypeInRange(
				normalized,
				sample.timeMs,
				mouseUp.timeMs,
				isTextDrag ? "text" : "closed-hand",
			);
		}
	}

	return normalized;
}

/**
 * Groups press intervals into clusters where the next down is no more than
 * `mergeGapMs` after the previous release. Returns an array of
 * `{ firstMs, lastMs, anchorMs, focus }` objects, one per cluster. Focus and
 * anchor time come from the click with the highest interaction strength.
 */
function buildClickClusters(
	clicks: CursorInteractionCandidate[],
	mergeGapMs: number,
): Array<{ firstMs: number; lastMs: number; anchorMs: number; focus: ZoomFocus }> {
	if (clicks.length === 0) {
		return [];
	}

	const sorted = [...clicks].sort((a, b) => a.centerTimeMs - b.centerTimeMs);
	const clusters: Array<{ firstMs: number; lastMs: number; anchorMs: number; focus: ZoomFocus }> =
		[];

	let clusterStart = sorted[0].centerTimeMs;
	let clusterEnd = sorted[0].endTimeMs ?? sorted[0].centerTimeMs;
	let bestStrength = sorted[0].strength;
	let bestFocus = sorted[0].focus;
	let anchorMs = sorted[0].centerTimeMs;
	let sumCx = sorted[0].focus.cx;
	let sumCy = sorted[0].focus.cy;
	let count = 1;

	for (let i = 1; i < sorted.length; i++) {
		const click = sorted[i];
		const gap = click.centerTimeMs - clusterEnd;

		if (gap <= mergeGapMs) {
			// Extend current cluster
			clusterEnd = Math.max(clusterEnd, click.endTimeMs ?? click.centerTimeMs);
			if (click.strength > bestStrength) {
				bestStrength = click.strength;
				bestFocus = click.focus;
				anchorMs = click.centerTimeMs;
			}
			sumCx += click.focus.cx;
			sumCy += click.focus.cy;
			count += 1;
		} else {
			// Flush current cluster and start a new one
			clusters.push({
				firstMs: clusterStart,
				lastMs: clusterEnd,
				anchorMs,
				focus: bestFocus ?? { cx: sumCx / count, cy: sumCy / count },
			});
			clusterStart = click.centerTimeMs;
			clusterEnd = click.endTimeMs ?? click.centerTimeMs;
			bestStrength = click.strength;
			bestFocus = click.focus;
			anchorMs = click.centerTimeMs;
			sumCx = click.focus.cx;
			sumCy = click.focus.cy;
			count = 1;
		}
	}

	// Flush last cluster
	clusters.push({
		firstMs: clusterStart,
		lastMs: clusterEnd,
		anchorMs,
		focus: bestFocus ?? { cx: sumCx / count, cy: sumCy / count },
	});

	return clusters;
}

export function buildInteractionZoomSuggestions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	/** Telemetry uses recording time; zoom blocks use the edited timeline. */
	clipRegions?: ClipRegion[];
	totalMs: number;
	defaultDurationMs: number;
	reservedSpans?: Array<{ start: number; end: number }>;
	spacingMs?: number;
	mergeGapMs?: number;
	padMs?: number;
}): InteractionZoomSuggestionResult {
	const {
		cursorTelemetry,
		clipRegions = [],
		totalMs,
		defaultDurationMs,
		reservedSpans = [],
		mergeGapMs = CLICK_CLUSTER_MERGE_GAP_MS,
		padMs = CLICK_CLUSTER_PAD_MS,
		spacingMs = padMs,
	} = params;

	if (totalMs <= 0) {
		return { status: "no-slots", suggestions: [] };
	}

	const normalizedSamples = normalizeCursorTelemetry(
		cursorTelemetry,
		clipRegions.length > 0 ? Number.MAX_SAFE_INTEGER : totalMs,
	);
	if (normalizedSamples.length === 0) {
		return { status: "no-telemetry", suggestions: [] };
	}

	if (
		normalizedSamples.length === 1 &&
		!isExplicitClickType(normalizedSamples[0].interactionType)
	) {
		return { status: "no-telemetry", suggestions: [] };
	}

	// Only use explicit click events (uiohook telemetry) – ignore dwell heuristics
	const recordingEndMs =
		clipRegions.length > 0
			? Math.max(
					normalizedSamples[normalizedSamples.length - 1].timeMs,
					...clipRegions.map(getClipSourceEndMs),
				)
			: totalMs;
	const clickCandidates = detectInteractionCandidates(normalizedSamples, recordingEndMs).filter(
		(candidate) => candidate.source === "explicit",
	);

	if (clickCandidates.length === 0) {
		return { status: "no-interactions", suggestions: [] };
	}

	// Project each retained source interval separately. A removed click must not be
	// snapped onto a cut, and duplicated/reordered source gets its own interactions.
	const groups =
		clipRegions.length > 0
			? [...clipRegions]
					.sort((a, b) => a.startMs - b.startMs)
					.map((clip) => {
						const sourceStart = getClipSourceStartMs(clip);
						const sourceEnd = getClipSourceEndMs(clip);
						const speed =
							Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
						const candidates = clickCandidates.flatMap((candidate) => {
							const end = candidate.endTimeMs ?? candidate.centerTimeMs;
							if (
								candidate.centerTimeMs >= sourceEnd ||
								end < sourceStart ||
								(end === sourceStart && candidate.centerTimeMs < sourceStart)
							)
								return [];
							return [
								{
									...candidate,
									centerTimeMs:
										clip.startMs +
										(Math.max(candidate.centerTimeMs, sourceStart) -
											sourceStart) /
											speed,
									endTimeMs:
										clip.startMs +
										(Math.min(end, sourceEnd) - sourceStart) / speed,
								},
							];
						});
						return {
							candidates,
							start: Math.max(0, clip.startMs),
							end: Math.min(totalMs, clip.endMs),
						};
					})
			: [{ candidates: clickCandidates, start: 0, end: totalMs }];
	if (!groups.some(({ candidates }) => candidates.length > 0)) {
		return { status: "no-interactions", suggestions: [] };
	}

	const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
	const suggestions: SuggestedZoomRegion[] = [];

	const windows = groups
		.flatMap((group) =>
			buildClickClusters(group.candidates, mergeGapMs).map((cluster) => ({
				cluster,
				lower: group.start,
				upper: group.end,
				start: Math.max(group.start, cluster.firstMs - padMs),
				end: Math.min(group.end, cluster.lastMs + padMs),
			})),
		)
		.filter(
			({ start, end }) =>
				end > start && !reserved.some((span) => end > span.start && start < span.end),
		);

	for (const [index, window] of windows.entries()) {
		const { cluster } = window;
		// Expand the shorter side so the focus-defining click lands at the midpoint,
		// preserving every click and the full press/drag through its release.
		const halfDuration = Math.max(
			defaultDurationMs / 2,
			cluster.anchorMs - window.start,
			window.end - cluster.anchorMs,
		);
		const centeredStart = cluster.anchorMs - halfDuration;
		const centeredEnd = cluster.anchorMs + halfDuration;
		const blockers = [...reserved, ...windows.slice(index + 1)];
		const canCenter =
			centeredStart >= window.lower &&
			centeredEnd <= window.upper &&
			!blockers.some(
				(span) =>
					centeredEnd + spacingMs > span.start && centeredStart - spacingMs < span.end,
			);
		// At a boundary, shift a minimum-duration block into the available space.
		// Preserve the full padded interaction when a nearby block leaves less room.
		const lower = Math.max(
			window.lower,
			...blockers
				.filter((span) => span.end <= window.start)
				.map((span) => span.end + spacingMs),
		);
		const upper = Math.min(
			window.upper,
			...blockers
				.filter((span) => span.start >= window.end)
				.map((span) => span.start - spacingMs),
		);
		const duration = Math.min(
			Math.max(defaultDurationMs, window.end - window.start),
			upper - lower,
		);
		const minStart = Math.max(lower, window.end - duration);
		const maxStart = Math.min(window.start, upper - duration);
		const canExpand = duration >= window.end - window.start && minStart <= maxStart;
		const expandedStart = Math.max(
			minStart,
			Math.min(cluster.anchorMs - duration / 2, maxStart),
		);
		const regionStart = canCenter ? centeredStart : canExpand ? expandedStart : window.start;
		const regionEnd = canCenter
			? centeredEnd
			: canExpand
				? expandedStart + duration
				: window.end;
		if (reserved.some((span) => regionEnd > span.start && regionStart < span.end)) continue;

		reserved.push({ start: regionStart, end: regionEnd });
		suggestions.push({ start: regionStart, end: regionEnd, focus: cluster.focus });
	}

	if (suggestions.length === 0) {
		return { status: "no-slots", suggestions: [] };
	}

	// Sort chronologically
	suggestions.sort((a, b) => a.start - b.start);

	return { status: "ok", suggestions };
}
