import { Container } from "pixi.js";
import {
	type AppliedTransform,
	analyzeCameraStep,
	applyCameraStepBlur,
	computeTransformQuad,
	DIRECTIONAL_BLUR_KERNEL_SIZE,
} from "./cameraMotionBlur";

export type { DirectionalMotionBlur } from "./cameraMotionBlur";
export { computeDirectionalMotionBlur } from "./cameraMotionBlur";

import { MotionBlurFilter } from "pixi-filters/motion-blur";

import { ZoomBlurFilter } from "pixi-filters/zoom-blur";

import { DEFAULT_ZOOM_MOTION_BLUR_TUNING, type ZoomMotionBlurTuning } from "../types";

export interface MotionBlurState {
	lastFrameTimeMs: number;
	prevCamX: number;
	prevCamY: number;
	prevCamScale: number;
	initialized: boolean;
}

export function createMotionBlurState(): MotionBlurState {
	return {
		lastFrameTimeMs: 0,
		prevCamX: 0,
		prevCamY: 0,
		prevCamScale: 1,
		initialized: false,
	};
}

interface TransformParams {
	cameraContainer: Container;
	zoomBlurFilter?: ZoomBlurFilter | null;
	motionBlurFilter?: MotionBlurFilter | null;
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	zoomProgress?: number;
	focusX: number;
	focusY: number;
	isPlaying: boolean;
	motionBlurAmount?: number;
	motionBlurTuning?: ZoomMotionBlurTuning;
	transformOverride?: AppliedTransform;
	motionBlurState?: MotionBlurState;
	frameTimeMs?: number;
	motionSample?: { previousTransform: AppliedTransform; deltaMs: number } | null;
}

interface FocusFromTransformGeometry {
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	x: number;
	y: number;
}

interface ZoomTransformGeometry {
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	zoomProgress?: number;
	focusX: number;
	focusY: number;
}

function resetMotionEffects(
	zoomBlurFilter?: ZoomBlurFilter | null,
	motionBlurFilter?: MotionBlurFilter | null,
	motionBlurState?: MotionBlurState,
) {
	if (motionBlurFilter) {
		motionBlurFilter.velocity = { x: 0, y: 0 };
		motionBlurFilter.kernelSize = 5;
		motionBlurFilter.offset = 0;
	}

	if (zoomBlurFilter) {
		zoomBlurFilter.strength = 0;
		zoomBlurFilter.innerRadius = 0;
		zoomBlurFilter.radius = -1;
	}

	if (motionBlurState) {
		motionBlurState.lastFrameTimeMs = 0;
		motionBlurState.prevCamX = 0;
		motionBlurState.prevCamY = 0;
		motionBlurState.prevCamScale = 1;
		motionBlurState.initialized = false;
	}
}

function resolveMotionBlurTuning(motionBlurTuning?: ZoomMotionBlurTuning): ZoomMotionBlurTuning {
	if (!motionBlurTuning) {
		return DEFAULT_ZOOM_MOTION_BLUR_TUNING;
	}

	return {
		...DEFAULT_ZOOM_MOTION_BLUR_TUNING,
		...motionBlurTuning,
	};
}

export function computeZoomTransform({
	stageSize,
	baseMask,
	zoomScale,
	zoomProgress = 1,
	focusX,
	focusY,
}: ZoomTransformGeometry): AppliedTransform {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0
	) {
		return { scale: 1, x: 0, y: 0 };
	}

	const progress = Math.min(1, Math.max(0, zoomProgress));
	const focusStagePxX = baseMask.x + focusX * baseMask.width;
	const focusStagePxY = baseMask.y + focusY * baseMask.height;
	const stageCenterX = stageSize.width / 2;
	const stageCenterY = stageSize.height / 2;
	const scale = 1 + (zoomScale - 1) * progress;
	const finalX = stageCenterX - focusStagePxX * zoomScale;
	const finalY = stageCenterY - focusStagePxY * zoomScale;

	return {
		scale,
		x: finalX * progress,
		y: finalY * progress,
	};
}

export function computeFocusFromTransform({
	stageSize,
	baseMask,
	zoomScale,
	x,
	y,
}: FocusFromTransformGeometry) {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0 ||
		zoomScale <= 0
	) {
		return { cx: 0.5, cy: 0.5 };
	}

	const stageCenterX = stageSize.width / 2;
	const stageCenterY = stageSize.height / 2;
	const focusStagePxX = (stageCenterX - x) / zoomScale;
	const focusStagePxY = (stageCenterY - y) / zoomScale;

	return {
		cx: (focusStagePxX - baseMask.x) / baseMask.width,
		cy: (focusStagePxY - baseMask.y) / baseMask.height,
	};
}

export function applyZoomTransform({
	cameraContainer,
	zoomBlurFilter,
	motionBlurFilter,
	stageSize,
	baseMask,
	zoomScale,
	zoomProgress = 1,
	focusX,
	focusY,
	isPlaying,
	motionBlurAmount = 0,
	motionBlurTuning,
	transformOverride,
	motionBlurState,
	frameTimeMs,
	motionSample,
}: TransformParams): AppliedTransform {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0
	) {
		cameraContainer.scale.set(1);
		cameraContainer.position.set(0, 0);
		resetMotionEffects(zoomBlurFilter, motionBlurFilter, motionBlurState);
		return { scale: 1, x: 0, y: 0 };
	}

	const transform =
		transformOverride ??
		computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale,
			zoomProgress,
			focusX,
			focusY,
		});

	// Apply position & scale to camera container
	cameraContainer.scale.set(transform.scale);
	cameraContainer.position.set(transform.x, transform.y);
	const resolvedTuning = resolveMotionBlurTuning(motionBlurTuning);
	const blurEnabled = Number.isFinite(motionBlurAmount) && motionBlurAmount > 0;

	if (
		motionBlurFilter &&
		blurEnabled &&
		motionSample &&
		Number.isFinite(motionSample.deltaMs) &&
		motionSample.deltaMs > 0 &&
		motionSample.deltaMs <= 100
	) {
		const analysis = analyzeCameraStep({
			previousQuad: computeTransformQuad(baseMask, motionSample.previousTransform),
			currentQuad: computeTransformQuad(baseMask, transform),
			stageSize,
			motionBlurAmount,
			motionBlurTuning: resolvedTuning,
			deltaSeconds: motionSample.deltaMs / 1000,
		});
		applyCameraStepBlur({ analysis, motionBlurFilter, zoomBlurFilter });
		if (motionBlurState) {
			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;
			motionBlurState.lastFrameTimeMs = frameTimeMs ?? performance.now();
			motionBlurState.initialized = true;
		}
	} else if (motionSample !== undefined) {
		resetMotionEffects(zoomBlurFilter, motionBlurFilter, motionBlurState);
	} else if (motionBlurState && motionBlurFilter && blurEnabled && isPlaying) {
		const now = frameTimeMs ?? performance.now();

		if (!Number.isFinite(now)) {
			resetMotionEffects(zoomBlurFilter, motionBlurFilter, motionBlurState);
		} else if (!motionBlurState.initialized) {
			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;
			motionBlurState.lastFrameTimeMs = now;
			motionBlurState.initialized = true;
			motionBlurFilter.velocity = { x: 0, y: 0 };
			motionBlurFilter.kernelSize = DIRECTIONAL_BLUR_KERNEL_SIZE;
			motionBlurFilter.offset = 0;
			if (zoomBlurFilter) {
				zoomBlurFilter.strength = 0;
			}
		} else {
			const dtMs = now - motionBlurState.lastFrameTimeMs;
			// Like the webcam shutter, hold repeated frames and clear discontinuities.
			// Clamping a seek or a dropped frame to a shorter interval invents motion.
			const samePose =
				transform.scale === motionBlurState.prevCamScale &&
				transform.x === motionBlurState.prevCamX &&
				transform.y === motionBlurState.prevCamY;
			if (dtMs === 0 && samePose) return transform;
			if (dtMs <= 0 || dtMs > 100) {
				resetMotionEffects(zoomBlurFilter, motionBlurFilter);
			} else {
				const previousTransform = {
					scale: motionBlurState.prevCamScale,
					x: motionBlurState.prevCamX,
					y: motionBlurState.prevCamY,
				};
				const analysis = analyzeCameraStep({
					previousQuad: computeTransformQuad(baseMask, previousTransform),
					currentQuad: computeTransformQuad(baseMask, transform),
					stageSize,
					motionBlurAmount,
					motionBlurTuning: resolvedTuning,
					deltaSeconds: dtMs / 1000,
				});
				applyCameraStepBlur({ analysis, motionBlurFilter, zoomBlurFilter });
			}

			motionBlurState.lastFrameTimeMs = now;
			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;
		}
	} else {
		resetMotionEffects(zoomBlurFilter, motionBlurFilter, motionBlurState);
	}

	return {
		scale: transform.scale,
		x: transform.x,
		y: transform.y,
	};
}
