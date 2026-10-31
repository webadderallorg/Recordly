import { buildActiveCaptionLayout } from "@/components/video-editor/captionLayout";
import {
	CAPTION_FONT_WEIGHT,
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
	getCaptionWordVisualState,
} from "@/components/video-editor/captionStyle";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	getDefaultCaptionFontFamily,
} from "@/components/video-editor/types";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";

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
	ctx.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${settings.fontFamily || getDefaultCaptionFontFamily()}`;
	const padding = getCaptionPadding(fontSize);

	const activeCaptionLayout = buildActiveCaptionLayout({
		cues,
		timeMs,
		settings,
		maxWidthPx: getCaptionTextMaxWidth(width, settings.maxWidth, fontSize),
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
	const centerX = width / 2;
	const centerY = height - (height * settings.bottomOffset) / 100 - boxHeight / 2;
	const maxMeasuredWidth = activeCaptionLayout.visibleLines.reduce(
		(largest, line) => Math.max(largest, line.width),
		0,
	);
	const boxWidth = Math.min(
		width * (settings.maxWidth / 100) + paddingX * 2,
		maxMeasuredWidth + paddingX * 2,
	);

	ctx.translate(centerX, centerY + activeCaptionLayout.translateY);
	ctx.scale(activeCaptionLayout.scale, activeCaptionLayout.scale);
	ctx.globalAlpha = activeCaptionLayout.opacity;

	ctx.fillStyle = `rgba(0, 0, 0, ${settings.backgroundOpacity})`;
	drawSquircleOnCanvas(ctx, {
		x: -boxWidth / 2,
		y: -boxHeight / 2,
		width: boxWidth,
		height: boxHeight,
		radius: getCaptionScaledRadius(settings.boxRadius, fontSize),
	});
	ctx.fill();

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";

	activeCaptionLayout.visibleLines.forEach((line, lineIndex) => {
		let cursorX = -line.width / 2;
		const lineY = -boxHeight / 2 + paddingY + lineHeight * lineIndex + lineHeight / 2;

		line.words.forEach((word) => {
			const segmentText = `${word.leadingSpace ? " " : ""}${word.text}`;
			const segmentWidth = ctx.measureText(segmentText).width;
			const visualState = getCaptionWordVisualState(
				activeCaptionLayout.hasWordTimings,
				word.state,
			);

			ctx.save();
			ctx.translate(cursorX, lineY);
			ctx.fillStyle = visualState.isInactive
				? settings.inactiveTextColor
				: settings.textColor;
			ctx.globalAlpha = activeCaptionLayout.opacity * visualState.opacity;
			ctx.fillText(segmentText, 0, 0);
			ctx.restore();

			cursorX += segmentWidth;
		});
	});

	ctx.restore();
}
