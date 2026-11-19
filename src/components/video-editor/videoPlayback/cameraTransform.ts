import { clampFocusToScale } from "./focusUtils";
import {
	type CursorSpringTuning,
	clampDeltaMs,
	getZoomSpringConfig,
	resetSpringState,
	type SpringConfig,
	type SpringState,
	stepSpringValue,
} from "./motionSmoothing";
import type { SceneZoomTarget } from "./sceneMotion";
import { computeZoomTransform } from "./zoomTransform";

function advanceCameraSpring(
	state: SpringState,
	target: number,
	deltaMs: number,
	config: SpringConfig,
) {
	const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 1000 / 60;
	// The shared solver limits each step. Subdivide the whole media
	// interval so a delayed preview frame doesn't leave the camera behind it.
	const steps = Math.ceil(elapsedMs / clampDeltaMs(elapsedMs));
	for (let step = 0; step < steps; step += 1) {
		stepSpringValue(state, target, elapsedMs / steps, config);
		if (state.value === target && state.velocity === 0) break;
	}
	return state.value;
}

/** Smooth camera panning without extending the timeline's zoom envelope. */
export function computeCameraTransform({
	target,
	stageSize,
	baseMask,
	springScale,
	springX,
	springY,
	deltaMs,
	snap = false,
	zoomSmoothness,
	tuning,
}: {
	target: SceneZoomTarget;
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	springScale: SpringState;
	springX: SpringState;
	springY: SpringState;
	deltaMs: number;
	snap?: boolean;
	zoomSmoothness?: number;
	tuning?: CursorSpringTuning;
}) {
	let scale = target.scale;
	let focusX = target.focus.cx;
	let focusY = target.focus.cy;
	if (snap || deltaMs <= 0 || target.progress <= 0) {
		resetSpringState(springScale, scale);
		resetSpringState(springX, focusX);
		resetSpringState(springY, focusY);
	} else {
		// Blocks change the spring's goal, not its position or momentum. Keep
		// integrating through the incoming block so a pan can settle naturally.
		const config = getZoomSpringConfig(zoomSmoothness, tuning, target.cinematic);
		if (target.connected) scale = advanceCameraSpring(springScale, scale, deltaMs, config);
		focusX = advanceCameraSpring(springX, focusX, deltaMs, config);
		focusY = advanceCameraSpring(springY, focusY, deltaMs, config);
	}
	if (target.progress <= 0) return { scale: 1, x: 0, y: 0 };
	if (!target.connected || snap || deltaMs <= 0) {
		// Isolated zoom envelopes already include their spring response. Sync the
		// depth state here so a later connected move begins at the displayed depth.
		Object.assign(springScale, { value: scale, velocity: 0, initialized: true });
	}

	// A shrinking zoom has tighter focus bounds; a trailing pan must stay inside them.
	const focus = clampFocusToScale({ cx: focusX, cy: focusY }, scale);
	if (snap || deltaMs <= 0) {
		// A composed seek is the next spring's starting position. Leaving it
		// uninitialized would snap again to a moving goal on the first resumed frame.
		Object.assign(springX, { value: focus.cx, velocity: 0, initialized: true });
		Object.assign(springY, { value: focus.cy, velocity: 0, initialized: true });
	}

	return computeZoomTransform({
		stageSize,
		baseMask,
		zoomScale: scale,
		zoomProgress: target.progress,
		focusX: focus.cx,
		focusY: focus.cy,
	});
}
