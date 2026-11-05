import type { ExportMp4FrameRate } from "@/lib/exporter/types";

const HD_PIXELS = 1280 * 720;
const FULL_HD_PIXELS = 1920 * 1080;

/** Cloud hardware VBR targets and software fallback ceilings, separate from local quality. */
export function getCloudShareBitrate({
	width,
	height,
	frameRate,
}: {
	width: number;
	height: number;
	frameRate: ExportMp4FrameRate;
}): number {
	const pixels = width * height;
	const base =
		pixels <= HD_PIXELS
			? 2_000_000 * (pixels / HD_PIXELS)
			: 2_000_000 +
				2_000_000 * Math.min(1, (pixels - HD_PIXELS) / (FULL_HD_PIXELS - HD_PIXELS));
	// Give motion more room at 60 FPS without doubling the delivery size.
	return Math.round(Math.max(1_000_000, base) * (frameRate === 60 ? 1.5 : 1));
}
