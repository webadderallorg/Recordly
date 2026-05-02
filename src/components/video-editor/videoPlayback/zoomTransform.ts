import { BlurFilter, Container } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";

const PEAK_VELOCITY_PPS = 2000;
const MAX_BLUR_PX = 8;
const VELOCITY_THRESHOLD_PPS = 15;

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
	blurFilter: BlurFilter | null;
	motionBlurFilter?: MotionBlurFilter | null;
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	zoomScale: number;
	zoomProgress?: number;
	focusX: number;
	focusY: number;
	motionIntensity: number;
	motionVector?: { x: number; y: number };
	isPlaying: boolean;
	motionBlurAmount?: number;
	transformOverride?: AppliedTransform;
	motionBlurState?: MotionBlurState;
	frameTimeMs?: number;
}

interface AppliedTransform {
	scale: number;
	x: number;
	y: number;
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
	blurFilter: BlurFilter | null,
	motionBlurFilter?: MotionBlurFilter | null,
	motionBlurState?: MotionBlurState,
) {
	if (motionBlurFilter) {
		motionBlurFilter.velocity = { x: 0, y: 0 };
		motionBlurFilter.kernelSize = 5;
		motionBlurFilter.offset = 0;
	}

	if (blurFilter) {
		blurFilter.blur = 0;
	}

	if (motionBlurState) {
		motionBlurState.initialized = false;
	}
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

	// Clamp the focus point so that the visible window at full zoom stays
	// inside the displayed video rect (baseMask). Without this, zooming near
	// the edge of a video that does not fill the canvas (e.g. a 16:9 recording
	// on a 1:1 canvas) pans the letterbox/background into view. When the
	// visible window is larger than baseMask along an axis, no clamp range
	// exists and we snap to baseMask center on that axis instead.
	const safeZoom = zoomScale > 0 ? zoomScale : 1;
	const halfVisibleW = stageSize.width / (2 * safeZoom);
	const halfVisibleH = stageSize.height / (2 * safeZoom);
	const minFocusPxX = baseMask.x + halfVisibleW;
	const maxFocusPxX = baseMask.x + baseMask.width - halfVisibleW;
	const minFocusPxY = baseMask.y + halfVisibleH;
	const maxFocusPxY = baseMask.y + baseMask.height - halfVisibleH;
	const clampedFocusPxX =
		minFocusPxX <= maxFocusPxX
			? Math.min(maxFocusPxX, Math.max(minFocusPxX, focusStagePxX))
			: baseMask.x + baseMask.width / 2;
	const clampedFocusPxY =
		minFocusPxY <= maxFocusPxY
			? Math.min(maxFocusPxY, Math.max(minFocusPxY, focusStagePxY))
			: baseMask.y + baseMask.height / 2;

	const finalX = stageCenterX - clampedFocusPxX * zoomScale;
	const finalY = stageCenterY - clampedFocusPxY * zoomScale;

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
	blurFilter,
	motionBlurFilter,
	stageSize,
	baseMask,
	zoomScale,
	zoomProgress = 1,
	focusX,
	focusY,
	motionIntensity: _motionIntensity,
	motionVector: _motionVector,
	isPlaying,
	motionBlurAmount = 0,
	transformOverride,
	motionBlurState,
	frameTimeMs,
}: TransformParams): AppliedTransform {
	if (
		stageSize.width <= 0 ||
		stageSize.height <= 0 ||
		baseMask.width <= 0 ||
		baseMask.height <= 0
	) {
		cameraContainer.scale.set(1);
		cameraContainer.position.set(0, 0);
		resetMotionEffects(blurFilter, motionBlurFilter, motionBlurState);
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

	if (motionBlurState && motionBlurFilter && motionBlurAmount > 0 && isPlaying) {
		const now = frameTimeMs ?? performance.now();

		if (!motionBlurState.initialized) {
			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;
			motionBlurState.lastFrameTimeMs = now;
			motionBlurState.initialized = true;
			motionBlurFilter.velocity = { x: 0, y: 0 };
			motionBlurFilter.kernelSize = 5;
			motionBlurFilter.offset = 0;
			if (blurFilter) blurFilter.blur = 0;
		} else {
			const dtMs = Math.min(80, Math.max(1, now - motionBlurState.lastFrameTimeMs));
			const dtSeconds = dtMs / 1000;
			motionBlurState.lastFrameTimeMs = now;

			// Camera displacement this frame (stage-px)
			const dx = transform.x - motionBlurState.prevCamX;
			const dy = transform.y - motionBlurState.prevCamY;
			const dScale = transform.scale - motionBlurState.prevCamScale;

			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;

			// Velocity in px/s (translation + scale-change contribution)
			const velocityX = dx / dtSeconds;
			const velocityY = dy / dtSeconds;
			const scaleVelocity =
				Math.abs(dScale / dtSeconds) * Math.max(stageSize.width, stageSize.height) * 0.5;
			const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY) + scaleVelocity;

			const normalised = Math.min(1, speed / PEAK_VELOCITY_PPS);
			const targetBlur =
				speed < VELOCITY_THRESHOLD_PPS
					? 0
					: normalised * normalised * MAX_BLUR_PX * motionBlurAmount;

			const dirMag = Math.sqrt(velocityX * velocityX + velocityY * velocityY) || 1;
			const velocityScale = targetBlur * 1.2;
			motionBlurFilter.velocity =
				targetBlur > 0
					? {
							x: (velocityX / dirMag) * velocityScale,
							y: (velocityY / dirMag) * velocityScale,
						}
					: { x: 0, y: 0 };
			motionBlurFilter.kernelSize = targetBlur > 4 ? 11 : targetBlur > 1.5 ? 9 : 5;
			motionBlurFilter.offset = targetBlur > 0.5 ? -0.2 : 0;

			if (blurFilter) {
				blurFilter.blur = 0;
			}
		}
	} else {
		resetMotionEffects(blurFilter, motionBlurFilter, motionBlurState);
	}

	return {
		scale: transform.scale,
		x: transform.x,
		y: transform.y,
	};
}
