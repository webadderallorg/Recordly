import { getVideoShadowFilter, VIDEO_SHADOW_REFERENCE_WIDTH } from "@/lib/exporter/shadowProfile";

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
	const scale = Math.max(1, viewportWidth) / VIDEO_SHADOW_REFERENCE_WIDTH;
	const blurPx = Math.max(0, backgroundBlur) * scale;

	return {
		viewportScale: scale,
		backgroundBlurPx: blurPx,
		backgroundOverscanPx: Math.ceil(blurPx * 2),
		shadowFilter: getVideoShadowFilter(scale, shadowIntensity),
	};
}
