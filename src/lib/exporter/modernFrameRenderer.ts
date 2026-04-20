import { Application, BlurFilter, Container, Graphics, Sprite } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { AnnotationRenderAssets } from "./annotationRenderer";
import { preloadAnnotationAssets } from "./annotationRenderer";
import { ForwardFrameSource } from "./forwardFrameSource";
import {
	VIDEO_SHADOW_LAYER_PROFILES,
	WEBCAM_SHADOW_LAYER_PROFILES,
} from "./shadowProfile";
import type { ExportRenderBackend } from "./types";
import type {
	FrameRenderConfig,
	AnimationState,
	LayoutCache,
	MutableVideoTextureSource,
	ShadowLayer,
	AnnotationSpriteEntry,
	ExportCompositeCanvasState,
	WebcamLayoutCache,
} from "./frameRendererTypes";
import {
	createAnimationState,
	configureHighQuality2DContext,
	createShadowLayers,
	createPixiApplication,
	createTextureFromSource,
	replaceSpriteTexture,
	VIDEO_FRAME_STARTUP_STAGING_WINDOW_SEC,
} from "./frameRendererHelpers";
import {
	setupBackground,
	syncBackgroundFrame,
} from "./frameRendererBackground";
import {
	updateWebcamOverlay,
} from "./frameRendererWebcam";
import {
	setupWebcamSource,
	syncWebcamFrame,
} from "./frameRendererWebcamSync";
import { setupCaptionResources, updateCaptionLayer } from "./frameRendererCaptions";
import {
	calculateAnnotationScaleFactor,
	hasActiveBlurAnnotations,
	setupAnnotationLayer,
	updateAnnotationLayer,
	composeBlurAnnotationFrame,
	shouldCompositeExtensionFrame,
	compositeExtensions,
} from "./frameRendererCompositing";
import { syncVideoEffectsFilters } from "./modernFrameRendererFilters";
import { destroyFrameRenderer } from "./modernFrameRendererLifecycle";
import { updateAnimationState, updateLayout } from "./frameRendererZoom";
import {
	type CursorFollowCameraState,
	createCursorFollowCameraState,
} from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "@/components/video-editor/videoPlayback/cursorRenderer";
import {
	createSpringState,
	type SpringState,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import {
	applyZoomTransform,
	createMotionBlurState,
	type MotionBlurState,
} from "@/components/video-editor/videoPlayback/zoomTransform";

export { type FrameRenderConfig } from "./frameRendererTypes";

// Renders video frames with all effects directly into a GPU-backed Pixi scene for export.
export class FrameRenderer {
	app: Application | null = null;
	rendererBackend: ExportRenderBackend = "webgl";
	backgroundContainer: Container | null = null;
	cameraContainer: Container | null = null;
	videoEffectsContainer: Container | null = null;
	videoContainer: Container | null = null;
	cursorContainer: Container | null = null;
	overlayContainer: Container | null = null;
	annotationContainer: Container | null = null;
	captionContainer: Container | null = null;
	webcamRootContainer: Container | null = null;
	webcamContainer: Container | null = null;
	videoSprite: Sprite | null = null;
	videoTextureSource: MutableVideoTextureSource | null = null;
	backgroundSprite: Sprite | null = null;
	backgroundTextureSource: MutableVideoTextureSource | null = null;
	videoMaskGraphics: Graphics | null = null;
	webcamMaskGraphics: Graphics | null = null;
	blurFilter: BlurFilter | null = null;
	motionBlurFilter: MotionBlurFilter | null = null;
	backgroundBlurFilter: BlurFilter | null = null;
	annotationAssets: AnnotationRenderAssets | null = null;
	annotationScaleFactor = 1;
	annotationSprites: AnnotationSpriteEntry[] = [];
	backgroundForwardFrameSource: ForwardFrameSource | null = null;
	backgroundDecodedFrame: VideoFrame | null = null;
	backgroundVideoElement: HTMLVideoElement | null = null;
	videoShadowLayers: ShadowLayer[] = [];
	webcamShadowLayers: ShadowLayer[] = [];
	webcamSprite: Sprite | null = null;
	webcamTextureSource: MutableVideoTextureSource | null = null;
	webcamForwardFrameSource: ForwardFrameSource | null = null;
	webcamDecodedFrame: VideoFrame | null = null;
	webcamVideoElement: HTMLVideoElement | null = null;
	webcamSeekPromise: Promise<void> | null = null;
	webcamFrameCacheCanvas: HTMLCanvasElement | null = null;
	webcamFrameCacheCtx: CanvasRenderingContext2D | null = null;
	sceneVideoFrameStagingCanvas: HTMLCanvasElement | null = null;
	sceneVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;
	webcamVideoFrameStagingCanvas: HTMLCanvasElement | null = null;
	webcamVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;
	captionMeasureCanvas: HTMLCanvasElement | null = null;
	captionMeasureCtx: CanvasRenderingContext2D | null = null;
	captionCanvas: HTMLCanvasElement | null = null;
	captionCtx: CanvasRenderingContext2D | null = null;
	captionSprite: Sprite | null = null;
	captionTextureSource: MutableVideoTextureSource | null = null;
	captionRenderKey: string | null = null;
	exportCompositeCanvas: ExportCompositeCanvasState | null = null;
	outputCanvasOverride: HTMLCanvasElement | null = null;
	config: FrameRenderConfig;
	animationState: AnimationState;
	motionBlurState: MotionBlurState;
	springScale: SpringState;
	springX: SpringState;
	springY: SpringState;
	cursorFollowCamera: CursorFollowCameraState;
	lastContentTimeMs: number | null = null;
	layoutCache: LayoutCache | null = null;
	currentVideoTime = 0;
	lastMotionVector = { x: 0, y: 0 };
	cursorOverlay: PixiCursorOverlay | null = null;
	lastSyncedWebcamTime: number | null = null;
	lastWebcamCacheRefreshTime: number | null = null;
	webcamRenderMode: "hidden" | "live" | "cached" = "hidden";
	webcamLayoutCache: WebcamLayoutCache | null = null;
	videoTextureUsesStartupStaging = false;
	webcamTextureUsesStartupStaging = false;
	compositeCanvas: HTMLCanvasElement | null = null;
	compositeCtx: CanvasRenderingContext2D | null = null;
	lastEmittedClickTimeMs = -1;
	cleanupWebcamSource: (() => void) | null = null;

	constructor(config: FrameRenderConfig) {
		this.config = config;
		this.animationState = createAnimationState();
		this.motionBlurState = createMotionBlurState();
		this.springScale = createSpringState(1);
		this.springX = createSpringState(0);
		this.springY = createSpringState(0);
		this.cursorFollowCamera = createCursorFollowCameraState();
	}

	async initialize(): Promise<void> {
		let cursorOverlayEnabled = true;
		try {
			await preloadCursorAssets();
		} catch (error) {
			cursorOverlayEnabled = false;
			console.warn(
				"[FrameRenderer] Native cursor assets are unavailable; continuing export without cursor overlay.",
				error,
			);
		}

		const canvas = document.createElement("canvas");
		canvas.width = this.config.width;
		canvas.height = this.config.height;

		try {
			const exportCanvas = canvas as HTMLCanvasElement & { colorSpace?: string };
			if ("colorSpace" in exportCanvas) {
				exportCanvas.colorSpace = "srgb";
			}
		} catch (error) {
			console.warn("[FrameRenderer] colorSpace not supported on this platform:", error);
		}

		const application = await createPixiApplication(canvas, this.config);
		this.app = application.app;
		this.rendererBackend = application.backend;

		this.backgroundContainer = new Container();
		this.cameraContainer = new Container();
		this.videoEffectsContainer = new Container();
		this.videoContainer = new Container();
		this.cursorContainer = new Container();
		this.overlayContainer = new Container();
		this.annotationContainer = new Container();
		this.captionContainer = new Container();
		this.webcamRootContainer = new Container();
		this.webcamContainer = new Container();

		this.app.stage.addChild(this.backgroundContainer);
		this.app.stage.addChild(this.cameraContainer);
		this.app.stage.addChild(this.overlayContainer);

		this.videoShadowLayers = createShadowLayers(
			this.cameraContainer,
			VIDEO_SHADOW_LAYER_PROFILES,
		);

		this.cameraContainer.addChild(this.videoEffectsContainer);
		this.cameraContainer.addChild(this.cursorContainer);
		this.videoEffectsContainer.addChild(this.videoContainer);

		this.webcamShadowLayers = createShadowLayers(
			this.webcamRootContainer,
			WEBCAM_SHADOW_LAYER_PROFILES,
		);
		this.webcamRootContainer.addChild(this.webcamContainer);
		this.webcamRootContainer.visible = false;

		this.overlayContainer.addChild(this.webcamRootContainer);
		this.overlayContainer.addChild(this.annotationContainer);
		this.overlayContainer.addChild(this.captionContainer);

		this.videoMaskGraphics = new Graphics();
		this.videoContainer.addChild(this.videoMaskGraphics);
		this.videoContainer.mask = this.videoMaskGraphics;

		this.webcamMaskGraphics = new Graphics();
		this.webcamContainer.addChild(this.webcamMaskGraphics);
		this.webcamContainer.mask = this.webcamMaskGraphics;

		if (cursorOverlayEnabled) {
			this.cursorOverlay = new PixiCursorOverlay({
				dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * (this.config.cursorSize ?? 1.4),
				style: this.config.cursorStyle ?? "tahoe",
				smoothingFactor:
					this.config.cursorSmoothing ?? DEFAULT_CURSOR_CONFIG.smoothingFactor,
				motionBlur: this.config.cursorMotionBlur ?? 0,
				clickBounce: this.config.cursorClickBounce ?? DEFAULT_CURSOR_CONFIG.clickBounce,
				clickBounceDuration:
					this.config.cursorClickBounceDuration ??
					DEFAULT_CURSOR_CONFIG.clickBounceDuration,
				sway: this.config.cursorSway ?? DEFAULT_CURSOR_CONFIG.sway,
			});
			this.cursorContainer.addChild(this.cursorOverlay.container);
		}

		await setupBackground(this);
		await setupWebcamSource(this);

		this.annotationScaleFactor = calculateAnnotationScaleFactor(this);
		this.annotationAssets = await preloadAnnotationAssets(this.config.annotationRegions ?? []);
		await setupAnnotationLayer(this);
		setupCaptionResources(this);

		this.compositeCanvas = document.createElement("canvas");
		this.compositeCanvas.width = this.config.width;
		this.compositeCanvas.height = this.config.height;
		this.compositeCtx = configureHighQuality2DContext(
			this.compositeCanvas.getContext("2d", {
				willReadFrequently: false,
			}),
		);
		if (!this.compositeCtx) {
			throw new Error("Failed to get 2D context for composite canvas");
		}

		if (this.shouldUseZoomMotionBlur()) {
			this.motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
		}
		syncVideoEffectsFilters(this);

		console.log(`[FrameRenderer] Export renderer backend: ${this.rendererBackend}`);
	}

	private shouldUseZoomMotionBlur(): boolean {
		return (this.config.zoomMotionBlur ?? 0) > 0;
	}

	private shouldUseStartupVideoFrameStaging(): boolean {
		return (
			this.rendererBackend === "webgpu" &&
			this.currentVideoTime < VIDEO_FRAME_STARTUP_STAGING_WINDOW_SEC
		);
	}

	private ensureVideoFrameStagingCanvas(
		kind: "scene" | "webcam",
		width: number,
		height: number,
	): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));
		const currentCanvas =
			kind === "scene"
				? this.sceneVideoFrameStagingCanvas
				: this.webcamVideoFrameStagingCanvas;
		const currentContext =
			kind === "scene" ? this.sceneVideoFrameStagingCtx : this.webcamVideoFrameStagingCtx;

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
		const context = configureHighQuality2DContext(canvas.getContext("2d"));
		if (!context) {
			return null;
		}

		if (kind === "scene") {
			this.sceneVideoFrameStagingCanvas = canvas;
			this.sceneVideoFrameStagingCtx = context;
		} else {
			this.webcamVideoFrameStagingCanvas = canvas;
			this.webcamVideoFrameStagingCtx = context;
		}

		return { canvas, context };
	}

	stageVideoFrameForTexture(
		frame: VideoFrame,
		kind: "scene" | "webcam",
		fallbackWidth: number,
		fallbackHeight: number,
	): CanvasImageSource | VideoFrame {
		if (!this.shouldUseStartupVideoFrameStaging()) {
			return frame;
		}

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

	async renderFrame(
		videoFrame: VideoFrame,
		timestamp: number,
		cursorTimestamp = timestamp,
	): Promise<void> {
		if (!this.app || !this.videoContainer || !this.cameraContainer || !this.videoMaskGraphics) {
			throw new Error("Renderer not initialized");
		}

		this.currentVideoTime = timestamp / 1_000_000;

		if (this.webcamForwardFrameSource || this.webcamVideoElement) {
			await syncWebcamFrame(this, Math.max(0, this.currentVideoTime));
		}

		if (this.backgroundForwardFrameSource || this.backgroundVideoElement) {
			await syncBackgroundFrame(this, this.currentVideoTime);
		}

		const resolvedVideoSource = this.stageVideoFrameForTexture(
			videoFrame,
			"scene",
			this.config.videoWidth,
			this.config.videoHeight,
		);
		const usesStartupStaging = resolvedVideoSource !== videoFrame;

		if (!this.videoSprite) {
			const texture = createTextureFromSource(resolvedVideoSource);
			this.videoSprite = new Sprite(texture);
			this.videoTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.videoContainer.addChildAt(this.videoSprite, 0);
			this.videoTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.videoTextureUsesStartupStaging !== usesStartupStaging) {
			this.videoTextureSource = replaceSpriteTexture(
				this.videoSprite,
				resolvedVideoSource,
			);
			this.videoTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.videoTextureSource) {
			this.videoTextureSource.resource = resolvedVideoSource;
			this.videoTextureSource.update();
		}

		if (!this.layoutCache) {
			updateLayout(this);
		}
		const layoutCache = this.layoutCache;
		if (!layoutCache) {
			throw new Error("Renderer layout cache is unavailable");
		}

		const timeMs = this.currentVideoTime * 1000;
		const cursorTimeMs = cursorTimestamp / 1000;

		if (this.cursorOverlay) {
			this.cursorOverlay.update(
				this.config.cursorTelemetry ?? [],
				cursorTimeMs,
				layoutCache.maskRect,
				this.config.showCursor ?? true,
				false,
			);
		}

		let maxMotionIntensity = 0;
		const motionIntensity = updateAnimationState(this, timeMs);
		maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);

		applyZoomTransform({
			cameraContainer: this.cameraContainer,
			blurFilter: this.blurFilter,
			motionBlurFilter: this.motionBlurFilter,
			stageSize: layoutCache.stageSize,
			baseMask: layoutCache.maskRect,
			zoomScale: this.animationState.scale,
			zoomProgress: this.animationState.progress,
			focusX: this.animationState.focusX,
			focusY: this.animationState.focusY,
			motionIntensity: maxMotionIntensity,
			motionVector: this.lastMotionVector,
			isPlaying: true,
			motionBlurAmount: this.config.zoomMotionBlur ?? 0,
			transformOverride: {
				scale: this.animationState.appliedScale,
				x: this.animationState.x,
				y: this.animationState.y,
			},
			motionBlurState: this.motionBlurState,
			frameTimeMs: timeMs,
		});

		updateAnnotationLayer(this, timeMs);
		updateCaptionLayer(this, timeMs);
		updateWebcamOverlay(this);

		if (hasActiveBlurAnnotations(this, timeMs)) {
			const annotationContainerVisible = this.annotationContainer?.visible ?? true;
			const captionContainerVisible = this.captionContainer?.visible ?? true;

			if (this.annotationContainer) {
				this.annotationContainer.visible = false;
			}
			if (this.captionContainer) {
				this.captionContainer.visible = false;
			}

			this.app.render();

			if (this.annotationContainer) {
				this.annotationContainer.visible = annotationContainerVisible;
			}
			if (this.captionContainer) {
				this.captionContainer.visible = captionContainerVisible;
			}

			await composeBlurAnnotationFrame(this, timeMs);
			return;
		}

		this.outputCanvasOverride = null;
		this.app.render();
		compositeExtensions(this, timeMs, cursorTimeMs);
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.app) {
			throw new Error("Renderer not initialized");
		}

		if (shouldCompositeExtensionFrame() && this.compositeCanvas) {
			return this.compositeCanvas;
		}

		return this.outputCanvasOverride ?? (this.app.canvas as HTMLCanvasElement);
	}

	getRendererBackend(): ExportRenderBackend {
		return this.rendererBackend;
	}

	destroy(): void {
		destroyFrameRenderer(this);
	}
}
