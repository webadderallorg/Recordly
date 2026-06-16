import {
	calculateOutputDimensions,
	type ExportBackendPreference,
	type ExportEncodingMode,
	type ExportFormat,
	type ExportMp4FrameRate,
	type ExportPipelineModel,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	type GifFrameRate,
	type GifSizePreset,
} from "@/lib/exporter";

export function resolveExportStartSettings({
	sourceWidth,
	sourceHeight,
	exportFormat,
	includeCaptionSidecar,
	exportEncodingMode,
	exportQuality,
	mp4FrameRate,
	exportBackendPreference,
	exportPipelineModel,
	gifFrameRate,
	gifLoop,
	gifSizePreset,
}: {
	sourceWidth: number;
	sourceHeight: number;
	exportFormat: ExportFormat;
	includeCaptionSidecar: boolean;
	exportEncodingMode: ExportEncodingMode;
	exportQuality: ExportQuality;
	mp4FrameRate: ExportMp4FrameRate;
	exportBackendPreference: ExportBackendPreference;
	exportPipelineModel: ExportPipelineModel;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
}): ExportSettings {
	const gifDimensions =
		exportFormat === "gif"
			? calculateOutputDimensions(sourceWidth, sourceHeight, gifSizePreset, GIF_SIZE_PRESETS)
			: null;

	return {
		format: exportFormat,
		includeCaptionSidecar: exportFormat === "mp4" ? includeCaptionSidecar : false,
		encodingMode: exportFormat === "mp4" ? exportEncodingMode : undefined,
		mp4FrameRate: exportFormat === "mp4" ? mp4FrameRate : undefined,
		backendPreference: exportFormat === "mp4" ? exportBackendPreference : undefined,
		pipelineModel: exportFormat === "mp4" ? exportPipelineModel : undefined,
		quality: exportFormat === "mp4" ? exportQuality : undefined,
		gifConfig:
			exportFormat === "gif" && gifDimensions
				? {
						frameRate: gifFrameRate,
						loop: gifLoop,
						sizePreset: gifSizePreset,
						width: gifDimensions.width,
						height: gifDimensions.height,
					}
				: undefined,
	};
}
