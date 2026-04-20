import type { Dispatch, SetStateAction } from "react";
import type {
	ExportBackendPreference,
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportProgress,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter";
import { toFileUrl } from "../projectPersistence";
import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomRegion,
	ZoomTransitionEasing,
} from "../types";
import type { SmokeExportConfig } from "../videoEditorUtils";

export type RenderConfig = {
	videoPath: string | null;
	wallpaper: string;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur: number;
	connectZooms: boolean;
	zoomInDurationMs: number;
	zoomInOverlapMs: number;
	zoomOutDurationMs: number;
	connectedZoomGapMs: number;
	connectedZoomDurationMs: number;
	zoomInEasing: ZoomTransitionEasing;
	zoomOutEasing: ZoomTransitionEasing;
	connectedZoomEasing: ZoomTransitionEasing;
	showCursor: boolean;
	cursorStyle: CursorStyle;
	effectiveCursorTelemetry: CursorTelemetryPoint[];
	cursorSize: number;
	cursorSmoothing: number;
	zoomSmoothness: number;
	zoomClassicMode: boolean;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
	cursorSway: number;
	audioRegions: AudioRegion[];
	sourceAudioFallbackPaths: string[];
	exportEncodingMode: ExportEncodingMode;
	exportBackendPreference: ExportBackendPreference;
	exportPipelineModel: ExportPipelineModel;
	borderRadius: number;
	padding: number;
	cropRegion: CropRegion;
	webcam: WebcamOverlaySettings;
	resolvedWebcamVideoUrl: string | null;
	annotationRegions: AnnotationRegion[];
	autoCaptions: CaptionCue[];
	autoCaptionSettings: AutoCaptionSettings;
	isPlaying: boolean;
	exportQuality: ExportQuality;
	effectiveZoomRegions: ZoomRegion[];
	effectiveSpeedRegions: SpeedRegion[];
	trimRegions: TrimRegion[];
	mp4FrameRate: ExportMp4FrameRate;
	frame: string | null;
	exportFormat: ExportFormat;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
};

export type CancelableExporter = { cancel(): void };
export type PendingExportSave = { fileName: string; arrayBuffer: ArrayBuffer };

export interface SmokeProgressTracker {
	progressSamples: Array<Record<string, unknown>>;
	record(progress: ExportProgress): void;
}

export function createSmokeProgressTracker(
	smokeExportConfig: SmokeExportConfig,
	smokeExportStartedAt: number | null,
	setExportProgress: Dispatch<SetStateAction<ExportProgress | null>>,
): SmokeProgressTracker {
	const progressSamples: Array<Record<string, unknown>> = [];
	let lastSampleAt = 0;
	let lastPhase: ExportProgress["phase"] | undefined;

	return {
		progressSamples,
		record(progress: ExportProgress) {
			setExportProgress(progress);
			if (!smokeExportConfig.enabled || smokeExportStartedAt === null) {
				return;
			}

			const now = performance.now();
			const phase = progress.phase ?? "extracting";
			const shouldSample =
				progressSamples.length === 0 ||
				phase !== lastPhase ||
				now - lastSampleAt >= 1000 ||
				progress.currentFrame >= progress.totalFrames;
			if (!shouldSample) {
				return;
			}

			progressSamples.push({
				elapsedMs: Math.round(now - smokeExportStartedAt),
				phase,
				currentFrame: progress.currentFrame,
				totalFrames: progress.totalFrames,
				percentage: progress.percentage,
				estimatedTimeRemaining: progress.estimatedTimeRemaining,
				renderFps: progress.renderFps,
				renderBackend: progress.renderBackend,
				encodeBackend: progress.encodeBackend,
				encoderName: progress.encoderName,
			});
			lastSampleAt = now;
			lastPhase = phase;
		},
	};
}

export function resolveWebcamUrl(config: RenderConfig): string | null {
	return (
		config.resolvedWebcamVideoUrl ??
		(config.webcam.sourcePath ? toFileUrl(config.webcam.sourcePath) : null)
	);
}