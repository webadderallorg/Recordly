import { DEFAULT_AUTO_CAPTION_SETTINGS } from "./types";

export const CAPTION_LINE_HEIGHT = 1.32;

const DEFAULT_CAPTION_REFERENCE_WIDTH = 1920 * (DEFAULT_AUTO_CAPTION_SETTINGS.maxWidth / 100);

export function getCaptionTargetWidth(containerWidth: number, maxWidthPercent: number) {
	return Math.max(1, containerWidth * (maxWidthPercent / 100));
}

export function getCaptionScaledFontSize(
	fontSize: number,
	containerWidth: number,
	maxWidthPercent: number,
) {
	return Math.max(
		14,
		fontSize *
			(getCaptionTargetWidth(containerWidth, maxWidthPercent) /
				DEFAULT_CAPTION_REFERENCE_WIDTH),
	);
}

export function getCaptionPadding(fontSize: number) {
	return {
		x: fontSize * 1.1,
		y: fontSize * 0.78,
	};
}

export function getCaptionScaledRadius(radius: number, fontSize: number) {
	const baseline = Math.max(1, DEFAULT_AUTO_CAPTION_SETTINGS.fontSize);
	return Math.max(0, radius * (fontSize / baseline));
}

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
