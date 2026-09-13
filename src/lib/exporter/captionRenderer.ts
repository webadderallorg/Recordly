import type { AutoCaptionSettings, CaptionCue } from "@/components/video-editor/types";
import { buildCaptionBlock, paintCaptionBlock } from "@/lib/captions/captionPainter";

/** Draw the active caption with the shared caption painter used by preview and export. */
export function renderCaptions(
	ctx: CanvasRenderingContext2D,
	cues: CaptionCue[],
	settings: AutoCaptionSettings,
	frame: { width: number; height: number },
	timeMs: number,
) {
	const block = buildCaptionBlock({ cues, timeMs, settings, frame, measureContext: ctx });
	if (block) {
		paintCaptionBlock(ctx, block, settings);
	}
}
