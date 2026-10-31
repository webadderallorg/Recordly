import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "./types";

const MIN_MP4_BITRATE = 2_000_000;
const REFERENCE_FRAME_RATE = 30;
const HD_PIXELS = 1280 * 720;
const FULL_HD_PIXELS = 1920 * 1080;
const UHD_PIXELS = 3840 * 2160;

function interpolateBitrate(
	totalPixels: number,
	startPixels: number,
	endPixels: number,
	startBitrate: number,
	endBitrate: number,
): number {
	const progress = Math.max(
		0,
		Math.min(1, (totalPixels - startPixels) / (endPixels - startPixels)),
	);
	return Math.round(startBitrate + (endBitrate - startBitrate) * progress);
}

export function getEncodingModeBitrateMultiplier(encodingMode: ExportEncodingMode): number {
	switch (encodingMode) {
		case "fast":
			return 0.5;
		case "quality":
			return 1;
		case "balanced":
		default:
			return 0.8;
	}
}

export function getSourceQualityBitrate(width: number, height: number): number {
	const totalPixels = width * height;
	if (totalPixels <= HD_PIXELS) {
		return 8_000_000;
	}
	if (totalPixels <= FULL_HD_PIXELS) {
		return 12_000_000;
	}
	if (totalPixels >= UHD_PIXELS) {
		return 45_000_000;
	}
	return interpolateBitrate(totalPixels, FULL_HD_PIXELS, UHD_PIXELS, 12_000_000, 45_000_000);
}

function getBaseMp4ExportBitrate(width: number, height: number, quality: ExportQuality): number {
	if (quality === "source") {
		return getSourceQualityBitrate(width, height);
	}

	const totalPixels = width * height;
	if (totalPixels <= HD_PIXELS) {
		return 5_000_000;
	}
	if (totalPixels <= FULL_HD_PIXELS) {
		return 8_000_000;
	}
	if (totalPixels >= UHD_PIXELS) {
		return 35_000_000;
	}
	return interpolateBitrate(totalPixels, FULL_HD_PIXELS, UHD_PIXELS, 8_000_000, 35_000_000);
}

function getFrameRateBitrateMultiplier(frameRate: ExportMp4FrameRate): number {
	// This only scales requestedBitrate above REFERENCE_FRAME_RATE, so 24fps
	// and 30fps share the same multiplier. useModernNativeStaticLayout can
	// still change the final bitrate because pixelRateScale uses frameRate
	// against REFERENCE_PIXEL_RATE for the native layout floor/cap.
	return Math.sqrt(Math.max(1, frameRate / REFERENCE_FRAME_RATE));
}

export function getMp4ExportBitrate(options: {
	width: number;
	height: number;
	frameRate: ExportMp4FrameRate;
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	useModernNativeStaticLayout?: boolean;
}): number {
	const requestedBitrate = Math.round(
		getBaseMp4ExportBitrate(options.width, options.height, options.quality) *
			getFrameRateBitrateMultiplier(options.frameRate) *
			getEncodingModeBitrateMultiplier(options.encodingMode),
	);

	// Keep every backend on the same delivery bitrate policy. Native static-layout
	// exports previously applied a second set of floors and caps that could more
	// than double the requested web-delivery target.
	return Math.max(MIN_MP4_BITRATE, requestedBitrate);
}
