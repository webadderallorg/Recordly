export function canShowFloatingWebcamPreview(
	requested: boolean,
	hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return requested && hudOverlayMousePassthroughSupported === true;
}

export function canToggleFloatingWebcamPreview(
	hudOverlayMousePassthroughSupported: boolean | null,
): boolean {
	return hudOverlayMousePassthroughSupported !== false;
}

export interface WebcamPreviewSize {
	width: number;
	height: number;
}

export type WebcamPreviewResizeHandle = "nw" | "ne" | "sw" | "se";

export const WEBCAM_PREVIEW_RESIZE_HANDLES: WebcamPreviewResizeHandle[] = ["nw", "ne", "sw", "se"];
export const WEBCAM_PREVIEW_SIZE_STORAGE_KEY = "recordly.webcam-preview-size";
export const DEFAULT_WEBCAM_PREVIEW_SIZE: WebcamPreviewSize = { width: 288, height: 288 };
const WEBCAM_PREVIEW_MIN_SIZE = 120;
const WEBCAM_PREVIEW_MAX_SIZE = 480;

function clampWebcamPreviewDimension(value: number, max = WEBCAM_PREVIEW_MAX_SIZE): number {
	return Math.min(
		Math.max(value, WEBCAM_PREVIEW_MIN_SIZE),
		Math.min(max, WEBCAM_PREVIEW_MAX_SIZE),
	);
}

export function parseWebcamPreviewSize(stored: string | null): WebcamPreviewSize {
	try {
		const { width, height } = JSON.parse(stored ?? "");
		if (Number.isFinite(width) && Number.isFinite(height)) {
			return {
				width: clampWebcamPreviewDimension(width),
				height: clampWebcamPreviewDimension(height),
			};
		}
	} catch {
		// Missing or corrupt preference: fall back to the default size.
	}
	return DEFAULT_WEBCAM_PREVIEW_SIZE;
}

/**
 * The preview is anchored by its bottom-right corner (CSS right/bottom plus a translate
 * offset), so growing it from an east/south handle also shifts the offset to keep the
 * opposite edge in place. The dragged edge is never pushed past the viewport.
 */
export function resizeWebcamPreview(
	handle: WebcamPreviewResizeHandle,
	start: { left: number; top: number; right: number; bottom: number },
	deltaX: number,
	deltaY: number,
	viewport: WebcamPreviewSize,
): WebcamPreviewSize & { shiftX: number; shiftY: number } {
	const growsEast = handle.endsWith("e");
	const growsSouth = handle.startsWith("s");
	const startWidth = start.right - start.left;
	const startHeight = start.bottom - start.top;
	const width = clampWebcamPreviewDimension(
		startWidth + (growsEast ? deltaX : -deltaX),
		growsEast ? viewport.width - start.left : start.right,
	);
	const height = clampWebcamPreviewDimension(
		startHeight + (growsSouth ? deltaY : -deltaY),
		growsSouth ? viewport.height - start.top : start.bottom,
	);

	return {
		width,
		height,
		shiftX: growsEast ? width - startWidth : 0,
		shiftY: growsSouth ? height - startHeight : 0,
	};
}
