import type { ProjectEditorState } from "./projectPersistenceTypes";
import { clamp, isFiniteNumber } from "./projectPersistenceUtils";
import {
	DEFAULT_WEBCAM_MARGIN,
	DEFAULT_WEBCAM_OVERLAY,
	DEFAULT_WEBCAM_POSITION_PRESET,
	DEFAULT_WEBCAM_POSITION_X,
	DEFAULT_WEBCAM_POSITION_Y,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_ROUNDNESS,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_WEBCAM_TIME_OFFSET_MS,
	type WebcamOverlaySettings,
} from "./types";
import { convertLegacyWebcamRadiusToRoundness, normalizeWebcamCropRegion } from "./webcamOverlay";

export function normalizeProjectWebcam(editor: Partial<ProjectEditorState>): WebcamOverlaySettings {
	const webcam: Partial<WebcamOverlaySettings> =
		editor.webcam && typeof editor.webcam === "object" ? editor.webcam : {};

	const webcamSourcePath = typeof webcam.sourcePath === "string" ? webcam.sourcePath : null;

	const legacyZoomScaleEffect = isFiniteNumber(
		(webcam as Partial<{ zoomScaleEffect: number }>).zoomScaleEffect,
	)
		? (webcam as Partial<{ zoomScaleEffect: number }>).zoomScaleEffect
		: null;
	return {
		shape:
			webcam.shape === "circle" || webcam.shape === "squircle" || webcam.shape === "rectangle"
				? webcam.shape
				: editor.webcam
					? "squircle"
					: DEFAULT_WEBCAM_OVERLAY.shape,
		visibleRanges: Array.isArray(webcam.visibleRanges)
			? webcam.visibleRanges
					.filter(
						(range) =>
							isFiniteNumber(range?.startMs) &&
							isFiniteNumber(range?.endMs) &&
							range.startMs >= 0 &&
							range.endMs > range.startMs,
					)
					.map(({ startMs, endMs }) => ({ startMs, endMs }))
			: undefined,
		enabled:
			typeof webcam.enabled === "boolean" ? webcam.enabled : DEFAULT_WEBCAM_OVERLAY.enabled,
		sourcePath: webcamSourcePath,
		mirror: typeof webcam.mirror === "boolean" ? webcam.mirror : DEFAULT_WEBCAM_OVERLAY.mirror,
		cropRegion: normalizeWebcamCropRegion(webcam.cropRegion),
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
		width: isFiniteNumber(webcam.width)
			? clamp(webcam.width, 10, 100)
			: isFiniteNumber(webcam.size)
				? clamp(webcam.size, 10, 100)
				: DEFAULT_WEBCAM_SIZE,
		height: isFiniteNumber(webcam.height)
			? clamp(webcam.height, 10, 100)
			: isFiniteNumber(webcam.size)
				? clamp(webcam.size, 10, 100)
				: DEFAULT_WEBCAM_SIZE,
		reactToZoom:
			typeof webcam.reactToZoom === "boolean"
				? webcam.reactToZoom
				: legacyZoomScaleEffect != null
					? legacyZoomScaleEffect > 0
					: DEFAULT_WEBCAM_REACT_TO_ZOOM,
		roundness: isFiniteNumber(webcam.roundness)
			? clamp(webcam.roundness, 0, 100)
			: isFiniteNumber(webcam.cornerRadius)
				? convertLegacyWebcamRadiusToRoundness(
						webcam.cornerRadius,
						isFiniteNumber(webcam.width)
							? webcam.width
							: isFiniteNumber(webcam.size)
								? webcam.size
								: DEFAULT_WEBCAM_SIZE,
						isFiniteNumber(webcam.height)
							? webcam.height
							: isFiniteNumber(webcam.size)
								? webcam.size
								: DEFAULT_WEBCAM_SIZE,
					)
				: DEFAULT_WEBCAM_ROUNDNESS,
		shadow: isFiniteNumber(webcam.shadow) ? clamp(webcam.shadow, 0, 1) : DEFAULT_WEBCAM_SHADOW,
		timeOffsetMs: isFiniteNumber(webcam.timeOffsetMs)
			? Math.round(webcam.timeOffsetMs)
			: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		margin: isFiniteNumber(webcam.margin) ? clamp(webcam.margin, 0, 96) : DEFAULT_WEBCAM_MARGIN,
	};
}
