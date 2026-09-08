import { useState } from "react";
import type { DeviceFrame } from "../deviceFrame";
import type { EditorPreferences } from "../editorPreferences";
import type {
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	WebcamOverlaySettings,
	ZoomMotionBlurTuning,
	ZoomTransitionEasing,
} from "../types";
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
	DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
} from "../types";

export function useAppearanceState(preferences: EditorPreferences) {
	const [wallpaper, setWallpaper] = useState(preferences.wallpaper);
	const [shadowIntensity, setShadowIntensity] = useState(preferences.shadowIntensity);
	const [backgroundBlur, setBackgroundBlur] = useState(preferences.backgroundBlur);
	const [zoomMotionBlur, setZoomMotionBlur] = useState(preferences.zoomMotionBlur);
	const [zoomMotionBlurTuning, setZoomMotionBlurTuning] = useState<ZoomMotionBlurTuning>(
		preferences.zoomMotionBlurTuning ?? DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	);
	const [zoomTemporalMotionBlur, setZoomTemporalMotionBlur] = useState(
		preferences.zoomTemporalMotionBlur,
	);
	const [zoomMotionBlurSampleCount, setZoomMotionBlurSampleCount] = useState<number | null>(
		preferences.zoomMotionBlurSampleCount,
	);
	const [zoomMotionBlurShutterFraction, setZoomMotionBlurShutterFraction] = useState<
		number | null
	>(preferences.zoomMotionBlurShutterFraction);
	const [autoApplyFreshRecordingAutoZooms, setAutoApplyFreshRecordingAutoZooms] = useState(
		preferences.autoApplyFreshRecordingAutoZooms,
	);
	const [connectZooms, setConnectZooms] = useState(preferences.connectZooms);
	const [zoomInDurationMs, setZoomInDurationMs] = useState(
		preferences.zoomInDurationMs ?? DEFAULT_ZOOM_IN_DURATION_MS,
	);
	const [zoomInOverlapMs, setZoomInOverlapMs] = useState(
		preferences.zoomInOverlapMs ?? DEFAULT_ZOOM_IN_OVERLAP_MS,
	);
	const [zoomOutDurationMs, setZoomOutDurationMs] = useState(
		preferences.zoomOutDurationMs ?? DEFAULT_ZOOM_OUT_DURATION_MS,
	);
	const [connectedZoomGapMs, setConnectedZoomGapMs] = useState(
		preferences.connectedZoomGapMs ?? DEFAULT_CONNECTED_ZOOM_GAP_MS,
	);
	const [connectedZoomDurationMs, setConnectedZoomDurationMs] = useState(
		preferences.connectedZoomDurationMs ?? DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	);
	const [zoomInEasing, setZoomInEasing] = useState<ZoomTransitionEasing>(
		preferences.zoomInEasing ?? DEFAULT_ZOOM_IN_EASING,
	);
	const [zoomOutEasing, setZoomOutEasing] = useState<ZoomTransitionEasing>(
		preferences.zoomOutEasing ?? DEFAULT_ZOOM_OUT_EASING,
	);
	const [connectedZoomEasing, setConnectedZoomEasing] = useState<ZoomTransitionEasing>(
		preferences.connectedZoomEasing ?? DEFAULT_CONNECTED_ZOOM_EASING,
	);
	const [showCursor, setShowCursor] = useState(preferences.showCursor);
	const [loopCursor, setLoopCursor] = useState(preferences.loopCursor);
	const [cursorStyle, setCursorStyle] = useState<CursorStyle>(
		preferences.cursorStyle ?? DEFAULT_CURSOR_STYLE,
	);
	const [cursorSize, setCursorSize] = useState(preferences.cursorSize);
	const [cursorSmoothing, setCursorSmoothing] = useState(preferences.cursorSmoothing);
	const [cursorSpringStiffnessMultiplier, setCursorSpringStiffnessMultiplier] = useState(
		preferences.cursorSpringStiffnessMultiplier,
	);
	const [cursorSpringDampingMultiplier, setCursorSpringDampingMultiplier] = useState(
		preferences.cursorSpringDampingMultiplier,
	);
	const [cursorSpringMassMultiplier, setCursorSpringMassMultiplier] = useState(
		preferences.cursorSpringMassMultiplier,
	);
	const [cameraSpringStiffnessMultiplier, setCameraSpringStiffnessMultiplier] = useState(
		preferences.cameraSpringStiffnessMultiplier,
	);
	const [cameraSpringDampingMultiplier, setCameraSpringDampingMultiplier] = useState(
		preferences.cameraSpringDampingMultiplier,
	);
	const [cameraSpringMassMultiplier, setCameraSpringMassMultiplier] = useState(
		preferences.cameraSpringMassMultiplier,
	);
	const [zoomSmoothness, setZoomSmoothness] = useState(0.5);
	const [zoomClassicMode, setZoomClassicMode] = useState(false);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(preferences.cursorMotionBlur);
	const [cursorClickEffect, setCursorClickEffect] = useState<CursorClickEffectStyle>(
		preferences.cursorClickEffect,
	);
	const [cursorClickEffectColor, setCursorClickEffectColor] = useState(
		preferences.cursorClickEffectColor,
	);
	const [cursorClickEffectScale, setCursorClickEffectScale] = useState(
		preferences.cursorClickEffectScale,
	);
	const [cursorClickEffectOpacity, setCursorClickEffectOpacity] = useState(
		preferences.cursorClickEffectOpacity,
	);
	const [cursorClickEffectDurationMs, setCursorClickEffectDurationMs] = useState(
		preferences.cursorClickEffectDurationMs,
	);
	const [cursorClickBounce, setCursorClickBounce] = useState(preferences.cursorClickBounce);
	const [cursorClickBounceDuration, setCursorClickBounceDuration] = useState(
		preferences.cursorClickBounceDuration,
	);
	const [cursorSway, setCursorSway] = useState(preferences.cursorSway);
	const [deviceFrame, setDeviceFrame] = useState<DeviceFrame>(preferences.deviceFrame);
	const [borderRadius, setBorderRadius] = useState(preferences.borderRadius);
	const [padding, setPadding] = useState(preferences.padding);
	const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
	const [webcam, setWebcam] = useState<WebcamOverlaySettings>(
		preferences.webcam ?? DEFAULT_WEBCAM_OVERLAY,
	);
	const [resolvedWebcamVideoUrl, setResolvedWebcamVideoUrl] = useState<string | null>(null);

	return {
		wallpaper,
		setWallpaper,
		shadowIntensity,
		setShadowIntensity,
		backgroundBlur,
		setBackgroundBlur,
		zoomMotionBlur,
		setZoomMotionBlur,
		zoomMotionBlurTuning,
		setZoomMotionBlurTuning,
		zoomTemporalMotionBlur,
		setZoomTemporalMotionBlur,
		zoomMotionBlurSampleCount,
		setZoomMotionBlurSampleCount,
		zoomMotionBlurShutterFraction,
		setZoomMotionBlurShutterFraction,
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
		cursorSpringStiffnessMultiplier,
		setCursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier,
		setCursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		setCursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier,
		setCameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		setCameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		setCameraSpringMassMultiplier,
		zoomSmoothness,
		setZoomSmoothness,
		zoomClassicMode,
		setZoomClassicMode,
		cursorMotionBlur,
		setCursorMotionBlur,
		cursorClickEffect,
		setCursorClickEffect,
		cursorClickEffectColor,
		setCursorClickEffectColor,
		cursorClickEffectScale,
		setCursorClickEffectScale,
		cursorClickEffectOpacity,
		setCursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		setCursorClickEffectDurationMs,
		cursorClickBounce,
		setCursorClickBounce,
		cursorClickBounceDuration,
		setCursorClickBounceDuration,
		cursorSway,
		setCursorSway,
		deviceFrame,
		setDeviceFrame,
		borderRadius,
		setBorderRadius,
		padding,
		setPadding,
		cropRegion,
		setCropRegion,
		webcam,
		setWebcam,
		resolvedWebcamVideoUrl,
		setResolvedWebcamVideoUrl,
	};
}
