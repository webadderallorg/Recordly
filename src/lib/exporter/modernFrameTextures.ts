import { Sprite, Texture } from "pixi.js";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { MutableVideoTextureSource } from "./modernFrameTypes";
import { configureHighQuality2DContext } from "./modernFrameUtils";

/** Owns textures resources for one export renderer. */
export class FrameTextures {
	constructor(private readonly context: Pick<FrameRenderContext, "scene">) {}

	sceneVideoFrameStagingCanvas: HTMLCanvasElement | null = null;

	sceneVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;

	backgroundVideoFrameStagingCanvas: HTMLCanvasElement | null = null;

	backgroundVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;

	webcamVideoFrameStagingCanvas: HTMLCanvasElement | null = null;

	webcamVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;

	retainedSceneSourceFrame: VideoFrame | null = null;

	retainedSceneTextureFrame: VideoFrame | null = null;

	retainedBackgroundSourceFrame: VideoFrame | null = null;

	retainedBackgroundTextureFrame: VideoFrame | null = null;

	retainedWebcamSourceFrame: VideoFrame | null = null;

	retainedWebcamTextureFrame: VideoFrame | null = null;

	retainedSceneBitmapTimestamp: number | null = null;

	retainedSceneBitmap: ImageBitmap | null = null;

	retainedBackgroundBitmapTimestamp: number | null = null;

	retainedBackgroundBitmap: ImageBitmap | null = null;

	getRetainedVideoFrameState(kind: "scene" | "background" | "webcam") {
		if (kind === "scene") {
			return {
				sourceFrame: this.retainedSceneSourceFrame,
				textureFrame: this.retainedSceneTextureFrame,
			};
		}

		if (kind === "background") {
			return {
				sourceFrame: this.retainedBackgroundSourceFrame,
				textureFrame: this.retainedBackgroundTextureFrame,
			};
		}

		return {
			sourceFrame: this.retainedWebcamSourceFrame,
			textureFrame: this.retainedWebcamTextureFrame,
		};
	}

	setRetainedVideoFrameState(
		kind: "scene" | "background" | "webcam",
		sourceFrame: VideoFrame | null,
		textureFrame: VideoFrame | null,
	): void {
		if (kind === "scene") {
			this.retainedSceneSourceFrame = sourceFrame;
			this.retainedSceneTextureFrame = textureFrame;
			return;
		}

		if (kind === "background") {
			this.retainedBackgroundSourceFrame = sourceFrame;
			this.retainedBackgroundTextureFrame = textureFrame;
			return;
		}

		this.retainedWebcamSourceFrame = sourceFrame;
		this.retainedWebcamTextureFrame = textureFrame;
	}

	closeRetainedVideoFrame(kind: "scene" | "background" | "webcam"): void {
		const state = this.getRetainedVideoFrameState(kind);
		if (!state.textureFrame) {
			this.setRetainedVideoFrameState(kind, null, null);
			return;
		}

		state.textureFrame.close();
		this.setRetainedVideoFrameState(kind, null, null);
	}

	closeRetainedBitmap(kind: "scene" | "background"): void {
		if (kind === "scene") {
			this.retainedSceneBitmap?.close();
			this.retainedSceneBitmap = null;
			this.retainedSceneBitmapTimestamp = null;
			return;
		}

		this.retainedBackgroundBitmap?.close();
		this.retainedBackgroundBitmap = null;
		this.retainedBackgroundBitmapTimestamp = null;
	}

	async resolveDetachedVideoFrameSource(
		frame: VideoFrame,
		kind: "scene" | "background",
		fallbackWidth: number,
		fallbackHeight: number,
	): Promise<CanvasImageSource | VideoFrame> {
		if (
			this.context.scene.rendererBackend !== "webgpu" ||
			typeof createImageBitmap !== "function"
		) {
			return this.stageVideoFrameForTexture(frame, kind, fallbackWidth, fallbackHeight);
		}

		const cachedTimestamp =
			kind === "scene"
				? this.retainedSceneBitmapTimestamp
				: this.retainedBackgroundBitmapTimestamp;
		const cachedBitmap =
			kind === "scene" ? this.retainedSceneBitmap : this.retainedBackgroundBitmap;
		if (cachedTimestamp === frame.timestamp && cachedBitmap) {
			return cachedBitmap;
		}

		try {
			const bitmap = await createImageBitmap(frame);
			this.closeRetainedBitmap(kind);
			if (kind === "scene") {
				this.retainedSceneBitmap = bitmap;
				this.retainedSceneBitmapTimestamp = frame.timestamp;
			} else {
				this.retainedBackgroundBitmap = bitmap;
				this.retainedBackgroundBitmapTimestamp = frame.timestamp;
			}
			return bitmap;
		} catch (error) {
			console.warn(
				`[ModernFrameRenderer] Failed to detach ${kind} VideoFrame to ImageBitmap, falling back to retained VideoFrame:`,
				error,
			);
			return this.stageVideoFrameForTexture(frame, kind, fallbackWidth, fallbackHeight);
		}
	}

	resolveRetainedVideoFrameSource(
		frame: VideoFrame,
		kind: "scene" | "background" | "webcam",
		fallbackWidth: number,
		fallbackHeight: number,
	): CanvasImageSource | VideoFrame {
		if (this.context.scene.rendererBackend !== "webgpu") {
			return frame;
		}

		const state = this.getRetainedVideoFrameState(kind);
		if (state.sourceFrame === frame && state.textureFrame) {
			return state.textureFrame;
		}

		try {
			const retainedFrame = new VideoFrame(frame, {
				timestamp: frame.timestamp,
			});
			this.closeRetainedVideoFrame(kind);
			this.setRetainedVideoFrameState(kind, frame, retainedFrame);
			return retainedFrame;
		} catch (error) {
			console.warn(
				`[ModernFrameRenderer] Failed to retain ${kind} VideoFrame, falling back to staging canvas:`,
				error,
			);
			return this.stageVideoFrameOnCanvas(frame, kind, fallbackWidth, fallbackHeight);
		}
	}

	ensureVideoFrameStagingCanvas(
		kind: "scene" | "background" | "webcam",
		width: number,
		height: number,
	): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));
		const currentCanvas =
			kind === "scene"
				? this.sceneVideoFrameStagingCanvas
				: kind === "background"
					? this.backgroundVideoFrameStagingCanvas
					: this.webcamVideoFrameStagingCanvas;
		const currentContext =
			kind === "scene"
				? this.sceneVideoFrameStagingCtx
				: kind === "background"
					? this.backgroundVideoFrameStagingCtx
					: this.webcamVideoFrameStagingCtx;

		if (
			currentCanvas &&
			currentCanvas.width === targetWidth &&
			currentCanvas.height === targetHeight &&
			currentContext
		) {
			return { canvas: currentCanvas, context: currentContext };
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;
		const context = configureHighQuality2DContext(
			canvas.getContext("2d", { willReadFrequently: true }),
		);
		if (!context) {
			return null;
		}

		if (kind === "scene") {
			this.sceneVideoFrameStagingCanvas = canvas;
			this.sceneVideoFrameStagingCtx = context;
		} else if (kind === "background") {
			this.backgroundVideoFrameStagingCanvas = canvas;
			this.backgroundVideoFrameStagingCtx = context;
		} else {
			this.webcamVideoFrameStagingCanvas = canvas;
			this.webcamVideoFrameStagingCtx = context;
		}

		return { canvas, context };
	}

	stageVideoFrameOnCanvas(
		frame: VideoFrame,
		kind: "scene" | "background" | "webcam",
		fallbackWidth: number,
		fallbackHeight: number,
	): CanvasImageSource | VideoFrame {
		const width = Math.max(1, frame.displayWidth || fallbackWidth);
		const height = Math.max(1, frame.displayHeight || fallbackHeight);
		const staging = this.ensureVideoFrameStagingCanvas(kind, width, height);
		if (!staging) {
			return frame;
		}

		staging.context.clearRect(0, 0, staging.canvas.width, staging.canvas.height);
		staging.context.drawImage(frame, 0, 0, staging.canvas.width, staging.canvas.height);
		return staging.canvas;
	}

	stageVideoFrameForTexture(
		frame: VideoFrame,
		kind: "scene" | "background" | "webcam",
		fallbackWidth: number,
		fallbackHeight: number,
	): CanvasImageSource | VideoFrame {
		// Keep webcam uploads on the older canvas-staged path. The newer
		// retained-VideoFrame upload path is fine for the main scene/background,
		// but it has produced unstable webcam overlays in Lightning exports.
		if (kind === "webcam") {
			return this.stageVideoFrameOnCanvas(frame, kind, fallbackWidth, fallbackHeight);
		}

		if (this.context.scene.rendererBackend === "webgpu") {
			return this.resolveRetainedVideoFrameSource(frame, kind, fallbackWidth, fallbackHeight);
		}

		return this.stageVideoFrameOnCanvas(frame, kind, fallbackWidth, fallbackHeight);
	}

	replaceSpriteTexture(
		sprite: Sprite,
		source: CanvasImageSource | VideoFrame,
	): MutableVideoTextureSource {
		const nextTexture = this.createTextureFromSource(source);
		const previousTexture = sprite.texture;
		sprite.texture = nextTexture;
		previousTexture.destroy(true);
		return nextTexture.source as unknown as MutableVideoTextureSource;
	}

	createTextureFromSource(source: CanvasImageSource | VideoFrame): Texture {
		if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
			return Texture.from(source as unknown as ImageBitmap);
		}

		return Texture.from(
			source as HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | ImageBitmap,
		);
	}
}
