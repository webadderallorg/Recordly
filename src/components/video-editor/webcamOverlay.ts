import type { CropRegion, WebcamCorner, WebcamPositionPreset } from "./types";

const MIN_WEBCAM_OVERLAY_SIZE_PX = 56;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

const WEBCAM_POSITION_SNAP_POINTS: Array<{ x: number; y: number }> = [
	{ x: 0, y: 0 },
	{ x: 0.5, y: 0 },
	{ x: 1, y: 0 },
	{ x: 0, y: 0.5 },
	{ x: 0.5, y: 0.5 },
	{ x: 1, y: 0.5 },
	{ x: 0, y: 1 },
	{ x: 0.5, y: 1 },
	{ x: 1, y: 1 },
];

export interface WebcamCropDrawLayout {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
	drawX: number;
	drawY: number;
	drawWidth: number;
	drawHeight: number;
}

export function getWebcamPositionForPreset(preset: WebcamPositionPreset): { x: number; y: number } {
	switch (preset) {
		case "top-left":
			return { x: 0, y: 0 };
		case "top-center":
			return { x: 0.5, y: 0 };
		case "top-right":
			return { x: 1, y: 0 };
		case "center-left":
			return { x: 0, y: 0.5 };
		case "center":
			return { x: 0.5, y: 0.5 };
		case "center-right":
			return { x: 1, y: 0.5 };
		case "bottom-left":
			return { x: 0, y: 1 };
		case "bottom-center":
			return { x: 0.5, y: 1 };
		case "custom":
			return { x: 1, y: 1 };
		case "bottom-right":
		default:
			return { x: 1, y: 1 };
	}
}

function isCornerPreset(preset: WebcamPositionPreset): preset is WebcamCorner {
	return (
		preset === "top-left" ||
		preset === "top-right" ||
		preset === "bottom-left" ||
		preset === "bottom-right"
	);
}

export function resolveWebcamCorner(
	preset: WebcamPositionPreset,
	legacyCorner: WebcamCorner,
): WebcamCorner {
	return isCornerPreset(preset) ? preset : legacyCorner;
}

export function getWebcamOverlayScale(zoomScale: number, reactToZoom: boolean): number {
	const safeZoomScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
	return reactToZoom ? 1 / safeZoomScale : 1;
}

export function getWebcamOverlaySizePx({
	containerWidth,
	containerHeight,
	sizePercent,
	margin,
	zoomScale,
	reactToZoom,
}: {
	containerWidth: number;
	containerHeight: number;
	sizePercent: number;
	margin: number;
	zoomScale: number;
	reactToZoom: boolean;
}): number {
	const minDimension = Math.min(containerWidth, containerHeight);
	const clampedSizePercent = clamp(sizePercent, 10, 100);
	const safeMargin = Math.max(0, margin);
	const maxSize = Math.max(MIN_WEBCAM_OVERLAY_SIZE_PX, minDimension - safeMargin * 2);
	const scaledSize =
		minDimension * (clampedSizePercent / 100) * getWebcamOverlayScale(zoomScale, reactToZoom);

	return Math.min(maxSize, Math.max(MIN_WEBCAM_OVERLAY_SIZE_PX, scaledSize));
}

/**
 * Inverse of getWebcamOverlaySizePx: given an on-screen pixel size (the size
 * the user dragged the bubble to), return the unscaled size percent that
 * produces it. Used by the in-preview resize handles so a drag updates the
 * persisted size in the same units the size slider uses.
 */
export function getWebcamSizePercentFromPx({
	sizePx,
	containerWidth,
	containerHeight,
	zoomScale,
	reactToZoom,
}: {
	sizePx: number;
	containerWidth: number;
	containerHeight: number;
	zoomScale: number;
	reactToZoom: boolean;
}): number {
	const minDimension = Math.min(containerWidth, containerHeight);
	if (minDimension <= 0) {
		return 10;
	}

	const scale = getWebcamOverlayScale(zoomScale, reactToZoom);
	if (scale <= 0) {
		return 10;
	}

	const percent = (sizePx / (minDimension * scale)) * 100;
	return clamp(percent, 10, 100);
}

export function getWebcamOverlayPosition({
	containerWidth,
	containerHeight,
	size,
	height,
	margin,
	positionPreset,
	positionX,
	positionY,
	legacyCorner,
}: {
	containerWidth: number;
	containerHeight: number;
	size: number;
	height?: number;
	margin: number;
	positionPreset: WebcamPositionPreset;
	positionX: number;
	positionY: number;
	legacyCorner: WebcamCorner;
}): { x: number; y: number } {
	const safeMargin = Math.max(0, margin);
	const availableWidth = Math.max(0, containerWidth - size - safeMargin * 2);
	const effectiveHeight = height ?? size;
	const availableHeight = Math.max(0, containerHeight - effectiveHeight - safeMargin * 2);
	const presetPosition =
		positionPreset === "custom"
			? { x: clamp(positionX, 0, 1), y: clamp(positionY, 0, 1) }
			: getWebcamPositionForPreset(positionPreset || legacyCorner);

	return {
		x: safeMargin + availableWidth * presetPosition.x,
		y: safeMargin + availableHeight * presetPosition.y,
	};
}

export function clampWebcamOverlayPosition({
	containerWidth,
	containerHeight,
	size,
	height,
	margin,
	position,
}: {
	containerWidth: number;
	containerHeight: number;
	size: number;
	height?: number;
	margin: number;
	position: { x: number; y: number };
}): { x: number; y: number } {
	const safeMargin = Math.max(0, margin);
	const effectiveHeight = height ?? size;
	const minX = Math.min(safeMargin, Math.max(0, containerWidth - size));
	const minY = Math.min(safeMargin, Math.max(0, containerHeight - effectiveHeight));
	const maxX = Math.max(minX, containerWidth - size - safeMargin);
	const maxY = Math.max(minY, containerHeight - effectiveHeight - safeMargin);

	return {
		x: clamp(position.x, minX, maxX),
		y: clamp(position.y, minY, maxY),
	};
}

export function getSnappedWebcamPositionPoint(
	position: { x: number; y: number },
	threshold = 0.05,
): { x: number; y: number } {
	const safeThreshold = Math.max(0, Math.min(1, threshold));
	const clampedPosition = {
		x: clamp(position.x, 0, 1),
		y: clamp(position.y, 0, 1),
	};
	let bestPoint = clampedPosition;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (const point of WEBCAM_POSITION_SNAP_POINTS) {
		const distance = Math.max(
			Math.abs(clampedPosition.x - point.x),
			Math.abs(clampedPosition.y - point.y),
		);
		if (distance <= safeThreshold && distance < bestDistance) {
			bestDistance = distance;
			bestPoint = point;
		}
	}

	return bestPoint;
}

export function getWebcamAvoidCursorPosition({
	containerWidth,
	containerHeight,
	size,
	height,
	margin,
	currentPosition,
	cursor,
	legacyCorner,
}: {
	containerWidth: number;
	containerHeight: number;
	size: number;
	height?: number;
	margin: number;
	currentPosition: { x: number; y: number };
	cursor: { x: number; y: number } | null | undefined;
	legacyCorner: WebcamCorner;
}): { x: number; y: number } {
	if (!cursor || containerWidth <= 0 || containerHeight <= 0 || size <= 0) {
		return currentPosition;
	}

	const centerX = currentPosition.x + size / 2;
	const effectiveHeight = height ?? size;
	const centerY = currentPosition.y + effectiveHeight / 2;
	const distance = Math.hypot(cursor.x - centerX, cursor.y - centerY);
	const triggerRadius = Math.max(72, Math.max(size, effectiveHeight) * 0.72);
	if (distance > triggerRadius) {
		return currentPosition;
	}

	const corners: WebcamCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
	let bestPosition = currentPosition;
	let bestScore = Number.NEGATIVE_INFINITY;

	for (const corner of corners) {
		const position = getWebcamOverlayPosition({
			containerWidth,
			containerHeight,
			size,
			height: effectiveHeight,
			margin,
			positionPreset: corner,
			positionX: 0,
			positionY: 0,
			legacyCorner,
		});
		const candidateCenterX = position.x + size / 2;
		const candidateCenterY = position.y + effectiveHeight / 2;
		const score = Math.hypot(cursor.x - candidateCenterX, cursor.y - candidateCenterY);
		if (score > bestScore) {
			bestScore = score;
			bestPosition = position;
		}
	}

	return bestPosition;
}

export function getWebcamCropDrawLayout({
	cropRegion,
	sourceWidth,
	sourceHeight,
	targetWidth,
	targetHeight,
}: {
	cropRegion?: Partial<CropRegion> | null;
	sourceWidth: number;
	sourceHeight: number;
	targetWidth: number;
	targetHeight: number;
}): WebcamCropDrawLayout {
	const safeTargetWidth = Math.max(1, targetWidth);
	const safeTargetHeight = Math.max(1, targetHeight);
	const { sx, sy, sw, sh } = getWebcamCropSourceRect(cropRegion, sourceWidth, sourceHeight);
	const coverScale = Math.max(safeTargetWidth / sw, safeTargetHeight / sh);
	const baseSize = Math.min(safeTargetWidth, safeTargetHeight);
	const revealScale = Math.max(safeTargetWidth / sw, baseSize / sh);
	const canRevealVertically =
		safeTargetHeight > safeTargetWidth + 0.5 && sh * revealScale >= safeTargetHeight;
	const scale = canRevealVertically ? revealScale : coverScale;
	const drawWidth = sw * scale;
	const drawHeight = sh * scale;
	const drawX = (safeTargetWidth - drawWidth) / 2;
	const drawY = canRevealVertically
		? (baseSize - drawHeight) / 2 + (safeTargetHeight - baseSize)
		: (safeTargetHeight - drawHeight) / 2;

	return {
		sx,
		sy,
		sw,
		sh,
		drawX,
		drawY,
		drawWidth,
		drawHeight,
	};
}

export function normalizeWebcamCropRegion(cropRegion?: Partial<CropRegion> | null): CropRegion {
	const candidate = cropRegion ?? {};
	const rawX = Number.isFinite(candidate.x) ? (candidate.x as number) : 0;
	const rawY = Number.isFinite(candidate.y) ? (candidate.y as number) : 0;
	const x = clamp(rawX, 0, 0.99);
	const y = clamp(rawY, 0, 0.99);
	const width = clamp(
		Number.isFinite(candidate.width) ? (candidate.width as number) : 1,
		0.01,
		1 - x,
	);
	const height = clamp(
		Number.isFinite(candidate.height) ? (candidate.height as number) : 1,
		0.01,
		1 - y,
	);

	return { x, y, width, height };
}

export function isWebcamCropRegionDefault(cropRegion?: Partial<CropRegion> | null): boolean {
	const crop = normalizeWebcamCropRegion(cropRegion);
	return crop.x <= 0 && crop.y <= 0 && crop.width >= 1 && crop.height >= 1;
}

export function getWebcamCropSourceRect(
	cropRegion: Partial<CropRegion> | null | undefined,
	sourceWidth: number,
	sourceHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
	const crop = normalizeWebcamCropRegion(cropRegion);
	const safeWidth = Math.max(1, sourceWidth);
	const safeHeight = Math.max(1, sourceHeight);
	const sx = clamp(crop.x * safeWidth, 0, safeWidth - 1);
	const sy = clamp(crop.y * safeHeight, 0, safeHeight - 1);
	const sw = clamp(crop.width * safeWidth, 1, safeWidth - sx);
	const sh = clamp(crop.height * safeHeight, 1, safeHeight - sy);

	return { sx, sy, sw, sh };
}
