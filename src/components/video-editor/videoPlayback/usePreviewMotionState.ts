import { Container } from "pixi.js";
import { useRef } from "react";
import { type CursorFollowCameraState, createCursorFollowCameraState } from "./cursorFollowCamera";
import { PixiCursorOverlay } from "./cursorRenderer";
import { createSpringState, type SpringState } from "./motionSmoothing";
import type { PlaybackProps } from "./playbackProps";
import { createMotionBlurState, type MotionBlurState } from "./zoomTransform";
export function usePreviewMotionState(
	input: Pick<
		PlaybackProps,
		| "connectZooms"
		| "zoomInDurationMs"
		| "zoomInOverlapMs"
		| "zoomOutDurationMs"
		| "connectedZoomGapMs"
		| "connectedZoomDurationMs"
		| "zoomInEasing"
		| "zoomOutEasing"
		| "connectedZoomEasing"
		| "showCursor"
		| "cursorSize"
		| "cursorStyle"
		| "cursorSmoothing"
		| "cursorSpringStiffnessMultiplier"
		| "cursorSpringDampingMultiplier"
		| "cursorSpringMassMultiplier"
		| "cameraSpringStiffnessMultiplier"
		| "cameraSpringDampingMultiplier"
		| "cameraSpringMassMultiplier"
		| "cursorMotionBlur"
		| "cursorClickEffect"
		| "cursorClickEffectColor"
		| "cursorClickEffectScale"
		| "cursorClickEffectOpacity"
		| "cursorClickEffectDurationMs"
		| "cursorClickBounce"
		| "cursorClickBounceDuration"
		| "cursorSway"
		| "zoomMotionBlur"
		| "zoomMotionBlurTuning"
		| "zoomSmoothness"
		| "zoomClassicMode"
	>,
) {
	const {
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
		cursorSize,
		cursorStyle,
		cursorSmoothing,
		cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier,
		cameraSpringMassMultiplier,
		cursorMotionBlur,
		cursorClickEffect,
		cursorClickEffectColor,
		cursorClickEffectScale,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMs,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		zoomMotionBlur,
		zoomMotionBlurTuning,
		zoomSmoothness,
		zoomClassicMode,
	} = input;

	const cursorContainerRef = useRef<Container | null>(null);

	const connectZoomsRef = useRef(connectZooms);

	const zoomInDurationMsRef = useRef(zoomInDurationMs);

	const zoomInOverlapMsRef = useRef(zoomInOverlapMs);

	const zoomOutDurationMsRef = useRef(zoomOutDurationMs);

	const connectedZoomGapMsRef = useRef(connectedZoomGapMs);

	const connectedZoomDurationMsRef = useRef(connectedZoomDurationMs);

	const zoomInEasingRef = useRef(zoomInEasing);

	const zoomOutEasingRef = useRef(zoomOutEasing);

	const connectedZoomEasingRef = useRef(connectedZoomEasing);

	const cursorOverlayRef = useRef<PixiCursorOverlay | null>(null);

	const cursorTelemetryRef = useRef<CursorTelemetryPoint[]>([]);

	const showCursorRef = useRef(showCursor);

	const cursorSizeRef = useRef(cursorSize);

	const cursorStyleRef = useRef(cursorStyle);

	const cursorSmoothingRef = useRef(cursorSmoothing);

	const cursorSpringStiffnessMultiplierRef = useRef(cursorSpringStiffnessMultiplier);

	const cursorSpringDampingMultiplierRef = useRef(cursorSpringDampingMultiplier);

	const cursorSpringMassMultiplierRef = useRef(cursorSpringMassMultiplier);

	const cameraSpringStiffnessMultiplierRef = useRef(cameraSpringStiffnessMultiplier);

	const cameraSpringDampingMultiplierRef = useRef(cameraSpringDampingMultiplier);

	const cameraSpringMassMultiplierRef = useRef(cameraSpringMassMultiplier);

	const cursorMotionBlurRef = useRef(cursorMotionBlur);

	const cursorClickEffectRef = useRef(cursorClickEffect);

	const cursorClickEffectColorRef = useRef(cursorClickEffectColor);

	const cursorClickEffectScaleRef = useRef(cursorClickEffectScale);

	const cursorClickEffectOpacityRef = useRef(cursorClickEffectOpacity);

	const cursorClickEffectDurationMsRef = useRef(cursorClickEffectDurationMs);

	const cursorClickBounceRef = useRef(cursorClickBounce);

	const cursorClickBounceDurationRef = useRef(cursorClickBounceDuration);

	const cursorSwayRef = useRef(cursorSway);

	const zoomMotionBlurRef = useRef(zoomMotionBlur);

	const zoomMotionBlurTuningRef = useRef(zoomMotionBlurTuning);

	// Spring animation state for smooth zoom transitions
	const springScaleRef = useRef<SpringState>(createSpringState(1));

	const springXRef = useRef<SpringState>(createSpringState(0));

	const springYRef = useRef<SpringState>(createSpringState(0));

	const zoomSmoothnessRef = useRef(zoomSmoothness);

	const zoomClassicModeRef = useRef(zoomClassicMode);

	const cursorFollowCameraRef = useRef<CursorFollowCameraState>(createCursorFollowCameraState());

	const cursorFollowCameraNeedsResetRef = useRef(false);

	const motionBlurStateRef = useRef<MotionBlurState>(createMotionBlurState());
	return {
		cursorContainerRef,
		connectZoomsRef,
		zoomInDurationMsRef,
		zoomInOverlapMsRef,
		zoomOutDurationMsRef,
		connectedZoomGapMsRef,
		connectedZoomDurationMsRef,
		zoomInEasingRef,
		zoomOutEasingRef,
		connectedZoomEasingRef,
		cursorOverlayRef,
		cursorTelemetryRef,
		showCursorRef,
		cursorSizeRef,
		cursorStyleRef,
		cursorSmoothingRef,
		cursorSpringStiffnessMultiplierRef,
		cursorSpringDampingMultiplierRef,
		cursorSpringMassMultiplierRef,
		cameraSpringStiffnessMultiplierRef,
		cameraSpringDampingMultiplierRef,
		cameraSpringMassMultiplierRef,
		cursorMotionBlurRef,
		cursorClickEffectRef,
		cursorClickEffectColorRef,
		cursorClickEffectScaleRef,
		cursorClickEffectOpacityRef,
		cursorClickEffectDurationMsRef,
		cursorClickBounceRef,
		cursorClickBounceDurationRef,
		cursorSwayRef,
		zoomMotionBlurRef,
		zoomMotionBlurTuningRef,
		springScaleRef,
		springXRef,
		springYRef,
		zoomSmoothnessRef,
		zoomClassicModeRef,
		cursorFollowCameraRef,
		cursorFollowCameraNeedsResetRef,
		motionBlurStateRef,
	};
}
