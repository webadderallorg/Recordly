import type { CursorTelemetryPoint, ZoomFocus } from "../types";

export const MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO = 1.2;

interface ClickCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
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

export function shouldAutoApplyFreshRecordingZoomsForSource(
	sourceWidth?: number,
	sourceHeight?: number,
): boolean {
	if (
		!Number.isFinite(sourceWidth) ||
		!Number.isFinite(sourceHeight) ||
		(sourceWidth ?? 0) <= 0 ||
		(sourceHeight ?? 0) <= 0
	) {
		return true;
	}

	return (
		(sourceWidth as number) / (sourceHeight as number) >=
		MIN_FRESH_RECORDING_AUTO_ZOOM_SOURCE_ASPECT_RATIO
	);
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
		cursorType: sample.cursorType,
	};
}

export function normalizeCursorTelemetry(
	telemetry: CursorTelemetryPoint[],
	totalMs: number,
): CursorTelemetryPoint[] {
	return [...telemetry]
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.sort((a, b) => a.timeMs - b.timeMs)
		.map((sample) => normalizeTelemetrySample(sample, totalMs));
}

/**
 * Groups a sorted list of click timestamps into clusters where consecutive
 * clicks are no more than `mergeGapMs` apart. Returns an array of
 * `{ firstMs, lastMs, focus }` objects, one per cluster. Every click is weighted
 * equally, so the focus is the centroid of all click coordinates in the cluster.
 */
function buildClickClusters(
	clicks: ClickCandidate[],
	mergeGapMs: number,
): Array<{ firstMs: number; lastMs: number; focus: ZoomFocus }> {
	if (clicks.length === 0) {
		return [];
	}

	const sorted = [...clicks].sort((a, b) => a.centerTimeMs - b.centerTimeMs);
	const clusters: Array<{ firstMs: number; lastMs: number; focus: ZoomFocus }> = [];

	let clusterStart = sorted[0].centerTimeMs;
	let clusterEnd = sorted[0].centerTimeMs;
	let sumCx = sorted[0].focus.cx;
	let sumCy = sorted[0].focus.cy;
	let count = 1;

	for (let i = 1; i < sorted.length; i++) {
		const click = sorted[i];
		const gap = click.centerTimeMs - clusterEnd;

		if (gap <= mergeGapMs) {
			// Extend current cluster
			clusterEnd = Math.max(clusterEnd, click.centerTimeMs);
			sumCx += click.focus.cx;
			sumCy += click.focus.cy;
			count += 1;
		} else {
			// Flush current cluster and start a new one
			clusters.push({
				firstMs: clusterStart,
				lastMs: clusterEnd,
				focus: { cx: sumCx / count, cy: sumCy / count },
			});
			clusterStart = click.centerTimeMs;
			clusterEnd = click.centerTimeMs;
			sumCx = click.focus.cx;
			sumCy = click.focus.cy;
			count = 1;
		}
	}

	// Flush last cluster
	clusters.push({
		firstMs: clusterStart,
		lastMs: clusterEnd,
		focus: { cx: sumCx / count, cy: sumCy / count },
	});

	return clusters;
}

export function buildInteractionZoomSuggestions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	defaultDurationMs: number;
	reservedSpans?: Array<{ start: number; end: number }>;
	spacingMs?: number;
	mergeGapMs?: number;
	padMs?: number;
}): InteractionZoomSuggestionResult {
	const {
		cursorTelemetry,
		totalMs,
		reservedSpans = [],
		mergeGapMs = CLICK_CLUSTER_MERGE_GAP_MS,
		padMs = CLICK_CLUSTER_PAD_MS,
	} = params;

	if (totalMs <= 0) {
		return { status: "no-slots", suggestions: [] };
	}

	const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalizedSamples.length === 0) {
		return { status: "no-telemetry", suggestions: [] };
	}

	if (
		normalizedSamples.length === 1 &&
		!isExplicitClickType(normalizedSamples[0].interactionType)
	) {
		return { status: "no-telemetry", suggestions: [] };
	}

	const clickCandidates: ClickCandidate[] = normalizedSamples
		.filter((sample) => isExplicitClickType(sample.interactionType))
		.map((sample) => ({
			centerTimeMs: Math.round(sample.timeMs),
			focus: { cx: sample.cx, cy: sample.cy },
		}));

	if (clickCandidates.length === 0) {
		return { status: "no-interactions", suggestions: [] };
	}

	// Group nearby clicks into clusters, then derive zoom windows from those clusters
	const clusters = buildClickClusters(clickCandidates, mergeGapMs);

	const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
	const suggestions: SuggestedZoomRegion[] = [];

	for (const cluster of clusters) {
		const regionStart = Math.max(0, cluster.firstMs - padMs);
		const regionEnd = Math.min(totalMs, cluster.lastMs + padMs);

		if (regionEnd <= regionStart) {
			continue;
		}

		const hasOverlap = reserved.some(
			(span) => regionEnd > span.start && regionStart < span.end,
		);

		if (hasOverlap) {
			continue;
		}

		reserved.push({ start: regionStart, end: regionEnd });
		suggestions.push({
			start: regionStart,
			end: regionEnd,
			focus: cluster.focus,
		});
	}

	if (suggestions.length === 0) {
		return { status: "no-slots", suggestions: [] };
	}

	// Sort chronologically
	suggestions.sort((a, b) => a.start - b.start);

	return { status: "ok", suggestions };
}
