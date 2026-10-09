import type { TypingTelemetryPoint } from "../types";

/**
 * Typing telemetry — a keystroke-only, character-free record used to drive
 * "auto zoom while typing".
 *
 * PRIVACY: this deliberately stores NO characters and NO key codes. It stores
 * only a coarse keystroke class plus the cursor position at the moment of the
 * keypress. That is everything the zoom heuristic needs (where is the user
 * typing, how fast, and what kind of key), and nothing that could reconstruct
 * what was typed. Key codes in particular are intentionally dropped: they
 * would allow recovering the text on a known keyboard layout.
 */

export type TypingBurstKind = "burst" | "sustained" | "single";

/** Coarse, non-reversible key classes. Deliberately lossy by design. */
export type TypingKeyClass =
	| "printable" // a character-producing key, character itself discarded
	| "space"
	| "enter"
	| "backspace"
	| "delete"
	| "tab"
	| "escape"
	| "arrow"
	| "navigation" // home/end/pageup/pagedown
	| "shortcut" // any ctrl/cmd/alt combination
	| "other";

export interface TypingBurst {
	/** ms since capture start (pause-adjusted), of the burst's first key. */
	startMs: number;
	/** ms since capture start, of the burst's last key. */
	endMs: number;
	/** Number of keypresses in the burst. */
	keyCount: number;
	/** Mean cursor position over the burst, normalized 0-1. */
	cx: number;
	cy: number;
	/** Dominant key class in the burst. */
	dominant: TypingKeyClass;
	kind: TypingBurstKind;
}

export function classifyTypingKey(keycode: number, modifiers: Modifiers): TypingKeyClass {
	if (modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) {
		return "shortcut";
	}

	// uiohook-napi exposes UiohookKey with layout-independent keycode constants.
	// These are the values from the package's keycode table; anything unmapped
	// falls through to a positional heuristic below.
	if (keycode === 1) return "escape";
	if (keycode === 14) return "backspace";
	if (keycode === 15) return "tab";
	if (keycode === 28) return "enter";
	if (keycode === 57) return "space";
	if (keycode === 76) return "delete";

	const ARROWS = new Set([57419, 57420, 57421, 57422, 57423, 57424, 57425, 57426]);
	if (ARROWS.has(keycode)) return "arrow";

	const NAV = new Set([
		57414, // home
		57415, // end
		57416, // pageup
		57417, // pagedown
	]);
	if (NAV.has(keycode)) return "navigation";

	// A uiohook keycode below the navigation block is a character key on both
	// the Linux/Windows (evdev) and macOS (CGKeyCode) tables. Values above it
	// are function/media keys, which we do not want to treat as typing.
	return keycode > 0 && keycode < 57414 ? "printable" : "other";
}

export interface Modifiers {
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

export function normalizeTypingTelemetrySamples(rawSamples: unknown): TypingTelemetryPoint[] {
	const source = Array.isArray(rawSamples)
		? rawSamples
		: (rawSamples as { samples?: unknown[] } | null)?.samples;
	if (!Array.isArray(source)) {
		return [];
	}

	const KEY_CLASSES = new Set<TypingKeyClass>([
		"printable", "space", "enter", "backspace", "delete", "tab",
		"escape", "arrow", "navigation", "shortcut", "other",
	]);

	return source
		.slice(0, MAX_TYPING_SAMPLES)
		.map((entry) => {
			const item = (entry ?? {}) as Partial<TypingTelemetryPoint>;
			return {
				timeMs: typeof item.timeMs === "number" && Number.isFinite(item.timeMs) ? item.timeMs : 0,
				cx: typeof item.cx === "number" && Number.isFinite(item.cx) ? clamp01(item.cx) : 0.5,
				cy: typeof item.cy === "number" && Number.isFinite(item.cy) ? clamp01(item.cy) : 0.5,
				keyClass: KEY_CLASSES.has(item.keyClass as TypingKeyClass)
					? (item.keyClass as TypingKeyClass)
					: "other",
			} satisfies TypingTelemetryPoint;
		})
		.sort((a, b) => a.timeMs - b.timeMs);
}

function clamp01(v: number) {
	return Math.min(1, Math.max(0, v));
}

// ── Burst detection ───────────────────────────────────────────────────────────

export const TYPING_BURST_GAP_MS = 900;
export const TYPING_SUSTAINED_MIN_KEYS = 6;
export const TYPING_MIN_KEYS_FOR_BURST = 3;

export function detectTypingBursts(samples: TypingTelemetryPoint[]): TypingBurst[] {
	if (samples.length === 0) {
		return [];
	}

	const runs: TypingTelemetryPoint[][] = [];
	let run: TypingTelemetryPoint[] = [samples[0]];

	for (let i = 1; i < samples.length; i += 1) {
		if (samples[i].timeMs - run[run.length - 1].timeMs <= TYPING_BURST_GAP_MS) {
			run.push(samples[i]);
		} else {
			runs.push(run);
			run = [samples[i]];
		}
	}
	runs.push(run);

	const bursts: TypingBurst[] = [];
	for (const r of runs) {
		if (r.length < TYPING_MIN_KEYS_FOR_BURST) {
			continue;
		}

		const counts = new Map<TypingKeyClass, number>();
		let sumX = 0;
		let sumY = 0;
		for (const s of r) {
			counts.set(s.keyClass, (counts.get(s.keyClass) ?? 0) + 1);
			sumX += s.cx;
			sumY += s.cy;
		}

		let dominant: TypingKeyClass = "printable";
		let best = -1;
		for (const [k, v] of counts) {
			if (v > best) {
				best = v;
				dominant = k;
			}
		}

		const startMs = r[0].timeMs;
		const endMs = r[r.length - 1].timeMs;

		// Shortcut-heavy runs are not typing (Cmd+Q, Ctrl+S ...) and a lone
		// backspace flurry is an edit, not authoring new text. Both are excluded
		// from driving a zoom so the camera does not chase editing noise.
		if (dominant === "shortcut") {
			continue;
		}

		bursts.push({
			startMs,
			endMs,
			keyCount: r.length,
			cx: sumX / r.length,
			cy: sumY / r.length,
			dominant,
			kind:
				r.length >= TYPING_SUSTAINED_MIN_KEYS
					? "sustained"
					: endMs - startMs < 350
						? "burst"
						: "single",
		});
	}

	return bursts;
}

/**
 * Convert bursts into the zoom spans the timeline understands, padded so the
 * camera arrives slightly before the first key and leaves slightly after the
 * last — matching how a viewer perceives "the camera settled on the typing".
 */
export function buildTypingZoomSuggestions(params: {
	bursts: TypingBurst[];
	totalMs: number;
	padBeforeMs?: number;
	padAfterMs?: number;
	minDurationMs?: number;
	reservedSpans?: Array<{ start: number; end: number }>;
	reserveGapMs?: number;
}): Array<{ start: number; end: number; focus: { cx: number; cy: number }; keyCount: number }> {
	const {
		bursts,
		totalMs,
		padBeforeMs = 320,
		padAfterMs = 620,
		minDurationMs = 900,
		reservedSpans = [],
		reserveGapMs = 250,
	} = params;

	if (totalMs <= 0 || bursts.length === 0) {
		return [];
	}

	const out: Array<{ start: number; end: number; focus: { cx: number; cy: number }; keyCount: number }> = [];
	const taken: Array<{ start: number; end: number }> = [...reservedSpans];

	for (const burst of bursts) {
		let start = Math.max(0, burst.startMs - padBeforeMs);
		let end = Math.min(totalMs, burst.endMs + padAfterMs);
		if (end - start < minDurationMs) {
			const grow = (minDurationMs - (end - start)) / 2;
			start = Math.max(0, start - grow);
			end = Math.min(totalMs, end + grow);
		}
		if (end - start < 1) {
			continue;
		}

		const overlaps = (span: { start: number; end: number }) =>
			span.start - reserveGapMs < end && start < span.end + reserveGapMs;

		if (taken.some(overlaps)) {
			continue;
		}

		const focus = { cx: clamp01(burst.cx), cy: clamp01(burst.cy) };
		out.push({ start, end, focus, keyCount: burst.keyCount });
		taken.push({ start, end });
	}

	return out;
}

const MAX_TYPING_SAMPLES = 60 * 60 * 10; // 1 hour @ ~10 keys/sec average
