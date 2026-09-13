import {
	type ActiveCaptionLayout,
	buildActiveCaptionLayout,
	type CaptionWordLayout,
} from "@/components/video-editor/captionLayout";
import {
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
} from "@/components/video-editor/captionStyle";
import {
	type AutoCaptionSettings,
	type CaptionCue,
	DEFAULT_AUTO_CAPTION_SETTINGS,
} from "@/components/video-editor/types";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";
import { buildCaptionFontString, ensureCaptionFontLoaded } from "./captionFonts";

export interface CaptionFrameSize {
	width: number;
	height: number;
}

export interface CaptionTypography {
	fontSize: number;
	font: string;
	lineHeight: number;
	padding: { x: number; y: number };
	outlineWidthPx: number;
}

export interface CaptionBlock {
	layout: ActiveCaptionLayout;
	typography: CaptionTypography;
	boxWidth: number;
	boxHeight: number;
	/** Space around the box that outlines, shadows and highlights may paint into. */
	bleed: number;
	centerX: number;
	centerY: number;
	/** `cueId:cueWordIndex` of words the accent rule emphasizes in the visible caption. */
	accentedWordKeys: ReadonlySet<string>;
	/** Changes whenever the rasterized block would look different. */
	renderKey: string;
}

type CaptionMeasureContext = Pick<CanvasRenderingContext2D, "font" | "measureText">;

const HORIZONTAL_EDGE_MARGIN_RATIO = 0.04;
const POP_HIGHLIGHT_SCALE = 1.12;
const PILL_PADDING_X_EM = 0.2;
// The pill may reach into the surrounding spaces, but never far enough to touch neighbours.
const PILL_MAX_SPACE_FRACTION = 0.4;
const PILL_HEIGHT_EM = 1.25;
const PILL_RADIUS_EM = 0.22;
const SHADOW_BLUR_EM = 0.3;
const SHADOW_OFFSET_EM = 0.08;

/**
 * Pop enlarges the spoken word in place; every word reserves that extra width so the
 * enlarged word never overlaps its neighbours and the line does not reflow per word.
 */
function getWordAdvanceScale(settings: AutoCaptionSettings): number {
	return settings.highlightMode === "pop" ? POP_HIGHLIGHT_SCALE : 1;
}

/** Width of a layout segment (optional leading space + word) including pop reservation. */
function measureCaptionSegment(
	ctx: CaptionMeasureContext,
	segment: string,
	settings: AutoCaptionSettings,
): number {
	const text = applyCaptionTextTransform(segment, settings);
	const word = text.trimStart();
	const leadingWidth =
		word.length < text.length
			? ctx.measureText(text.slice(0, text.length - word.length)).width
			: 0;
	return leadingWidth + ctx.measureText(word).width * getWordAdvanceScale(settings);
}

export function applyCaptionTextTransform(text: string, settings: AutoCaptionSettings): string {
	return settings.uppercase ? text.toLocaleUpperCase() : text;
}

export function resolveCaptionTypography(
	settings: AutoCaptionSettings,
	frameWidth: number,
): CaptionTypography {
	const fontSize = getCaptionScaledFontSize(settings.fontSize, frameWidth, settings.maxWidth);
	return {
		fontSize,
		font: buildCaptionFontString({
			fontId: settings.fontId,
			weight: settings.fontWeight,
			fontSizePx: fontSize,
		}),
		lineHeight: fontSize * CAPTION_LINE_HEIGHT,
		padding: getCaptionPadding(fontSize),
		outlineWidthPx: settings.outlineWidth * (fontSize / DEFAULT_AUTO_CAPTION_SETTINGS.fontSize),
	};
}

/** Loads the caption face before a renderer measures or draws with it. */
export function ensureCaptionSettingsFontLoaded(
	settings: AutoCaptionSettings,
	frameWidth: number,
): Promise<void> {
	return ensureCaptionFontLoaded(resolveCaptionTypography(settings, frameWidth).font);
}

function getCaptionBleed(settings: AutoCaptionSettings, typography: CaptionTypography): number {
	const { fontSize } = typography;
	const shadowExtent =
		settings.shadowOpacity > 0 ? fontSize * (SHADOW_BLUR_EM + SHADOW_OFFSET_EM) : 0;
	const highlightExtent =
		settings.highlightMode === "pop"
			? fontSize * (POP_HIGHLIGHT_SCALE - 1)
			: settings.highlightMode === "pill"
				? fontSize * PILL_PADDING_X_EM
				: 0;
	return Math.ceil(Math.max(typography.outlineWidthPx, shadowExtent, highlightExtent) + 2);
}

export function getCaptionBlockCenter(
	settings: AutoCaptionSettings,
	frame: CaptionFrameSize,
	box: { width: number; height: number },
): { centerX: number; centerY: number } {
	const edgeMarginX = frame.width * HORIZONTAL_EDGE_MARGIN_RATIO;
	const centerX =
		settings.horizontalAlign === "left"
			? edgeMarginX + box.width / 2
			: settings.horizontalAlign === "right"
				? frame.width - edgeMarginX - box.width / 2
				: frame.width / 2;
	const edgeOffsetY = (frame.height * settings.bottomOffset) / 100;
	const centerY =
		settings.verticalPosition === "top"
			? edgeOffsetY + box.height / 2
			: settings.verticalPosition === "middle"
				? frame.height / 2
				: frame.height - edgeOffsetY - box.height / 2;
	return { centerX, centerY };
}

function countWordCharacters(text: string): number {
	return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

function getCueWordTexts(cue: CaptionCue): string[] {
	return cue.words?.length
		? cue.words.map((word) => word.text)
		: cue.text.split(/\s+/).filter(Boolean);
}

/** Resolves which word of each visible caption the automatic accent rule picks out. */
export function getAccentedWordKeys(
	cues: CaptionCue[],
	visibleCueIds: ReadonlySet<string>,
	rule: AutoCaptionSettings["accentRule"],
): Set<string> {
	const keys = new Set<string>();
	if (rule === "none") {
		return keys;
	}
	for (const cue of cues) {
		if (!visibleCueIds.has(cue.id)) continue;
		const texts = getCueWordTexts(cue);
		if (texts.length === 0) continue;
		const index =
			rule === "first-word"
				? 0
				: texts.reduce(
						(best, text, candidate) =>
							countWordCharacters(text) > countWordCharacters(texts[best])
								? candidate
								: best,
						0,
					);
		keys.add(`${cue.id}:${index}`);
	}
	return keys;
}

/** Lays out the caption visible at `timeMs` and resolves where it sits in the frame. */
export function buildCaptionBlock(options: {
	cues: CaptionCue[];
	timeMs: number;
	settings: AutoCaptionSettings;
	frame: CaptionFrameSize;
	measureContext: CaptionMeasureContext;
}): CaptionBlock | null {
	const { settings, frame, measureContext } = options;
	if (!settings.enabled || options.cues.length === 0) {
		return null;
	}

	const typography = resolveCaptionTypography(settings, frame.width);
	measureContext.font = typography.font;
	const layout = buildActiveCaptionLayout({
		cues: options.cues,
		timeMs: options.timeMs,
		settings,
		maxWidthPx: getCaptionTextMaxWidth(frame.width, settings.maxWidth, typography.fontSize),
		measureText: (text) => measureCaptionSegment(measureContext, text, settings),
	});
	if (!layout) {
		return null;
	}

	const widestLine = layout.visibleLines.reduce(
		(widest, line) => Math.max(widest, line.width),
		0,
	);
	const boxWidth = Math.min(
		frame.width * (settings.maxWidth / 100) + typography.padding.x * 2,
		widestLine + typography.padding.x * 2,
	);
	const boxHeight = layout.visibleLines.length * typography.lineHeight + typography.padding.y * 2;

	return {
		layout,
		typography,
		boxWidth,
		boxHeight,
		bleed: getCaptionBleed(settings, typography),
		accentedWordKeys: getAccentedWordKeys(
			options.cues,
			new Set(layout.visibleLines.flatMap((line) => line.words.map((word) => word.cueId))),
			settings.accentRule,
		),
		...getCaptionBlockCenter(settings, frame, { width: boxWidth, height: boxHeight }),
		renderKey: `${layout.blockKey}:${layout.visiblePageIndex}:${layout.activeWordIndex}`,
	};
}

function isHighlightedWord(
	block: CaptionBlock,
	word: CaptionWordLayout,
	settings: AutoCaptionSettings,
) {
	return (
		settings.highlightMode !== "none" && block.layout.hasWordTimings && word.state === "active"
	);
}

function getWordFillColor(
	block: CaptionBlock,
	word: CaptionWordLayout,
	settings: AutoCaptionSettings,
	highlighted: boolean,
): string {
	if (highlighted && (settings.highlightMode === "color" || settings.highlightMode === "pop")) {
		return settings.highlightColor;
	}
	if (word.emphasized || block.accentedWordKeys.has(`${word.cueId}:${word.cueWordIndex}`)) {
		return settings.emphasisColor;
	}
	return settings.textColor;
}

function drawHighlightPill(
	ctx: CanvasRenderingContext2D,
	settings: AutoCaptionSettings,
	fontSize: number,
	word: { x: number; width: number },
) {
	const spaceWidth = ctx.measureText(" ").width;
	const paddingX = Math.min(fontSize * PILL_PADDING_X_EM, spaceWidth * PILL_MAX_SPACE_FRACTION);
	const height = fontSize * PILL_HEIGHT_EM;
	ctx.fillStyle = settings.highlightColor;
	drawSquircleOnCanvas(ctx, {
		x: word.x - paddingX,
		y: -height / 2,
		width: word.width + paddingX * 2,
		height,
		radius: fontSize * PILL_RADIUS_EM,
	});
	ctx.fill();
}

function drawWordGlyphs(
	ctx: CanvasRenderingContext2D,
	options: {
		text: string;
		fillColor: string;
		settings: AutoCaptionSettings;
		typography: CaptionTypography;
	},
) {
	const { settings, typography, text } = options;
	if (settings.shadowOpacity > 0) {
		ctx.shadowColor = `rgba(0, 0, 0, ${settings.shadowOpacity})`;
		ctx.shadowBlur = typography.fontSize * SHADOW_BLUR_EM;
		ctx.shadowOffsetY = typography.fontSize * SHADOW_OFFSET_EM;
	}
	if (typography.outlineWidthPx > 0) {
		// Strokes straddle the glyph edge; doubling the width and filling on top leaves
		// exactly `outlineWidthPx` of outline outside the letters.
		ctx.lineJoin = "round";
		ctx.lineWidth = typography.outlineWidthPx * 2;
		ctx.strokeStyle = settings.outlineColor;
		ctx.strokeText(text, 0, 0);
		ctx.shadowColor = "transparent";
	}
	ctx.fillStyle = options.fillColor;
	ctx.fillText(text, 0, 0);
}

function getLineStartX(block: CaptionBlock, lineWidth: number, settings: AutoCaptionSettings) {
	const innerHalfWidth = block.boxWidth / 2 - block.typography.padding.x;
	if (settings.horizontalAlign === "left") return -innerHalfWidth;
	if (settings.horizontalAlign === "right") return innerHalfWidth - lineWidth;
	return -lineWidth / 2;
}

function drawCaptionWord(
	ctx: CanvasRenderingContext2D,
	block: CaptionBlock,
	settings: AutoCaptionSettings,
	placement: { word: CaptionWordLayout; x: number; y: number },
): number {
	const { word } = placement;
	const leading = word.leadingSpace ? applyCaptionTextTransform(" ", settings) : "";
	const text = applyCaptionTextTransform(word.text, settings);
	const advanceScale = getWordAdvanceScale(settings);
	const leadingWidth = leading ? ctx.measureText(leading).width : 0;
	const textWidth = ctx.measureText(text).width;
	const textSlotWidth = textWidth * advanceScale;
	const highlighted = isHighlightedWord(block, word, settings);
	const { fontSize } = block.typography;

	ctx.save();
	ctx.translate(placement.x + leadingWidth + (textSlotWidth - textWidth) / 2, placement.y);
	if (highlighted && settings.highlightMode === "pill") {
		drawHighlightPill(ctx, settings, fontSize, { x: 0, width: textWidth });
	}
	if (highlighted && settings.highlightMode === "pop") {
		ctx.translate(textWidth / 2, 0);
		ctx.scale(POP_HIGHLIGHT_SCALE, POP_HIGHLIGHT_SCALE);
		ctx.translate(-textWidth / 2, 0);
	}
	drawWordGlyphs(ctx, {
		text,
		fillColor: getWordFillColor(block, word, settings, highlighted),
		settings,
		typography: block.typography,
	});
	ctx.restore();

	return leadingWidth + textSlotWidth;
}

/** Draws the caption box and text centered on the context origin. */
export function drawCaptionBlock(
	ctx: CanvasRenderingContext2D,
	block: CaptionBlock,
	settings: AutoCaptionSettings,
): void {
	const { typography } = block;
	ctx.save();
	ctx.font = typography.font;

	if (settings.backgroundOpacity > 0) {
		ctx.fillStyle = `rgba(0, 0, 0, ${settings.backgroundOpacity})`;
		drawSquircleOnCanvas(ctx, {
			x: -block.boxWidth / 2,
			y: -block.boxHeight / 2,
			width: block.boxWidth,
			height: block.boxHeight,
			radius: getCaptionScaledRadius(settings.boxRadius, typography.fontSize),
		});
		ctx.fill();
	}

	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	block.layout.visibleLines.forEach((line, lineIndex) => {
		const y =
			-block.boxHeight / 2 +
			typography.padding.y +
			typography.lineHeight * lineIndex +
			typography.lineHeight / 2;
		let x = getLineStartX(block, line.width, settings);
		for (const word of line.words) {
			x += drawCaptionWord(ctx, block, settings, { word, x, y });
		}
	});

	ctx.restore();
}

/** Draws the caption at its frame position, applying the block's enter/exit animation. */
export function paintCaptionBlock(
	ctx: CanvasRenderingContext2D,
	block: CaptionBlock,
	settings: AutoCaptionSettings,
): void {
	ctx.save();
	ctx.translate(block.centerX, block.centerY + block.layout.translateY);
	ctx.scale(block.layout.scale, block.layout.scale);
	ctx.globalAlpha *= block.layout.opacity;
	drawCaptionBlock(ctx, block, settings);
	ctx.restore();
}
