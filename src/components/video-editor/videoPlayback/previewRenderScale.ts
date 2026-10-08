/**
 * How sharply the editor preview is rendered. Lower scales draw fewer pixels per
 * frame, which speeds up playback on large or high-DPI displays. Export is unaffected.
 */
export const PREVIEW_RENDER_SCALES = ["auto", "native", "1", "0.75", "0.5", "0.25"] as const;
export type PreviewRenderScale = (typeof PREVIEW_RENDER_SCALES)[number];
export const DEFAULT_PREVIEW_RENDER_SCALE: PreviewRenderScale = "auto";

/** `auto` follows the display but caps 2x+ screens, where the extra pixels barely show. */
const AUTO_MAX_RESOLUTION = 1.5;

export function normalizePreviewRenderScale(value: unknown): PreviewRenderScale {
	return PREVIEW_RENDER_SCALES.includes(value as PreviewRenderScale)
		? (value as PreviewRenderScale)
		: DEFAULT_PREVIEW_RENDER_SCALE;
}

/** Pixi renderer resolution (device pixels per CSS pixel) for a scale choice. */
export function resolvePreviewRenderResolution(
	scale: PreviewRenderScale,
	devicePixelRatio: number,
): number {
	const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
	if (scale === "native") return dpr;
	if (scale === "auto") return Math.min(dpr, AUTO_MAX_RESOLUTION);
	return Number(scale);
}
