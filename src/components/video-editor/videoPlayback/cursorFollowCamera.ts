import type { CursorTelemetryPoint, ZoomFocus } from "../types";
import { interpolateCursorPosition } from "./cursorRenderer";
import { clampFocusToScale } from "./focusUtils";

/**
 * Cursor-follow camera.
 *
 * Keeps a persistent camera center while zoomed in. The camera only recenters
 * after the cursor leaves an inner safe zone within the current zoomed view,
 * shifting just enough to bring the cursor back inside that zone.
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
	/** Current camera focus while zoomed */
	focusX: number;
	/** Current camera focus while zoomed */
	focusY: number;
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
	 * 0.25 for manual zooms, 0.25 for auto/system zooms.
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
		focusX: 0.5,
		focusY: 0.5,
		wasZoomed: false,
		reachedFullZoom: false,
		frozenFocusX: 0.5,
		frozenFocusY: 0.5,
	};
}

export function resetCursorFollowCamera(state: CursorFollowCameraState): void {
	state.initialized = false;
	state.lastTimeMs = 0;
	state.focusX = 0.5;
	state.focusY = 0.5;
	state.wasZoomed = false;
	state.reachedFullZoom = false;
	state.frozenFocusX = 0.5;
	state.frozenFocusY = 0.5;
}

function clampSafeZoneRatio(ratio: number) {
	if (!Number.isFinite(ratio)) {
		return SNAP_TO_EDGES_RATIO_AUTO;
	}

	return Math.max(0, Math.min(0.49, ratio));
}

function getVisibleHalfSpan(zoomScale: number) {
	return 1 / (2 * Math.max(1, zoomScale));
}

function recenterFocusWhenCursorLeavesSafeZone(
	currentFocus: ZoomFocus,
	cursorFocus: ZoomFocus,
	zoomScale: number,
	safeZoneRatio: number,
): ZoomFocus {
	const halfSpan = getVisibleHalfSpan(zoomScale);
	const visibleSpan = halfSpan * 2;
	const safeZoneInset = visibleSpan * clampSafeZoneRatio(safeZoneRatio);

	const safeLeft = currentFocus.cx - halfSpan + safeZoneInset;
	const safeRight = currentFocus.cx + halfSpan - safeZoneInset;
	const safeTop = currentFocus.cy - halfSpan + safeZoneInset;
	const safeBottom = currentFocus.cy + halfSpan - safeZoneInset;

	let nextFocusX = currentFocus.cx;
	let nextFocusY = currentFocus.cy;

	if (cursorFocus.cx < safeLeft) {
		nextFocusX = cursorFocus.cx;
	} else if (cursorFocus.cx > safeRight) {
		nextFocusX = cursorFocus.cx;
	}

	if (cursorFocus.cy < safeTop) {
		nextFocusY = cursorFocus.cy;
	} else if (cursorFocus.cy > safeBottom) {
		nextFocusY = cursorFocus.cy;
	}

	return clampFocusToScale(
		{
			cx: nextFocusX,
			cy: nextFocusY,
		},
		zoomScale,
	);
}

/**
 * Cursor follow: target focus computation.
 *
 * Computes the desired camera focus point based on a persistent camera center
 * and an inner safe zone. The zoom transition layer handles smooth
 * interpolation toward the returned focus.
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
	const clampedRegionFocus = clampFocusToScale(regionFocus, zoomScale);

	// If not zoomed (strength ≈ 0), reset state and return region focus
	if (zoomStrength < 0.01) {
		if (state.wasZoomed) {
			state.wasZoomed = false;
			state.initialized = false;
			state.reachedFullZoom = false;
		}
		return clampedRegionFocus;
	}

	const cursorPos = interpolateCursorPosition(cursorSamples, timeMs);
	if (!cursorPos) {
		return state.initialized
			? { cx: state.focusX, cy: state.focusY }
			: clampedRegionFocus;
	}

	// Track when zoom reaches full strength
	if (zoomStrength >= 0.99) {
		state.reachedFullZoom = true;
	}

	// Zooming out: was fully zoomed but strength is now dropping — freeze camera
	if (state.reachedFullZoom && zoomStrength < 0.99) {
		return { cx: state.frozenFocusX, cy: state.frozenFocusY };
	}

	const timeWentBackwards = state.initialized && timeMs + 0.5 < state.lastTimeMs;

	if (!state.initialized || !state.wasZoomed || timeWentBackwards) {
		const initialFocus = recenterFocusWhenCursorLeavesSafeZone(
			clampedRegionFocus,
			{ cx: cursorPos.cx, cy: cursorPos.cy },
			zoomScale,
			config.snapToEdgesRatio,
		);
		state.lastTimeMs = timeMs;
		state.initialized = true;
		state.wasZoomed = true;
		state.focusX = initialFocus.cx;
		state.focusY = initialFocus.cy;
		state.frozenFocusX = initialFocus.cx;
		state.frozenFocusY = initialFocus.cy;
		return initialFocus;
	}

	state.lastTimeMs = timeMs;

	const targetFocus = recenterFocusWhenCursorLeavesSafeZone(
		{ cx: state.focusX, cy: state.focusY },
		{ cx: cursorPos.cx, cy: cursorPos.cy },
		zoomScale,
		config.snapToEdgesRatio,
	);

	state.focusX = targetFocus.cx;
	state.focusY = targetFocus.cy;
	state.frozenFocusX = targetFocus.cx;
	state.frozenFocusY = targetFocus.cy;

	return targetFocus;
}
