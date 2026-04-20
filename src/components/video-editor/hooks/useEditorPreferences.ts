/**
 * useEditorPreferences – manages all visual / export preference state.
 * Persists changes to localStorage via saveEditorPreferences.
 */
import { useCallback, useEffect, useState } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_WEBCAM_OVERLAY,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
	type CropRegion,
	type CursorStyle,
	type EditorEffectSection,
	type WebcamOverlaySettings,
	type ZoomTransitionEasing,
} from "../types";
import type {
	ExportBackendPreference,
	ExportEncodingMode,
	ExportFormat,
	ExportMp4FrameRate,
	ExportPipelineModel,
	ExportQuality,
	GifFrameRate,
	GifSizePreset,
} from "@/lib/exporter/types";

const DEFAULT_MP4_EXPORT_FRAME_RATE: ExportMp4FrameRate = 30;

export function useEditorPreferences() {
	const initial = loadEditorPreferences();

	const [activeEffectSection, setActiveEffectSection] = useState<EditorEffectSection>("scene");
	const [wallpaper, setWallpaper] = useState<string>(initial.wallpaper);
	const [shadowIntensity, setShadowIntensity] = useState(initial.shadowIntensity);
	const [backgroundBlur, setBackgroundBlur] = useState(initial.backgroundBlur);
	const [zoomMotionBlur, setZoomMotionBlur] = useState(initial.zoomMotionBlur);
	const [autoApplyFreshRecordingAutoZooms, setAutoApplyFreshRecordingAutoZooms] = useState(
		initial.autoApplyFreshRecordingAutoZooms,
	);
	const [connectZooms, setConnectZooms] = useState(initial.connectZooms);
	const [zoomInDurationMs, setZoomInDurationMs] = useState(
		initial.zoomInDurationMs ?? DEFAULT_ZOOM_IN_DURATION_MS,
	);
	const [zoomInOverlapMs, setZoomInOverlapMs] = useState(
		initial.zoomInOverlapMs ?? DEFAULT_ZOOM_IN_OVERLAP_MS,
	);
	const [zoomOutDurationMs, setZoomOutDurationMs] = useState(
		initial.zoomOutDurationMs ?? DEFAULT_ZOOM_OUT_DURATION_MS,
	);
	const [connectedZoomGapMs, setConnectedZoomGapMs] = useState(
		initial.connectedZoomGapMs ?? DEFAULT_CONNECTED_ZOOM_GAP_MS,
	);
	const [connectedZoomDurationMs, setConnectedZoomDurationMs] = useState(
		initial.connectedZoomDurationMs ?? DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	);
	const [zoomInEasing, setZoomInEasing] = useState<ZoomTransitionEasing>(
		initial.zoomInEasing ?? DEFAULT_ZOOM_IN_EASING,
	);
	const [zoomOutEasing, setZoomOutEasing] = useState<ZoomTransitionEasing>(
		initial.zoomOutEasing ?? DEFAULT_ZOOM_OUT_EASING,
	);
	const [connectedZoomEasing, setConnectedZoomEasing] = useState<ZoomTransitionEasing>(
		initial.connectedZoomEasing ?? DEFAULT_CONNECTED_ZOOM_EASING,
	);
	const [showCursor, setShowCursor] = useState(initial.showCursor);
	const [loopCursor, setLoopCursor] = useState(initial.loopCursor);
	const [cursorStyle, setCursorStyle] = useState<CursorStyle>(
		initial.cursorStyle ?? DEFAULT_CURSOR_STYLE,
	);
	const [cursorSize, setCursorSize] = useState(initial.cursorSize);
	const [cursorSmoothing, setCursorSmoothing] = useState(initial.cursorSmoothing);
	const [zoomSmoothness, setZoomSmoothness] = useState(0.5);
	const [zoomClassicMode, setZoomClassicMode] = useState(false);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(initial.cursorMotionBlur);
	const [cursorClickBounce, setCursorClickBounce] = useState(initial.cursorClickBounce);
	const [cursorClickBounceDuration, setCursorClickBounceDuration] = useState(
		initial.cursorClickBounceDuration,
	);
	const [cursorSway, setCursorSway] = useState(initial.cursorSway);
	const [borderRadius, setBorderRadius] = useState(initial.borderRadius);
	const [padding, setPadding] = useState(initial.padding);
	const [frame, setFrame] = useState<string | null>(initial.frame);
	const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
	const [webcam, setWebcam] = useState<WebcamOverlaySettings>(
		initial.webcam ?? DEFAULT_WEBCAM_OVERLAY,
	);
	const [resolvedWebcamVideoUrl, setResolvedWebcamVideoUrl] = useState<string | null>(null);
	const [aspectRatio, setAspectRatio] = useState<AspectRatio>(initial.aspectRatio);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(initial.exportQuality);
	const [exportEncodingMode, setExportEncodingMode] = useState<ExportEncodingMode>(
		initial.exportEncodingMode,
	);
	const [exportBackendPreference, setExportBackendPreference] =
		useState<ExportBackendPreference>(initial.exportBackendPreference);
	const [exportPipelineModel, setExportPipelineModel] = useState<ExportPipelineModel>(
		initial.exportPipelineModel,
	);
	const [mp4FrameRate, setMp4FrameRate] = useState<ExportMp4FrameRate>(
		initial.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(initial.exportFormat);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(initial.gifFrameRate);
	const [gifLoop, setGifLoop] = useState(initial.gifLoop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(initial.gifSizePreset);
	const [previewVolume, setPreviewVolume] = useState(1);

	// Keep activeEffectSection sensible (remove stale values)
	useEffect(() => {
		if (activeEffectSection === "frame" || activeEffectSection === "crop") {
			setActiveEffectSection("scene");
		}
	}, [activeEffectSection]);

	// Persist preferences to localStorage
	useEffect(() => {
		saveEditorPreferences({
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			autoApplyFreshRecordingAutoZooms,
			connectZooms,
			zoomInDurationMs,
			zoomInOverlapMs,
			zoomOutDurationMs,
			connectedZoomGapMs,
			connectedZoomDurationMs,
			zoomInEasing,
			zoomOutEasing,
			connectedZoomEasing,
			showCursor,
			loopCursor,
			cursorStyle,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			borderRadius,
			padding,
			frame,
			webcam,
			aspectRatio,
			exportEncodingMode,
			exportBackendPreference,
			exportPipelineModel,
			exportQuality,
			mp4FrameRate,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
		});
	}, [
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		autoApplyFreshRecordingAutoZooms,
		connectZooms,
		zoomInDurationMs,
		zoomInOverlapMs,
		zoomOutDurationMs,
		connectedZoomGapMs,
		connectedZoomDurationMs,
		zoomInEasing,
		zoomOutEasing,
		connectedZoomEasing,
		showCursor,
		loopCursor,
		cursorStyle,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		borderRadius,
		padding,
		frame,
		webcam,
		aspectRatio,
		exportEncodingMode,
		exportBackendPreference,
		exportPipelineModel,
		exportQuality,
		mp4FrameRate,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	/** Apply all preference fields from a loaded project state. */
	const applyProjectPreferences = useCallback(
		(editor: {
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
			zoomSmoothness?: number;
			zoomClassicMode?: boolean;
			cursorMotionBlur: number;
			cursorClickBounce: number;
			cursorClickBounceDuration: number;
			cursorSway: number;
			borderRadius: number;
			padding: number;
			frame: string | null;
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
		}) => {
			setWallpaper(editor.wallpaper);
			setShadowIntensity(editor.shadowIntensity);
			setBackgroundBlur(editor.backgroundBlur);
			setZoomMotionBlur(editor.zoomMotionBlur);
			setConnectZooms(editor.connectZooms);
			setZoomInDurationMs(editor.zoomInDurationMs);
			setZoomInOverlapMs(editor.zoomInOverlapMs);
			setZoomOutDurationMs(editor.zoomOutDurationMs);
			setConnectedZoomGapMs(editor.connectedZoomGapMs);
			setConnectedZoomDurationMs(editor.connectedZoomDurationMs);
			setZoomInEasing(editor.zoomInEasing);
			setZoomOutEasing(editor.zoomOutEasing);
			setConnectedZoomEasing(editor.connectedZoomEasing);
			setShowCursor(editor.showCursor);
			setLoopCursor(editor.loopCursor);
			setCursorStyle(editor.cursorStyle);
			setCursorSize(editor.cursorSize);
			setCursorSmoothing(editor.cursorSmoothing);
			if (editor.zoomSmoothness !== undefined) setZoomSmoothness(editor.zoomSmoothness);
			if (editor.zoomClassicMode !== undefined) setZoomClassicMode(editor.zoomClassicMode);
			setCursorMotionBlur(editor.cursorMotionBlur);
			setCursorClickBounce(editor.cursorClickBounce);
			setCursorClickBounceDuration(editor.cursorClickBounceDuration);
			setCursorSway(editor.cursorSway);
			setBorderRadius(editor.borderRadius);
			setPadding(editor.padding);
			setFrame(editor.frame);
			setCropRegion(DEFAULT_CROP_REGION);
			setWebcam(editor.webcam);
			setAspectRatio(editor.aspectRatio);
			setExportEncodingMode(editor.exportEncodingMode);
			setExportBackendPreference(editor.exportBackendPreference);
			setExportPipelineModel(editor.exportPipelineModel);
			setExportQuality(editor.exportQuality);
			setMp4FrameRate(editor.mp4FrameRate);
			setExportFormat(editor.exportFormat);
			setGifFrameRate(editor.gifFrameRate);
			setGifLoop(editor.gifLoop);
			setGifSizePreset(editor.gifSizePreset);
		},
		[],
	);

	return {
		activeEffectSection,
		setActiveEffectSection,
		wallpaper,
		setWallpaper,
		shadowIntensity,
		setShadowIntensity,
		backgroundBlur,
		setBackgroundBlur,
		zoomMotionBlur,
		setZoomMotionBlur,
		autoApplyFreshRecordingAutoZooms,
		setAutoApplyFreshRecordingAutoZooms,
		connectZooms,
		setConnectZooms,
		zoomInDurationMs,
		setZoomInDurationMs,
		zoomInOverlapMs,
		setZoomInOverlapMs,
		zoomOutDurationMs,
		setZoomOutDurationMs,
		connectedZoomGapMs,
		setConnectedZoomGapMs,
		connectedZoomDurationMs,
		setConnectedZoomDurationMs,
		zoomInEasing,
		setZoomInEasing,
		zoomOutEasing,
		setZoomOutEasing,
		connectedZoomEasing,
		setConnectedZoomEasing,
		showCursor,
		setShowCursor,
		loopCursor,
		setLoopCursor,
		cursorStyle,
		setCursorStyle,
		cursorSize,
		setCursorSize,
		cursorSmoothing,
		setCursorSmoothing,
		zoomSmoothness,
		setZoomSmoothness,
		zoomClassicMode,
		setZoomClassicMode,
		cursorMotionBlur,
		setCursorMotionBlur,
		cursorClickBounce,
		setCursorClickBounce,
		cursorClickBounceDuration,
		setCursorClickBounceDuration,
		cursorSway,
		setCursorSway,
		borderRadius,
		setBorderRadius,
		padding,
		setPadding,
		frame,
		setFrame,
		cropRegion,
		setCropRegion,
		webcam,
		setWebcam,
		resolvedWebcamVideoUrl,
		setResolvedWebcamVideoUrl,
		aspectRatio,
		setAspectRatio,
		exportQuality,
		setExportQuality,
		exportEncodingMode,
		setExportEncodingMode,
		exportBackendPreference,
		setExportBackendPreference,
		exportPipelineModel,
		setExportPipelineModel,
		mp4FrameRate,
		setMp4FrameRate,
		exportFormat,
		setExportFormat,
		gifFrameRate,
		setGifFrameRate,
		gifLoop,
		setGifLoop,
		gifSizePreset,
		setGifSizePreset,
		previewVolume,
		setPreviewVolume,
		applyProjectPreferences,
	};
}

export type EditorPreferencesHook = ReturnType<typeof useEditorPreferences>;