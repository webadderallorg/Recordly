import type { CropRegion, WebcamCorner, WebcamPositionPreset } from "./types";

const MIN_WEBCAM_OVERLAY_SIZE_PX = 56;
export const WEBCAM_REFERENCE_VIEWPORT_WIDTH = 1920;
const WEBCAM_REFERENCE_VIEWPORT_HEIGHT = 1080;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function scaleWebcamOverlayPixels(value: number, containerWidth: number): number {
	const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
	const safeWidth = Number.isFinite(containerWidth) ? Math.max(0, containerWidth) : 0;
	return safeValue * (safeWidth / WEBCAM_REFERENCE_VIEWPORT_WIDTH);
}

export function getWebcamCornerRadiusPx(
	roundnessPercent: number,
	width: number,
	height: number,
): number {
	const safeRoundness = Number.isFinite(roundnessPercent) ? clamp(roundnessPercent, 0, 100) : 0;
	const strengthenedRoundness = Math.sqrt(safeRoundness / 100);
	return (Math.max(0, Math.min(width, height)) / 2) * strengthenedRoundness;
}

export function convertLegacyWebcamRadiusToRoundness(
	radiusPixels: number,
	widthPercent: number,
	heightPercent: number,
): number {
	const referenceShortSide =
		WEBCAM_REFERENCE_VIEWPORT_HEIGHT *
		(clamp(Math.min(widthPercent, heightPercent), 10, 100) / 100);
	const normalizedRadius = clamp(Math.max(0, radiusPixels) / (referenceShortSide / 2), 0, 1);
	return normalizedRadius ** 2 * 100;
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

export function getWebcamOverlayDimensionsPx({
	containerWidth,
	containerHeight,
	widthPercent,
	heightPercent,
	margin,
	zoomScale,
	reactToZoom,
}: {
	containerWidth: number;
	containerHeight: number;
	widthPercent: number;
	heightPercent: number;
	margin: number;
	zoomScale: number;
	reactToZoom: boolean;
}): { width: number; height: number } {
	return {
		width: getWebcamOverlaySizePx({
			containerWidth,
			containerHeight,
			sizePercent: widthPercent,
			margin,
			zoomScale,
			reactToZoom,
		}),
		height: getWebcamOverlaySizePx({
			containerWidth,
			containerHeight,
			sizePercent: heightPercent,
			margin,
			zoomScale,
			reactToZoom,
		}),
	};
}

export function getWebcamOverlayPosition({
	containerWidth,
	containerHeight,
	size,
	width,
	height,
	margin,
	positionPreset,
	positionX,
	positionY,
	legacyCorner,
}: {
	containerWidth: number;
	containerHeight: number;
	size?: number;
	width?: number;
	height?: number;
	margin: number;
	positionPreset: WebcamPositionPreset;
	positionX: number;
	positionY: number;
	legacyCorner: WebcamCorner;
}): { x: number; y: number } {
	const safeMargin = Math.max(0, margin);
	const overlayWidth = Math.max(0, width ?? size ?? 0);
	const overlayHeight = Math.max(0, height ?? size ?? overlayWidth);
	const availableWidth = Math.max(0, containerWidth - overlayWidth - safeMargin * 2);
	const availableHeight = Math.max(0, containerHeight - overlayHeight - safeMargin * 2);
	const presetPosition =
		positionPreset === "custom"
			? { x: clamp(positionX, 0, 1), y: clamp(positionY, 0, 1) }
			: getWebcamPositionForPreset(positionPreset || legacyCorner);

	return {
		x: safeMargin + availableWidth * presetPosition.x,
		y: safeMargin + availableHeight * presetPosition.y,
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

export function getCropMatchedWebcamHeightPercent(
	widthPercent: number,
	heightPercent: number,
	sourceWidth: number | null | undefined,
	sourceHeight: number | null | undefined,
	cropRegion: Partial<CropRegion> | null | undefined,
): number {
	const safeWidthPercent = Number.isFinite(widthPercent) ? widthPercent : 40;
	const safeHeightPercent = Number.isFinite(heightPercent) ? heightPercent : safeWidthPercent;
	if (Math.abs(safeWidthPercent - safeHeightPercent) > 0.001) {
		return clamp(safeHeightPercent, 10, 100);
	}

	const crop = normalizeWebcamCropRegion(cropRegion);
	if (crop.x <= 0 && crop.y <= 0 && crop.width >= 1 && crop.height >= 1) {
		return clamp(safeHeightPercent, 10, 100);
	}

	const sourceAspect =
		Number.isFinite(sourceWidth) &&
		Number.isFinite(sourceHeight) &&
		sourceWidth != null &&
		sourceHeight != null &&
		sourceWidth > 0 &&
		sourceHeight > 0
			? sourceWidth / sourceHeight
			: 1;
	const cropAspect = (crop.width * sourceAspect) / Math.max(0.001, crop.height);
	if (!Number.isFinite(cropAspect) || cropAspect <= 0) {
		return clamp(safeHeightPercent, 10, 100);
	}

	return clamp(safeWidthPercent / cropAspect, 10, 100);
}
