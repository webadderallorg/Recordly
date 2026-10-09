import type { TypingTelemetryPoint } from "../types";

/**
 * Auto-zoom-on-typing: turn keystroke telemetry into zoom regions.
 *
 * Mirrors the shape of `zoomSuggestionUtils` so the two suggestion sources can
 * be merged and de-overlapped by the same timeline code.
 *
 * Design notes
 * ------------
 * The camera targets the CURSOR position at the time of the keystrokes, not a
 * recovered text caret. uiohook reports keystrokes globally and carries no
 * caret position, and recovering one would mean either querying every
 * focused app's UI (platform-specific, slow, invasive) or inferring it from
 * the video pixels. In practice the caret is at the cursor while typing, which
 * is what this uses — and it degrades gracefully when the user is not typing.
 *
 * Zoom DEPTH is chosen from how much text was actually typed, so a three-word
 * search query does not get the same treatment as a paragraph. Thresholds are
 * expressed against the depth table in `types.ts` rather than as raw scale
 * factors, so they stay correct if that table changes.
 */

/** Renderer-side mirror of the main-process typing sample. */
export type { TypingTelemetryPoint };

export interface TypingZoomCandidate {
	start: number;
	end: number;
	focus: { cx: number; cy: number };
	keyCount: number;
	/** Keys per second over the burst — the "intensity" of the typing. */
	rate: number;
}

export type TypingZoomSuggestionStatus = "ok" | "no-telemetry" | "no-typing" | "no-slots";

export interface TypingZoomSuggestionResult {
	status: TypingZoomSuggestionStatus;
	suggestions: TypingZoomCandidate[];
}

/**
 * Keystrokes separated by more than this are treated as separate bursts, so a
 * pause to think does not produce one very long zoom held over dead air.
 */
export const TYPING_BURST_GAP_MS = 900;

/** A burst needs at least this many keys to be worth a camera move. */
export const TYPING_MIN_KEYS = 3;

/** Camera arrives slightly before the first key... */
export const TYPING_PAD_BEFORE_MS = 320;

/** ...and leaves slightly after the last, so the zoom is not visibly clipped. */
export const TYPING_PAD_AFTER_MS = 620;

/** No zoom shorter than this, however brief the burst. */
export const TYPING_MIN_DURATION_MS = 900;

/** Two typing zooms closer than this are merged into one continuous move. */
export const TYPING_MERGE_GAP_MS = 600;

/**
 * Zoom depth by key count. Depth indexes `ZOOM_DEPTH_SCALES`
 * (1:1.25 … 6:5.0); a measured reference clip of this effect peaked around
 * 1.5x, which is depth 2, so the short-query case sits there and sustained
 * typing is allowed to go deeper.
 */
export const TYPING_DEPTH_BY_KEY_COUNT: ReadonlyArray<{ minKeys: number; depth: 1 | 2 | 3 }> = [
	{ minKeys: 24, depth: 3 },
	{ minKeys: 8, depth: 2 },
	{ minKeys: TYPING_MIN_KEYS, depth: 1 },
];

export function resolveTypingZoomDepth(keyCount: number): 1 | 2 | 3 {
	for (const entry of TYPING_DEPTH_BY_KEY_COUNT) {
		if (keyCount >= entry.minKeys) {
			return entry.depth;
		}
	}
	return 1;
}

export function normalizeTypingTelemetry(
	samples: TypingTelemetryPoint[],
	totalMs: number,
): TypingTelemetryPoint[] {
	if (totalMs <= 0) {
		return [];
	}

	return samples
		.filter(
			(sample) =>
				Number.isFinite(sample.timeMs) &&
				sample.timeMs >= 0 &&
				sample.timeMs <= totalMs &&
				Number.isFinite(sample.cx) &&
				Number.isFinite(sample.cy),
		)
		.map((sample) => ({
			...sample,
			cx: clamp01(sample.cx),
			cy: clamp01(sample.cy),
		}))
		.sort((a, b) => a.timeMs - b.timeMs);
}

function clamp01(v: number) {
	return Math.min(1, Math.max(0, v));
}

/**
 * Group keystrokes into bursts and measure each one.
 *
 * A burst dominated by modifier combos or pure navigation is rejected: those
 * are shortcuts and caret movement, not authoring text, and zooming on them
 * makes the camera twitch at things the viewer is not reading.
 */
export function detectTypingZoomCandidates(
	samples: TypingTelemetryPoint[],
): TypingZoomCandidate[] {
	if (samples.length === 0) {
		return [];
	}

	const runs: TypingTelemetryPoint[][] = [[samples[0]]];
	for (let i = 1; i < samples.length; i += 1) {
		const previous = runs[runs.length - 1][runs[runs.length - 1].length - 1];
		if (samples[i].timeMs - previous.timeMs <= TYPING_BURST_GAP_MS) {
			runs[runs.length - 1].push(samples[i]);
		} else {
			runs.push([samples[i]]);
		}
	}

	const candidates: TypingZoomCandidate[] = [];

	for (const run of runs) {
		if (run.length < TYPING_MIN_KEYS) {
			continue;
		}

		const counts = new Map<string, number>();
		let sumCx = 0;
		let sumCy = 0;
		for (const sample of run) {
			counts.set(sample.keyClass, (counts.get(sample.keyClass) ?? 0) + 1);
			sumCx += sample.cx;
			sumCy += sample.cy;
		}

		let dominant = "printable";
		let dominantCount = -1;
		for (const [keyClass, count] of counts) {
			if (count > dominantCount) {
				dominantCount = count;
				dominant = keyClass;
			}
		}

		if (dominant === "shortcut" || dominant === "arrow" || dominant === "navigation") {
			continue;
		}

		const start = run[0].timeMs;
		const end = run[run.length - 1].timeMs;
		const durationSec = Math.max(0.001, (end - start) / 1000);

		candidates.push({
			start,
			end,
			focus: { cx: clamp01(sumCx / run.length), cy: clamp01(sumCy / run.length) },
			keyCount: run.length,
			rate: run.length / durationSec,
		});
	}

	return candidates;
}

function overlaps(
	a: { start: number; end: number },
	b: { start: number; end: number },
	gapMs: number,
) {
	return a.start - gapMs < b.end && a.start < b.end + gapMs;
}

/**
 * Build typing-driven zoom regions.
 *
 * `reservedSpans` lets the caller exclude time already claimed by other zoom
 * regions, so enabling both click-zoom and typing-zoom does not stack two
 * zooms on the same second of footage.
 */
export function buildTypingZoomSuggestions(params: {
	typingTelemetry: TypingTelemetryPoint[];
	totalMs: number;
	reservedSpans?: Array<{ start: number; end: number }>;
	padBeforeMs?: number;
	padAfterMs?: number;
	minDurationMs?: number;
	mergeGapMs?: number;
	reserveGapMs?: number;
}): TypingZoomSuggestionResult {
	const {
		typingTelemetry,
		totalMs,
		reservedSpans = [],
		padBeforeMs = TYPING_PAD_BEFORE_MS,
		padAfterMs = TYPING_PAD_AFTER_MS,
		minDurationMs = TYPING_MIN_DURATION_MS,
		mergeGapMs = TYPING_MERGE_GAP_MS,
		reserveGapMs = 250,
	} = params;

	if (totalMs <= 0) {
		return { status: "no-slots", suggestions: [] };
	}

	const normalized = normalizeTypingTelemetry(typingTelemetry, totalMs);
	if (normalized.length === 0) {
		return { status: "no-telemetry", suggestions: [] };
	}

	const candidates = detectTypingZoomCandidates(normalized);
	if (candidates.length === 0) {
		return { status: "no-typing", suggestions: [] };
	}

	const spans = candidates.map((candidate) => {
		let start = Math.max(0, candidate.start - padBeforeMs);
		let end = Math.min(totalMs, candidate.end + padAfterMs);
		if (end - start < minDurationMs) {
			const grow = (minDurationMs - (end - start)) / 2;
			start = Math.max(0, start - grow);
			end = Math.min(totalMs, end + grow);
		}
		return { start, end, candidate };
	});

	// Merge bursts separated by a short gap into one continuous zoom, so a
	// pause between words does not make the camera pump in and out.
	spans.sort((a, b) => a.start - b.start);
	const merged: Array<{ start: number; end: number; candidates: TypingZoomCandidate[] }> = [];
	for (const span of spans) {
		const last = merged[merged.length - 1];
		if (last && span.start - last.end <= mergeGapMs) {
			last.end = Math.max(last.end, span.end);
			last.candidates.push(span.candidate);
			continue;
		}
		merged.push({ start: span.start, end: span.end, candidates: [span.candidate] });
	}

	const reserved = [...reservedSpans].sort((a, b) => a.start - b.start);
	const suggestions: TypingZoomCandidate[] = [];

	for (const span of merged) {
		if (span.end <= span.start) {
			continue;
		}
		if (reserved.some((other) => overlaps(span, other, reserveGapMs))) {
			continue;
		}

		// Focus on the centroid of the merged group, and let the total key
		// count (not one burst's) pick the depth.
		let sumCx = 0;
		let sumCy = 0;
		let keyCount = 0;
		for (const candidate of span.candidates) {
			sumCx += candidate.focus.cx * candidate.keyCount;
			sumCy += candidate.focus.cy * candidate.keyCount;
			keyCount += candidate.keyCount;
		}

		const suggestion: TypingZoomCandidate = {
			start: span.start,
			end: span.end,
			focus: { cx: clamp01(sumCx / keyCount), cy: clamp01(sumCy / keyCount) },
			keyCount,
			rate: span.candidates.reduce((max, c) => Math.max(max, c.rate), 0),
		};

		reserved.push({ start: suggestion.start, end: suggestion.end });
		suggestions.push(suggestion);
	}

	if (suggestions.length === 0) {
		return { status: "no-slots", suggestions: [] };
	}

	return { status: "ok", suggestions };
}
