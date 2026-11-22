import { getCaptionFontFamily } from "@/components/video-editor/captionFonts";
import { buildActiveCaptionLayout } from "@/components/video-editor/captionLayout";
import {
	drawCaptionBoxBorder,
	getCaptionBackground,
	getCaptionPreset,
} from "@/components/video-editor/captionPresets";
import {
	CAPTION_LINE_HEIGHT,
	getCaptionBoxCenter,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
} from "@/components/video-editor/captionStyle";
import { type AutoCaptionSettings, type CaptionCue } from "@/components/video-editor/types";
import { drawSquircleOnCanvas, SQUIRCLE_RADIUS_SCALE } from "@/lib/geometry/squircle";
import { drawCaptionLine } from "./captionText";

/** Draw the active caption using the same typography and timing as preview. */
export function renderCaptions(
	ctx: CanvasRenderingContext2D,
	cues: CaptionCue[],
	settings: AutoCaptionSettings,
	width: number,
	height: number,
	timeMs: number,
) {
	if (!settings.enabled || cues.length === 0) {
		return;
	}

	ctx.save();

	const fontSize = getCaptionScaledFontSize(settings.fontSize, width, settings.maxWidth);
	ctx.font = `${getCaptionPreset(settings.style).fontWeight} ${fontSize}px ${getCaptionFontFamily(settings)}`;
	const padding = getCaptionPadding(fontSize, settings.style);

	const activeCaptionLayout = buildActiveCaptionLayout({
		cues,
		timeMs,
		settings,
		maxWidthPx: getCaptionTextMaxWidth(width, settings.maxWidth, fontSize, settings.style),
		measureText: (text) => ctx.measureText(text).width,
	});
	if (!activeCaptionLayout) {
		ctx.restore();
		return;
	}

	const lineHeight = fontSize * CAPTION_LINE_HEIGHT;
	const paddingX = padding.x;
	const paddingY = padding.y;
	const textBlockHeight = activeCaptionLayout.visibleLines.length * lineHeight;
	const boxHeight = textBlockHeight + paddingY * 2;
	const maxMeasuredWidth = activeCaptionLayout.visibleLines.reduce(
		(largest, line) => Math.max(largest, line.width),
		0,
	);
	const boxWidth = Math.min(
		width * (settings.maxWidth / 100) + paddingX * 2,
		maxMeasuredWidth + paddingX * 2,
	);
	const { centerX, centerY } = getCaptionBoxCenter({
		width,
		height,
		boxWidth,
		boxHeight,
		horizontalPosition: settings.horizontalPosition,
		bottomOffset: settings.bottomOffset,
	});

	ctx.translate(centerX, centerY + activeCaptionLayout.translateY);
	ctx.scale(activeCaptionLayout.scale, activeCaptionLayout.scale);
	ctx.globalAlpha = activeCaptionLayout.opacity;

	ctx.fillStyle = getCaptionBackground(settings);
	const radius = getCaptionScaledRadius(settings.boxRadius, fontSize) * SQUIRCLE_RADIUS_SCALE;
	drawSquircleOnCanvas(ctx, {
		x: -boxWidth / 2,
		y: -boxHeight / 2,
		width: boxWidth,
		height: boxHeight,
		radius,
	});
	ctx.fill();
	drawCaptionBoxBorder(
		ctx,
		settings.style,
		-boxWidth / 2,
		-boxHeight / 2,
		boxWidth,
		boxHeight,
		radius,
		fontSize,
	);

	activeCaptionLayout.visibleLines.forEach((line, index) => {
		drawCaptionLine(
			ctx,
			line,
			settings,
			fontSize,
			getCaptionFontFamily(settings),
			0,
			-boxHeight / 2 + paddingY + lineHeight * index,
			activeCaptionLayout.hasWordTimings,
		);
	});

	ctx.restore();
}
