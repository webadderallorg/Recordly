const supportedRates = new Map<number, boolean>();

/** Ask the runtime rather than assuming every platform accepts the same rates. */
export function supportsPreviewPlaybackRate(rate: number): boolean {
	if (!Number.isFinite(rate) || rate <= 0) return false;
	const cached = supportedRates.get(rate);
	if (cached !== undefined) return cached;
	const video = document.createElement("video");
	try {
		video.playbackRate = rate;
		supportedRates.set(rate, true);
		return true;
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "NotSupportedError") throw error;
		supportedRates.set(rate, false);
		return false;
	}
}

/** Contiguous quarter-step range supported by the runtime, anchored at normal speed. */
export function getPreviewPlaybackRateRange(): { min: number; max: number } {
	let min = 1;
	let max = 1;
	while (min > 0.25 && supportsPreviewPlaybackRate(min - 0.25)) min -= 0.25;
	while (max < 30 && supportsPreviewPlaybackRate(max + 0.25)) max += 0.25;
	return { min, max };
}
