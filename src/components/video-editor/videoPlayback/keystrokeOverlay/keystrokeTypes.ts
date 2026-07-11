// Keystroke overlay — shared types and default display policy.
//
// The main process captures a stable semantic key token (resolved from
// uiohook-napi's UiohookKey table) plus modifier booleans. All interpretation
// and layout lives in the renderer so it stays pure and unit-testable.

export interface KeystrokeEvent {
	/** Elapsed capture time in ms — same clock as cursor telemetry. */
	timeMs: number;
	/**
	 * Semantic key token (e.g. "A", "Enter", "Space", "Up", "Comma"). Falls back
	 * to the raw numeric keycode as a string when the token is unknown.
	 */
	key: string;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	meta?: boolean;
}

export type ModifierGlyphStyle = "mac" | "windows" | "linux";

export type KeystrokeOverlayPosition =
	| "bottom-center"
	| "bottom-left"
	| "bottom-right"
	| "top-center";

export interface KeystrokeOverlayPolicy {
	/** Consecutive plain keystrokes within this gap merge into one keycap group. */
	groupWindowMs: number;
	/** Fully-opaque hold time after a group's last keystroke. */
	holdMs: number;
	/** Fade-out duration after the hold elapses. */
	fadeMs: number;
	/** Max keys shown in a single running (typed) group before it wraps. */
	maxKeysPerGroup: number;
	/** Max simultaneously-visible groups; older ones drop off. */
	maxGroups: number;
}

// ── Display policy ────────────────────────────────────────────────────────────
// These five constants ARE the feel of the overlay. They are intentionally
// isolated here so the behaviour can be tuned (or surfaced as user settings)
// without touching the coalescing algorithm or the renderer.
export const DEFAULT_KEYSTROKE_OVERLAY_POLICY: KeystrokeOverlayPolicy = {
	groupWindowMs: 650,
	holdMs: 1200,
	fadeMs: 350,
	maxKeysPerGroup: 12,
	maxGroups: 3,
};

export interface KeycapGroup {
	/** Deterministic id derived from the group's first keystroke. */
	id: string;
	/** Display labels in order, e.g. ["⌘","⇧","P"] or ["H","e","l","l","o"]. */
	labels: string[];
	/** True when the group is a modifier chord rather than running typed text. */
	isChord: boolean;
	startMs: number;
	lastMs: number;
	/** Visibility 0..1 at the queried time. */
	opacity: number;
}
