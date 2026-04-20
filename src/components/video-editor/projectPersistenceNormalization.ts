import { DEFAULT_WALLPAPER_PATH } from "@/lib/wallpapers";
import { ASPECT_RATIOS, type AspectRatio, isCustomAspectRatio } from "@/utils/aspectRatioUtils";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_WEBCAM_CORNER_RADIUS,
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_OVERLAY,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_WEBCAM_TIME_OFFSET_MS,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_MOTION_BLUR,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
	type WebcamOverlaySettings,
	type ZoomTransitionEasing,
} from "./types";
import {
	clamp,
	isFiniteNumber,
	normalizeExportBackendPreference,
	normalizeExportEncodingMode,
	normalizeExportMp4FrameRate,
	normalizeExportPipelineModel,
	type ProjectEditorState,
} from "./projectPersistenceShared";
import {
	normalizeAnnotationRegions,
	normalizeAudioRegions,
	normalizeAutoCaptionSettings,
	normalizeAutoCaptions,
	normalizeClipRegions,
	normalizeSpeedRegions,
	normalizeTrimRegions,
	normalizeZoomRegions,
} from "./projectPersistenceRegions";

function normalizeZoomTransitionEasing(
	value: unknown,
	fallback: ZoomTransitionEasing,
): ZoomTransitionEasing {
	return value === "recordly" ||
		value === "glide" ||
		value === "smooth" ||
		value === "snappy" ||
		value === "linear"
		? value
		: fallback;
}

export function normalizeProjectEditor(editor: Partial<ProjectEditorState>): ProjectEditorState {
	const validAspectRatios = new Set<AspectRatio>(ASPECT_RATIOS);
	const legacyMotionBlurEnabled = (editor as Partial<{ motionBlurEnabled: boolean }>).motionBlurEnabled;
	const legacyShowBlur = (editor as Partial<{ showBlur: boolean }>).showBlur;
	const normalizedZoomMotionBlur = isFiniteNumber(editor.zoomMotionBlur)
		? clamp(editor.zoomMotionBlur, 0, 2)
		: legacyMotionBlurEnabled
			? 0.35
			: DEFAULT_ZOOM_MOTION_BLUR;
	const normalizedBackgroundBlur = isFiniteNumber(editor.backgroundBlur)
		? clamp(editor.backgroundBlur, 0, 8)
		: legacyShowBlur
			? 2
			: 0;
	const normalizedZoomInDurationMs = isFiniteNumber(editor.zoomInDurationMs)
		? clamp(editor.zoomInDurationMs, 60, 4000)
		: DEFAULT_ZOOM_IN_DURATION_MS;
	const normalizedZoomInOverlapMs = isFiniteNumber(editor.zoomInOverlapMs)
		? clamp(editor.zoomInOverlapMs, 0, normalizedZoomInDurationMs)
		: DEFAULT_ZOOM_IN_OVERLAP_MS;
	const normalizedZoomOutDurationMs = isFiniteNumber(editor.zoomOutDurationMs)
		? clamp(editor.zoomOutDurationMs, 60, 4000)
		: DEFAULT_ZOOM_OUT_DURATION_MS;
	const normalizedConnectedZoomGapMs = isFiniteNumber(editor.connectedZoomGapMs)
		? clamp(editor.connectedZoomGapMs, 0, 5000)
		: DEFAULT_CONNECTED_ZOOM_GAP_MS;
	const normalizedConnectedZoomDurationMs = isFiniteNumber(editor.connectedZoomDurationMs)
		? clamp(editor.connectedZoomDurationMs, 60, 4000)
		: DEFAULT_CONNECTED_ZOOM_DURATION_MS;
	const normalizedAutoCaptionSettings = normalizeAutoCaptionSettings(editor);

	const rawCropX = isFiniteNumber(editor.cropRegion?.x) ? editor.cropRegion.x : DEFAULT_CROP_REGION.x;
	const rawCropY = isFiniteNumber(editor.cropRegion?.y) ? editor.cropRegion.y : DEFAULT_CROP_REGION.y;
	const rawCropWidth = isFiniteNumber(editor.cropRegion?.width)
		? editor.cropRegion.width
		: DEFAULT_CROP_REGION.width;
	const rawCropHeight = isFiniteNumber(editor.cropRegion?.height)
		? editor.cropRegion.height
		: DEFAULT_CROP_REGION.height;
	const cropX = clamp(rawCropX, 0, 1);
	const cropY = clamp(rawCropY, 0, 1);
	const cropWidth = clamp(rawCropWidth, 0.01, 1 - cropX);
	const cropHeight = clamp(rawCropHeight, 0.01, 1 - cropY);

	const webcam: Partial<WebcamOverlaySettings> =
		editor.webcam && typeof editor.webcam === "object" ? editor.webcam : {};
	const webcamSourcePath = typeof webcam.sourcePath === "string" ? webcam.sourcePath : null;
	const legacyZoomScaleEffect = isFiniteNumber(
		(webcam as Partial<{ zoomScaleEffect: number }>).zoomScaleEffect,
	)
		? (webcam as Partial<{ zoomScaleEffect: number }>).zoomScaleEffect
		: null;

	return {
		wallpaper: typeof editor.wallpaper === "string" ? editor.wallpaper : DEFAULT_WALLPAPER_PATH,
		shadowIntensity: typeof editor.shadowIntensity === "number" ? editor.shadowIntensity : 0.67,
		backgroundBlur: normalizedBackgroundBlur,
		zoomMotionBlur: normalizedZoomMotionBlur,
		connectZooms: typeof editor.connectZooms === "boolean" ? editor.connectZooms : true,
		zoomInDurationMs: normalizedZoomInDurationMs,
		zoomInOverlapMs: normalizedZoomInOverlapMs,
		zoomOutDurationMs: normalizedZoomOutDurationMs,
		connectedZoomGapMs: normalizedConnectedZoomGapMs,
		connectedZoomDurationMs: normalizedConnectedZoomDurationMs,
		zoomInEasing: normalizeZoomTransitionEasing(editor.zoomInEasing, DEFAULT_ZOOM_IN_EASING),
		zoomOutEasing: normalizeZoomTransitionEasing(editor.zoomOutEasing, DEFAULT_ZOOM_OUT_EASING),
		connectedZoomEasing: normalizeZoomTransitionEasing(
			editor.connectedZoomEasing,
			DEFAULT_CONNECTED_ZOOM_EASING,
		),
		showCursor: typeof editor.showCursor === "boolean" ? editor.showCursor : true,
		loopCursor: typeof editor.loopCursor === "boolean" ? editor.loopCursor : false,
		cursorStyle:
			typeof editor.cursorStyle === "string" && editor.cursorStyle.trim().length > 0
				? editor.cursorStyle
				: DEFAULT_CURSOR_STYLE,
		cursorSize: isFiniteNumber(editor.cursorSize)
			? clamp(editor.cursorSize, 0.5, 10)
			: DEFAULT_CURSOR_SIZE,
		cursorSmoothing: isFiniteNumber(editor.cursorSmoothing)
			? clamp(editor.cursorSmoothing, 0, 2)
			: DEFAULT_CURSOR_SMOOTHING,
		zoomSmoothness: isFiniteNumber(editor.zoomSmoothness)
			? clamp(editor.zoomSmoothness, 0, 1)
			: 0.5,
		zoomClassicMode: typeof editor.zoomClassicMode === "boolean" ? editor.zoomClassicMode : false,
		cursorMotionBlur: isFiniteNumber(editor.cursorMotionBlur)
			? clamp(editor.cursorMotionBlur, 0, 2)
			: DEFAULT_CURSOR_MOTION_BLUR,
		cursorClickBounce: isFiniteNumber(editor.cursorClickBounce)
			? clamp(editor.cursorClickBounce, 0, 5)
			: DEFAULT_CURSOR_CLICK_BOUNCE,
		cursorClickBounceDuration: isFiniteNumber(editor.cursorClickBounceDuration)
			? clamp(editor.cursorClickBounceDuration, 60, 500)
			: DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
		cursorSway: isFiniteNumber(editor.cursorSway)
			? clamp(editor.cursorSway, 0, 2)
			: DEFAULT_CURSOR_SWAY,
		borderRadius: typeof editor.borderRadius === "number" ? editor.borderRadius : 12.5,
		padding: isFiniteNumber(editor.padding) ? clamp(editor.padding, 0, 100) : 20,
		frame: typeof editor.frame === "string" ? editor.frame : null,
		cropRegion: { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
		zoomRegions: normalizeZoomRegions(editor),
		trimRegions: normalizeTrimRegions(editor),
		clipRegions: normalizeClipRegions(editor),
		speedRegions: normalizeSpeedRegions(editor),
		annotationRegions: normalizeAnnotationRegions(editor),
		audioRegions: normalizeAudioRegions(editor),
		autoCaptions: normalizeAutoCaptions(editor),
		autoCaptionSettings: normalizedAutoCaptionSettings,
		webcam: {
			enabled:
				typeof webcam.enabled === "boolean" ? webcam.enabled : DEFAULT_WEBCAM_OVERLAY.enabled,
			sourcePath: webcamSourcePath,
			mirror: typeof webcam.mirror === "boolean" ? webcam.mirror : DEFAULT_WEBCAM_OVERLAY.mirror,
			positionPreset:
				webcam.positionPreset === "top-left" ||
				webcam.positionPreset === "top-center" ||
				webcam.positionPreset === "top-right" ||
				webcam.positionPreset === "center-left" ||
				webcam.positionPreset === "center" ||
				webcam.positionPreset === "center-right" ||
				webcam.positionPreset === "bottom-left" ||
				webcam.positionPreset === "bottom-center" ||
				webcam.positionPreset === "bottom-right" ||
				webcam.positionPreset === "custom"
					? webcam.positionPreset
					: webcam.corner === "top-left" ||
							webcam.corner === "top-right" ||
							webcam.corner === "bottom-left" ||
							webcam.corner === "bottom-right"
						? webcam.corner
						: DEFAULT_WEBCAM_POSITION_PRESET,
			positionX: isFiniteNumber(webcam.positionX)
				? clamp(webcam.positionX, 0, 1)
				: DEFAULT_WEBCAM_POSITION_X,
			positionY: isFiniteNumber(webcam.positionY)
				? clamp(webcam.positionY, 0, 1)
				: DEFAULT_WEBCAM_POSITION_Y,
			corner:
				webcam.corner === "top-left" ||
				webcam.corner === "top-right" ||
				webcam.corner === "bottom-left" ||
				webcam.corner === "bottom-right"
					? webcam.corner
					: DEFAULT_WEBCAM_OVERLAY.corner,
			size: isFiniteNumber(webcam.size) ? clamp(webcam.size, 10, 100) : DEFAULT_WEBCAM_SIZE,
			reactToZoom:
				typeof webcam.reactToZoom === "boolean"
					? webcam.reactToZoom
					: legacyZoomScaleEffect != null
						? legacyZoomScaleEffect > 0
						: DEFAULT_WEBCAM_REACT_TO_ZOOM,
			cornerRadius: isFiniteNumber(webcam.cornerRadius)
				? clamp(webcam.cornerRadius, 0, 160)
				: DEFAULT_WEBCAM_CORNER_RADIUS,
			shadow: isFiniteNumber(webcam.shadow)
				? clamp(webcam.shadow, 0, 1)
				: DEFAULT_WEBCAM_SHADOW,
			timeOffsetMs: isFiniteNumber(webcam.timeOffsetMs)
				? Math.round(webcam.timeOffsetMs)
				: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			margin: isFiniteNumber(webcam.margin)
				? clamp(webcam.margin, 0, 96)
				: DEFAULT_WEBCAM_MARGIN,
		},
		aspectRatio:
			typeof editor.aspectRatio === "string" &&
			(validAspectRatios.has(editor.aspectRatio) || isCustomAspectRatio(editor.aspectRatio))
				? (editor.aspectRatio as AspectRatio)
				: "16:9",
		exportEncodingMode: normalizeExportEncodingMode(editor.exportEncodingMode),
		exportBackendPreference: normalizeExportBackendPreference(editor.exportBackendPreference),
		exportPipelineModel: normalizeExportPipelineModel(editor.exportPipelineModel),
		exportQuality:
			editor.exportQuality === "medium" ||
			editor.exportQuality === "good" ||
			editor.exportQuality === "high" ||
			editor.exportQuality === "source"
				? editor.exportQuality
				: "source",
		mp4FrameRate: normalizeExportMp4FrameRate(editor.mp4FrameRate),
		exportFormat: editor.exportFormat === "gif" ? "gif" : "mp4",
		gifFrameRate:
			editor.gifFrameRate === 15 ||
			editor.gifFrameRate === 20 ||
			editor.gifFrameRate === 25 ||
			editor.gifFrameRate === 30
				? editor.gifFrameRate
				: 15,
		gifLoop: typeof editor.gifLoop === "boolean" ? editor.gifLoop : true,
		gifSizePreset:
			editor.gifSizePreset === "medium" ||
			editor.gifSizePreset === "large" ||
			editor.gifSizePreset === "original"
				? editor.gifSizePreset
				: "medium",
	};
}