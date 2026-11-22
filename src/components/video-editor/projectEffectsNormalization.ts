import type { ProjectEditorState } from "./projectPersistenceTypes";
import { clamp, DEFAULT_MOTION_PRESET, isFiniteNumber } from "./projectPersistenceUtils";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_MOTION_BLUR,
	DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	type ZoomMotionBlurTuning,
} from "./types";

export function normalizeProjectEffects(editor: Partial<ProjectEditorState>) {
	const legacyMotionBlurEnabled = (editor as Partial<{ motionBlurEnabled: boolean }>)
		.motionBlurEnabled;

	const legacyShowBlur = (editor as Partial<{ showBlur: boolean }>).showBlur;

	const normalizedZoomMotionBlur = isFiniteNumber(
		(editor as Partial<ProjectEditorState>).zoomMotionBlur,
	)
		? clamp((editor as Partial<ProjectEditorState>).zoomMotionBlur as number, 0, 2)
		: legacyMotionBlurEnabled
			? 0.35
			: DEFAULT_ZOOM_MOTION_BLUR;

	const rawZoomMotionBlurTuning =
		(editor as Partial<ProjectEditorState>).zoomMotionBlurTuning &&
		typeof (editor as Partial<ProjectEditorState>).zoomMotionBlurTuning === "object"
			? ((editor as Partial<ProjectEditorState>)
					.zoomMotionBlurTuning as Partial<ZoomMotionBlurTuning>)
			: {};

	const normalizedZoomMotionBlurTuning: ZoomMotionBlurTuning = {
		panVelocityThreshold: isFiniteNumber(rawZoomMotionBlurTuning.panVelocityThreshold)
			? clamp(rawZoomMotionBlurTuning.panVelocityThreshold, 0, 240)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.panVelocityThreshold,
		zoomVelocityThreshold: isFiniteNumber(rawZoomMotionBlurTuning.zoomVelocityThreshold)
			? clamp(rawZoomMotionBlurTuning.zoomVelocityThreshold, 0, 0.4)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.zoomVelocityThreshold,
		maxDirectionalBlurPx: isFiniteNumber(rawZoomMotionBlurTuning.maxDirectionalBlurPx)
			? clamp(rawZoomMotionBlurTuning.maxDirectionalBlurPx, 0, 96)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxDirectionalBlurPx,
		maxRadialBlurStrength: isFiniteNumber(rawZoomMotionBlurTuning.maxRadialBlurStrength)
			? clamp(rawZoomMotionBlurTuning.maxRadialBlurStrength, 0, 1.5)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxRadialBlurStrength,
		panResponsePerSecond: isFiniteNumber(rawZoomMotionBlurTuning.panResponsePerSecond)
			? clamp(rawZoomMotionBlurTuning.panResponsePerSecond, 1, 30)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.panResponsePerSecond,
		zoomResponsePerSecond: isFiniteNumber(rawZoomMotionBlurTuning.zoomResponsePerSecond)
			? clamp(rawZoomMotionBlurTuning.zoomResponsePerSecond, 1, 30)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.zoomResponsePerSecond,
		zoomSafeZoneRadiusPx: isFiniteNumber(rawZoomMotionBlurTuning.zoomSafeZoneRadiusPx)
			? clamp(rawZoomMotionBlurTuning.zoomSafeZoneRadiusPx, 0, 80)
			: DEFAULT_ZOOM_MOTION_BLUR_TUNING.zoomSafeZoneRadiusPx,
	};

	const normalizedBackgroundBlur = isFiniteNumber(
		(editor as Partial<ProjectEditorState>).backgroundBlur,
	)
		? clamp((editor as Partial<ProjectEditorState>).backgroundBlur as number, 0, 8)
		: legacyShowBlur
			? 2
			: 0;

	const normalizedZoomInDurationMs = isFiniteNumber(editor.zoomInDurationMs)
		? clamp(editor.zoomInDurationMs, 60, 4000)
		: DEFAULT_MOTION_PRESET.zoomInDurationMs;

	const normalizedZoomInOverlapMs = isFiniteNumber(editor.zoomInOverlapMs)
		? clamp(editor.zoomInOverlapMs, 0, normalizedZoomInDurationMs)
		: DEFAULT_ZOOM_IN_OVERLAP_MS;

	const normalizedZoomOutDurationMs = isFiniteNumber(editor.zoomOutDurationMs)
		? clamp(editor.zoomOutDurationMs, 60, 4000)
		: DEFAULT_MOTION_PRESET.zoomOutDurationMs;

	const normalizedConnectedZoomGapMs = isFiniteNumber(editor.connectedZoomGapMs)
		? clamp(editor.connectedZoomGapMs, 0, 5000)
		: DEFAULT_CONNECTED_ZOOM_GAP_MS;

	const normalizedConnectedZoomDurationMs = isFiniteNumber(editor.connectedZoomDurationMs)
		? clamp(editor.connectedZoomDurationMs, 60, 4000)
		: DEFAULT_CONNECTED_ZOOM_DURATION_MS;
	return {
		normalizedZoomMotionBlur,
		normalizedZoomMotionBlurTuning,
		normalizedBackgroundBlur,
		normalizedZoomInDurationMs,
		normalizedZoomInOverlapMs,
		normalizedZoomOutDurationMs,
		normalizedConnectedZoomGapMs,
		normalizedConnectedZoomDurationMs,
	};
}
