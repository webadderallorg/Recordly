import {
	EXPORT_BITRATE_DEFAULT_CUSTOM_MBPS,
	EXPORT_BITRATE_H264_MAX_MBPS,
	EXPORT_BITRATE_HEVC_MAX_MBPS,
	EXPORT_BITRATE_MAX_MBPS,
	EXPORT_BITRATE_MIN_MBPS,
	type ExportBitrateMode,
	type ExportEncodingMode,
	type ExportMp4FrameRate,
	type ExportQuality,
	type ExportVideoCodec,
} from "./types";

const MIN_MP4_BITRATE = 2_000_000;
const REFERENCE_PIXEL_RATE = 1920 * 1080 * 30;
const REFERENCE_FRAME_RATE = 30;

export function getEncodingModeBitrateMultiplier(encodingMode: ExportEncodingMode): number {
	switch (encodingMode) {
		case "fast":
			return 0.1;
		case "quality":
			return 1;
		case "balanced":
		default:
			return 0.75;
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

function getFrameRateBitrateMultiplier(frameRate: ExportMp4FrameRate): number {
	// This only scales requestedBitrate above REFERENCE_FRAME_RATE, so 24fps
	// and 30fps share the same multiplier. useModernNativeStaticLayout can
	// still change the final bitrate because pixelRateScale uses frameRate
	// against REFERENCE_PIXEL_RATE for the native layout floor/cap.
	return Math.sqrt(Math.max(1, frameRate / REFERENCE_FRAME_RATE));
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
			getFrameRateBitrateMultiplier(options.frameRate) *
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

function getCodecCustomBitrateCapMbps(codec: ExportVideoCodec | undefined): number {
	switch (codec) {
		case "h264":
			return Math.min(EXPORT_BITRATE_H264_MAX_MBPS, EXPORT_BITRATE_MAX_MBPS);
		case "hevc":
			return Math.min(EXPORT_BITRATE_HEVC_MAX_MBPS, EXPORT_BITRATE_MAX_MBPS);
		default:
			return EXPORT_BITRATE_MAX_MBPS;
	}
}

function getCodecAutoBitrateCapBps(codec: ExportVideoCodec | undefined): number {
	if (codec === "hevc") {
		return EXPORT_BITRATE_HEVC_MAX_MBPS * 1_000_000;
	}
	// h264 and unknown codecs keep the existing auto heuristic unchanged.
	return Number.POSITIVE_INFINITY;
}

export function clampCustomBitrateMbps(mbps: number, codec?: ExportVideoCodec): number {
	if (!Number.isFinite(mbps) || Number.isNaN(mbps)) {
		return EXPORT_BITRATE_DEFAULT_CUSTOM_MBPS;
	}
	if (mbps < EXPORT_BITRATE_MIN_MBPS) {
		return EXPORT_BITRATE_MIN_MBPS;
	}
	if (mbps > getCodecCustomBitrateCapMbps(codec)) {
		return getCodecCustomBitrateCapMbps(codec);
	}
	return mbps;
}

export function customBitrateMbpsToBps(mbps: number, codec?: ExportVideoCodec): number {
	return Math.floor(clampCustomBitrateMbps(mbps, codec) * 1_000_000);
}

export function resolveExportBitrate(options: {
	mode: ExportBitrateMode;
	customMbps: number;
	width: number;
	height: number;
	frameRate: ExportMp4FrameRate;
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	useModernNativeStaticLayout?: boolean;
	codec?: ExportVideoCodec;
}): number {
	if (options.mode === "custom") {
		return customBitrateMbpsToBps(options.customMbps, options.codec);
	}
	return Math.min(getMp4ExportBitrate(options), getCodecAutoBitrateCapBps(options.codec));
}
