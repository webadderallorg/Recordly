import { CURSOR_MOTION_PRESETS } from "./cursorMotionPresets";
import type { PersistedDevMotionBlurSettings } from "./projectPersistenceTypes";
import { type AutoCaptionAnimation, type ZoomTransitionEasing } from "./types";
export const PROJECT_VERSION = 2;

export const MACOS_DEFAULT_BORDER_RADIUS_PERCENT = 8;

export const LEGACY_BORDER_RADIUS_REFERENCE_PX = 1080;

export function getDefaultBorderRadiusPercent(
	platform = typeof navigator === "undefined" ? "" : navigator.platform,
): number {
	return /mac/i.test(platform) ? MACOS_DEFAULT_BORDER_RADIUS_PERCENT : 0;
}

export function legacyBorderRadiusPixelsToPercent(value: number): number {
	return (value / LEGACY_BORDER_RADIUS_REFERENCE_PX) * 100;
}

export const DEFAULT_MOTION_PRESET = CURSOR_MOTION_PRESETS.focused;

export function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

export function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function stripPersistedDevMotionBlurSettings<T extends PersistedDevMotionBlurSettings>(
	editor: T,
): Omit<T, keyof PersistedDevMotionBlurSettings> {
	const { zoomMotionBlurTuning: _zoomMotionBlurTuning, ...persistedEditor } = editor;

	return persistedEditor;
}

export function normalizeZoomTransitionEasing(
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

export function normalizeAutoCaptionAnimation(
	value: unknown,
	fallback: AutoCaptionAnimation,
): AutoCaptionAnimation {
	return value === "none" || value === "fade" || value === "rise" || value === "pop"
		? value
		: fallback;
}
