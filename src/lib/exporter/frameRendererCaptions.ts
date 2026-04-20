import { Sprite, Texture } from "pixi.js";
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
import { getDefaultCaptionFontFamily } from "@/components/video-editor/types";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";
import type { CaptionRenderState, MutableVideoTextureSource } from "./frameRendererTypes";
import type { FrameRenderer } from "./modernFrameRenderer";
import { configureHighQuality2DContext } from "./frameRendererHelpers";

export function setupCaptionResources(self: FrameRenderer): void {
	if (!self.config.autoCaptions?.length || !self.config.autoCaptionSettings) {
		return;
	}

	self.captionMeasureCanvas = document.createElement("canvas");
	self.captionMeasureCanvas.width = 1;
	self.captionMeasureCanvas.height = 1;
	self.captionMeasureCtx = configureHighQuality2DContext(
		self.captionMeasureCanvas.getContext("2d"),
	);
}

function buildCaptionRenderState(self: FrameRenderer, timeMs: number): CaptionRenderState | null {
	const settings = self.config.autoCaptionSettings;
	const cues = self.config.autoCaptions;
	const measureCtx = self.captionMeasureCtx;

	if (!settings || !cues?.length || !measureCtx) {
		return null;
	}

	const fontFamily = settings.fontFamily || getDefaultCaptionFontFamily();
	const fontSize = getCaptionScaledFontSize(
		settings.fontSize,
		self.config.width,
		settings.maxWidth,
	);
	measureCtx.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${fontFamily}`;

	const layout = buildActiveCaptionLayout({
		cues,
		timeMs,
		settings,
		maxWidthPx: getCaptionTextMaxWidth(self.config.width, settings.maxWidth, fontSize),
		measureText: (text) => measureCtx.measureText(text).width,
	});
	if (!layout) {
		return null;
	}

	const padding = getCaptionPadding(fontSize);
	const lineHeight = fontSize * CAPTION_LINE_HEIGHT;
	const textBlockHeight = layout.visibleLines.length * lineHeight;
	const boxHeight = textBlockHeight + padding.y * 2;
	const maxMeasuredWidth = layout.visibleLines.reduce(
		(largest, line) => Math.max(largest, line.width),
		0,
	);
	const boxWidth = Math.min(
		self.config.width * (settings.maxWidth / 100) + padding.x * 2,
		maxMeasuredWidth + padding.x * 2,
	);
	const centerX = self.config.width / 2;
	const centerY =
		self.config.height - (self.config.height * settings.bottomOffset) / 100 - boxHeight / 2;

	return {
		key: `${layout.blockKey}:${layout.visiblePageIndex}:${layout.activeWordIndex}`,
		layout,
		fontFamily,
		fontSize,
		lineHeight,
		boxWidth,
		boxHeight,
		centerX,
		centerY,
	};
}

function ensureCaptionCanvas(self: FrameRenderer, width: number, height: number): void {
	const targetWidth = Math.max(1, Math.ceil(width));
	const targetHeight = Math.max(1, Math.ceil(height));

	if (
		self.captionCanvas &&
		self.captionCanvas.width === targetWidth &&
		self.captionCanvas.height === targetHeight &&
		self.captionCtx &&
		self.captionSprite
	) {
		return;
	}

	self.captionCanvas = document.createElement("canvas");
	self.captionCanvas.width = targetWidth;
	self.captionCanvas.height = targetHeight;
	self.captionCtx = configureHighQuality2DContext(self.captionCanvas.getContext("2d"));

	if (!self.captionCtx) {
		throw new Error("Failed to create caption export canvas");
	}

	const nextTexture = Texture.from(self.captionCanvas);
	if (self.captionSprite) {
		const previousTexture = self.captionSprite.texture;
		self.captionSprite.texture = nextTexture;
		self.captionTextureSource = nextTexture.source as unknown as MutableVideoTextureSource;
		previousTexture.destroy(true);
	} else {
		self.captionSprite = new Sprite(nextTexture);
		self.captionSprite.anchor.set(0.5);
		self.captionContainer?.addChild(self.captionSprite);
		self.captionTextureSource = nextTexture.source as unknown as MutableVideoTextureSource;
	}
}

function rasterizeCaptionSprite(self: FrameRenderer, state: CaptionRenderState): void {
	ensureCaptionCanvas(self, state.boxWidth, state.boxHeight);

	if (!self.captionCtx || !self.captionCanvas || !self.captionSprite) {
		return;
	}

	const ctx = self.captionCtx;
	const settings = self.config.autoCaptionSettings;
	if (!settings) {
		return;
	}

	ctx.clearRect(0, 0, self.captionCanvas.width, self.captionCanvas.height);
	ctx.font = `${CAPTION_FONT_WEIGHT} ${state.fontSize}px ${state.fontFamily}`;
	ctx.fillStyle = `rgba(0, 0, 0, ${settings.backgroundOpacity})`;
	drawSquircleOnCanvas(ctx, {
		x: 0,
		y: 0,
		width: state.boxWidth,
		height: state.boxHeight,
		radius: getCaptionScaledRadius(settings.boxRadius, state.fontSize),
	});
	ctx.fill();

	const padding = getCaptionPadding(state.fontSize);
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";

	state.layout.visibleLines.forEach((line, lineIndex) => {
		let cursorX = (state.boxWidth - line.width) / 2;
		const lineY = padding.y + state.lineHeight * lineIndex + state.lineHeight / 2;

		line.words.forEach((word) => {
			const segmentText = `${word.leadingSpace ? " " : ""}${word.text}`;
			const segmentWidth = ctx.measureText(segmentText).width;
			const visualState = getCaptionWordVisualState(
				state.layout.hasWordTimings,
				word.state,
			);

			ctx.save();
			ctx.translate(cursorX, lineY);
			ctx.fillStyle = visualState.isInactive
				? settings.inactiveTextColor
				: settings.textColor;
			ctx.globalAlpha = visualState.opacity;
			ctx.fillText(segmentText, 0, 0);
			ctx.restore();

			cursorX += segmentWidth;
		});
	});

	self.captionTextureSource?.update();
	self.captionRenderKey = state.key;
}

export function updateCaptionLayer(self: FrameRenderer, timeMs: number): void {
	const state = buildCaptionRenderState(self, timeMs);
	if (!state || !self.captionContainer) {
		if (self.captionSprite) {
			self.captionSprite.visible = false;
		}
		if (self.captionContainer) {
			self.captionContainer.visible = false;
		}
		self.captionRenderKey = null;
		return;
	}

	const needsReraster =
		!self.captionSprite ||
		!self.captionCanvas ||
		self.captionCanvas.width !== Math.max(1, Math.ceil(state.boxWidth)) ||
		self.captionCanvas.height !== Math.max(1, Math.ceil(state.boxHeight)) ||
		self.captionRenderKey !== state.key;

	if (needsReraster) {
		rasterizeCaptionSprite(self, state);
	}

	if (!self.captionSprite) {
		return;
	}

	self.captionContainer.visible = true;
	self.captionSprite.visible = true;
	self.captionSprite.position.set(state.centerX, state.centerY + state.layout.translateY);
	self.captionSprite.scale.set(state.layout.scale);
	self.captionSprite.alpha = state.layout.opacity;
}
