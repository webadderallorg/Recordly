import type { ExportFormat, ExportPipelineModel, ExportProgress } from "@/lib/exporter";

export type ExportStatusModel = {
	isExportSaving: boolean;
	isExportPreparing: boolean;
	isExportFinalizing: boolean;
	isRenderingAudio: boolean;
	exportFinalizingProgress: number | null;
	exportFinalizingPercent: number | null;
	isExportMuxingAndSaving: boolean;
	isExportFinalSaveIndeterminate: boolean;
	isLightningExportInProgress: boolean;
	shouldSuspendPreviewRendering: boolean;
	isLegacyExportInProgress: boolean;
	renderSpeedFps: string | null;
	runtimeLabel: string | null;
	nativeSkipReasons: string[];
	nativeSkipLabel: string | null;
};

const NATIVE_SKIP_REASON_LABELS: Record<string, string> = {
	"native-static-api-unavailable": "native export API unavailable",
	"odd-output-dimensions": "output dimensions are not even",
	"unsupported-background-video": "video background",
	"unsupported-cursor-click-effect": "cursor click effect",
	"unsupported-cursor-motion-blur": "cursor motion blur",
	"unsupported-extension-hook": "extension render hook",
	"unsupported-annotation-overlay": "annotation overlay",
	"unsupported-blur-annotation-overlay": "blur annotation overlay",
	"unsupported-caption-overlay": "caption overlay",
	"unsupported-frame-overlay": "frame overlay",
	"unsupported-webcam-source": "webcam source",
	"unsupported-rectangular-webcam-overlay": "rectangular webcam overlay",
	"unsupported-motion-blur": "zoom motion blur",
	"unsupported-temporal-motion-blur": "temporal zoom motion blur",
	"unsupported-motion-blur-on-overlay-route": "zoom motion blur over overlay layers",
	"unsupported-native-speed-timeline": "speed timeline",
	"unsupported-native-trim-timeline": "trim timeline",
	"native-timeline-requires-windows-gpu": "timeline requires Windows GPU export",
	"native-zoom-requires-windows-gpu": "zoom requires Windows GPU export",
	"overlay-layers-do-not-support-native-timeline": "overlay timeline mapping",
	"native-overlay-preparation-failed": "native overlay preparation",
	"invalid-crop-region": "invalid crop region",
	"missing-source-path": "source path unavailable",
	"missing-audio-options": "audio options unavailable",
	"unsupported-background": "background",
	"cursor-atlas-unavailable": "cursor atlas unavailable",
	"invalid-native-speed-timeline": "invalid speed timeline",
	"invalid-native-trim-timeline": "invalid trim timeline",
	"invalid-layout-or-duration": "invalid layout or duration",
};

export function formatNativeSkipReason(reason: string): string {
	const baseReason = reason.split(":", 1)[0];
	return NATIVE_SKIP_REASON_LABELS[baseReason] ?? reason;
}

export function resolveExportStatusModel({
	isExporting,
	exportProgress,
	exportFormat,
	exportPipelineModel,
}: {
	isExporting: boolean;
	exportProgress: ExportProgress | null;
	exportFormat: ExportFormat;
	exportPipelineModel: ExportPipelineModel;
}): ExportStatusModel {
	const isExportSaving = exportProgress?.phase === "saving";
	const isExportPreparing =
		isExporting && (!exportProgress || exportProgress.phase === "preparing");
	const isExportFinalizing = exportProgress?.phase === "finalizing";
	const isRenderingAudio =
		isExportFinalizing && typeof exportProgress?.audioProgress === "number";
	const rawFinalizingProgress =
		typeof exportProgress?.renderProgress === "number"
			? exportProgress.renderProgress
			: (exportProgress?.percentage ?? 100);
	const exportFinalizingProgress = isExportFinalizing
		? Math.max(
				0,
				Math.min(100, Number.isFinite(rawFinalizingProgress) ? rawFinalizingProgress : 0),
			)
		: null;
	const exportFinalizingPercent = isExportFinalizing
		? Math.round(exportFinalizingProgress ?? 100)
		: null;
	const isExportMuxingAndSaving =
		isExportFinalizing &&
		exportFormat === "mp4" &&
		exportPipelineModel === "modern" &&
		!isRenderingAudio;
	const isExportFinalSaveIndeterminate =
		isExportMuxingAndSaving && (exportFinalizingPercent ?? 0) >= 98;
	const isLightningExportInProgress =
		exportFormat === "mp4" &&
		exportPipelineModel === "modern" &&
		(isExporting || exportProgress !== null);
	const shouldSuspendPreviewRendering =
		isExporting && exportFormat === "mp4" && exportPipelineModel === "modern";
	const isLegacyExportInProgress =
		exportFormat === "mp4" &&
		exportPipelineModel === "legacy" &&
		(isExporting || exportProgress !== null);
	const renderSpeedFps =
		!isExportPreparing &&
		!isExportFinalizing &&
		!isExportSaving &&
		typeof exportProgress?.renderFps === "number" &&
		Number.isFinite(exportProgress.renderFps) &&
		exportProgress.renderFps > 0
			? exportProgress.renderFps.toFixed(1)
			: null;
	const runtimeLabel = resolveRuntimeLabel(exportProgress);
	const nativeSkipReasons =
		exportProgress?.nativeStaticLayoutSkipReasons &&
		exportProgress.nativeStaticLayoutSkipReasons.length > 0
			? exportProgress.nativeStaticLayoutSkipReasons
			: exportProgress?.nativeStaticLayoutSkipReason
				? [exportProgress.nativeStaticLayoutSkipReason]
				: [];
	const nativeSkipLabel =
		nativeSkipReasons.length > 0
			? `Native skipped: ${nativeSkipReasons.map(formatNativeSkipReason).join("; ")}`
			: null;

	return {
		isExportSaving,
		isExportPreparing,
		isExportFinalizing,
		isRenderingAudio,
		exportFinalizingProgress,
		exportFinalizingPercent,
		isExportMuxingAndSaving,
		isExportFinalSaveIndeterminate,
		isLightningExportInProgress,
		shouldSuspendPreviewRendering,
		isLegacyExportInProgress,
		renderSpeedFps,
		runtimeLabel,
		nativeSkipReasons,
		nativeSkipLabel,
	};
}

function resolveRuntimeLabel(exportProgress: ExportProgress | null): string | null {
	const renderBackend = exportProgress?.renderBackend;
	const encodeBackend = exportProgress?.encodeBackend;
	const encoderName = exportProgress?.encoderName;

	if (!renderBackend && !encodeBackend && !encoderName) {
		return null;
	}

	// The NVIDIA CUDA compositor is a distinct native backend; it must never be
	// mislabeled as Breeze (the FFmpeg CLI encoder) in export status.
	if (encoderName === "nvidia-cuda-compositor") {
		return "NVIDIA CUDA compositor";
	}
	if (encoderName === "windows-d3d11-compositor") {
		return "Windows D3D11 compositor";
	}

	const rendererLabel =
		renderBackend === "webgpu" ? "WebGPU" : renderBackend === "webgl" ? "WebGL" : null;
	const encoderLabel =
		encodeBackend === "ffmpeg" ? "Breeze" : encodeBackend === "webcodecs" ? "WebCodecs" : null;
	const pathLabel =
		rendererLabel && encoderLabel
			? `${rendererLabel} + ${encoderLabel}`
			: (rendererLabel ?? encoderLabel);

	if (!pathLabel) {
		return encoderName ?? null;
	}

	return encoderName ? `${pathLabel} (${encoderName})` : pathLabel;
}
