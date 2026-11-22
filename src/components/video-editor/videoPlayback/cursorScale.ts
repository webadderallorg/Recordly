export const CURSOR_REFERENCE_VIEWPORT_WIDTH = 1920;

export function getCursorViewportScale(viewportWidth: number, minimumScale = 0): number {
	return Math.max(minimumScale, Math.max(0, viewportWidth) / CURSOR_REFERENCE_VIEWPORT_WIDTH);
}
