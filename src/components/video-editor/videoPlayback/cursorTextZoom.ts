import type { CursorFollowCropSettings, CursorTelemetryPoint, ZoomFocus } from "../types";
import {
	detectMouseActivity,
	isTextCursorActive,
	MOUSE_ACTIVE_DEBOUNCE_MS,
	MOUSE_MOVE_THRESHOLD,
} from "./cursorFollowCrop";
import { interpolateCursorPosition } from "./cursorRenderer";

/**
 * Returns the most recent video-time (ms) at or before `timeMs` at which the
 * mouse moved by at least MOUSE_MOVE_THRESHOLD between consecutive samples.
 * Returns -Infinity if no movement is found (mouse has been still throughout).
 * This lets the layer engage immediately when paused/scrubbing rather than
 * only after several frames of forward playback.
 */
function findLastMouseMoveMs(samples: CursorTelemetryPoint[], timeMs: number): number {
	let next: CursorTelemetryPoint | null = null;
	for (let i = samples.length - 1; i >= 0; i--) {
		const s = samples[i];
		if (s.timeMs > timeMs + 50) continue;
		if (next !== null) {
			const dx = next.cx - s.cx;
			const dy = next.cy - s.cy;
			if (dx * dx + dy * dy >= MOUSE_MOVE_THRESHOLD * MOUSE_MOVE_THRESHOLD) {
				return next.timeMs;
			}
		}
		next = s;
	}
	return -Infinity;
}

/** Default zoom depth for the text-zoom layer — a modest punch-in for typing. */
export const DEFAULT_TEXT_ZOOM_DEPTH_SCALE = 1.6;

/** Clamp the configured text-zoom depth to a sane range. */
function clampDepth(depth: number | undefined): number {
	if (!Number.isFinite(depth) || depth === undefined || depth <= 1) {
		return DEFAULT_TEXT_ZOOM_DEPTH_SCALE;
	}
	return Math.min(4, depth);
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0.5;
	return Math.min(1, Math.max(0, value));
}

export interface CursorTextZoomState {
	initialized: boolean;
	lastTimeMs: number;
	/** Whether the text-zoom is currently engaged (typing detected). */
	active: boolean;
	/** Last video-time (ms) at which active mouse movement was detected. */
	mouseLastMovedMs: number;
	/** Focus locked at the moment the zoom engaged, in source-normalized space. */
	focus: ZoomFocus;
}

export function createCursorTextZoomState(): CursorTextZoomState {
	return {
		initialized: false,
		lastTimeMs: 0,
		active: false,
		mouseLastMovedMs: -Infinity,
		focus: { cx: 0.5, cy: 0.5 },
	};
}

export function resetCursorTextZoomState(state: CursorTextZoomState): void {
	state.initialized = false;
	state.lastTimeMs = 0;
	state.active = false;
	state.mouseLastMovedMs = -Infinity;
	state.focus = { cx: 0.5, cy: 0.5 };
}

export interface TextZoomResult {
	/** True while the text-zoom layer wants to be engaged. */
	active: boolean;
	/** Target zoom scale (1 = none). */
	scale: number;
	/** Target focus in source-normalized space. */
	focus: ZoomFocus;
}

const INACTIVE: TextZoomResult = { active: false, scale: 1, focus: { cx: 0.5, cy: 0.5 } };

/**
 * Per-frame state for the independent text-zoom layer.
 *
 * Mirrors the focus-mode detection used by the cursor-follow crop: the layer
 * engages after the mouse has been still for `MOUSE_ACTIVE_DEBOUNCE_MS` while
 * the I-beam (text) cursor is active, and disengages the instant the mouse
 * moves again (mouse always wins). When engaged it locks the zoom focus to the
 * typing spot so the punch-in is stable; the caller eases scale/position via
 * the shared zoom spring, so this only needs to emit a stable target.
 */
export function computeCursorTextZoom(
	state: CursorTextZoomState,
	cursorSamples: CursorTelemetryPoint[],
	timeMs: number,
	settings: CursorFollowCropSettings,
): TextZoomResult {
	if (!settings.textZoomEnabled) {
		if (state.initialized) resetCursorTextZoomState(state);
		return INACTIVE;
	}

	const depth = clampDepth(settings.textZoomDepth);

	// (Re)initialize on first use or when time jumps (scrubbing/seeking). Seed
	// `mouseLastMovedMs` from the telemetry itself so the layer can engage right
	// away when paused or scrubbed onto a typing moment, not only after several
	// frames of forward playback.
	const timeJumped = state.initialized && Math.abs(timeMs - state.lastTimeMs) > 250;
	if (!state.initialized || timeJumped) {
		state.initialized = true;
		state.lastTimeMs = timeMs;
		state.active = false;
		state.mouseLastMovedMs = findLastMouseMoveMs(cursorSamples, timeMs);
	}
	state.lastTimeMs = timeMs;

	const mouseActive = detectMouseActivity(cursorSamples, timeMs);
	if (mouseActive) {
		state.mouseLastMovedMs = timeMs;
		state.active = false;
		return INACTIVE;
	}

	// Engage after the debounce once typing (I-beam) is detected.
	if (
		!state.active &&
		timeMs - state.mouseLastMovedMs > MOUSE_ACTIVE_DEBOUNCE_MS &&
		isTextCursorActive(cursorSamples, timeMs)
	) {
		const cursor = interpolateCursorPosition(cursorSamples, timeMs);
		if (cursor) {
			state.focus = { cx: clamp01(cursor.cx), cy: clamp01(cursor.cy) };
			state.active = true;
		}
	}

	if (!state.active) {
		return INACTIVE;
	}

	return { active: true, scale: depth, focus: state.focus };
}
