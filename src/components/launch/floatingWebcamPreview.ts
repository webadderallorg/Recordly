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

export interface PreviewViewportSize {
	width: number;
	height: number;
}

/**
 * Bounds the dragged preview must stay inside: the window that renders it, not
 * the display. The HUD overlay covers the work area (menu bar and Dock
 * excluded), so the screen size overshoots the window's bottom edge — dragging
 * the preview into that band moves it outside the window, where it clips and
 * disappears. The screen is only a fallback for a degenerate zero viewport.
 */
export function resolvePreviewViewport(
	inner: PreviewViewportSize,
	screen?: PreviewViewportSize | null,
): PreviewViewportSize {
	return {
		width: inner.width > 0 ? inner.width : (screen?.width ?? 0),
		height: inner.height > 0 ? inner.height : (screen?.height ?? 0),
	};
}

/** Keeps the preview fully inside `viewport`, so it can never be dragged out of sight. */
export function clampPreviewPosition(
	position: { left: number; top: number },
	previewSize: PreviewViewportSize,
	viewport: PreviewViewportSize,
): { left: number; top: number } {
	const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));

	return {
		left: clamp(position.left, viewport.width - previewSize.width),
		top: clamp(position.top, viewport.height - previewSize.height),
	};
}
