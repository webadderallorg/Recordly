export interface ShadowLayerProfile {
	offsetScale: number;
	alphaScale: number;
	blurScale: number;
}

export const VIDEO_SHADOW_REFERENCE_WIDTH = 640;

// macOS-style ambient + contact shadows, in pixels at the 640px scene reference
// width. The broad layer lifts the window; the tighter, denser layer defines its
// edge. This is a visual approximation of the window shadow, not an Apple API.
export const VIDEO_SHADOW_LAYER_PROFILES: ReadonlyArray<ShadowLayerProfile> = Object.freeze([
	{ offsetScale: 12, alphaScale: 0.24, blurScale: 28 },
	{ offsetScale: 2, alphaScale: 0.38, blurScale: 3 },
]);

// Use the same falloff on camera bubbles, relative to a 200px bubble.
export const WEBCAM_SHADOW_LAYER_PROFILES: ReadonlyArray<ShadowLayerProfile> = Object.freeze(
	VIDEO_SHADOW_LAYER_PROFILES.map((profile) => ({
		offsetScale: profile.offsetScale / 200,
		alphaScale: profile.alphaScale,
		blurScale: profile.blurScale / 200,
	})),
);

export function getVideoShadowStrength(value: number): number {
	// 50% now matches the original full-strength profile; 100% has twice the reach/density.
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 2;
}

function getShadowFilter(
	profiles: ReadonlyArray<ShadowLayerProfile>,
	size: number,
	strength: number,
): string {
	if (strength <= 0) return "none";
	return profiles
		.map((profile) => {
			const offset = Math.max(0, size) * profile.offsetScale * strength;
			const blur = Math.max(0, size) * profile.blurScale * strength;
			const alpha = profile.alphaScale * strength;
			return `drop-shadow(0 ${offset}px ${blur}px rgba(0, 0, 0, ${alpha}))`;
		})
		.join(" ");
}

export function getVideoShadowFilter(viewportScale: number, value: number): string {
	return getShadowFilter(
		VIDEO_SHADOW_LAYER_PROFILES,
		viewportScale,
		getVideoShadowStrength(value),
	);
}

export function getWebcamShadowStrength(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value * 2 : 0));
}

export function getWebcamShadowFilter(shadowSize: number, value: number): string {
	return getShadowFilter(
		WEBCAM_SHADOW_LAYER_PROFILES,
		shadowSize,
		getWebcamShadowStrength(value),
	);
}

export function getShadowFilterPadding(blur: number, offsetY: number): number {
	return Math.ceil(Math.max(0, blur * 3 + Math.abs(offsetY)));
}

/** Chained drop-shadows expand each previous shadow; reserve the sum of their extents. */
export function getWebcamShadowPadding(shadowSize: number, value: number): number {
	const strength = getWebcamShadowStrength(value);
	return Math.ceil(
		WEBCAM_SHADOW_LAYER_PROFILES.reduce(
			(padding, profile) =>
				padding +
				getShadowFilterPadding(
					shadowSize * profile.blurScale * strength,
					shadowSize * profile.offsetScale * strength,
				),
			0,
		),
	);
}
