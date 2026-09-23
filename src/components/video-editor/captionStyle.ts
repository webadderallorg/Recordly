import type { CaptionWordState } from "./captionLayout";
import { type AutoCaptionSettings, DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

export const CAPTION_FONT_WEIGHT = 400;
export const CAPTION_LINE_HEIGHT = 1.32;

const DEFAULT_CAPTION_REFERENCE_WIDTH = 1920;

/** Converts the configured maximum-width percentage into pixels for a frame or preview. */
export function getCaptionTargetWidth(containerWidth: number, maxWidthPercent: number) {
	return Math.max(1, containerWidth * (maxWidthPercent / 100));
}

/**
 * Scales the authored caption font size from the 1920px reference canvas to the
 * current frame width. Width constraints are intentionally excluded so changing
 * max width affects wrapping without changing the apparent type size.
 *
 * `_maxWidthPercent` remains in the signature for compatibility with existing
 * preview and export call sites.
 */
export function getCaptionScaledFontSize(
	fontSize: number,
	containerWidth: number,
	_maxWidthPercent: number,
) {
	return Math.max(1, fontSize * (containerWidth / DEFAULT_CAPTION_REFERENCE_WIDTH));
}

/** Returns horizontal and vertical caption-box padding proportional to the rendered font size. */
export function getCaptionPadding(fontSize: number) {
	return {
		x: fontSize * 1.1,
		y: fontSize * 0.78,
	};
}

/** Scales a configured corner radius in step with the rendered caption font size. */
export function getCaptionScaledRadius(radius: number, fontSize: number) {
	const baseline = Math.max(1, DEFAULT_AUTO_CAPTION_SETTINGS.fontSize);
	return Math.max(0, radius * (fontSize / baseline));
}

/** Returns the usable text width after subtracting caption-box padding. */
export function getCaptionTextMaxWidth(
	containerWidth: number,
	maxWidthPercent: number,
	fontSize: number,
) {
	const padding = getCaptionPadding(fontSize);
	return Math.max(
		fontSize * 4,
		getCaptionTargetWidth(containerWidth, maxWidthPercent) - padding.x * 2,
	);
}

/**
 * Converts percentage-based caption settings into the pixel-space center point
 * used by canvas and Pixi renderers. `positionY` describes the box's bottom edge,
 * so half the measured box height is subtracted to obtain its center.
 */
export function getCaptionAnchorPosition(
	settings: Pick<AutoCaptionSettings, "positionX" | "positionY">,
	frameWidth: number,
	frameHeight: number,
	boxHeight: number,
) {
	return {
		x: (frameWidth * settings.positionX) / 100,
		y: (frameHeight * settings.positionY) / 100 - boxHeight / 2,
	};
}

export function getCaptionWordVisualState(_hasWordTimings: boolean, _state: CaptionWordState) {
	// Per-word "spoken" highlighting is disabled: word-level timings from the
	// transcriber are unreliable, so captions render as a single uniform block.
	return {
		isInactive: false,
		opacity: 1,
	};
}
