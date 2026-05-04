import { Container } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";

const PEAK_TRANSLATION_VELOCITY_PPS = 1800;
const PAN_VELOCITY_THRESHOLD_PPS = 24;
const PEAK_LOG_SCALE_VELOCITY_PER_SECOND = 1.45;
const LOG_SCALE_VELOCITY_THRESHOLD = 0.05;
const MAX_DIRECTIONAL_BLUR_PX = 7.5;
const MAX_ZOOM_BLUR_STRENGTH = 0.14;
const PAN_RESPONSE_PER_SECOND = 11;
const ZOOM_RESPONSE_PER_SECOND = 9;

export interface MotionBlurState {
	lastFrameTimeMs: number;
	prevCamX: number;
	prevCamY: number;
	prevCamScale: number;
	smoothedPanVelocityX: number;
	smoothedPanVelocityY: number;
	smoothedLogScaleVelocity: number;
	smoothedDirectionalBlur: number;
	smoothedRadialBlur: number;
	initialized: boolean;
}

export function createMotionBlurState(): MotionBlurState {
	return {
		lastFrameTimeMs: 0,
		prevCamX: 0,
		prevCamY: 0,
		prevCamScale: 1,
		smoothedPanVelocityX: 0,
		smoothedPanVelocityY: 0,
		smoothedLogScaleVelocity: 0,
		smoothedDirectionalBlur: 0,
		smoothedRadialBlur: 0,
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
		motionBlurState.smoothedPanVelocityX = 0;
		motionBlurState.smoothedPanVelocityY = 0;
		motionBlurState.smoothedLogScaleVelocity = 0;
		motionBlurState.smoothedDirectionalBlur = 0;
		motionBlurState.smoothedRadialBlur = 0;
		motionBlurState.initialized = false;
	}
}

function mixTowards(current: number, target: number, blendFactor: number) {
	return current + (target - current) * blendFactor;
}

function computeSmoothingBlend(deltaSeconds: number, responsePerSecond: number) {
	return 1 - Math.exp(-Math.max(0, deltaSeconds) * responsePerSecond);
}

function remapMotionStrength(value: number, threshold: number, peak: number) {
	if (!Number.isFinite(value) || value <= threshold) {
		return 0;
	}

	const span = Math.max(0.0001, peak - threshold);
	return Math.min(1, (value - threshold) / span);
}

function squareEase(value: number) {
	return value * value;
}

function resolveDirectionalKernelSize(blurStrength: number) {
	if (blurStrength >= 5.5) {
		return 13;
	}

	if (blurStrength >= 3) {
		return 11;
	}

	if (blurStrength >= 1.25) {
		return 7;
	}

	return 5;
}

function computeZoomBlurGeometry({
	stageSize,
	baseMask,
	targetZoomScale,
	focusX,
	focusY,
}: {
	stageSize: { width: number; height: number };
	baseMask: { x: number; y: number; width: number; height: number };
	targetZoomScale: number;
	focusX: number;
	focusY: number;
}) {
	const safeZoomScale = Math.max(1, targetZoomScale);
	const visibleWidth = stageSize.width / safeZoomScale;
	const visibleHeight = stageSize.height / safeZoomScale;
	const visibleHalfDiagonal = Math.hypot(visibleWidth / 2, visibleHeight / 2);
	const focusStagePxX = baseMask.x + focusX * baseMask.width;
	const focusStagePxY = baseMask.y + focusY * baseMask.height;
	const outerRadius = Math.max(
		Math.hypot(focusStagePxX, focusStagePxY),
		Math.hypot(stageSize.width - focusStagePxX, focusStagePxY),
		Math.hypot(focusStagePxX, stageSize.height - focusStagePxY),
		Math.hypot(stageSize.width - focusStagePxX, stageSize.height - focusStagePxY),
	);

	return {
		centerX: focusStagePxX,
		centerY: focusStagePxY,
		innerRadius: Math.max(18, Math.min(outerRadius - 1, visibleHalfDiagonal)),
		radius: Math.max(outerRadius, 1),
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
			if (zoomBlurFilter) {
				zoomBlurFilter.strength = 0;
			}
		} else {
			const dtMs = Math.min(80, Math.max(1, now - motionBlurState.lastFrameTimeMs));
			const dtSeconds = dtMs / 1000;
			motionBlurState.lastFrameTimeMs = now;

			const dx = transform.x - motionBlurState.prevCamX;
			const dy = transform.y - motionBlurState.prevCamY;
			const previousScale = Math.max(0.0001, motionBlurState.prevCamScale);
			const scaleRatio = Math.max(0.0001, transform.scale) / previousScale;
			const logScaleVelocity = Math.log(scaleRatio) / dtSeconds;

			motionBlurState.prevCamX = transform.x;
			motionBlurState.prevCamY = transform.y;
			motionBlurState.prevCamScale = transform.scale;

			const smoothingBlend = computeSmoothingBlend(dtSeconds, PAN_RESPONSE_PER_SECOND);
			const zoomSmoothingBlend = computeSmoothingBlend(dtSeconds, ZOOM_RESPONSE_PER_SECOND);
			const rawVelocityX = dx / dtSeconds;
			const rawVelocityY = dy / dtSeconds;
			motionBlurState.smoothedPanVelocityX = mixTowards(
				motionBlurState.smoothedPanVelocityX,
				rawVelocityX,
				smoothingBlend,
			);
			motionBlurState.smoothedPanVelocityY = mixTowards(
				motionBlurState.smoothedPanVelocityY,
				rawVelocityY,
				smoothingBlend,
			);
			motionBlurState.smoothedLogScaleVelocity = mixTowards(
				motionBlurState.smoothedLogScaleVelocity,
				logScaleVelocity,
				zoomSmoothingBlend,
			);

			const panVelocityX = motionBlurState.smoothedPanVelocityX;
			const panVelocityY = motionBlurState.smoothedPanVelocityY;
			const panSpeed = Math.hypot(panVelocityX, panVelocityY);
			const panStrength = squareEase(
				remapMotionStrength(
					panSpeed,
					PAN_VELOCITY_THRESHOLD_PPS,
					PEAK_TRANSLATION_VELOCITY_PPS,
				),
			);
			const zoomStrength = squareEase(
				remapMotionStrength(
					Math.abs(motionBlurState.smoothedLogScaleVelocity),
					LOG_SCALE_VELOCITY_THRESHOLD,
					PEAK_LOG_SCALE_VELOCITY_PER_SECOND,
				),
			);

			const targetDirectionalBlur =
				panStrength *
				(1 - Math.min(0.82, zoomStrength * 0.85)) *
				MAX_DIRECTIONAL_BLUR_PX *
				motionBlurAmount;
			const targetRadialBlur = zoomStrength * MAX_ZOOM_BLUR_STRENGTH * motionBlurAmount;

			motionBlurState.smoothedDirectionalBlur = mixTowards(
				motionBlurState.smoothedDirectionalBlur,
				targetDirectionalBlur,
				smoothingBlend,
			);
			motionBlurState.smoothedRadialBlur = mixTowards(
				motionBlurState.smoothedRadialBlur,
				targetRadialBlur,
				zoomSmoothingBlend,
			);

			const directionalBlur = motionBlurState.smoothedDirectionalBlur;
			const radialBlur = motionBlurState.smoothedRadialBlur;
			const dirMag = Math.hypot(panVelocityX, panVelocityY) || 1;
			const velocityScale = directionalBlur * 1.1;
			motionBlurFilter.velocity =
				directionalBlur > 0.15
					? {
							x: (panVelocityX / dirMag) * velocityScale,
							y: (panVelocityY / dirMag) * velocityScale,
						}
					: { x: 0, y: 0 };
			motionBlurFilter.kernelSize = resolveDirectionalKernelSize(directionalBlur);
			motionBlurFilter.offset = directionalBlur > 0.45 ? -0.12 : 0;

			if (zoomBlurFilter) {
				const zoomBlurGeometry = computeZoomBlurGeometry({
					stageSize,
					baseMask,
					targetZoomScale: Math.max(zoomScale, transform.scale, 1),
					focusX,
					focusY,
				});

				zoomBlurFilter.center = {
					x: zoomBlurGeometry.centerX,
					y: zoomBlurGeometry.centerY,
				};
				zoomBlurFilter.innerRadius = zoomBlurGeometry.innerRadius;
				zoomBlurFilter.radius = zoomBlurGeometry.radius;
				zoomBlurFilter.strength =
					radialBlur * (motionBlurState.smoothedLogScaleVelocity >= 0 ? 0.88 : 1);
			}
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
