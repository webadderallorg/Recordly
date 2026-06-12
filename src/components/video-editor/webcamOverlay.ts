import {
	type CropRegion,
	DEFAULT_WEBCAM_COLOR,
	DEFAULT_WEBCAM_GREENSCREEN,
	DEFAULT_WEBCAM_MASK,
	type WebcamColorSettings,
	type WebcamCorner,
	type WebcamGreenscreenSettings,
	type WebcamMaskPoint,
	type WebcamMaskSettings,
	type WebcamPositionPreset,
} from "./types";

const MIN_WEBCAM_OVERLAY_SIZE_PX = 56;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
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

export function getWebcamOverlayPosition({
	containerWidth,
	containerHeight,
	size,
	margin,
	positionPreset,
	positionX,
	positionY,
	legacyCorner,
}: {
	containerWidth: number;
	containerHeight: number;
	size: number;
	margin: number;
	positionPreset: WebcamPositionPreset;
	positionX: number;
	positionY: number;
	legacyCorner: WebcamCorner;
}): { x: number; y: number } {
	const safeMargin = Math.max(0, margin);
	const availableWidth = Math.max(0, containerWidth - size - safeMargin * 2);
	const availableHeight = Math.max(0, containerHeight - size - safeMargin * 2);
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

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function normalizeWebcamGreenscreen(
	value?: Partial<WebcamGreenscreenSettings> | null,
): WebcamGreenscreenSettings {
	const candidate = value ?? {};
	return {
		enabled:
			typeof candidate.enabled === "boolean"
				? candidate.enabled
				: DEFAULT_WEBCAM_GREENSCREEN.enabled,
		keyColor:
			typeof candidate.keyColor === "string" && HEX_COLOR_PATTERN.test(candidate.keyColor)
				? candidate.keyColor.toLowerCase()
				: DEFAULT_WEBCAM_GREENSCREEN.keyColor,
		keyColor2:
			typeof candidate.keyColor2 === "string" && HEX_COLOR_PATTERN.test(candidate.keyColor2)
				? candidate.keyColor2.toLowerCase()
				: null,
		backgroundImagePath:
			typeof candidate.backgroundImagePath === "string" && candidate.backgroundImagePath
				? candidate.backgroundImagePath
				: null,
		keyStrength: Number.isFinite(candidate.keyStrength)
			? clamp(candidate.keyStrength as number, 0, 1)
			: DEFAULT_WEBCAM_GREENSCREEN.keyStrength,
		edgeSoftness: Number.isFinite(candidate.edgeSoftness)
			? clamp(candidate.edgeSoftness as number, 0, 1)
			: DEFAULT_WEBCAM_GREENSCREEN.edgeSoftness,
	};
}

/**
 * Normalizes one pen-mask anchor: x/y clamped to 0..1, each bezier handle
 * kept (clamped) only when both of its coordinates are finite, omitted
 * otherwise so corner points stay plain `{ x, y }` objects.
 */
function normalizeWebcamMaskPoint(point: WebcamMaskPoint): WebcamMaskPoint {
	const normalized: WebcamMaskPoint = {
		x: clamp(point.x, 0, 1),
		y: clamp(point.y, 0, 1),
	};
	if (Number.isFinite(point.inX) && Number.isFinite(point.inY)) {
		normalized.inX = clamp(point.inX as number, 0, 1);
		normalized.inY = clamp(point.inY as number, 0, 1);
	}
	if (Number.isFinite(point.outX) && Number.isFinite(point.outY)) {
		normalized.outX = clamp(point.outX as number, 0, 1);
		normalized.outY = clamp(point.outY as number, 0, 1);
	}
	return normalized;
}

export function normalizeWebcamMask(
	value?: Partial<WebcamMaskSettings> | null,
): WebcamMaskSettings {
	const candidate = value ?? {};
	const points = Array.isArray(candidate.points)
		? candidate.points
				.filter(
					(point): point is WebcamMaskPoint =>
						typeof point === "object" &&
						point !== null &&
						Number.isFinite((point as { x?: unknown }).x) &&
						Number.isFinite((point as { y?: unknown }).y),
				)
				.map(normalizeWebcamMaskPoint)
		: [...DEFAULT_WEBCAM_MASK.points];
	return {
		enabled:
			typeof candidate.enabled === "boolean"
				? candidate.enabled
				: DEFAULT_WEBCAM_MASK.enabled,
		shape:
			candidate.shape === "rect" || candidate.shape === "polygon"
				? candidate.shape
				: DEFAULT_WEBCAM_MASK.shape,
		rect: normalizeWebcamCropRegion(candidate.rect),
		cornerRadius: Number.isFinite(candidate.cornerRadius)
			? clamp(candidate.cornerRadius as number, 0, 1)
			: DEFAULT_WEBCAM_MASK.cornerRadius,
		feather: Number.isFinite(candidate.feather)
			? clamp(candidate.feather as number, 0, 1)
			: DEFAULT_WEBCAM_MASK.feather,
		points,
	};
}

export function normalizeWebcamColor(
	value?: Partial<WebcamColorSettings> | null,
): WebcamColorSettings {
	const candidate = value ?? {};
	const normalizeChannel = (raw: unknown, fallback: number) =>
		Number.isFinite(raw) ? clamp(raw as number, -1, 1) : fallback;
	return {
		brightness: normalizeChannel(candidate.brightness, DEFAULT_WEBCAM_COLOR.brightness),
		contrast: normalizeChannel(candidate.contrast, DEFAULT_WEBCAM_COLOR.contrast),
		highlights: normalizeChannel(candidate.highlights, DEFAULT_WEBCAM_COLOR.highlights),
		shadows: normalizeChannel(candidate.shadows, DEFAULT_WEBCAM_COLOR.shadows),
		temperature: normalizeChannel(candidate.temperature, DEFAULT_WEBCAM_COLOR.temperature),
		saturation: normalizeChannel(candidate.saturation, DEFAULT_WEBCAM_COLOR.saturation),
	};
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
