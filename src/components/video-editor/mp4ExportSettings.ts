import type {
	ExportBitrateMode,
	ExportEncoderPreference,
	ExportEncodingMode,
	ExportMp4FrameRate,
	ExportQuality,
	ExportSettings,
	ExportVideoCodec,
} from "@/lib/exporter";
import type { SmokeExportConfig } from "./smokeExportConfig";

export type ResolvedMp4ExportSettings = {
	quality: ExportQuality;
	encodingMode: ExportEncodingMode;
	selectedMp4FrameRate: ExportMp4FrameRate;
	exportVideoCodec: ExportVideoCodec;
	exportEncoderPreference: ExportEncoderPreference;
	exportBitrateMode: ExportBitrateMode;
	exportBitrateMbps: number;
};

const DEFAULT_VIDEO_CODEC: ExportVideoCodec = "h264";
const DEFAULT_ENCODER_PREFERENCE: ExportEncoderPreference = "auto";
const DEFAULT_BITRATE_MODE: ExportBitrateMode = "auto";
const DEFAULT_CUSTOM_MBPS = 20;

function normalizeBitrateMbps(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) {
		return DEFAULT_CUSTOM_MBPS;
	}
	return Math.min(200, Math.max(1, value));
}

export function resolveMp4ExportSettings({
	smokeExportConfig,
	settings,
	exportQuality,
	exportEncodingMode,
	mp4FrameRate,
	exportVideoCodec,
	exportEncoderPreference,
	exportBitrateMode,
	exportBitrateMbps,
}: {
	smokeExportConfig: Pick<
		SmokeExportConfig,
		| "enabled"
		| "quality"
		| "encodingMode"
		| "fps"
		| "videoCodec"
		| "encoderPreference"
		| "bitrateMode"
		| "bitrateMbps"
	>;
	settings: Pick<
		ExportSettings,
		| "quality"
		| "encodingMode"
		| "mp4FrameRate"
		| "exportVideoCodec"
		| "exportEncoderPreference"
		| "exportBitrateMode"
		| "exportBitrateMbps"
	>;
	exportQuality: ExportQuality;
	exportEncodingMode: ExportEncodingMode;
	mp4FrameRate: ExportMp4FrameRate;
	exportVideoCodec: ExportVideoCodec;
	exportEncoderPreference: ExportEncoderPreference;
	exportBitrateMode: ExportBitrateMode;
	exportBitrateMbps: number;
}): ResolvedMp4ExportSettings {
	return {
		quality: smokeExportConfig.enabled
			? (smokeExportConfig.quality ?? settings.quality ?? exportQuality)
			: (settings.quality ?? exportQuality),
		encodingMode: smokeExportConfig.enabled
			? (smokeExportConfig.encodingMode ?? settings.encodingMode ?? exportEncodingMode)
			: (settings.encodingMode ?? exportEncodingMode),
		selectedMp4FrameRate: smokeExportConfig.enabled
			? (smokeExportConfig.fps ?? settings.mp4FrameRate ?? mp4FrameRate)
			: (settings.mp4FrameRate ?? mp4FrameRate),
		exportVideoCodec: smokeExportConfig.enabled
			? (smokeExportConfig.videoCodec ??
				settings.exportVideoCodec ??
				exportVideoCodec ??
				DEFAULT_VIDEO_CODEC)
			: (settings.exportVideoCodec ?? exportVideoCodec ?? DEFAULT_VIDEO_CODEC),
		exportEncoderPreference: smokeExportConfig.enabled
			? (smokeExportConfig.encoderPreference ??
				settings.exportEncoderPreference ??
				exportEncoderPreference ??
				DEFAULT_ENCODER_PREFERENCE)
			: (settings.exportEncoderPreference ??
				exportEncoderPreference ??
				DEFAULT_ENCODER_PREFERENCE),
		exportBitrateMode: smokeExportConfig.enabled
			? (smokeExportConfig.bitrateMode ??
				settings.exportBitrateMode ??
				exportBitrateMode ??
				DEFAULT_BITRATE_MODE)
			: (settings.exportBitrateMode ?? exportBitrateMode ?? DEFAULT_BITRATE_MODE),
		exportBitrateMbps: smokeExportConfig.enabled
			? (smokeExportConfig.bitrateMbps ??
				settings.exportBitrateMbps ??
				normalizeBitrateMbps(exportBitrateMbps))
			: (settings.exportBitrateMbps ?? normalizeBitrateMbps(exportBitrateMbps)),
	};
}
