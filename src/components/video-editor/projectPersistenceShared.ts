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
import { isValidMp4FrameRate } from "@/lib/exporter";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CropRegion,
	CursorStyle,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomRegion,
	ZoomTransitionEasing,
} from "./types";

export const PROJECT_VERSION = 1;

export interface ProjectEditorState {
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
	loopCursor: boolean;
	cursorStyle: CursorStyle;
	cursorSize: number;
	cursorSmoothing: number;
	zoomSmoothness: number;
	zoomClassicMode: boolean;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
	cursorSway: number;
	borderRadius: number;
	padding: number;
	frame: string | null;
	cropRegion: CropRegion;
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	autoCaptionSettings: AutoCaptionSettings;
	webcam: WebcamOverlaySettings;
	aspectRatio: AspectRatio;
	exportEncodingMode: ExportEncodingMode;
	exportBackendPreference: ExportBackendPreference;
	exportPipelineModel: ExportPipelineModel;
	exportQuality: ExportQuality;
	mp4FrameRate: ExportMp4FrameRate;
	exportFormat: ExportFormat;
	gifFrameRate: GifFrameRate;
	gifLoop: boolean;
	gifSizePreset: GifSizePreset;
}

export interface EditorProjectData {
	version: number;
	videoPath: string;
	editor: Partial<ProjectEditorState>;
}

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
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

export function normalizeExportPipelineModel(value: unknown): ExportPipelineModel {
	if (value === "modern" || value === "legacy") {
		return value;
	}

	return "legacy";
}

export function normalizeExportMp4FrameRate(value: unknown): ExportMp4FrameRate {
	return typeof value === "number" && isValidMp4FrameRate(value) ? value : 30;
}