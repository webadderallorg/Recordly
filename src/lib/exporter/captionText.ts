import { drawSquircleOnCanvas, SQUIRCLE_RADIUS_SCALE } from "@/lib/geometry/squircle";
import type { CaptionLineLayout } from "@/components/video-editor/captionLayout";
import {
	getCaptionDisplayText,
	getCaptionPreset,
	getCaptionWordColor,
	getCaptionWordOutline,
} from "@/components/video-editor/captionPresets";
import {
	CAPTION_LINE_HEIGHT,
	getCaptionFontBaseline,
	CAPTION_WORD_HIGHLIGHT,
	getCaptionWordVisualState,
} from "@/components/video-editor/captionStyle";
import type { AutoCaptionSettings } from "@/components/video-editor/types";

/** Natural word spacing and one alphabetic baseline, shared by both exporters. */
export function drawCaptionLine(
	ctx: CanvasRenderingContext2D,
	line: CaptionLineLayout,
	settings: AutoCaptionSettings,
	fontSize: number,
	fontFamily: string,
	centerX: number,
	top: number,
	hasWordTimings: boolean,
) {
	const preset = getCaptionPreset(settings.style);
	const font = (size: number) => `${preset.fontWeight} ${size}px ${fontFamily}`;
	ctx.save();
	ctx.font = font(fontSize);
	const metrics = ctx.measureText("Hg");
	const ascent = metrics.fontBoundingBoxAscent ?? fontSize * 0.8;
	const descent = metrics.fontBoundingBoxDescent ?? fontSize * 0.2;
	const baseline = top + (fontSize * CAPTION_LINE_HEIGHT - ascent - descent) / 2 + ascent;
	const spaceWidth = ctx.measureText(" ").width;
	const textBaseline = getCaptionFontBaseline(fontSize, metrics);
	const segments = line.words.map((word) => {
		const text = getCaptionDisplayText(word.text, settings.style);
		return {
			word,
			text,
			visual: getCaptionWordVisualState(hasWordTimings, word.state),
			width: ctx.measureText(text).width,
		};
	});
	const width = segments.reduce(
		(sum, item) => sum + item.width + (item.word.leadingSpace ? spaceWidth : 0),
		0,
	);
	let x = centerX - width / 2;
	const positioned = segments.map((segment) => {
		if (segment.word.leadingSpace) x += spaceWidth;
		const position = x;
		x += segment.width;
		return { ...segment, x: position };
	});
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	// The independent active visual paints above its neighbours, just as in DOM.
	positioned.sort((a, b) => Number(a.visual.isHighlighted) - Number(b.visual.isHighlighted));
	for (const { text, word, visual, width: wordWidth, x } of positioned) {
		// Emphasis changes only color and background; typography stays fixed.
		ctx.save();
		if (word.revealProgress !== undefined) {
			ctx.globalAlpha *= word.revealProgress;
			ctx.filter = `blur(${(1 - word.revealProgress) * fontSize * 0.18}px)`;
		}
		ctx.translate(x + wordWidth / 2, baseline);
		const drawX = -wordWidth / 2;
		if (visual.isHighlighted && preset.highlightFill) {
			const padX = fontSize * CAPTION_WORD_HIGHLIGHT.paddingXEm;
			const padY = fontSize * CAPTION_WORD_HIGHLIGHT.paddingYEm;
			drawSquircleOnCanvas(ctx, {
				x: drawX - padX,
				y: -textBaseline - padY,
				width: wordWidth + padX * 2,
				height: fontSize + padY * 2,
				radius: fontSize * CAPTION_WORD_HIGHLIGHT.radiusEm * SQUIRCLE_RADIUS_SCALE,
			});
			ctx.fillStyle = preset.highlightFill;
			ctx.fill();
		}
		ctx.fillStyle = getCaptionWordColor(settings, visual);
		const outline = getCaptionWordOutline(settings, visual);
		if (outline) {
			ctx.strokeStyle = "#000000";
			ctx.lineWidth = fontSize * outline;
			ctx.lineJoin = "round";
			ctx.strokeText(text, drawX, 0);
		}
		ctx.fillText(text, drawX, 0);
		ctx.restore();
	}
	ctx.restore();
}
