import { Application, Container, Sprite, Texture } from "pixi.js";
import { DEFAULT_FOCUS } from "@/components/video-editor/videoPlayback/constants";
import { drawSquircleOnCanvas } from "@/lib/geometry/squircle";
import { getShadowFilterPadding } from "./shadowProfile";
import type { AnimationState, MutableVideoTextureSource, ShadowLayer } from "./frameRendererTypes";
import type { ExportRenderBackend } from "./types";

export function createAnimationState(): AnimationState {
	return {
		scale: 1,
		appliedScale: 1,
		focusX: DEFAULT_FOCUS.cx,
		focusY: DEFAULT_FOCUS.cy,
		progress: 0,
		x: 0,
		y: 0,
	};
}

export function configureHighQuality2DContext(
	context: CanvasRenderingContext2D | null,
): CanvasRenderingContext2D | null {
	if (!context) {
		return null;
	}

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";

	return context;
}

export function drawSourceCoverToCanvas(
	ctx: CanvasRenderingContext2D,
	source: CanvasImageSource,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
): void {
	const safeSourceWidth = Math.max(1, sourceWidth);
	const safeSourceHeight = Math.max(1, sourceHeight);
	const sourceAspect = safeSourceWidth / safeSourceHeight;
	const targetAspect = targetWidth / targetHeight;

	let drawWidth = targetWidth;
	let drawHeight = targetHeight;
	let drawX = 0;
	let drawY = 0;

	if (sourceAspect > targetAspect) {
		drawHeight = targetHeight;
		drawWidth = drawHeight * sourceAspect;
		drawX = (targetWidth - drawWidth) / 2;
	} else {
		drawWidth = targetWidth;
		drawHeight = drawWidth / sourceAspect;
		drawY = (targetHeight - drawHeight) / 2;
	}

	ctx.clearRect(0, 0, targetWidth, targetHeight);
	ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
}

export function applyCoverLayoutToSprite(
	sprite: Sprite,
	sourceWidth: number,
	sourceHeight: number,
	targetWidth: number,
	targetHeight: number,
	centerX: number,
	centerY: number,
	mirror = false,
): void {
	const safeSourceWidth = Math.max(1, sourceWidth);
	const safeSourceHeight = Math.max(1, sourceHeight);
	const coverScale = Math.max(targetWidth / safeSourceWidth, targetHeight / safeSourceHeight);

	sprite.anchor.set(0.5);
	sprite.position.set(centerX, centerY);
	sprite.scale.set(coverScale * (mirror ? -1 : 1), coverScale);
}

export function clampUnitInterval(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function areNearlyEqual(first: number, second: number, epsilon = 0.01): boolean {
	return Math.abs(first - second) <= epsilon;
}

export const VIDEO_FRAME_STARTUP_STAGING_WINDOW_SEC = 2.25;

export function createShadowLayers(
	parent: Container,
	configs: ReadonlyArray<{ offsetScale: number; alphaScale: number; blurScale: number }>,
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

export function ensureShadowLayerCanvas(layer: ShadowLayer, width: number, height: number): void {
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

export function rasterizeShadowLayer(
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
	},
): void {
	if (options.alpha <= 0 || options.width <= 0 || options.height <= 0) {
		layer.container.visible = false;
		return;
	}

	const padding = getShadowFilterPadding(options.blur, options.offsetY);
	ensureShadowLayerCanvas(
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
	});
	layer.context.fill();
	layer.context.restore();

	layer.sprite.position.set(options.x - padding, options.y - padding);
	layer.textureSource?.update();
	layer.container.alpha = 1;
	layer.container.visible = true;
}

export async function createPixiApplication(
	canvas: HTMLCanvasElement,
	config: { width: number; height: number; preferredRenderBackend?: ExportRenderBackend },
): Promise<{ app: Application; backend: ExportRenderBackend }> {
	const baseOptions = {
		canvas,
		width: config.width,
		height: config.height,
		backgroundAlpha: 0,
		antialias: true,
		failIfMajorPerformanceCaveat: false,
		resolution: 1,
		autoDensity: true,
		autoStart: false,
		sharedTicker: false,
		powerPreference: "high-performance" as const,
	};

	const preferredRenderBackend = config.preferredRenderBackend;
	const backendOrder: ExportRenderBackend[] =
		preferredRenderBackend === "webgl"
			? ["webgl", "webgpu"]
			: preferredRenderBackend === "webgpu"
				? ["webgpu", "webgl"]
				: typeof navigator !== "undefined" && "gpu" in navigator
					? ["webgpu", "webgl"]
					: ["webgl"];
	let lastError: unknown = null;

	for (const backend of backendOrder) {
		if (backend === "webgpu") {
			if (!(typeof navigator !== "undefined" && "gpu" in navigator)) {
				continue;
			}

			const webgpuApp = new Application();
			try {
				await webgpuApp.init({
					...baseOptions,
					preference: "webgpu",
				});
				return { app: webgpuApp, backend: "webgpu" };
			} catch (error) {
				lastError = error;
				console.warn(
					"[FrameRenderer] WebGPU export renderer unavailable; trying next backend:",
					error,
				);
				webgpuApp.destroy(true);
			}
			continue;
		}

		const webglApp = new Application();
		try {
			await webglApp.init({
				...baseOptions,
				preference: "webgl",
			});
			return { app: webglApp, backend: "webgl" };
		} catch (error) {
			lastError = error;
			console.warn(
				"[FrameRenderer] WebGL export renderer unavailable; trying next backend:",
				error,
			);
			webglApp.destroy(true);
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error("No supported Pixi export renderer was available");
}

export function createTextureFromSource(source: CanvasImageSource | VideoFrame): Texture {
	if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
		return Texture.from(source as unknown as ImageBitmap);
	}

	return Texture.from(
		source as HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | ImageBitmap,
	);
}

export function replaceSpriteTexture(
	sprite: Sprite,
	source: CanvasImageSource | VideoFrame,
): MutableVideoTextureSource {
	const nextTexture = createTextureFromSource(source);
	const previousTexture = sprite.texture;
	sprite.texture = nextTexture;
	previousTexture.destroy(true);
	return nextTexture.source as unknown as MutableVideoTextureSource;
}
