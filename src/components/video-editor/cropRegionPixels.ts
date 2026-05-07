import type { CropRegion } from "./types";

export interface CropRegionPixels {
	x: number;
	y: number;
	width: number;
	height: number;
}

const DEFAULT_SOURCE_WIDTH = 1920;
const DEFAULT_SOURCE_HEIGHT = 1080;
const MIN_CROP_RATIO = 0.01;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizeSourceDimension(value: number, fallback: number) {
	return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function normalizePixelValue(value: number) {
	return Number.isFinite(value) ? Math.round(value) : 0;
}

export function getCropSourceDimensions(videoElement: HTMLVideoElement | null) {
	return {
		width: normalizeSourceDimension(videoElement?.videoWidth ?? 0, DEFAULT_SOURCE_WIDTH),
		height: normalizeSourceDimension(videoElement?.videoHeight ?? 0, DEFAULT_SOURCE_HEIGHT),
	};
}

export function cropRegionToPixels(
	cropRegion: CropRegion,
	sourceWidth: number,
	sourceHeight: number,
): CropRegionPixels {
	const width = normalizeSourceDimension(sourceWidth, DEFAULT_SOURCE_WIDTH);
	const height = normalizeSourceDimension(sourceHeight, DEFAULT_SOURCE_HEIGHT);

	const x = clamp(Math.round(cropRegion.x * width), 0, width - 1);
	const y = clamp(Math.round(cropRegion.y * height), 0, height - 1);
	return {
		x,
		y,
		width: clamp(Math.round(cropRegion.width * width), 1, width - x),
		height: clamp(Math.round(cropRegion.height * height), 1, height - y),
	};
}

export function cropRegionFromPixels(
	pixels: CropRegionPixels,
	sourceWidth: number,
	sourceHeight: number,
): CropRegion {
	const width = normalizeSourceDimension(sourceWidth, DEFAULT_SOURCE_WIDTH);
	const height = normalizeSourceDimension(sourceHeight, DEFAULT_SOURCE_HEIGHT);
	const minWidth = Math.max(1, Math.ceil(width * MIN_CROP_RATIO));
	const minHeight = Math.max(1, Math.ceil(height * MIN_CROP_RATIO));

	const x = clamp(normalizePixelValue(pixels.x), 0, width - minWidth);
	const y = clamp(normalizePixelValue(pixels.y), 0, height - minHeight);
	const cropWidth = clamp(normalizePixelValue(pixels.width), minWidth, width - x);
	const cropHeight = clamp(normalizePixelValue(pixels.height), minHeight, height - y);

	return {
		x: x / width,
		y: y / height,
		width: cropWidth / width,
		height: cropHeight / height,
	};
}
