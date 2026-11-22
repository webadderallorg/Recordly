import { Container, Sprite, Texture } from "pixi.js";
import { getSceneEffectMetrics } from "@/components/video-editor/videoPlayback/sceneEffects";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { MutableVideoTextureSource, ShadowLayer } from "./modernFrameTypes";
import { configureHighQuality2DContext } from "./modernFrameUtils";
import { getShadowFilterPadding, getVideoShadowStrength } from "./shadowProfile";

/** Owns shadows resources for one export renderer. */
export class FrameShadows {
	constructor(private readonly context: Pick<FrameRenderContext, "config">) {}

	videoShadowLayers: ShadowLayer[] = [];

	createShadowLayers(
		parent: Container,
		configs: ReadonlyArray<{
			offsetScale: number;
			alphaScale: number;
			blurScale: number;
		}>,
	): ShadowLayer[] {
		return configs.map((config) => {
			const container = new Container();
			container.visible = false;
			parent.addChild(container);

			return {
				container,
				sprite: null,
				canvas: null,
				context: null,
				textureSource: null,
				...config,
			};
		});
	}

	ensureShadowLayerCanvas(layer: ShadowLayer, width: number, height: number): void {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));

		if (
			layer.canvas &&
			layer.canvas.width === targetWidth &&
			layer.canvas.height === targetHeight &&
			layer.context &&
			layer.sprite
		) {
			return;
		}

		layer.canvas = document.createElement("canvas");
		layer.canvas.width = targetWidth;
		layer.canvas.height = targetHeight;
		layer.context = configureHighQuality2DContext(layer.canvas.getContext("2d"));

		if (!layer.context) {
			throw new Error("Failed to create shadow export canvas");
		}

		const nextTexture = Texture.from(layer.canvas);
		if (layer.sprite) {
			const previousTexture = layer.sprite.texture;
			layer.sprite.texture = nextTexture;
			layer.textureSource = nextTexture.source as unknown as MutableVideoTextureSource;
			previousTexture.destroy(true);
		} else {
			layer.sprite = new Sprite(nextTexture);
			layer.container.addChild(layer.sprite);
			layer.textureSource = nextTexture.source as unknown as MutableVideoTextureSource;
		}
	}

	rasterizeShadowLayer(
		layer: ShadowLayer,
		options: {
			x: number;
			y: number;
			width: number;
			height: number;
			radius: number;
			offsetY: number;
			alpha: number;
			blur: number;
			cornerExponent?: number;
		},
	): void {
		if (options.alpha <= 0 || options.width <= 0 || options.height <= 0) {
			layer.container.visible = false;
			return;
		}

		const padding = getShadowFilterPadding(options.blur, options.offsetY);
		this.ensureShadowLayerCanvas(
			layer,
			options.width + padding * 2,
			options.height + padding * 2,
		);

		if (!layer.context || !layer.canvas || !layer.sprite) {
			layer.container.visible = false;
			return;
		}

		layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
		layer.context.save();
		layer.context.filter = options.blur > 0 ? `blur(${options.blur}px)` : "none";
		layer.context.fillStyle = `rgba(0, 0, 0, ${options.alpha})`;
		drawSquircleOnCanvas(layer.context, {
			x: padding,
			y: padding + options.offsetY,
			width: options.width,
			height: options.height,
			radius: options.radius,
			exponent: options.cornerExponent,
		});
		layer.context.fill();
		layer.context.restore();

		layer.sprite.position.set(options.x - padding, options.y - padding);
		layer.textureSource?.update();
		layer.container.alpha = 1;
		layer.container.visible = true;
	}

	updateVideoShadowLayout(layout: {
		maskX: number;
		maskY: number;
		maskWidth: number;
		maskHeight: number;
		maskRadius: number;
	}): void {
		const shadowStrength = getVideoShadowStrength(this.context.config.shadowIntensity);
		const effectScale = getSceneEffectMetrics({
			viewportWidth: this.context.config.width,
			backgroundBlur: 0,
			shadowIntensity: shadowStrength,
		}).viewportScale;
		for (const layer of this.videoShadowLayers) {
			if (!this.context.config.showShadow || shadowStrength <= 0) {
				layer.container.visible = false;
				continue;
			}

			const offsetY = layer.offsetScale * effectScale * shadowStrength;
			this.rasterizeShadowLayer(layer, {
				x: layout.maskX,
				y: layout.maskY,
				width: layout.maskWidth,
				height: layout.maskHeight,
				radius: layout.maskRadius,
				offsetY,
				alpha: layer.alphaScale * shadowStrength,
				blur: Math.max(0, layer.blurScale * effectScale * shadowStrength),
			});
		}
	}
}
