export interface WebcamBackgroundBlurSettings {
	enabled: boolean;
	amount: number;
}

export const WEBCAM_BACKGROUND_BLUR_MIN = 1;
export const WEBCAM_BACKGROUND_BLUR_MAX = 20;
export const DEFAULT_WEBCAM_BACKGROUND_BLUR: WebcamBackgroundBlurSettings = Object.freeze({
	enabled: false,
	amount: 12,
});

export function normalizeWebcamBackgroundBlurSettings(
	value: unknown,
): WebcamBackgroundBlurSettings {
	const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	const amount =
		typeof candidate.amount === "number" && Number.isFinite(candidate.amount)
			? Math.min(
					WEBCAM_BACKGROUND_BLUR_MAX,
					Math.max(WEBCAM_BACKGROUND_BLUR_MIN, Math.round(candidate.amount)),
				)
			: DEFAULT_WEBCAM_BACKGROUND_BLUR.amount;

	return {
		enabled:
			typeof candidate.enabled === "boolean"
				? candidate.enabled
				: DEFAULT_WEBCAM_BACKGROUND_BLUR.enabled,
		amount,
	};
}
