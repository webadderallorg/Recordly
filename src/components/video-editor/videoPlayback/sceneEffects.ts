const EFFECT_REFERENCE_WIDTH = 640;

export type SceneEffectMetrics = {
	viewportScale: number;
	backgroundBlurPx: number;
	backgroundOverscanPx: number;
	shadowFilter: string;
};

/**
 * Resolve CSS/canvas effect pixels from the rendered scene width.
 *
 * Preview and export render at very different pixel sizes. Treating effect
 * settings as literal pixels makes the export visibly diverge from the editor.
 * This reference width keeps the setting's appearance proportional at every
 * resolution and gives both compositors one source of truth.
 */
export function getSceneEffectMetrics({
	viewportWidth,
	backgroundBlur,
	shadowIntensity,
}: {
	viewportWidth: number;
	backgroundBlur: number;
	shadowIntensity: number;
}): SceneEffectMetrics {
	const scale = Math.max(1, viewportWidth) / EFFECT_REFERENCE_WIDTH;
	const blurPx = Math.max(0, backgroundBlur) * scale;
	const intensity = Math.max(0, shadowIntensity);
	const shadow = (offsetY: number, blur: number, alpha: number) =>
		`drop-shadow(0 ${offsetY * intensity * scale}px ${blur * intensity * scale}px rgba(0,0,0,${alpha * intensity}))`;

	return {
		viewportScale: scale,
		backgroundBlurPx: blurPx,
		backgroundOverscanPx: Math.ceil(blurPx * 2),
		shadowFilter:
			intensity > 0
				? [shadow(12, 48, 0.7), shadow(4, 16, 0.5), shadow(2, 8, 0.3)].join(" ")
				: "none",
	};
}
