import type { ExportEncodingMode, ExportMp4FrameRate, ExportQuality } from "./types";

const MIN_MP4_BITRATE = 2_000_000;
const REFERENCE_PIXEL_RATE = 1920 * 1080 * 30;

export function getEncodingModeBitrateMultiplier(encodingMode: ExportEncodingMode): number {
	switch (encodingMode) {
		case "fast":
			return 0.1;
		case "quality":
			return 0.9;
		case "balanced":
		default:
			return 0.5;
	}
}

export function getSourceQualityBitrate(width: number, height: number): number {
	const totalPixels = width * height;
	if (totalPixels > 2560 * 1440) {
		return 80_000_000;
	}
	if (totalPixels > 1920 * 1080) {
		return 50_000_000;
	}
	return 30_000_000;
}

function getBaseMp4ExportBitrate(width: number, height: number, quality: ExportQuality): number {
	if (quality === "source") {
		return getSourceQualityBitrate(width, height);
	}

	const totalPixels = width * height;
	if (totalPixels <= 1280 * 720) {
		return 10_000_000;
	}
	if (totalPixels <= 1920 * 1080) {
		return 20_000_000;
	}
	return 30_000_000;
}

function getModernNativeStaticLayoutBitrateCap(
	width: number,
	height: number,
	frameRate: ExportMp4FrameRate,
	quality: ExportQuality,
): number {
	const referenceCap =
		quality === "source"
			? 36_000_000
			: quality === "high"
				? 28_000_000
				: quality === "good"
					? 20_000_000
					: 14_000_000;
	const pixelRateScale = Math.max((width * height * frameRate) / REFERENCE_PIXEL_RATE, 0.1);
	return Math.round(referenceCap * Math.sqrt(pixelRateScale));
}

function getModernNativeStaticLayoutBitrateFloor(
	width: number,
	height: number,
	frameRate: ExportMp4FrameRate,
	quality: ExportQuality,
): number {
	const referenceFloor =
		quality === "source"
			? 22_000_000
			: quality === "high"
				? 16_000_000
				: quality === "good"
					? 12_000_000
					: 8_000_000;
	const pixelRateScale = Math.max((width * height * frameRate) / REFERENCE_PIXEL_RATE, 0.1);
	return Math.round(referenceFloor * Math.sqrt(pixelRateScale));
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
			getEncodingModeBitrateMultiplier(options.encodingMode),
	);
	const nativeStaticLayoutBitrate =
		options.useModernNativeStaticLayout && options.encodingMode !== "fast"
			? Math.max(
					requestedBitrate,
					getModernNativeStaticLayoutBitrateFloor(
						options.width,
						options.height,
						options.frameRate,
						options.quality,
					),
				)
			: requestedBitrate;
	const cappedBitrate = options.useModernNativeStaticLayout
		? Math.min(
				nativeStaticLayoutBitrate,
				getModernNativeStaticLayoutBitrateCap(
					options.width,
					options.height,
					options.frameRate,
					options.quality,
				),
			)
		: requestedBitrate;

	return Math.max(MIN_MP4_BITRATE, cappedBitrate);
}
