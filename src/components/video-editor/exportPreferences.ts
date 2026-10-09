import type {
	ExportBackendPreference,
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { isValidMp4FrameRate } from "@/lib/exporter/types";

export interface ExportPreferences {
	exportEncodingMode: ExportEncodingMode;
	exportBackendPreference: ExportBackendPreference;
	exportPipelineModel: ExportPipelineModel;
	exportQuality: ExportQuality;
	mp4FrameRate: ExportMp4FrameRate;
	exportFormat: ExportFormat;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
	publishDestination: "link" | "local";
	includeCaptionSidecar: boolean;
}

export function normalizeExportEncodingMode(value: unknown): ExportEncodingMode {
	if (value === "fast" || value === "balanced" || value === "quality") {
		return value;
	}

	return "balanced";
}

export function normalizeExportBackendPreference(value: unknown): ExportBackendPreference {
	if (value === "auto" || value === "webcodecs" || value === "breeze") {
		return value;
	}

	return "auto";
}

export function normalizeExportPipelineModel(_value: unknown): ExportPipelineModel {
	// Legacy remains available to internal smoke/export routing, but persisted
	// user selections migrate to the only pipeline exposed by the editor UI.
	return "modern";
}

export function normalizeExportMp4FrameRate(value: unknown): ExportMp4FrameRate {
	return typeof value === "number" && isValidMp4FrameRate(value) ? value : 60;
}

export function normalizeExportPreferences(raw: Partial<ExportPreferences>): ExportPreferences {
	return {
		exportEncodingMode: normalizeExportEncodingMode(raw.exportEncodingMode),
		exportBackendPreference: normalizeExportBackendPreference(raw.exportBackendPreference),
		exportPipelineModel: normalizeExportPipelineModel(raw.exportPipelineModel),
		exportQuality:
			raw.exportQuality === "medium" ||
			raw.exportQuality === "good" ||
			raw.exportQuality === "high" ||
			raw.exportQuality === "source"
				? raw.exportQuality
				: "source",
		mp4FrameRate: normalizeExportMp4FrameRate(raw.mp4FrameRate),
		exportFormat: raw.exportFormat === "gif" ? "gif" : "mp4",
		gifFrameRate:
			raw.gifFrameRate === 15 ||
			raw.gifFrameRate === 20 ||
			raw.gifFrameRate === 25 ||
			raw.gifFrameRate === 30
				? raw.gifFrameRate
				: 15,
		gifLoop: typeof raw.gifLoop === "boolean" ? raw.gifLoop : true,
		gifSizePreset:
			raw.gifSizePreset === "medium" ||
			raw.gifSizePreset === "large" ||
			raw.gifSizePreset === "original"
				? raw.gifSizePreset
				: "medium",
		publishDestination: raw.publishDestination === "local" ? "local" : "link",
		includeCaptionSidecar: raw.includeCaptionSidecar === true,
	};
}
