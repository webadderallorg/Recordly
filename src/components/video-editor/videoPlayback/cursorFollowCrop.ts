import type { CropRegion, CursorFollowCropSettings, CursorTelemetryPoint } from "../types";
import { interpolateCursorPosition } from "./cursorRenderer";

export interface CursorFollowCropState {
	initialized: boolean;
	lastTimeMs: number;
	/** Current top-left x of viewport, normalized 0..1 in source space. */
	x: number;
	/** Current top-left y of viewport, normalized 0..1 in source space. */
	y: number;
	/** Current focus mode when trackTextCursor is enabled. */
	focusMode: "mouse" | "text";
	/** Last video-time (ms) at which active mouse movement was detected. */
	mouseLastMovedMs: number;
}

export function createCursorFollowCropState(): CursorFollowCropState {
	return {
		initialized: false,
		lastTimeMs: 0,
		x: 0,
		y: 0,
		focusMode: "mouse",
		mouseLastMovedMs: -Infinity,
	};
}

export function resetCursorFollowCropState(state: CursorFollowCropState): void {
	state.initialized = false;
	state.lastTimeMs = 0;
	state.x = 0;
	state.y = 0;
	state.focusMode = "mouse";
	state.mouseLastMovedMs = -Infinity;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}

function clampSafeZoneRatio(ratio: number): number {
	if (!Number.isFinite(ratio)) return 0.25;
	return Math.max(0, Math.min(0.49, ratio));
}

function clampSmoothness(value: number): number {
	if (!Number.isFinite(value)) return 0.5;
	return Math.max(0, Math.min(1, value));
}

function clampViewportSize(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 1;
	return Math.min(1, value);
}

// Minimum normalized displacement between consecutive samples to count as active movement.
export const MOUSE_MOVE_THRESHOLD = 0.008;
// Look-back window (ms) for mouse movement detection.
const MOUSE_ACTIVE_WINDOW_MS = 400;
// How long (ms) the mouse must be still before switching to text-cursor mode.
export const MOUSE_ACTIVE_DEBOUNCE_MS = 700;
// Smoothness floor applied in text-cursor mode to keep the viewport stable.
const TEXT_CURSOR_SMOOTHNESS = 0.92;

/**
 * Returns true if there was meaningful mouse movement in the last
 * MOUSE_ACTIVE_WINDOW_MS ms before timeMs. Scans backwards so it can
 * early-exit as soon as one moving pair is found.
 */
export function detectMouseActivity(samples: CursorTelemetryPoint[], timeMs: number): boolean {
	const windowStart = timeMs - MOUSE_ACTIVE_WINDOW_MS;
	let prev: CursorTelemetryPoint | null = null;
	for (let i = samples.length - 1; i >= 0; i--) {
		const s = samples[i];
		if (s.timeMs > timeMs + 50) continue;
		if (s.timeMs < windowStart) break;
		if (prev !== null) {
			const dx = prev.cx - s.cx;
			const dy = prev.cy - s.cy;
			if (dx * dx + dy * dy >= MOUSE_MOVE_THRESHOLD * MOUSE_MOVE_THRESHOLD) return true;
		}
		prev = s;
	}
	return false;
}

/**
 * Returns true if the cursor type at or just before timeMs is the text I-beam.
 */
export function isTextCursorActive(samples: CursorTelemetryPoint[], timeMs: number): boolean {
	if (samples.length === 0) return false;
	for (let i = samples.length - 1; i >= 0; i--) {
		if (samples[i].timeMs <= timeMs + 50) {
			return samples[i].cursorType === "text";
		}
	}
	return false;
}

/**
 * Returns the viewport top-left position so the cursor lies inside the safe-zone
 * inset of the viewport. If the cursor is already inside the inset relative to
 * the current viewport, the current viewport position is returned unchanged.
 */
function computeTargetPosition(
	currentX: number,
	currentY: number,
	viewportWidth: number,
	viewportHeight: number,
	cursorCx: number,
	cursorCy: number,
	safeZoneRatio: number,
): { x: number; y: number } {
	const ratio = clampSafeZoneRatio(safeZoneRatio);
	const insetX = viewportWidth * ratio;
	const insetY = viewportHeight * ratio;

	const safeLeft = currentX + insetX;
	const safeRight = currentX + viewportWidth - insetX;
	const safeTop = currentY + insetY;
	const safeBottom = currentY + viewportHeight - insetY;

	let nextX = currentX;
	let nextY = currentY;

	if (cursorCx < safeLeft) {
		nextX = cursorCx - insetX;
	} else if (cursorCx > safeRight) {
		nextX = cursorCx - (viewportWidth - insetX);
	}

	if (cursorCy < safeTop) {
		nextY = cursorCy - insetY;
	} else if (cursorCy > safeBottom) {
		nextY = cursorCy - (viewportHeight - insetY);
	}

	const maxX = Math.max(0, 1 - viewportWidth);
	const maxY = Math.max(0, 1 - viewportHeight);
	return {
		x: clamp(nextX, 0, maxX),
		y: clamp(nextY, 0, maxY),
	};
}

/**
 * Returns the viewport top-left that centers the cursor in the viewport.
 * Used in text-cursor mode so the viewport actively pans onto the typing spot
 * (the I-beam position) rather than merely holding the cursor inside the safe
 * zone. Clamped so the viewport never leaves the source bounds.
 */
function computeCenteredPosition(
	viewportWidth: number,
	viewportHeight: number,
	cursorCx: number,
	cursorCy: number,
): { x: number; y: number } {
	const maxX = Math.max(0, 1 - viewportWidth);
	const maxY = Math.max(0, 1 - viewportHeight);
	return {
		x: clamp(cursorCx - viewportWidth / 2, 0, maxX),
		y: clamp(cursorCy - viewportHeight / 2, 0, maxY),
	};
}

/**
 * Maps smoothness (0..1, higher = slower follow) and elapsed frame time
 * to a per-frame interpolation factor in [0, 1]. At smoothness=0 the response
 * is immediate (factor=1). At smoothness=1 the response is almost frozen.
 */
function getResponseFactor(smoothness: number, dtMs: number): number {
	const s = clampSmoothness(smoothness);
	if (s <= 0) return 1;
	if (s >= 1) return 0;
	// Higher smoothness ⇒ lower per-second response.
	const responsePerSecond = 20 * (1 - s) + 1;
	const dtSec = Math.max(0, Math.min(0.25, dtMs / 1000));
	return 1 - Math.exp(-responsePerSecond * dtSec);
}

/**
 * Per-frame effective crop when "Track Cursor" is enabled.
 *
 * The viewport size is taken from `base.width`/`base.height`; `base.x`/`base.y`
 * is used only as the initial home position when telemetry isn't available yet.
 * The viewport top-left is panned so the cursor stays inside the safe-zone inset
 * of the viewport, then smoothly eased toward that target.
 *
 * When `settings.trackTextCursor` is true the function also tracks whether the
 * user is typing (mouse stationary + I-beam cursor type). In text-cursor mode
 * the viewport is kept very stable (high smoothness floor) and only switches
 * back to active mouse tracking once movement is detected — debounced by
 * MOUSE_ACTIVE_DEBOUNCE_MS so the transition is never jarring.
 */
export function computeCursorFollowCrop(
	state: CursorFollowCropState,
	cursorSamples: CursorTelemetryPoint[],
	timeMs: number,
	base: CropRegion,
	settings: CursorFollowCropSettings,
): CropRegion {
	const width = clampViewportSize(base.width);
	const height = clampViewportSize(base.height);
	const maxX = Math.max(0, 1 - width);
	const maxY = Math.max(0, 1 - height);

	const fallbackX = clamp(base.x, 0, maxX);
	const fallbackY = clamp(base.y, 0, maxY);

	const cursor = interpolateCursorPosition(cursorSamples, timeMs);
	if (!cursor) {
		if (!state.initialized) {
			state.x = fallbackX;
			state.y = fallbackY;
			state.initialized = true;
			state.lastTimeMs = timeMs;
			state.mouseLastMovedMs = timeMs;
		}
		return { x: state.x, y: state.y, width, height };
	}

	const cursorCx = clamp(cursor.cx, 0, 1);
	const cursorCy = clamp(cursor.cy, 0, 1);

	const timeWentBackwards = state.initialized && timeMs + 0.5 < state.lastTimeMs;
	if (!state.initialized || timeWentBackwards) {
		const initial = computeTargetPosition(
			fallbackX,
			fallbackY,
			width,
			height,
			cursorCx,
			cursorCy,
			settings.safeZoneRatio,
		);
		state.x = initial.x;
		state.y = initial.y;
		state.initialized = true;
		state.lastTimeMs = timeMs;
		state.mouseLastMovedMs = timeMs;
		state.focusMode = "mouse";
		return { x: state.x, y: state.y, width, height };
	}

	// Update focus mode when text-cursor tracking is enabled.
	// Mouse always wins: any detected movement immediately snaps back to mouse mode.
	// Transition to text mode is debounced so it only happens after MOUSE_ACTIVE_DEBOUNCE_MS
	// of stillness with an I-beam cursor, preventing jarring switches.
	if (settings.trackTextCursor) {
		const mouseActive = detectMouseActivity(cursorSamples, timeMs);
		if (mouseActive) {
			state.mouseLastMovedMs = timeMs;
			state.focusMode = "mouse";
		} else if (
			state.focusMode !== "text" &&
			timeMs - state.mouseLastMovedMs > MOUSE_ACTIVE_DEBOUNCE_MS &&
			isTextCursorActive(cursorSamples, timeMs)
		) {
			state.focusMode = "text";
		}
	} else {
		state.focusMode = "mouse";
	}

	// In text-cursor mode, clamp smoothness to a high floor so the viewport
	// barely moves while the user is typing. The cursor is still tracked so that
	// a click to a new text field (which triggers mouse mode) eventually lands
	// the viewport in the right place.
	const inTextMode = settings.trackTextCursor && state.focusMode === "text";
	const effectiveSmoothness = inTextMode
		? Math.max(settings.smoothness, TEXT_CURSOR_SMOOTHNESS)
		: settings.smoothness;

	// In text-cursor mode, actively pan to center the I-beam (the typing spot)
	// instead of merely holding it inside the safe zone — eased gently by the
	// high text-mode smoothness floor so the move never feels jarring. In mouse
	// mode, keep the safe-zone hold so small movements don't shift the viewport.
	const target = inTextMode
		? computeCenteredPosition(width, height, cursorCx, cursorCy)
		: computeTargetPosition(
				state.x,
				state.y,
				width,
				height,
				cursorCx,
				cursorCy,
				settings.safeZoneRatio,
			);

	const dtMs = Math.max(0, timeMs - state.lastTimeMs);
	const factor = getResponseFactor(effectiveSmoothness, dtMs);
	state.x = clamp(state.x + (target.x - state.x) * factor, 0, maxX);
	state.y = clamp(state.y + (target.y - state.y) * factor, 0, maxY);
	state.lastTimeMs = timeMs;

	return { x: state.x, y: state.y, width, height };
}
