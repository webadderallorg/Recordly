import { Sprite } from "pixi.js";
import { applyZoomTransform } from "@/components/video-editor/videoPlayback/zoomTransform";
import { FrameAnnotations } from "./modernFrameAnnotations";
import { FrameBackground } from "./modernFrameBackground";
import { FrameBackgroundPlayback } from "./modernFrameBackgroundPlayback";
import { FrameCaptions } from "./modernFrameCaptions";
import { FrameGeometry } from "./modernFrameGeometry";
import { destroyFrameRenderer } from "./modernFrameLifecycle";
import { FrameMotion } from "./modernFrameMotion";
import { FrameScene } from "./modernFrameScene";
import { FrameShadows } from "./modernFrameShadows";
import { FrameTextures } from "./modernFrameTextures";
import type { FrameRenderConfig, MutableVideoTextureSource } from "./modernFrameTypes";
import { FrameWebcam } from "./modernFrameWebcam";
import { FrameWebcamFrames } from "./modernFrameWebcamFrames";
import { FrameWebcamMedia } from "./modernFrameWebcamMedia";
import type { ExportRenderBackend } from "./types";

export interface FrameRenderContext {
	config: FrameRenderConfig;
	currentVideoTime: number;
	scene: FrameScene;
	textures: FrameTextures;
	shadows: FrameShadows;
	background: FrameBackground;
	backgroundPlayback: FrameBackgroundPlayback;
	annotations: FrameAnnotations;
	captions: FrameCaptions;
	webcamMedia: FrameWebcamMedia;
	webcamFrames: FrameWebcamFrames;
	webcam: FrameWebcam;
	motion: FrameMotion;
	geometry: FrameGeometry;
}

/** Coordinates effect owners while preserving frame order and the exporter API. */
export class FrameRenderer implements FrameRenderContext {
	config: FrameRenderConfig;
	currentVideoTime = 0;
	readonly scene: FrameScene;
	readonly textures: FrameTextures;
	readonly shadows: FrameShadows;
	readonly background: FrameBackground;
	readonly backgroundPlayback: FrameBackgroundPlayback;
	readonly annotations: FrameAnnotations;
	readonly captions: FrameCaptions;
	readonly webcamMedia: FrameWebcamMedia;
	readonly webcamFrames: FrameWebcamFrames;
	readonly webcam: FrameWebcam;
	readonly motion: FrameMotion;
	readonly geometry: FrameGeometry;

	constructor(config: FrameRenderConfig) {
		this.config = config;
		this.scene = new FrameScene(this);
		this.textures = new FrameTextures(this);
		this.shadows = new FrameShadows(this);
		this.background = new FrameBackground(this);
		this.backgroundPlayback = new FrameBackgroundPlayback(this);
		this.annotations = new FrameAnnotations(this);
		this.captions = new FrameCaptions(this);
		this.webcamMedia = new FrameWebcamMedia(this);
		this.webcamFrames = new FrameWebcamFrames(this);
		this.webcam = new FrameWebcam(this);
		this.motion = new FrameMotion(this);
		this.geometry = new FrameGeometry(this);
	}

	async initialize(): Promise<void> {
		await this.scene.initialize();
	}

	async renderFrame(
		videoFrame: VideoFrame | null,
		timestamp: number,
		cursorTimestamp = timestamp,
		_frameDurationUs?: number,
		backgroundTimelineTimestamp = timestamp,
	): Promise<void> {
		if (
			!this.scene.app ||
			!this.scene.videoContainer ||
			!this.scene.cameraContainer ||
			!this.scene.videoMaskGraphics
		) {
			throw new Error("Renderer not initialized");
		}

		this.currentVideoTime = timestamp / 1_000_000;
		this.scene.cameraContainer.visible = videoFrame !== null;
		if (!videoFrame) {
			this.motion.updateAnimationState(
				backgroundTimelineTimestamp / 1000,
				cursorTimestamp / 1000,
			);
			if (
				this.backgroundPlayback.backgroundForwardFrameSource ||
				this.backgroundPlayback.backgroundVideoElement
			) {
				await this.backgroundPlayback.syncBackgroundFrame(
					backgroundTimelineTimestamp / 1_000_000,
				);
			}
			if (this.scene.webcamRootContainer) this.scene.webcamRootContainer.visible = false;
			this.webcam.webcamMotionBlur.reset();
			if (this.scene.captionContainer) this.scene.captionContainer.visible = false;
			// Gap frames must bypass canvas annotation compositing as well as Pixi layers.
			this.annotations.outputCanvasOverride = null;
			this.scene.app.render();
			return;
		}
		if (this.scene.captionContainer) this.scene.captionContainer.visible = true;

		const timeMs = this.config.timelineEffects
			? backgroundTimelineTimestamp / 1000
			: timestamp / 1000;
		const redactedSource = this.annotations.redactSourceFrame(videoFrame, timeMs);
		const resolvedVideoSource =
			redactedSource ??
			(await this.textures.resolveDetachedVideoFrameSource(
				videoFrame,
				"scene",
				this.config.videoWidth,
				this.config.videoHeight,
			));
		const usesStartupStaging = resolvedVideoSource !== videoFrame;

		if (!this.scene.videoSprite) {
			const texture = this.textures.createTextureFromSource(resolvedVideoSource);
			this.scene.videoSprite = new Sprite(texture);
			this.scene.videoTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.scene.videoContainer.addChildAt(this.scene.videoSprite, 0);
			this.scene.videoTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.scene.videoTextureUsesStartupStaging !== usesStartupStaging) {
			this.scene.videoTextureSource = this.textures.replaceSpriteTexture(
				this.scene.videoSprite,
				resolvedVideoSource,
			);
			this.scene.videoTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.scene.videoTextureSource) {
			this.scene.videoTextureSource.resource = resolvedVideoSource;
			this.scene.videoTextureSource.update();
		}

		if (!this.geometry.layoutCache) {
			this.geometry.updateLayout();
		}
		const layoutCache = this.geometry.layoutCache;
		if (!layoutCache) {
			throw new Error("Renderer layout cache is unavailable");
		}

		if (this.webcamMedia.webcamForwardFrameSource || this.webcamMedia.webcamVideoElement) {
			await this.webcamMedia.syncWebcamFrame(Math.max(0, this.currentVideoTime));
		}

		if (
			this.backgroundPlayback.backgroundForwardFrameSource ||
			this.backgroundPlayback.backgroundVideoElement
		) {
			await this.backgroundPlayback.syncBackgroundFrame(
				Math.max(0, backgroundTimelineTimestamp / 1_000_000),
			);
		}

		const cursorTimeMs = cursorTimestamp / 1000;

		if (this.scene.cursorOverlay) {
			this.scene.cursorOverlay.update(
				this.config.cursorTelemetry ?? [],
				cursorTimeMs,
				layoutCache.maskRect,
				this.config.showCursor ?? true,
				false,
			);
		}

		this.motion.updateAnimationState(timeMs, cursorTimeMs);

		applyZoomTransform({
			cameraContainer: this.scene.cameraContainer,
			zoomBlurFilter: this.scene.zoomBlurFilter,
			motionBlurFilter: this.scene.motionBlurFilter,
			stageSize: layoutCache.stageSize,
			baseMask: layoutCache.maskRect,
			zoomScale: this.motion.animationState.scale,
			zoomProgress: this.motion.animationState.progress,
			focusX: this.motion.animationState.focusX,
			focusY: this.motion.animationState.focusY,
			isPlaying: true,
			motionBlurAmount: this.config.zoomMotionBlur ?? 0,
			motionBlurTuning: this.config.zoomMotionBlurTuning,
			transformOverride: {
				scale: this.motion.animationState.appliedScale,
				x: this.motion.animationState.x,
				y: this.motion.animationState.y,
			},
			motionBlurState: this.motion.motionBlurState,
			frameTimeMs: timeMs,
		});

		this.annotations.updateAnnotationLayer(timeMs);
		this.captions.updateCaptionLayer(timestamp / 1000);
		this.webcam.updateWebcamOverlay(this.currentVideoTime, timeMs);
		await this.annotations.renderOutput(timeMs);
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.scene.app) {
			throw new Error("Renderer not initialized");
		}

		return (
			this.annotations.outputCanvasOverride ?? (this.scene.app.canvas as HTMLCanvasElement)
		);
	}

	capturePixelsForNativeExport(): Uint8ClampedArray | null {
		if (!this.scene.app) {
			return null;
		}

		const finalCanvas = this.annotations.outputCanvasOverride;

		if (finalCanvas) {
			const context = finalCanvas.getContext("2d");
			return context
				? context.getImageData(0, 0, finalCanvas.width, finalCanvas.height).data
				: null;
		}

		const result = this.scene.app.renderer.extract.pixels(this.scene.app.stage);
		const pixels = result.pixels;

		return pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels);
	}

	getRendererBackend(): ExportRenderBackend {
		return this.scene.rendererBackend;
	}

	destroy(): void {
		destroyFrameRenderer(this);
	}
}
