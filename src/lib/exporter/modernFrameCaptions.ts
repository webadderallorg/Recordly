import { drawSquircleOnCanvas, SQUIRCLE_RADIUS_SCALE } from "@/lib/geometry/squircle";
import { getCaptionFontFamily } from "@/components/video-editor/captionFonts";
import {
	drawCaptionBoxBorder,
	getCaptionBackground,
	getCaptionPreset,
} from "@/components/video-editor/captionPresets";
import { drawCaptionLine } from "./captionText";
import { Sprite, Texture } from "pixi.js";
import { buildActiveCaptionLayout } from "@/components/video-editor/captionLayout";
import {
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
} from "@/components/video-editor/captionStyle";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { CaptionRenderState, MutableVideoTextureSource } from "./modernFrameTypes";
import { configureHighQuality2DContext } from "./modernFrameUtils";

/** Owns captions resources for one export renderer. */
export class FrameCaptions {
	constructor(private readonly context: Pick<FrameRenderContext, "scene" | "config">) {}

	captionMeasureCanvas: HTMLCanvasElement | null = null;

	captionMeasureCtx: CanvasRenderingContext2D | null = null;

	captionCanvas: HTMLCanvasElement | null = null;

	captionCtx: CanvasRenderingContext2D | null = null;

	captionSprite: Sprite | null = null;

	captionTextureSource: MutableVideoTextureSource | null = null;

	captionRenderKey: string | null = null;

	drawCaptionOverlay(context: CanvasRenderingContext2D): void {
		if (
			!this.context.scene.captionContainer?.visible ||
			!this.captionSprite?.visible ||
			!this.captionCanvas
		) {
			return;
		}

		const drawWidth = this.captionCanvas.width * this.captionSprite.scale.x;
		const drawHeight = this.captionCanvas.height * this.captionSprite.scale.y;
		const drawX = this.captionSprite.x - drawWidth * this.captionSprite.anchor.x;
		const drawY = this.captionSprite.y - drawHeight * this.captionSprite.anchor.y;

		context.save();
		context.globalAlpha = this.captionSprite.alpha;
		context.drawImage(this.captionCanvas, drawX, drawY, drawWidth, drawHeight);
		context.restore();
	}

	setupCaptionResources(): void {
		if (!this.context.config.autoCaptions?.length || !this.context.config.autoCaptionSettings) {
			return;
		}

		this.captionMeasureCanvas = document.createElement("canvas");
		this.captionMeasureCanvas.width = 1;
		this.captionMeasureCanvas.height = 1;
		this.captionMeasureCtx = configureHighQuality2DContext(
			this.captionMeasureCanvas.getContext("2d"),
		);
	}

	buildCaptionRenderState(timeMs: number): CaptionRenderState | null {
		const settings = this.context.config.autoCaptionSettings;
		const cues = this.context.config.autoCaptions;
		const measureCtx = this.captionMeasureCtx;

		if (!settings || !cues?.length || !measureCtx) {
			return null;
		}

		const fontFamily = getCaptionFontFamily(settings);
		const fontSize = getCaptionScaledFontSize(
			settings.fontSize,
			this.context.config.width,
			settings.maxWidth,
		);
		measureCtx.font = `${getCaptionPreset(settings.style).fontWeight} ${fontSize}px ${fontFamily}`;

		const layout = buildActiveCaptionLayout({
			cues,
			timeMs,
			settings,
			maxWidthPx: getCaptionTextMaxWidth(
				this.context.config.width,
				settings.maxWidth,
				fontSize,
				settings.style,
			),
			measureText: (text) => measureCtx.measureText(text).width,
		});
		if (!layout) {
			return null;
		}

		const padding = getCaptionPadding(fontSize, settings.style);
		const lineHeight = fontSize * CAPTION_LINE_HEIGHT;
		const textBlockHeight = layout.visibleLines.length * lineHeight;
		const boxHeight = textBlockHeight + padding.y * 2;
		const maxMeasuredWidth = layout.visibleLines.reduce(
			(largest, line) => Math.max(largest, line.width),
			0,
		);
		const boxWidth = Math.min(
			this.context.config.width * (settings.maxWidth / 100) + padding.x * 2,
			maxMeasuredWidth + padding.x * 2,
		);
		const centerX = this.context.config.width / 2;
		const centerY =
			this.context.config.height -
			(this.context.config.height * settings.bottomOffset) / 100 -
			boxHeight / 2;

		return {
			key: `${layout.blockKey}:${layout.visiblePageIndex}:${layout.activeWordIndex}:${layout.visibleLines.flatMap((line) => line.words.map((word) => word.revealProgress?.toFixed(4) ?? "")).join(",")}`,
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

	ensureCaptionCanvas(width: number, height: number): void {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));

		if (
			this.captionCanvas &&
			this.captionCanvas.width === targetWidth &&
			this.captionCanvas.height === targetHeight &&
			this.captionCtx &&
			this.captionSprite
		) {
			return;
		}

		this.captionCanvas = document.createElement("canvas");
		this.captionCanvas.width = targetWidth;
		this.captionCanvas.height = targetHeight;
		this.captionCtx = configureHighQuality2DContext(this.captionCanvas.getContext("2d"));

		if (!this.captionCtx) {
			throw new Error("Failed to create caption export canvas");
		}

		const nextTexture = Texture.from(this.captionCanvas);
		if (this.captionSprite) {
			const previousTexture = this.captionSprite.texture;
			this.captionSprite.texture = nextTexture;
			this.captionTextureSource = nextTexture.source as unknown as MutableVideoTextureSource;
			previousTexture.destroy(true);
		} else {
			this.captionSprite = new Sprite(nextTexture);
			this.captionSprite.anchor.set(0.5);
			this.context.scene.captionContainer?.addChild(this.captionSprite);
			this.captionTextureSource = nextTexture.source as unknown as MutableVideoTextureSource;
		}
	}

	rasterizeCaptionSprite(state: CaptionRenderState): void {
		this.ensureCaptionCanvas(state.boxWidth, state.boxHeight);

		if (!this.captionCtx || !this.captionCanvas || !this.captionSprite) {
			return;
		}

		const ctx = this.captionCtx;
		const settings = this.context.config.autoCaptionSettings;
		if (!settings) {
			return;
		}

		ctx.clearRect(0, 0, this.captionCanvas.width, this.captionCanvas.height);
		ctx.font = `${getCaptionPreset(settings.style).fontWeight} ${state.fontSize}px ${state.fontFamily}`;
		ctx.fillStyle = getCaptionBackground(settings);
		const radius =
			getCaptionScaledRadius(settings.boxRadius, state.fontSize) * SQUIRCLE_RADIUS_SCALE;
		drawSquircleOnCanvas(ctx, {
			x: 0,
			y: 0,
			width: state.boxWidth,
			height: state.boxHeight,
			radius,
		});
		ctx.fill();
		drawCaptionBoxBorder(
			ctx,
			settings.style,
			0,
			0,
			state.boxWidth,
			state.boxHeight,
			radius,
			state.fontSize,
		);

		const padding = getCaptionPadding(state.fontSize, settings.style);
		state.layout.visibleLines.forEach((line, index) => {
			drawCaptionLine(
				ctx,
				line,
				settings,
				state.fontSize,
				state.fontFamily,
				state.boxWidth / 2,
				padding.y + state.lineHeight * index,
				state.layout.hasWordTimings,
			);
		});

		this.captionTextureSource?.update();
		this.captionRenderKey = state.key;
	}

	updateCaptionLayer(timeMs: number): void {
		const state = this.buildCaptionRenderState(timeMs);
		if (!state || !this.context.scene.captionContainer) {
			if (this.captionSprite) {
				this.captionSprite.visible = false;
			}
			if (this.context.scene.captionContainer) {
				this.context.scene.captionContainer.visible = false;
			}
			this.captionRenderKey = null;
			return;
		}

		const needsReraster =
			!this.captionSprite ||
			!this.captionCanvas ||
			this.captionCanvas.width !== Math.max(1, Math.ceil(state.boxWidth)) ||
			this.captionCanvas.height !== Math.max(1, Math.ceil(state.boxHeight)) ||
			this.captionRenderKey !== state.key;

		if (needsReraster) {
			this.rasterizeCaptionSprite(state);
		}

		if (!this.captionSprite) {
			return;
		}

		this.context.scene.captionContainer.visible = true;
		this.captionSprite.visible = true;
		this.captionSprite.position.set(state.centerX, state.centerY + state.layout.translateY);
		this.captionSprite.scale.set(state.layout.scale);
		this.captionSprite.alpha = state.layout.opacity;
	}
}
