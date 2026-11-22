import {
	type ExportBackendPreference,
	type ExportEncodingMode,
	type ExportMp4FrameRate,
	type ExportPipelineModel,
	type ExportQuality,
	type ExportRenderBackend,
	isValidMp4FrameRate,
} from "@/lib/exporter/types";

export type SmokeExportConfig = {
	enabled: boolean;
	inputPath: string | null;
	outputPath: string | null;
	useNativeExport: boolean;
	encodingMode?: ExportEncodingMode;
	shadowIntensity?: number;
	webcamInputPath?: string | null;
	webcamShadow?: number;
	webcamSize?: number;
	pipelineModel?: ExportPipelineModel;
	backendPreference?: ExportBackendPreference;
	renderBackend?: ExportRenderBackend;
	maxEncodeQueue?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	projectPath?: string | null;
	quality?: ExportQuality;
	fps?: ExportMp4FrameRate;
};

export type DevOpenRecordingConfig = {
	inputPath: string | null;
	webcamInputPath: string | null;
};

function parseSmokeExportNumber(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseSmokeExportNonNegativeNumber(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}

	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseSmokeExportQuality(value: string | null): ExportQuality | undefined {
	if (value === "medium" || value === "good" || value === "high" || value === "source") {
		return value;
	}
	return undefined;
}

function parseSmokeExportFps(value: string | null): ExportMp4FrameRate | undefined {
	if (value === null) return undefined;
	const parsed = Number.parseInt(value, 10);
	return isValidMp4FrameRate(parsed) ? parsed : undefined;
}

function parseSmokeRenderBackend(value: string | null): ExportRenderBackend | undefined {
	return value === "webgl" || value === "webgpu" ? value : undefined;
}

export function getSmokeExportConfig(search: string): SmokeExportConfig {
	const params = new URLSearchParams(search);
	const enabled = params.get("smokeExport") === "1";

	return {
		enabled,
		inputPath: enabled ? params.get("smokeInput") : null,
		outputPath: enabled ? params.get("smokeOutput") : null,
		useNativeExport: enabled ? params.get("smokeUseNativeExport") === "1" : false,
		encodingMode:
			enabled && params.get("smokeEncodingMode") === "fast"
				? "fast"
				: enabled && params.get("smokeEncodingMode") === "balanced"
					? "balanced"
					: enabled && params.get("smokeEncodingMode") === "quality"
						? "quality"
						: undefined,
		shadowIntensity: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeShadowIntensity"))
			: undefined,
		webcamInputPath: enabled ? params.get("smokeWebcamInput") : null,
		webcamShadow: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamShadow"))
			: undefined,
		webcamSize: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamSize"))
			: undefined,
		pipelineModel:
			enabled && params.get("smokePipelineModel") === "modern"
				? "modern"
				: enabled && params.get("smokePipelineModel") === "legacy"
					? "legacy"
					: undefined,
		backendPreference:
			enabled && params.get("smokeBackendPreference") === "auto"
				? "auto"
				: enabled && params.get("smokeBackendPreference") === "webcodecs"
					? "webcodecs"
					: enabled && params.get("smokeBackendPreference") === "breeze"
						? "breeze"
						: undefined,
		renderBackend: enabled
			? parseSmokeRenderBackend(params.get("smokeRenderBackend"))
			: undefined,
		maxEncodeQueue: enabled
			? parseSmokeExportNumber(params.get("smokeMaxEncodeQueue"))
			: undefined,
		maxDecodeQueue: enabled
			? parseSmokeExportNumber(params.get("smokeMaxDecodeQueue"))
			: undefined,
		maxPendingFrames: enabled
			? parseSmokeExportNumber(params.get("smokeMaxPendingFrames"))
			: undefined,
		projectPath: enabled ? params.get("smokeProject") : null,
		quality: enabled ? parseSmokeExportQuality(params.get("smokeQuality")) : undefined,
		fps: enabled ? parseSmokeExportFps(params.get("smokeFps")) : undefined,
	};
}

export function getDevOpenRecordingConfig(search: string): DevOpenRecordingConfig {
	const params = new URLSearchParams(search);
	return {
		inputPath: params.get("devOpenInput"),
		webcamInputPath: params.get("devOpenWebcam"),
	};
}
