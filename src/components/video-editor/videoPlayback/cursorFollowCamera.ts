import type { CursorTelemetryPoint, ZoomFocus } from "../types";
import { interpolateCursorPosition } from "./cursorRenderer";
import { edgeSnapFocus } from "./focusUtils";

/**
 * Cursor-follow camera.
 *
 * Computes a TARGET focus point each frame (cursor → edge snap → focus),
 * then the zoom transition animation layer smoothly interpolates toward it.
 *
 * Edge snap: With snapToEdgesRatio = 0.25, cursor positions within 25% of
 * each edge pin the camera to that edge. The middle 50% maps linearly.
 * This prevents the camera from panning beyond the viewport bounds.
 */

/** Default snap ratio for manual zoom regions */
export const SNAP_TO_EDGES_RATIO_MANUAL = 0.25;
/** Snap ratio for system/auto zoom regions */
export const SNAP_TO_EDGES_RATIO_AUTO = 0.25;

export interface CursorFollowCameraState {
	/** Whether the state has been initialized with a starting position */
	initialized: boolean;
	/** Time of last update in ms (video time, not wall clock) */
	lastTimeMs: number;
	/** Whether the camera was active (zoomed) on the previous frame */
	wasZoomed: boolean;
	/** Whether the zoom reached full strength (≈1) — used to detect zoom-out */
	reachedFullZoom: boolean;
	/** Frozen focus when zooming out (camera holds position) */
	frozenFocusX: number;
	frozenFocusY: number;
}

export interface CursorFollowConfig {
	/**
	 * snapToEdgesRatio — how much of the screen edge pins the camera.
	 * 0.25 for manual zooms, 0.5 for auto/system zooms.
	 */
	snapToEdgesRatio: number;
}

export const DEFAULT_CURSOR_FOLLOW_CONFIG: CursorFollowConfig = {
	snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO,
};

export function createCursorFollowCameraState(): CursorFollowCameraState {
	return {
		initialized: false,
		lastTimeMs: 0,
		wasZoomed: false,
		reachedFullZoom: false,
		frozenFocusX: 0.5,
		frozenFocusY: 0.5,
	};
}

export function resetCursorFollowCamera(state: CursorFollowCameraState): void {
	state.initialized = false;
	state.lastTimeMs = 0;
	state.wasZoomed = false;
	state.reachedFullZoom = false;
	state.frozenFocusX = 0.5;
	state.frozenFocusY = 0.5;
}

/**
 * Cursor follow: target focus computation.
 *
 * Computes the desired camera focus point based on cursor position and
 * edge snap. The zoom transition layer handles smooth interpolation.
 *
 * Pipeline: cursor → edgeSnap(snapToEdgesRatio) → focus
 *
 * @returns The target focus point for this frame (normalized 0-1).
 */
export function computeCursorFollowFocus(
	state: CursorFollowCameraState,
	cursorSamples: CursorTelemetryPoint[],
	timeMs: number,
	zoomScale: number,
	zoomStrength: number,
	regionFocus: ZoomFocus,
	config: CursorFollowConfig = DEFAULT_CURSOR_FOLLOW_CONFIG,
): ZoomFocus {
	// If no cursor data available, fall back to static region focus
	const cursorPos = interpolateCursorPosition(cursorSamples, timeMs);
	if (!cursorPos) {
		return regionFocus;
	}

	// If not zoomed (strength ≈ 0), reset state and return region focus
	if (zoomStrength < 0.01) {
		if (state.wasZoomed) {
			state.wasZoomed = false;
			state.initialized = false;
			state.reachedFullZoom = false;
		}
		return regionFocus;
	}

	// Track when zoom reaches full strength
	if (zoomStrength >= 0.99) {
		state.reachedFullZoom = true;
	}

	// Zooming out: was fully zoomed but strength is now dropping — freeze camera
	if (state.reachedFullZoom && zoomStrength < 0.99) {
		return { cx: state.frozenFocusX, cy: state.frozenFocusY };
	}

	// First frame of a zoom: mark initialized
	if (!state.initialized || !state.wasZoomed) {
		state.lastTimeMs = timeMs;
		state.initialized = true;
		state.wasZoomed = true;
	}

	state.lastTimeMs = timeMs;

	// Edge snap: maps cursor through clamped linear remap.
	// Camera pins to edge when cursor is within snapToEdgesRatio of boundary.
	const targetFocus = edgeSnapFocus(
		{ cx: cursorPos.cx, cy: cursorPos.cy },
		zoomScale,
		config.snapToEdgesRatio,
	);

	// Save for zoom-out freeze
	state.frozenFocusX = targetFocus.cx;
	state.frozenFocusY = targetFocus.cy;

	return targetFocus;
}
