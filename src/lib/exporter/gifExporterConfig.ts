import type { CursorIdleHideSettings } from "@/components/video-editor/videoPlayback/cursorIdleVisibility";
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomMotionBlurTuning,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import type { ExportProgress, GIF_SIZE_PRESETS, GifFrameRate, GifSizePreset } from "./types";

export interface GifExporterConfig {
	clipRegions?: import("@/components/video-editor/types").ClipRegion[];
	videoUrl: string;
	width: number;
	height: number;
	frameRate: GifFrameRate;
	loop: boolean;
	sizePreset: GifSizePreset;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
	zoomMotionBlurTuning?: ZoomMotionBlurTuning;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomInOverlapMs?: number;
	zoomOutDurationMs?: number;
	connectedZoomGapMs?: number;
	connectedZoomDurationMs?: number;
	zoomInEasing?: ZoomTransitionEasing;
	zoomOutEasing?: ZoomTransitionEasing;
	connectedZoomEasing?: ZoomTransitionEasing;
	borderRadius?: number;
	padding?: Padding | number;
	videoPadding?: Padding | number;
	cropRegion: CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamUrl?: string | null;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	cursorStyle?: CursorStyle;
	cursorSize?: number;
	cursorSmoothing?: number;
	cursorSpringStiffnessMultiplier?: number;
	cursorSpringDampingMultiplier?: number;
	cursorSpringMassMultiplier?: number;
	cameraSpringStiffnessMultiplier?: number;
	cameraSpringDampingMultiplier?: number;
	cameraSpringMassMultiplier?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	cursorMotionBlur?: number;
	cursorClickEffect?: CursorClickEffectStyle;
	cursorClickEffectColor?: string;
	cursorClickEffectScale?: number;
	cursorClickEffectOpacity?: number;
	cursorClickEffectDurationMs?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	cursorIdleHide?: CursorIdleHideSettings;
	previewWidth?: number;
	previewHeight?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	onProgress?: (progress: ExportProgress) => void;
}

/**
 * Calculate output dimensions based on size preset and source dimensions while preserving aspect ratio.
 * @param sourceWidth - Original video width
 * @param sourceHeight - Original video height
 * @param sizePreset - The size preset to use
 * @param sizePresets - The size presets configuration
 * @returns The calculated output dimensions
 */
export function calculateOutputDimensions(
	sourceWidth: number,
	sourceHeight: number,
	sizePreset: GifSizePreset,
	sizePresets: typeof GIF_SIZE_PRESETS,
): { width: number; height: number } {
	const preset = sizePresets[sizePreset];
	const maxHeight = preset.maxHeight;

	// If original is smaller than max height or preset is 'original', use source dimensions
	if (sourceHeight <= maxHeight || sizePreset === "original") {
		return { width: sourceWidth, height: sourceHeight };
	}

	// Calculate scaled dimensions preserving aspect ratio
	const aspectRatio = sourceWidth / sourceHeight;
	const newHeight = maxHeight;
	const newWidth = Math.round(newHeight * aspectRatio);

	// Ensure dimensions are even (required for some encoders)
	return {
		width: newWidth % 2 === 0 ? newWidth : newWidth + 1,
		height: newHeight % 2 === 0 ? newHeight : newHeight + 1,
	};
}

export function getGifRepeat(loop: boolean): 0 | 1 {
	return loop ? 0 : 1;
}

export function buildGifFrameRendererConfig(
	config: GifExporterConfig,
	videoInfo: { width: number; height: number },
) {
	return {
		width: config.width,
		timelineEffects: config.clipRegions !== undefined,
		height: config.height,
		wallpaper: config.wallpaper,
		zoomRegions: config.zoomRegions,
		showShadow: config.showShadow,
		shadowIntensity: config.shadowIntensity,
		backgroundBlur: config.backgroundBlur,
		zoomMotionBlur: config.zoomMotionBlur,
		zoomMotionBlurTuning: config.zoomMotionBlurTuning,
		connectZooms: config.connectZooms,
		zoomInDurationMs: config.zoomInDurationMs,
		zoomInOverlapMs: config.zoomInOverlapMs,
		zoomOutDurationMs: config.zoomOutDurationMs,
		connectedZoomGapMs: config.connectedZoomGapMs,
		connectedZoomDurationMs: config.connectedZoomDurationMs,
		zoomInEasing: config.zoomInEasing,
		zoomOutEasing: config.zoomOutEasing,
		connectedZoomEasing: config.connectedZoomEasing,
		borderRadius: config.borderRadius,
		padding: config.padding,
		cropRegion: config.cropRegion,
		webcam: config.webcam,
		webcamUrl: config.webcamUrl,
		videoWidth: videoInfo.width,
		videoHeight: videoInfo.height,
		annotationRegions: config.annotationRegions,
		autoCaptions: config.autoCaptions,
		autoCaptionSettings: config.autoCaptionSettings,
		speedRegions: config.speedRegions,
		previewWidth: config.previewWidth,
		previewHeight: config.previewHeight,
		cursorTelemetry: config.cursorTelemetry,
		showCursor: config.showCursor,
		cursorStyle: config.cursorStyle,
		cursorSize: config.cursorSize,
		cursorSmoothing: config.cursorSmoothing,
		cursorSpringStiffnessMultiplier: config.cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: config.cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: config.cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: config.cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: config.cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: config.cameraSpringMassMultiplier,
		zoomSmoothness: config.zoomSmoothness,
		zoomClassicMode: config.zoomClassicMode,
		cursorMotionBlur: config.cursorMotionBlur,
		cursorClickEffect: config.cursorClickEffect,
		cursorClickEffectColor: config.cursorClickEffectColor,
		cursorClickEffectScale: config.cursorClickEffectScale,
		cursorClickEffectOpacity: config.cursorClickEffectOpacity,
		cursorClickEffectDurationMs: config.cursorClickEffectDurationMs,
		cursorClickBounce: config.cursorClickBounce,
		cursorClickBounceDuration: config.cursorClickBounceDuration,
		cursorSway: config.cursorSway,
		cursorIdleHide: config.cursorIdleHide,
	};
}

export interface GifSizeEstimate {
	originalBytes: number;
	optimizedBytes: number;
	reductionPercent: number;
	sampleFrames: number;
	totalFrames: number;
}
