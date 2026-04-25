import type { AutoZoomStyle, CursorTelemetryPoint, ZoomFocus } from "../types";

export const MIN_DWELL_DURATION_MS = 900;
export const MAX_DWELL_DURATION_MS = 20000;
export const DWELL_MOVE_THRESHOLD = 0.02;

export interface ZoomDwellCandidate {
	centerTimeMs: number;
	focus: ZoomFocus;
	strength: number;
}

export interface CursorInteractionCandidate extends ZoomDwellCandidate {
	kind:
		| "dwell"
		| "click-like"
		| "double-click-like"
		| "text-focus-like"
		| "dropdown-open"
		| "text-selection"
		| "text-field-click";
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

const DEFAULT_SUGGESTION_SPACING_MS = 6000;
const DEFAULT_MERGE_NEARBY_GAP_MS = 4000;
const DEFAULT_MAX_SUGGESTION_DURATION_MS = 20000;
const LONG_DWELL_DURATION_PADDING_MS = 4000;

export interface AutoZoomSuggestionConfig {
	style: AutoZoomStyle;
	minDwellDurationMs: number;
	maxDwellDurationMs: number;
	defaultDurationMs: number;
	spacingMs: number;
	mergeGapMs: number;
	maxDurationMs: number;
	longDwellPaddingMs: number;
	genericClickMinStrengthMs: number;
	clickLeadMs: number;
	clickTailMs: number;
}

export const AUTO_ZOOM_SUGGESTION_CONFIGS: Record<
	AutoZoomStyle,
	AutoZoomSuggestionConfig
> = {
	lecture: {
		style: "lecture",
		minDwellDurationMs: 1200,
		maxDwellDurationMs: 20000,
		defaultDurationMs: 10000,
		spacingMs: 6000,
		mergeGapMs: 4000,
		maxDurationMs: 20000,
		longDwellPaddingMs: 4000,
		genericClickMinStrengthMs: 1200,
		clickLeadMs: 600,
		clickTailMs: 3000,
	},
	demo: {
		style: "demo",
		minDwellDurationMs: 450,
		maxDwellDurationMs: 8000,
		defaultDurationMs: 4000,
		spacingMs: 1800,
		mergeGapMs: 1500,
		maxDurationMs: 8000,
		longDwellPaddingMs: 1800,
		genericClickMinStrengthMs: 0,
		clickLeadMs: 600,
		clickTailMs: 3000,
	},
	conservative: {
		style: "conservative",
		minDwellDurationMs: 1800,
		maxDwellDurationMs: 18000,
		defaultDurationMs: 10000,
		spacingMs: 10000,
		mergeGapMs: 3000,
		maxDurationMs: 18000,
		longDwellPaddingMs: 2500,
		genericClickMinStrengthMs: 2000,
		clickLeadMs: 400,
		clickTailMs: 2500,
	},
};

export function getAutoZoomSuggestionConfig(
	style: AutoZoomStyle = "lecture",
): AutoZoomSuggestionConfig {
	return AUTO_ZOOM_SUGGESTION_CONFIGS[style] ?? AUTO_ZOOM_SUGGESTION_CONFIGS.lecture;
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

	const interactions = detectInteractionCandidates(normalized);
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

	for (const sample of normalized) {
		if (sample.interactionType !== "click" && sample.interactionType !== "double-click") {
			continue;
		}

		const mouseUp = normalized.find(
			(candidate) =>
				candidate.timeMs > sample.timeMs && candidate.interactionType === "mouseup",
		);
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

export function detectZoomDwellCandidates(
	samples: CursorTelemetryPoint[],
	config: AutoZoomSuggestionConfig = getAutoZoomSuggestionConfig(),
): ZoomDwellCandidate[] {
	if (samples.length < 2) {
		return [];
	}

	const dwellCandidates: ZoomDwellCandidate[] = [];
	let runStart = 0;

	const pushRunIfDwell = (startIndex: number, endIndexExclusive: number) => {
		if (endIndexExclusive - startIndex < 2) {
			return;
		}

		const start = samples[startIndex];
		const end = samples[endIndexExclusive - 1];
		const runDuration = end.timeMs - start.timeMs;
		if (runDuration < config.minDwellDurationMs) {
			return;
		}

		const runSamples = samples.slice(startIndex, endIndexExclusive);
		const avgCx = runSamples.reduce((sum, sample) => sum + sample.cx, 0) / runSamples.length;
		const avgCy = runSamples.reduce((sum, sample) => sum + sample.cy, 0) / runSamples.length;

		dwellCandidates.push({
			centerTimeMs: Math.round((start.timeMs + end.timeMs) / 2),
			focus: { cx: avgCx, cy: avgCy },
			strength: Math.min(runDuration, config.maxDwellDurationMs),
		});
	};

	for (let index = 1; index < samples.length; index += 1) {
		const prev = samples[index - 1];
		const curr = samples[index];
		const distance = Math.hypot(curr.cx - prev.cx, curr.cy - prev.cy);

		if (distance > DWELL_MOVE_THRESHOLD) {
			pushRunIfDwell(runStart, index);
			runStart = index;
		}
	}
	pushRunIfDwell(runStart, samples.length);

	return dwellCandidates;
}

export function detectInteractionCandidates(
	samples: CursorTelemetryPoint[],
	config: AutoZoomSuggestionConfig = getAutoZoomSuggestionConfig(),
): CursorInteractionCandidate[] {
	// --- Phase 1: Explicit interaction events (from uiohook telemetry) ---
	const clickEvents = samples.filter(
		(s) => s.interactionType && s.interactionType !== "move" && s.interactionType !== "mouseup",
	);

	const explicitInteractionCandidates: CursorInteractionCandidate[] = [];

	for (const clickSample of clickEvents) {
		// Classify what happened AFTER this click by analyzing cursor trajectory
		const kind = classifyPostClickBehavior(samples, clickSample);

		const baseStrength =
			kind === "double-click-like"
				? config.style === "demo"
					? 2600
					: 1500
				: kind === "dropdown-open"
					? config.style === "demo"
						? 2400
						: 1200
					: kind === "text-selection"
						? config.style === "demo"
							? 2400
							: 1300
						: kind === "text-field-click"
							? config.style === "demo"
								? 2200
								: 1100
							: config.style === "demo"
								? 1800
								: 900;

		explicitInteractionCandidates.push({
			centerTimeMs: Math.round(clickSample.timeMs),
			focus: { cx: clickSample.cx, cy: clickSample.cy },
			strength: baseStrength,
			kind,
		});
	}

	// --- Phase 2: Dwell-based heuristic candidates ---
	const dwellCandidates = detectZoomDwellCandidates(samples, config).map<CursorInteractionCandidate>(
		(candidate) => {
			if (candidate.strength >= 1100) {
				return { ...candidate, kind: "text-focus-like" };
			}
			if (candidate.strength <= 800) {
				return { ...candidate, kind: "click-like" };
			}
			return { ...candidate, kind: "dwell" };
		},
	);

	// --- Phase 3: Synthetic double-click detection from dwell pairs ---
	const doubleClickCandidates: CursorInteractionCandidate[] = [];
	const sortedByTime = [...dwellCandidates].sort((a, b) => a.centerTimeMs - b.centerTimeMs);

	for (let index = 1; index < sortedByTime.length; index += 1) {
		const prev = sortedByTime[index - 1];
		const curr = sortedByTime[index];
		const timeGap = curr.centerTimeMs - prev.centerTimeMs;
		const spatialGap = Math.hypot(curr.focus.cx - prev.focus.cx, curr.focus.cy - prev.focus.cy);
		const bothShort = prev.strength <= 900 && curr.strength <= 900;

		if (bothShort && timeGap <= 450 && spatialGap <= 0.035) {
			doubleClickCandidates.push({
				centerTimeMs: Math.round((prev.centerTimeMs + curr.centerTimeMs) / 2),
				focus: {
					cx: (prev.focus.cx + curr.focus.cx) / 2,
					cy: (prev.focus.cy + curr.focus.cy) / 2,
				},
				strength: prev.strength + curr.strength + 500,
				kind: "double-click-like",
			});
		}
	}

	return [...explicitInteractionCandidates, ...dwellCandidates, ...doubleClickCandidates];
}

export function buildInteractionZoomSuggestions(params: {
	cursorTelemetry: CursorTelemetryPoint[];
	totalMs: number;
	defaultDurationMs: number;
	autoZoomStyle?: AutoZoomStyle;
	reservedSpans?: Array<{ start: number; end: number }>;
	spacingMs?: number;
	mergeGapMs?: number;
	maxDurationMs?: number;
}): InteractionZoomSuggestionResult {
	const {
		cursorTelemetry,
		totalMs,
		defaultDurationMs,
		autoZoomStyle = "lecture",
		reservedSpans = [],
	} = params;
	const config = getAutoZoomSuggestionConfig(autoZoomStyle);
	const spacingMs = params.spacingMs ?? config.spacingMs ?? DEFAULT_SUGGESTION_SPACING_MS;
	const mergeGapMs = params.mergeGapMs ?? config.mergeGapMs ?? DEFAULT_MERGE_NEARBY_GAP_MS;
	const maxDurationMs =
		params.maxDurationMs ?? config.maxDurationMs ?? DEFAULT_MAX_SUGGESTION_DURATION_MS;

	const defaultDuration = Math.min(config.defaultDurationMs ?? defaultDurationMs, totalMs);
	if (defaultDuration <= 0) {
		return { status: "no-slots", suggestions: [] };
	}

	const normalizedSamples = normalizeCursorTelemetry(cursorTelemetry, totalMs);
	if (normalizedSamples.length < 2) {
		return { status: "no-telemetry", suggestions: [] };
	}

	const interactionCandidates = detectInteractionCandidates(normalizedSamples, config);
	if (interactionCandidates.length === 0) {
		return { status: "no-interactions", suggestions: [] };
	}

	const meaningfulCandidates = interactionCandidates.filter(
		(candidate) =>
			candidate.kind !== "click-like" ||
			candidate.strength >= config.genericClickMinStrengthMs,
	);
	if (meaningfulCandidates.length === 0) {
		return { status: "no-interactions", suggestions: [] };
	}

	const sortedCandidates = [...meaningfulCandidates].sort((a, b) => b.strength - a.strength);
	const acceptedCenters: number[] = [];
	const accepted: SuggestedZoomRegion[] = [];
	const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
	const maxDuration = Math.max(defaultDuration, Math.min(maxDurationMs, totalMs));

	sortedCandidates.forEach((candidate) => {
		const tooCloseToAccepted = acceptedCenters.some(
			(center) => Math.abs(center - candidate.centerTimeMs) < spacingMs,
		);

		if (tooCloseToAccepted) {
			return;
		}

		const candidateDuration = Math.min(
			totalMs,
			Math.max(
				defaultDuration,
				Math.min(
					maxDuration,
					candidate.strength + (config.longDwellPaddingMs ?? LONG_DWELL_DURATION_PADDING_MS),
				),
			),
		);
		const isClickDriven =
			candidate.kind !== "dwell" && candidate.kind !== "text-focus-like";
		const centeredStart = Math.round(
			isClickDriven
				? candidate.centerTimeMs - config.clickLeadMs
				: candidate.centerTimeMs - candidateDuration / 2,
		);
		const candidateStart = Math.max(0, Math.min(centeredStart, totalMs - candidateDuration));
		const candidateEnd = candidateStart + candidateDuration;
		const hasOverlap = reserved.some(
			(span) => candidateEnd > span.start && candidateStart < span.end,
		);

		if (hasOverlap) {
			return;
		}

		reserved.push({ start: candidateStart, end: candidateEnd });
		acceptedCenters.push(candidate.centerTimeMs);
		accepted.push({
			start: candidateStart,
			end: candidateEnd,
			focus: candidate.focus,
		});
	});

	const sortedAccepted = [...accepted].sort((a, b) => a.start - b.start);
	const merged: SuggestedZoomRegion[] = [];
	for (const region of sortedAccepted) {
		const previous = merged[merged.length - 1];
		if (previous && region.start - previous.end <= mergeGapMs) {
			previous.end = Math.max(previous.end, region.end);
			continue;
		}

		merged.push({ ...region });
	}

	if (merged.length === 0) {
		return { status: "no-slots", suggestions: [] };
	}

	return { status: "ok", suggestions: merged };
}

/**
 * Analyzes cursor movement after a click to classify the interaction pattern.
 *
 * - **dropdown-open**: click followed by slow downward cursor movement (browsing items)
 * - **text-selection**: click followed by primarily horizontal drag movement
 * - **text-field-click**: click followed by cursor staying mostly still (dwell)
 * - **double-click-like**: explicit double-click interaction type
 * - **click-like**: generic click with no recognizable post-click pattern
 */
function classifyPostClickBehavior(
	samples: CursorTelemetryPoint[],
	clickSample: CursorTelemetryPoint,
): CursorInteractionCandidate["kind"] {
	// Explicit double-click from uiohook
	if (clickSample.interactionType === "double-click") {
		return "double-click-like";
	}

	const clickTime = clickSample.timeMs;

	// Check for mouseup shortly after (drag detection)
	const mouseUpAfter = samples.find(
		(s) =>
			s.interactionType === "mouseup" && s.timeMs > clickTime && s.timeMs - clickTime < 3000,
	);

	if (mouseUpAfter) {
		const dragDx = Math.abs(mouseUpAfter.cx - clickSample.cx);
		const dragDy = Math.abs(mouseUpAfter.cy - clickSample.cy);
		const dragDuration = mouseUpAfter.timeMs - clickTime;

		// Text selection: horizontal drag > 3% of screen, mostly horizontal, duration 200ms+
		if (dragDuration >= 200 && dragDx > 0.03 && dragDx > dragDy * 1.8) {
			return "text-selection";
		}
	}

	// Analyze trajectory in the 400ms-2000ms window after click
	const moveSamples = samples.filter(
		(s) =>
			s.timeMs > clickTime + 100 &&
			s.timeMs <= clickTime + 2000 &&
			(s.interactionType === "move" || !s.interactionType),
	);

	if (moveSamples.length < 3) {
		// Very few move samples after click = cursor stayed still = text field click
		return "text-field-click";
	}

	// Compute displacement from click position
	let maxDist = 0;
	let totalAbsDy = 0;
	let totalAbsDx = 0;
	for (const s of moveSamples) {
		const dist = Math.hypot(s.cx - clickSample.cx, s.cy - clickSample.cy);
		maxDist = Math.max(maxDist, dist);
		totalAbsDx += Math.abs(s.cx - clickSample.cx);
		totalAbsDy += Math.abs(s.cy - clickSample.cy);
	}

	// Cursor barely moved after click: text field click (dwell)
	if (maxDist < 0.02) {
		return "text-field-click";
	}

	// Primarily downward movement after click: dropdown open
	const lastMoveSample = moveSamples[moveSamples.length - 1];
	const netDy = lastMoveSample.cy - clickSample.cy;

	if (netDy > 0.03 && totalAbsDy > totalAbsDx * 1.5) {
		return "dropdown-open";
	}

	// Primarily horizontal movement: text selection (fallback if no mouseup)
	if (totalAbsDx > 0.03 && totalAbsDx > totalAbsDy * 1.8) {
		return "text-selection";
	}

	return "click-like";
}
