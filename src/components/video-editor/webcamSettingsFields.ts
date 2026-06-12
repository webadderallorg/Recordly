import { DEFAULT_WEBCAM_OVERLAY, type WebcamOverlaySettings } from "./types";

/**
 * Layout fields are portable across recordings (presets, preferences).
 * Per-recording fields (sourcePath, timeOffsetMs, enabled) belong to a
 * specific recording's webcam capture and must never travel with a preset.
 */
export type WebcamLayoutFields = Pick<
	WebcamOverlaySettings,
	| "mirror"
	| "cropRegion"
	| "corner"
	| "positionPreset"
	| "positionX"
	| "positionY"
	| "size"
	| "reactToZoom"
	| "cornerRadius"
	| "shadow"
	| "margin"
>;

export function pickWebcamLayoutFields(webcam: WebcamOverlaySettings): WebcamLayoutFields {
	return {
		mirror: webcam.mirror,
		cropRegion: { ...webcam.cropRegion },
		corner: webcam.corner,
		positionPreset: webcam.positionPreset,
		positionX: webcam.positionX,
		positionY: webcam.positionY,
		size: webcam.size,
		reactToZoom: webcam.reactToZoom,
		cornerRadius: webcam.cornerRadius,
		shadow: webcam.shadow,
		margin: webcam.margin,
	};
}

export function stripWebcamPerRecordingFields(
	webcam: WebcamOverlaySettings,
): WebcamOverlaySettings {
	return {
		...webcam,
		...pickWebcamLayoutFields(webcam),
		enabled: false,
		sourcePath: null,
		timeOffsetMs: DEFAULT_WEBCAM_OVERLAY.timeOffsetMs,
	};
}
