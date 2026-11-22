import { translate } from "@/i18n/runtime";
export type ShareResolution = 720 | 1080;

export function getShareResolution(plan?: string): ShareResolution {
	return plan === "pro" ? 1080 : 720;
}

/** Fit inside the landscape or portrait HD frame without upscaling. */
export function capShareDimensions(
	dimensions: { width: number; height: number },
	resolution: ShareResolution,
): { width: number; height: number } {
	const { width, height } = dimensions;
	if (![width, height].every((value) => Number.isFinite(value) && value >= 2))
		throw new Error(translate("ui.shareDimensionsNotReady"));
	const longEdge = resolution === 1080 ? 1920 : 1280;
	const scale = Math.min(
		1,
		longEdge / Math.max(width, height),
		resolution / Math.min(width, height),
	);
	const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
	return { width: even(width * scale), height: even(height * scale) };
}
