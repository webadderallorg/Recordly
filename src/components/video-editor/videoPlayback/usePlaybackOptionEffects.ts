import { useEffect } from "react";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackState } from "./usePlaybackState";
import { createMotionBlurState } from "./zoomTransform";
export type usePlaybackOptionEffectsInput = Pick<
	ReturnType<typeof usePlaybackState> & PlaybackProps,
	| "connectZoomsRef"
	| "connectZooms"
	| "requestPausedFrameRefresh"
	| "zoomInDurationMsRef"
	| "zoomInDurationMs"
	| "zoomInOverlapMsRef"
	| "zoomInOverlapMs"
	| "zoomOutDurationMsRef"
	| "zoomOutDurationMs"
	| "connectedZoomGapMsRef"
	| "connectedZoomGapMs"
	| "connectedZoomDurationMsRef"
	| "connectedZoomDurationMs"
	| "zoomInEasingRef"
	| "zoomInEasing"
	| "zoomOutEasingRef"
	| "zoomOutEasing"
	| "connectedZoomEasingRef"
	| "connectedZoomEasing"
	| "cursorTelemetryRef"
	| "cursorTelemetry"
	| "showCursorRef"
	| "showCursor"
	| "cursorStyleRef"
	| "cursorStyle"
	| "cursorSizeRef"
	| "cursorSize"
	| "cursorSmoothingRef"
	| "cursorSmoothing"
	| "cursorSpringStiffnessMultiplierRef"
	| "cursorSpringStiffnessMultiplier"
	| "cursorSpringDampingMultiplierRef"
	| "cursorSpringDampingMultiplier"
	| "cursorSpringMassMultiplierRef"
	| "cursorSpringMassMultiplier"
	| "cameraSpringStiffnessMultiplierRef"
	| "cameraSpringStiffnessMultiplier"
	| "cameraSpringDampingMultiplierRef"
	| "cameraSpringDampingMultiplier"
	| "cameraSpringMassMultiplierRef"
	| "cameraSpringMassMultiplier"
	| "zoomSmoothnessRef"
	| "zoomSmoothness"
	| "zoomMotionBlurRef"
	| "zoomMotionBlur"
	| "videoEffectsContainerRef"
	| "zoomBlurFilterRef"
	| "motionBlurFilterRef"
	| "motionBlurStateRef"
	| "zoomMotionBlurTuningRef"
	| "zoomMotionBlurTuning"
	| "zoomClassicModeRef"
	| "zoomClassicMode"
	| "cursorMotionBlurRef"
	| "cursorMotionBlur"
	| "cursorClickEffectRef"
	| "cursorClickEffect"
	| "cursorClickEffectColorRef"
	| "cursorClickEffectColor"
	| "cursorClickEffectScaleRef"
	| "cursorClickEffectScale"
	| "cursorClickEffectOpacityRef"
	| "cursorClickEffectOpacity"
	| "cursorClickEffectDurationMsRef"
	| "cursorClickEffectDurationMs"
	| "cursorClickBounceRef"
	| "cursorClickBounce"
	| "cursorClickBounceDurationRef"
	| "cursorClickBounceDuration"
	| "cursorSwayRef"
	| "cursorSway"
	| "currentTime"
	| "currentTimeRef"
>;
export function usePlaybackOptionEffects(input: usePlaybackOptionEffectsInput) {
	const {
		connectZoomsRef,
		connectZooms,
		requestPausedFrameRefresh,
		zoomInDurationMsRef,
		zoomInDurationMs,
		zoomInOverlapMsRef,
		zoomInOverlapMs,
		zoomOutDurationMsRef,
		zoomOutDurationMs,
		connectedZoomGapMsRef,
		connectedZoomGapMs,
		connectedZoomDurationMsRef,
		connectedZoomDurationMs,
		zoomInEasingRef,
		zoomInEasing,
		zoomOutEasingRef,
		zoomOutEasing,
		connectedZoomEasingRef,
		connectedZoomEasing,
		cursorTelemetryRef,
		cursorTelemetry,
		showCursorRef,
		showCursor,
		cursorStyleRef,
		cursorStyle,
		cursorSizeRef,
		cursorSize,
		cursorSmoothingRef,
		cursorSmoothing,
		cursorSpringStiffnessMultiplierRef,
		cursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplierRef,
		cursorSpringDampingMultiplier,
		cursorSpringMassMultiplierRef,
		cursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplierRef,
		cameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplierRef,
		cameraSpringDampingMultiplier,
		cameraSpringMassMultiplierRef,
		cameraSpringMassMultiplier,
		zoomSmoothnessRef,
		zoomSmoothness,
		zoomMotionBlurRef,
		zoomMotionBlur,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		motionBlurStateRef,
		zoomMotionBlurTuningRef,
		zoomMotionBlurTuning,
		zoomClassicModeRef,
		zoomClassicMode,
		cursorMotionBlurRef,
		cursorMotionBlur,
		cursorClickEffectRef,
		cursorClickEffect,
		cursorClickEffectColorRef,
		cursorClickEffectColor,
		cursorClickEffectScaleRef,
		cursorClickEffectScale,
		cursorClickEffectOpacityRef,
		cursorClickEffectOpacity,
		cursorClickEffectDurationMsRef,
		cursorClickEffectDurationMs,
		cursorClickBounceRef,
		cursorClickBounce,
		cursorClickBounceDurationRef,
		cursorClickBounceDuration,
		cursorSwayRef,
		cursorSway,
		currentTime,
		currentTimeRef,
	} = input;

	useEffect(() => {
		connectZoomsRef.current = connectZooms;
		requestPausedFrameRefresh();
	}, [connectZooms, requestPausedFrameRefresh, connectZoomsRef]);

	useEffect(() => {
		zoomInDurationMsRef.current = zoomInDurationMs;
		requestPausedFrameRefresh();
	}, [zoomInDurationMs, requestPausedFrameRefresh, zoomInDurationMsRef]);

	useEffect(() => {
		zoomInOverlapMsRef.current = zoomInOverlapMs;
		requestPausedFrameRefresh();
	}, [zoomInOverlapMs, requestPausedFrameRefresh, zoomInOverlapMsRef]);

	useEffect(() => {
		zoomOutDurationMsRef.current = zoomOutDurationMs;
		requestPausedFrameRefresh();
	}, [zoomOutDurationMs, requestPausedFrameRefresh, zoomOutDurationMsRef]);

	useEffect(() => {
		connectedZoomGapMsRef.current = connectedZoomGapMs;
		requestPausedFrameRefresh();
	}, [connectedZoomGapMs, requestPausedFrameRefresh, connectedZoomGapMsRef]);

	useEffect(() => {
		connectedZoomDurationMsRef.current = connectedZoomDurationMs;
		requestPausedFrameRefresh();
	}, [connectedZoomDurationMs, requestPausedFrameRefresh, connectedZoomDurationMsRef]);

	useEffect(() => {
		zoomInEasingRef.current = zoomInEasing;
		requestPausedFrameRefresh();
	}, [zoomInEasing, requestPausedFrameRefresh, zoomInEasingRef]);

	useEffect(() => {
		zoomOutEasingRef.current = zoomOutEasing;
		requestPausedFrameRefresh();
	}, [zoomOutEasing, requestPausedFrameRefresh, zoomOutEasingRef]);

	useEffect(() => {
		connectedZoomEasingRef.current = connectedZoomEasing;
		requestPausedFrameRefresh();
	}, [connectedZoomEasing, requestPausedFrameRefresh, connectedZoomEasingRef]);

	useEffect(() => {
		cursorTelemetryRef.current = cursorTelemetry;
		requestPausedFrameRefresh();
	}, [cursorTelemetry, requestPausedFrameRefresh, cursorTelemetryRef]);

	useEffect(() => {
		showCursorRef.current = showCursor;
		requestPausedFrameRefresh();
	}, [showCursor, requestPausedFrameRefresh, showCursorRef]);

	useEffect(() => {
		cursorStyleRef.current = cursorStyle;
		requestPausedFrameRefresh();
	}, [cursorStyle, requestPausedFrameRefresh, cursorStyleRef]);

	useEffect(() => {
		cursorSizeRef.current = cursorSize;
		requestPausedFrameRefresh();
	}, [cursorSize, requestPausedFrameRefresh, cursorSizeRef]);

	useEffect(() => {
		cursorSmoothingRef.current = cursorSmoothing;
		requestPausedFrameRefresh();
	}, [cursorSmoothing, requestPausedFrameRefresh, cursorSmoothingRef]);

	useEffect(() => {
		cursorSpringStiffnessMultiplierRef.current = cursorSpringStiffnessMultiplier;
		requestPausedFrameRefresh();
	}, [
		cursorSpringStiffnessMultiplier,
		requestPausedFrameRefresh,
		cursorSpringStiffnessMultiplierRef,
	]);

	useEffect(() => {
		cursorSpringDampingMultiplierRef.current = cursorSpringDampingMultiplier;
		requestPausedFrameRefresh();
	}, [
		cursorSpringDampingMultiplier,
		requestPausedFrameRefresh,
		cursorSpringDampingMultiplierRef,
	]);

	useEffect(() => {
		cursorSpringMassMultiplierRef.current = cursorSpringMassMultiplier;
		requestPausedFrameRefresh();
	}, [cursorSpringMassMultiplier, requestPausedFrameRefresh, cursorSpringMassMultiplierRef]);

	useEffect(() => {
		cameraSpringStiffnessMultiplierRef.current = cameraSpringStiffnessMultiplier;
		requestPausedFrameRefresh();
	}, [
		cameraSpringStiffnessMultiplier,
		requestPausedFrameRefresh,
		cameraSpringStiffnessMultiplierRef,
	]);

	useEffect(() => {
		cameraSpringDampingMultiplierRef.current = cameraSpringDampingMultiplier;
		requestPausedFrameRefresh();
	}, [
		cameraSpringDampingMultiplier,
		requestPausedFrameRefresh,
		cameraSpringDampingMultiplierRef,
	]);

	useEffect(() => {
		cameraSpringMassMultiplierRef.current = cameraSpringMassMultiplier;
		requestPausedFrameRefresh();
	}, [cameraSpringMassMultiplier, requestPausedFrameRefresh, cameraSpringMassMultiplierRef]);

	useEffect(() => {
		zoomSmoothnessRef.current = zoomSmoothness;
		requestPausedFrameRefresh();
	}, [zoomSmoothness, requestPausedFrameRefresh, zoomSmoothnessRef]);

	useEffect(() => {
		zoomMotionBlurRef.current = zoomMotionBlur;
		requestPausedFrameRefresh();

		const videoEffectsContainer = videoEffectsContainerRef.current;
		const zoomBlurFilter = zoomBlurFilterRef.current;
		const motionBlurFilter = motionBlurFilterRef.current;

		if (!videoEffectsContainer || !zoomBlurFilter || !motionBlurFilter) {
			return;
		}

		motionBlurStateRef.current = createMotionBlurState();
		videoEffectsContainer.filters =
			zoomMotionBlur > 0 ? [motionBlurFilter, zoomBlurFilter] : null;
	}, [
		zoomMotionBlur,
		requestPausedFrameRefresh,
		zoomMotionBlurRef,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		motionBlurStateRef,
	]);

	useEffect(() => {
		zoomMotionBlurTuningRef.current = zoomMotionBlurTuning;
		requestPausedFrameRefresh();
	}, [zoomMotionBlurTuning, requestPausedFrameRefresh, zoomMotionBlurTuningRef]);

	useEffect(() => {
		zoomClassicModeRef.current = zoomClassicMode;
		requestPausedFrameRefresh();
	}, [zoomClassicMode, requestPausedFrameRefresh, zoomClassicModeRef]);

	useEffect(() => {
		cursorMotionBlurRef.current = cursorMotionBlur;
		requestPausedFrameRefresh();
	}, [cursorMotionBlur, requestPausedFrameRefresh, cursorMotionBlurRef]);

	useEffect(() => {
		cursorClickEffectRef.current = cursorClickEffect;
		requestPausedFrameRefresh();
	}, [cursorClickEffect, requestPausedFrameRefresh, cursorClickEffectRef]);

	useEffect(() => {
		cursorClickEffectColorRef.current = cursorClickEffectColor;
		requestPausedFrameRefresh();
	}, [cursorClickEffectColor, requestPausedFrameRefresh, cursorClickEffectColorRef]);

	useEffect(() => {
		cursorClickEffectScaleRef.current = cursorClickEffectScale;
		requestPausedFrameRefresh();
	}, [cursorClickEffectScale, requestPausedFrameRefresh, cursorClickEffectScaleRef]);

	useEffect(() => {
		cursorClickEffectOpacityRef.current = cursorClickEffectOpacity;
		requestPausedFrameRefresh();
	}, [cursorClickEffectOpacity, requestPausedFrameRefresh, cursorClickEffectOpacityRef]);

	useEffect(() => {
		cursorClickEffectDurationMsRef.current = cursorClickEffectDurationMs;
		requestPausedFrameRefresh();
	}, [cursorClickEffectDurationMs, requestPausedFrameRefresh, cursorClickEffectDurationMsRef]);

	useEffect(() => {
		cursorClickBounceRef.current = cursorClickBounce;
		requestPausedFrameRefresh();
	}, [cursorClickBounce, requestPausedFrameRefresh, cursorClickBounceRef]);

	useEffect(() => {
		cursorClickBounceDurationRef.current = cursorClickBounceDuration;
		requestPausedFrameRefresh();
	}, [cursorClickBounceDuration, requestPausedFrameRefresh, cursorClickBounceDurationRef]);

	useEffect(() => {
		cursorSwayRef.current = cursorSway;
		requestPausedFrameRefresh();
	}, [cursorSway, requestPausedFrameRefresh, cursorSwayRef]);

	useEffect(() => {
		const timeMs = currentTime * 1000;
		currentTimeRef.current = timeMs;
	}, [currentTime, currentTimeRef]);
	return {};
}
