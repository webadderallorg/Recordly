export interface ShadowLayerProfile {
	offsetScale: number;
	alphaScale: number;
	blurScale: number;
}

export const VIDEO_SHADOW_LAYER_PROFILES: ReadonlyArray<ShadowLayerProfile> = Object.freeze([
	{ offsetScale: 12, alphaScale: 0.7, blurScale: 48 },
	{ offsetScale: 4, alphaScale: 0.5, blurScale: 16 },
	{ offsetScale: 2, alphaScale: 0.3, blurScale: 8 },
]);

export const WEBCAM_SHADOW_LAYER_PROFILES: ReadonlyArray<ShadowLayerProfile> = Object.freeze([
	{ offsetScale: 0.06, alphaScale: 0.9, blurScale: 0.22 },
	{ offsetScale: 0.025, alphaScale: 0.8, blurScale: 0.07 },
]);

export function getWebcamShadowStrength(value: number): number {
	return Math.min(1, Math.max(0, Number.isFinite(value) ? value * 2 : 0));
}

export function getWebcamShadowFilter(shadowSize: number, value: number): string {
	const strength = getWebcamShadowStrength(value);
	if (strength <= 0) {
		return "none";
	}

	return WEBCAM_SHADOW_LAYER_PROFILES.map((profile) => {
		const offset = Math.max(0, shadowSize) * profile.offsetScale * strength;
		const blur = Math.max(0, shadowSize) * profile.blurScale * strength;
		const alpha = Math.min(1, profile.alphaScale * strength);
		return `drop-shadow(0 ${offset}px ${blur}px rgba(0, 0, 0, ${alpha}))`;
	}).join(" ");
}

export function getShadowFilterPadding(blur: number, offsetY: number): number {
	return Math.ceil(Math.max(0, blur * 2 + Math.abs(offsetY)));
}
