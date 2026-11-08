import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import { DEFAULT_ZOOM_MOTION_BLUR_TUNING, type ZoomMotionBlurTuning } from "../types";

const MIN_DIRECTIONAL_BLUR_MAGNITUDE = 0.01;

export const DIRECTIONAL_BLUR_KERNEL_SIZE = 13;

const DIRECTIONAL_BLUR_OFFSET_DIVISOR = 32;

// Shorter pan exposure keeps directional trails from overpowering screen text.
const SPATIAL_PAN_SHUTTER_MULTIPLIER = 3;

// Spatial equivalent of a longer exposure. This extends the one-pass zoom
// trail without multiplying scene renders like temporal accumulation does.
const SPATIAL_ZOOM_SHUTTER_MULTIPLIER = 4;

export interface DirectionalMotionBlur {
	velocity: { x: number; y: number };
	magnitude: number;
	kernelSize: number;
	offset: number;
}

export interface AppliedTransform {
	scale: number;
	x: number;
	y: number;
}

interface Point2D {
	x: number;
	y: number;
}

interface TransformQuad {
	center: Point2D;
	corners: [Point2D, Point2D, Point2D, Point2D];
	diagonal: number;
	size: Point2D;
}

interface CameraStepAnalysis {
	mode: "move" | "zoom" | null;
	moveVelocity: Point2D;
	moveBlurVelocity: Point2D;
	moveBlurOffset: number;
	zoomCenter: Point2D;
	zoomStrength: number;
}

export function computeTransformQuad(
	baseMask: { x: number; y: number; width: number; height: number },
	transform: AppliedTransform,
): TransformQuad {
	const topLeft = {
		x: transform.x + baseMask.x * transform.scale,
		y: transform.y + baseMask.y * transform.scale,
	};
	const topRight = {
		x: transform.x + (baseMask.x + baseMask.width) * transform.scale,
		y: transform.y + baseMask.y * transform.scale,
	};
	const bottomRight = {
		x: transform.x + (baseMask.x + baseMask.width) * transform.scale,
		y: transform.y + (baseMask.y + baseMask.height) * transform.scale,
	};
	const bottomLeft = {
		x: transform.x + baseMask.x * transform.scale,
		y: transform.y + (baseMask.y + baseMask.height) * transform.scale,
	};
	const center = {
		x: (topLeft.x + bottomRight.x) * 0.5,
		y: (topLeft.y + bottomRight.y) * 0.5,
	};

	return {
		center,
		corners: [topLeft, topRight, bottomRight, bottomLeft],
		diagonal: Math.hypot(bottomRight.x - topLeft.x, bottomRight.y - topLeft.y),
		size: {
			x: Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y),
			y: Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y),
		},
	};
}

function crossProduct(a: Point2D, b: Point2D) {
	return a.x * b.y - a.y * b.x;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function intersectInfiniteLines(
	aStart: Point2D,
	aEnd: Point2D,
	bStart: Point2D,
	bEnd: Point2D,
): Point2D | null {
	const aDelta = { x: aEnd.x - aStart.x, y: aEnd.y - aStart.y };
	const bDelta = { x: bEnd.x - bStart.x, y: bEnd.y - bStart.y };
	const denominator = crossProduct(aDelta, bDelta);

	if (Math.abs(denominator) < 0.0001) {
		return null;
	}

	const originDelta = { x: bStart.x - aStart.x, y: bStart.y - aStart.y };
	const t = crossProduct(originDelta, bDelta) / denominator;

	return {
		x: aStart.x + aDelta.x * t,
		y: aStart.y + aDelta.y * t,
	};
}

function inferZoomCenterFromQuads(
	previousQuad: TransformQuad,
	currentQuad: TransformQuad,
	stageSize: { width: number; height: number },
) {
	const hasMeaningfulChange =
		Math.abs(currentQuad.center.x - previousQuad.center.x) > 0.001 ||
		Math.abs(currentQuad.center.y - previousQuad.center.y) > 0.001 ||
		Math.abs(currentQuad.diagonal - previousQuad.diagonal) > 0.001;

	if (!hasMeaningfulChange) {
		return previousQuad.center;
	}

	const motionSegments: Array<{ start: Point2D; end: Point2D }> = [];

	for (let i = 0; i < previousQuad.corners.length; i += 1) {
		const start = previousQuad.corners[i];
		const end = currentQuad.corners[i];
		if (Math.hypot(end.x - start.x, end.y - start.y) < 0.5) {
			continue;
		}
		motionSegments.push({ start, end });
	}

	for (let i = 0; i < motionSegments.length; i += 1) {
		for (let j = i + 1; j < motionSegments.length; j += 1) {
			const intersection = intersectInfiniteLines(
				motionSegments[i].start,
				motionSegments[i].end,
				motionSegments[j].start,
				motionSegments[j].end,
			);

			if (!intersection) {
				continue;
			}

			const marginX = stageSize.width;
			const marginY = stageSize.height;

			return {
				x: clamp(intersection.x, -marginX, stageSize.width + marginX),
				y: clamp(intersection.y, -marginY, stageSize.height + marginY),
			};
		}
	}

	return currentQuad.center;
}

function resolveFpsScale(deltaSeconds: number) {
	const fps = 1 / Math.max(1 / 240, deltaSeconds);
	return fps / 60;
}

export function computeDirectionalMotionBlur(
	delta: { x: number; y: number },
	motionBlurAmount: number,
	deltaSeconds: number,
	strengthMultiplier = 1,
): DirectionalMotionBlur {
	const scale = motionBlurAmount * resolveFpsScale(deltaSeconds) * strengthMultiplier;
	const velocity = {
		x: delta.x * scale,
		y: delta.y * scale,
	};
	const magnitude = Math.hypot(velocity.x, velocity.y);
	const isActive = magnitude >= MIN_DIRECTIONAL_BLUR_MAGNITUDE;

	return {
		velocity: isActive ? velocity : createZeroPoint(),
		magnitude: isActive ? magnitude : 0,
		kernelSize: DIRECTIONAL_BLUR_KERNEL_SIZE,
		offset: isActive ? -magnitude / DIRECTIONAL_BLUR_OFFSET_DIVISOR : 0,
	};
}

function resolveZoomBlurStrength(
	motionBlurAmount: number,
	motionBlurTuning: ZoomMotionBlurTuning,
	deltaSeconds: number,
) {
	const fpsScale = resolveFpsScale(deltaSeconds);
	return (
		motionBlurAmount *
		fpsScale *
		SPATIAL_ZOOM_SHUTTER_MULTIPLIER *
		(motionBlurTuning.maxRadialBlurStrength /
			DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxRadialBlurStrength)
	);
}

function computeMoveDelta(previousQuad: TransformQuad, currentQuad: TransformQuad) {
	return {
		x: currentQuad.center.x - previousQuad.center.x,
		y: currentQuad.center.y - previousQuad.center.y,
	};
}

function computeSizeDelta(previousQuad: TransformQuad, currentQuad: TransformQuad) {
	return {
		x: Math.abs(currentQuad.size.x - previousQuad.size.x),
		y: Math.abs(currentQuad.size.y - previousQuad.size.y),
	};
}

function computeZoomStrength(previousQuad: TransformQuad, currentQuad: TransformQuad) {
	// Keep the spatial approximation sampling inward. Sampling outward during
	// expansion can leave the filter's captured texture and produce transparent
	// or black frames; true directionality requires temporal/overscanned input.
	return Math.abs(1 - currentQuad.diagonal / Math.max(0.0001, previousQuad.diagonal));
}

function classifyMotionMode(
	previousQuad: TransformQuad,
	currentQuad: TransformQuad,
	motionBlurTuning: ZoomMotionBlurTuning,
	deltaSeconds: number,
) {
	const moveDelta = computeMoveDelta(previousQuad, currentQuad);
	const sizeDelta = computeSizeDelta(previousQuad, currentQuad);
	const moveDistance = Math.hypot(moveDelta.x, moveDelta.y);
	const zoomDistance = Math.hypot(sizeDelta.x, sizeDelta.y);
	const moveVelocity = Math.hypot(moveDelta.x, moveDelta.y) / Math.max(0.0001, deltaSeconds);
	const zoomVelocity =
		Math.abs(
			Math.log(
				Math.max(0.0001, currentQuad.diagonal) / Math.max(0.0001, previousQuad.diagonal),
			),
		) / Math.max(0.0001, deltaSeconds);
	const moveActive = moveDistance > 0.001 && moveVelocity > motionBlurTuning.panVelocityThreshold;
	const zoomActive =
		zoomDistance > 0.001 && zoomVelocity > motionBlurTuning.zoomVelocityThreshold;

	if (!moveActive && !zoomActive) {
		return null;
	}

	// Compare size and centre movement in the same stage-pixel units. A small
	// scale ripple must not suppress a stronger pan; exact ties favour movement.
	if (zoomActive && (!moveActive || zoomDistance > moveDistance)) {
		return "zoom";
	}

	return "move";
}

function createZeroPoint(): Point2D {
	return { x: 0, y: 0 };
}

export function analyzeCameraStep({
	previousQuad,
	currentQuad,
	stageSize,
	motionBlurAmount,
	motionBlurTuning,
	deltaSeconds,
}: {
	previousQuad: TransformQuad;
	currentQuad: TransformQuad;
	stageSize: { width: number; height: number };
	motionBlurAmount: number;
	motionBlurTuning: ZoomMotionBlurTuning;
	deltaSeconds: number;
}): CameraStepAnalysis {
	const mode = classifyMotionMode(previousQuad, currentQuad, motionBlurTuning, deltaSeconds);
	const moveDelta = computeMoveDelta(previousQuad, currentQuad);
	const zoomBlurStrength = resolveZoomBlurStrength(
		motionBlurAmount,
		motionBlurTuning,
		deltaSeconds,
	);
	const directionalBlur = computeDirectionalMotionBlur(
		moveDelta,
		motionBlurAmount,
		deltaSeconds,
		SPATIAL_PAN_SHUTTER_MULTIPLIER *
			(motionBlurTuning.maxDirectionalBlurPx /
				DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxDirectionalBlurPx),
	);

	return {
		mode,
		moveVelocity: moveDelta,
		moveBlurVelocity: mode === "move" ? directionalBlur.velocity : createZeroPoint(),
		moveBlurOffset: mode === "move" ? directionalBlur.offset : 0,
		zoomCenter: inferZoomCenterFromQuads(previousQuad, currentQuad, stageSize),
		zoomStrength:
			mode === "zoom" ? computeZoomStrength(previousQuad, currentQuad) * zoomBlurStrength : 0,
	};
}

export function applyCameraStepBlur({
	analysis,
	motionBlurFilter,
	zoomBlurFilter,
}: {
	analysis: CameraStepAnalysis;
	motionBlurFilter: MotionBlurFilter;
	zoomBlurFilter?: ZoomBlurFilter | null;
}) {
	motionBlurFilter.velocity = analysis.moveBlurVelocity;
	motionBlurFilter.kernelSize = DIRECTIONAL_BLUR_KERNEL_SIZE;
	motionBlurFilter.offset = analysis.moveBlurOffset;

	if (zoomBlurFilter) {
		zoomBlurFilter.center = analysis.zoomCenter;
		zoomBlurFilter.strength = analysis.zoomStrength;
		zoomBlurFilter.innerRadius = 0;
		zoomBlurFilter.radius = -1;
	}
}
