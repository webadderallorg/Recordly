import { Application, BlurFilter, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";
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
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	WebcamOverlaySettings,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import { getDefaultCaptionFontFamily, ZOOM_DEPTH_SCALES } from "@/components/video-editor/types";
import { DEFAULT_FOCUS } from "@/components/video-editor/videoPlayback/constants";
import {
	type CursorFollowCameraState,
	computeCursorFollowFocus,
	createCursorFollowCameraState,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "@/components/video-editor/videoPlayback/cursorRenderer";
import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import {
	createSpringState,
	getZoomSpringConfig,
	resetSpringState,
	type SpringState,
	stepSpringValue,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import { getWebcamMediaTargetTimeSeconds } from "@/components/video-editor/videoPlayback/webcamSync";
import { findDominantRegion } from "@/components/video-editor/videoPlayback/zoomRegionUtils";
import {
	applyZoomTransform,
	computeFocusFromTransform,
	computeZoomTransform,
	createMotionBlurState,
	type MotionBlurState,
} from "@/components/video-editor/videoPlayback/zoomTransform";
import {
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
} from "@/components/video-editor/webcamOverlay";
import { getAssetPath, getExportableVideoUrl, getRenderableAssetUrl } from "@/lib/assetPath";
import { extensionHost } from "@/lib/extensions";
import {
	mapCursorToCanvasNormalized,
	mapSmoothedCursorToCanvasNormalized,
} from "@/lib/extensions/cursorCoordinates";
import {
	executeExtensionCursorEffects,
	executeExtensionRenderHooks,
	notifyCursorInteraction,
} from "@/lib/extensions/renderHooks";
import { applyCanvasSceneTransform } from "@/lib/extensions/sceneTransform";
import { drawSquircleOnCanvas, drawSquircleOnGraphics } from "@/lib/geometry/squircle";
import {
	clampMediaTimeToDuration,
	getEffectiveVideoStreamDurationSeconds,
} from "@/lib/mediaTiming";
import { isVideoWallpaperSource } from "@/lib/wallpapers";
import {
	type AnnotationRenderAssets,
	preloadAnnotationAssets,
	renderAnnotations,
	renderAnnotationToCanvas,
} from "./annotationRenderer";
import { ForwardFrameSource } from "./forwardFrameSource";
import { resolveMediaElementSource } from "./localMediaSource";
import {
	getShadowFilterPadding,
	VIDEO_SHADOW_LAYER_PROFILES,
	WEBCAM_SHADOW_LAYER_PROFILES,
} from "./shadowProfile";
import {
	buildTemporalSamplePlanUs,
	getTemporalMotionBlurConfig,
} from "./temporalMotionBlur";
import type { ExportRenderBackend } from "./types";

interface FrameRenderConfig {
	width: number;
	height: number;
	preferredRenderBackend?: ExportRenderBackend;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
	zoomTemporalMotionBlur?: number;
	zoomMotionBlurSampleCount?: number | null;
	zoomMotionBlurShutterFraction?: number | null;
	connectZooms?: boolean;
	zoomInDurationMs?: number;
	zoomInOverlapMs?: number;
	zoomOutDurationMs?: number;
	connectedZoomGapMs?: number;
	connectedZoomDurationMs?: number;
	zoomInEasing?: ZoomTransitionEasing;
	zoomOutEasing?: ZoomTransitionEasing;
	connectedZoomEasing?: ZoomTransitionEasing;
	borderRadius?: number;
	padding?: Padding | number;
	cropRegion: CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamUrl?: string | null;
	videoWidth: number;
	videoHeight: number;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	speedRegions?: SpeedRegion[];
	previewWidth?: number;
	previewHeight?: number;
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	cursorStyle?: CursorStyle;
	cursorSize?: number;
	cursorSmoothing?: number;
	cursorSpringStiffnessMultiplier?: number;
	cursorSpringDampingMultiplier?: number;
	cursorSpringMassMultiplier?: number;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	frame?: string | null;
	nativeReadbackMode?: "pixels" | "canvas";
}

interface AnimationState {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
}

interface LayoutCache {
	stageSize: { width: number; height: number };
	videoSize: { width: number; height: number };
	baseScale: number;
	baseOffset: { x: number; y: number };
	maskRect: {
		x: number;
		y: number;
		width: number;
		height: number;
		sourceCrop: CropRegion;
	};
}

interface MutableVideoTextureSource {
	resource: CanvasImageSource | VideoFrame;
	update: () => void;
}

interface ShadowLayer {
	container: Container;
	sprite: Sprite | null;
	canvas: HTMLCanvasElement | null;
	context: CanvasRenderingContext2D | null;
	textureSource: MutableVideoTextureSource | null;
	offsetScale: number;
	alphaScale: number;
	blurScale: number;
}

interface WebcamRenderSource {
	source: CanvasImageSource | VideoFrame;
	width: number;
	height: number;
	mode: "live" | "cached";
}

interface WebcamLayoutCache {
	sourceWidth: number;
	sourceHeight: number;
	size: number;
	positionX: number;
	positionY: number;
	radius: number;
	shadowStrength: number;
	mirror: boolean;
}

interface AnnotationSpriteEntry {
	annotation: AnnotationRegion;
	sprite: Sprite;
	texture: Texture;
}

interface ExportCompositeCanvasState {
	canvas: HTMLCanvasElement;
	context: CanvasRenderingContext2D;
}

type ResolvedCaptionLayout = NonNullable<ReturnType<typeof buildActiveCaptionLayout>>;

interface CaptionRenderState {
	key: string;
	layout: ResolvedCaptionLayout;
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	boxWidth: number;
	boxHeight: number;
	centerX: number;
	centerY: number;
}

interface RenderSnapshot {
	timeMs: number;
	cursorTimeMs: number;
	sceneTransform: { scale: number; x: number; y: number };
	zoom: { scale: number; focusX: number; focusY: number; progress: number };
}

function createAnimationState(): AnimationState {
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

function configureHighQuality2DContext(
	context: CanvasRenderingContext2D | null,
): CanvasRenderingContext2D | null {
	if (!context) {
		return null;
	}

	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = "high";

	return context;
}

function drawSourceCoverToCanvas(
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

function applyCoverLayoutToSprite(
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

function clampUnitInterval(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function areNearlyEqual(first: number, second: number, epsilon = 0.01): boolean {
	return Math.abs(first - second) <= epsilon;
}

const VIDEO_FRAME_STARTUP_STAGING_WINDOW_SEC = 2.25;

// Renders video frames with all effects directly into a GPU-backed Pixi scene for export.
export class FrameRenderer {
	private app: Application | null = null;
	private rendererBackend: ExportRenderBackend = "webgl";
	private backgroundContainer: Container | null = null;
	private cameraContainer: Container | null = null;
	private videoEffectsContainer: Container | null = null;
	private videoContainer: Container | null = null;
	private cursorContainer: Container | null = null;
	private overlayContainer: Container | null = null;
	private annotationContainer: Container | null = null;
	private captionContainer: Container | null = null;
	private webcamRootContainer: Container | null = null;
	private webcamContainer: Container | null = null;
	private videoSprite: Sprite | null = null;
	private videoTextureSource: MutableVideoTextureSource | null = null;
	private backgroundSprite: Sprite | null = null;
	private backgroundTextureSource: MutableVideoTextureSource | null = null;
	private videoMaskGraphics: Graphics | null = null;
	private webcamMaskGraphics: Graphics | null = null;
	private zoomBlurFilter: ZoomBlurFilter | null = null;
	private motionBlurFilter: MotionBlurFilter | null = null;
	private backgroundBlurFilter: BlurFilter | null = null;
	private annotationAssets: AnnotationRenderAssets | null = null;
	private annotationScaleFactor = 1;
	private annotationSprites: AnnotationSpriteEntry[] = [];
	private backgroundForwardFrameSource: ForwardFrameSource | null = null;
	private backgroundForwardFrameSourceUrl: string | null = null;
	private backgroundForwardFrameDurationSec: number | null = null;
	private backgroundDecodedFrame: VideoFrame | null = null;
	private backgroundVideoElement: HTMLVideoElement | null = null;
	private backgroundSeekPromise: Promise<void> | null = null;
	private cleanupBackgroundSource: (() => void) | null = null;
	private lastSyncedBackgroundLoopTimeSec: number | null = null;
	private videoShadowLayers: ShadowLayer[] = [];
	private webcamShadowLayers: ShadowLayer[] = [];
	private webcamSprite: Sprite | null = null;
	private webcamTextureSource: MutableVideoTextureSource | null = null;
	private webcamForwardFrameSource: ForwardFrameSource | null = null;
	private webcamDecodedFrame: VideoFrame | null = null;
	private webcamVideoElement: HTMLVideoElement | null = null;
	private webcamSeekPromise: Promise<void> | null = null;
	private webcamFrameCacheCanvas: HTMLCanvasElement | null = null;
	private webcamFrameCacheCtx: CanvasRenderingContext2D | null = null;
	private sceneVideoFrameStagingCanvas: HTMLCanvasElement | null = null;
	private sceneVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;
	private backgroundVideoFrameStagingCanvas: HTMLCanvasElement | null = null;
	private backgroundVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;
	private webcamVideoFrameStagingCanvas: HTMLCanvasElement | null = null;
	private webcamVideoFrameStagingCtx: CanvasRenderingContext2D | null = null;
	private captionMeasureCanvas: HTMLCanvasElement | null = null;
	private captionMeasureCtx: CanvasRenderingContext2D | null = null;
	private captionCanvas: HTMLCanvasElement | null = null;
	private captionCtx: CanvasRenderingContext2D | null = null;
	private captionSprite: Sprite | null = null;
	private captionTextureSource: MutableVideoTextureSource | null = null;
	private captionRenderKey: string | null = null;
	private exportCompositeCanvas: ExportCompositeCanvasState | null = null;
	private temporalCompositeCanvas: ExportCompositeCanvasState | null = null;
	private outputCanvasOverride: HTMLCanvasElement | null = null;
	private config: FrameRenderConfig;
	private animationState: AnimationState;
	private motionBlurState: MotionBlurState;
	private springScale: SpringState;
	private springX: SpringState;
	private springY: SpringState;
	private cursorFollowCamera: CursorFollowCameraState;
	private lastContentTimeMs: number | null = null;
	private layoutCache: LayoutCache | null = null;
	private currentVideoTime = 0;
	private lastMotionVector = { x: 0, y: 0 };
	private cursorOverlay: PixiCursorOverlay | null = null;
	private lastSyncedWebcamTime: number | null = null;
	private lastWebcamCacheRefreshTime: number | null = null;
	private webcamRenderMode: "hidden" | "live" | "cached" = "hidden";
	private webcamLayoutCache: WebcamLayoutCache | null = null;
	private videoTextureUsesStartupStaging = false;
	private webcamTextureUsesStartupStaging = false;
	private compositeCanvas: HTMLCanvasElement | null = null;
	private compositeCtx: CanvasRenderingContext2D | null = null;
	private lastEmittedClickTimeMs = -1;
	private cleanupWebcamSource: (() => void) | null = null;

	constructor(config: FrameRenderConfig) {
		this.config = config;
		this.animationState = createAnimationState();
		this.motionBlurState = createMotionBlurState();
		this.springScale = createSpringState(1);
		this.springX = createSpringState(0);
		this.springY = createSpringState(0);
		this.cursorFollowCamera = createCursorFollowCameraState();
	}

	private shouldUseZoomMotionBlur(): boolean {
		return (this.config.zoomMotionBlur ?? 0) > 0;
	}

	private updateVideoEffectsFilterState(): void {
		if (!this.videoEffectsContainer) {
			return;
		}

		const activeFilters =
			this.shouldUseZoomMotionBlur() && this.zoomBlurFilter && this.motionBlurFilter
				? [this.zoomBlurFilter, this.motionBlurFilter]
				: null;
		this.videoEffectsContainer.filters = activeFilters;
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

		const application = await this.createPixiApplication(canvas);
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

		this.videoShadowLayers = this.createShadowLayers(
			this.cameraContainer,
			VIDEO_SHADOW_LAYER_PROFILES,
		);

		this.cameraContainer.addChild(this.videoEffectsContainer);
		this.cameraContainer.addChild(this.cursorContainer);
		this.videoEffectsContainer.addChild(this.videoContainer);
		this.videoEffectsContainer.filterArea = new Rectangle(
			0,
			0,
			this.config.width,
			this.config.height,
		);

		this.webcamShadowLayers = this.createShadowLayers(
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
				springTuning: {
					stiffnessMultiplier: this.config.cursorSpringStiffnessMultiplier,
					dampingMultiplier: this.config.cursorSpringDampingMultiplier,
					massMultiplier: this.config.cursorSpringMassMultiplier,
				},
				motionBlur: this.config.cursorMotionBlur ?? 0,
				clickBounce: this.config.cursorClickBounce ?? DEFAULT_CURSOR_CONFIG.clickBounce,
				clickBounceDuration:
					this.config.cursorClickBounceDuration ??
					DEFAULT_CURSOR_CONFIG.clickBounceDuration,
				sway: this.config.cursorSway ?? DEFAULT_CURSOR_CONFIG.sway,
			});
			this.cursorContainer.addChild(this.cursorOverlay.container);
		}

		await this.setupBackground();
		await this.setupWebcamSource();

		this.annotationScaleFactor = this.calculateAnnotationScaleFactor();
		this.annotationAssets = await preloadAnnotationAssets(this.config.annotationRegions ?? []);
		await this.setupAnnotationLayer();
		this.setupCaptionResources();

		if (this.shouldUseZoomMotionBlur()) {
			this.zoomBlurFilter = new ZoomBlurFilter({ strength: 0 });
			this.motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
		}

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

		this.updateVideoEffectsFilterState();

		console.log(`[FrameRenderer] Export renderer backend: ${this.rendererBackend}`);
	}

	private async createPixiApplication(
		canvas: HTMLCanvasElement,
	): Promise<{ app: Application; backend: ExportRenderBackend }> {
		const baseOptions = {
			canvas,
			width: this.config.width,
			height: this.config.height,
			backgroundAlpha: 0,
			antialias: true,
			failIfMajorPerformanceCaveat: false,
			resolution: 1,
			autoDensity: true,
			autoStart: false,
			sharedTicker: false,
			powerPreference: "high-performance" as const,
		};

		const preferredRenderBackend = this.config.preferredRenderBackend;
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

	private createShadowLayers(
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

	private ensureShadowLayerCanvas(layer: ShadowLayer, width: number, height: number): void {
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

	private rasterizeShadowLayer(
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
		});
		layer.context.fill();
		layer.context.restore();

		layer.sprite.position.set(options.x - padding, options.y - padding);
		layer.textureSource?.update();
		layer.container.alpha = 1;
		layer.container.visible = true;
	}

	private shouldUseStartupVideoFrameStaging(): boolean {
		return (
			this.rendererBackend === "webgpu" &&
			this.currentVideoTime < VIDEO_FRAME_STARTUP_STAGING_WINDOW_SEC
		);
	}

	private ensureVideoFrameStagingCanvas(
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

	private stageVideoFrameForTexture(
		frame: VideoFrame,
		kind: "scene" | "background" | "webcam",
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

	private replaceSpriteTexture(
		sprite: Sprite,
		source: CanvasImageSource | VideoFrame,
	): MutableVideoTextureSource {
		const nextTexture = this.createTextureFromSource(source);
		const previousTexture = sprite.texture;
		sprite.texture = nextTexture;
		previousTexture.destroy(true);
		return nextTexture.source as unknown as MutableVideoTextureSource;
	}

	private createTextureFromSource(source: CanvasImageSource | VideoFrame): Texture {
		if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
			return Texture.from(source as unknown as ImageBitmap);
		}

		return Texture.from(
			source as HTMLCanvasElement | HTMLVideoElement | HTMLImageElement | ImageBitmap,
		);
	}

	private getWebcamSourceDimensions(source: HTMLVideoElement | VideoFrame): {
		width: number;
		height: number;
	} {
		if ("displayWidth" in source && "displayHeight" in source) {
			return {
				width: source.displayWidth,
				height: source.displayHeight,
			};
		}

		return {
			width: source.videoWidth,
			height: source.videoHeight,
		};
	}

	private resetBackgroundLayer(): void {
		this.backgroundForwardFrameSource?.cancel();
		void this.backgroundForwardFrameSource?.destroy();
		this.backgroundForwardFrameSource = null;
		this.backgroundForwardFrameSourceUrl = null;
		this.backgroundForwardFrameDurationSec = null;
		this.closeBackgroundDecodedFrame();
		this.cleanupBackgroundSource?.();
		this.cleanupBackgroundSource = null;
		this.lastSyncedBackgroundLoopTimeSec = null;

		if (this.backgroundVideoElement) {
			this.backgroundVideoElement.pause();
			this.backgroundVideoElement.src = "";
			this.backgroundVideoElement.load();
			this.backgroundVideoElement = null;
		}

		const backgroundTexture = this.backgroundSprite?.texture ?? null;
		this.backgroundSprite?.destroy({ texture: false, textureSource: false });
		backgroundTexture?.destroy(true);

		this.backgroundSprite = null;
		this.backgroundTextureSource = null;
		this.backgroundBlurFilter = null;
		this.backgroundContainer?.removeChildren();
	}

	private async setupBackground(): Promise<void> {
		this.resetBackgroundLayer();

		const wallpaper = await this.resolveWallpaperForExport(this.config.wallpaper);

		try {
			if (isVideoWallpaperSource(wallpaper)) {
				let videoSrc = wallpaper;
				if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
					videoSrc = await getAssetPath(wallpaper.replace(/^\//, ""));
				}

				try {
					const frameSource = new ForwardFrameSource();
					const metadata = await frameSource.initialize(videoSrc);
					this.backgroundForwardFrameSource = frameSource;
					this.backgroundForwardFrameSourceUrl = videoSrc;
					this.backgroundForwardFrameDurationSec = getEffectiveVideoStreamDurationSeconds(
						{
							duration: metadata?.duration,
							streamDuration: metadata?.streamDuration,
						},
					);
					this.backgroundVideoElement = null;
					this.backgroundSeekPromise = null;
					this.lastSyncedBackgroundLoopTimeSec = null;
					return;
				} catch (error) {
					console.warn(
						"[FrameRenderer] Decoder-backed video wallpaper unavailable during export; falling back to media element sync:",
						error,
					);
				}

				const backgroundSource = await resolveMediaElementSource(videoSrc);
				this.cleanupBackgroundSource = backgroundSource.revoke;

				const video = document.createElement("video");
				video.muted = true;
				video.loop = true;
				video.playsInline = true;
				video.preload = "auto";
				video.src = backgroundSource.src;
				video.load();

				await new Promise<void>((resolve, reject) => {
					const onReady = () => {
						if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
							return;
						}
						cleanup();
						resolve();
					};
					const onError = () => {
						cleanup();
						reject(new Error(`Failed to load video wallpaper: ${wallpaper}`));
					};
					const cleanup = () => {
						video.removeEventListener("loadeddata", onReady);
						video.removeEventListener("canplay", onReady);
						video.removeEventListener("error", onError);
					};

					video.addEventListener("loadeddata", onReady);
					video.addEventListener("canplay", onReady);
					video.addEventListener("error", onError);
					onReady();
				});

				this.backgroundVideoElement = video;
				this.lastSyncedBackgroundLoopTimeSec = null;
				this.ensureBackgroundSprite(video, video.videoWidth, video.videoHeight);
				return;
			}

			const bgCanvas = document.createElement("canvas");
			bgCanvas.width = this.config.width;
			bgCanvas.height = this.config.height;
			const bgCtx = configureHighQuality2DContext(bgCanvas.getContext("2d"));

			if (!bgCtx) {
				throw new Error("Failed to get 2D context for background canvas");
			}

			if (
				wallpaper.startsWith("file://") ||
				wallpaper.startsWith("data:") ||
				wallpaper.startsWith("/") ||
				wallpaper.startsWith("http")
			) {
				const img = new Image();
				const imageUrl = await this.resolveWallpaperImageUrl(wallpaper);
				if (
					imageUrl.startsWith("http") &&
					window.location.origin &&
					!imageUrl.startsWith(window.location.origin)
				) {
					img.crossOrigin = "anonymous";
				}

				await new Promise<void>((resolve, reject) => {
					img.onload = () => resolve();
					img.onerror = (err) => {
						console.error(
							"[FrameRenderer] Failed to load background image:",
							imageUrl,
							err,
						);
						reject(new Error(`Failed to load background image: ${imageUrl}`));
					};
					img.src = imageUrl;
				});

				drawSourceCoverToCanvas(
					bgCtx,
					img,
					img.width,
					img.height,
					this.config.width,
					this.config.height,
				);
			} else if (wallpaper.startsWith("#")) {
				bgCtx.fillStyle = wallpaper;
				bgCtx.fillRect(0, 0, this.config.width, this.config.height);
			} else if (
				wallpaper.startsWith("linear-gradient") ||
				wallpaper.startsWith("radial-gradient")
			) {
				const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
				if (!gradientMatch) {
					bgCtx.fillStyle = "#000000";
					bgCtx.fillRect(0, 0, this.config.width, this.config.height);
				} else {
					const [, type, params] = gradientMatch;
					const parts = params.split(",").map((value) => value.trim());
					const gradient =
						type === "linear"
							? bgCtx.createLinearGradient(0, 0, 0, this.config.height)
							: bgCtx.createRadialGradient(
									this.config.width / 2,
									this.config.height / 2,
									0,
									this.config.width / 2,
									this.config.height / 2,
									Math.max(this.config.width, this.config.height) / 2,
								);

					parts.forEach((part, index) => {
						if (type === "linear" && (part.startsWith("to ") || part.includes("deg"))) {
							return;
						}

						const colorMatch = part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/);
						if (!colorMatch) {
							return;
						}

						const position = index / Math.max(parts.length - 1, 1);
						gradient.addColorStop(position, colorMatch[1]);
					});

					bgCtx.fillStyle = gradient;
					bgCtx.fillRect(0, 0, this.config.width, this.config.height);
				}
			} else {
				bgCtx.fillStyle = wallpaper;
				bgCtx.fillRect(0, 0, this.config.width, this.config.height);
			}

			const blurredCanvas =
				this.config.backgroundBlur > 0
					? this.createPreblurredBackgroundCanvas(bgCanvas)
					: null;
			const backgroundSource = blurredCanvas ?? bgCanvas;
			const backgroundTexture = Texture.from(backgroundSource);
			this.backgroundSprite = new Sprite(backgroundTexture);
			this.backgroundContainer?.addChild(this.backgroundSprite);
			applyCoverLayoutToSprite(
				this.backgroundSprite,
				backgroundSource.width,
				backgroundSource.height,
				this.config.width,
				this.config.height,
				this.config.width / 2,
				this.config.height / 2,
			);
		} catch (error) {
			console.error("[FrameRenderer] Error setting up background, using fallback:", error);
			const fallback = document.createElement("canvas");
			fallback.width = this.config.width;
			fallback.height = this.config.height;
			const ctx = configureHighQuality2DContext(fallback.getContext("2d"));
			if (!ctx) {
				throw new Error("Failed to create fallback background context");
			}
			ctx.fillStyle = "#000000";
			ctx.fillRect(0, 0, fallback.width, fallback.height);
			this.backgroundSprite = new Sprite(Texture.from(fallback));
			this.backgroundContainer?.addChild(this.backgroundSprite);
			applyCoverLayoutToSprite(
				this.backgroundSprite,
				fallback.width,
				fallback.height,
				this.config.width,
				this.config.height,
				this.config.width / 2,
				this.config.height / 2,
			);
		}
	}

	private ensureBackgroundSprite(
		source: CanvasImageSource | VideoFrame,
		sourceWidth: number,
		sourceHeight: number,
	): void {
		if (!this.backgroundContainer) {
			return;
		}

		const resolvedSource =
			typeof VideoFrame !== "undefined" && source instanceof VideoFrame
				? this.stageVideoFrameForTexture(source, "background", sourceWidth, sourceHeight)
				: typeof HTMLVideoElement !== "undefined" &&
						source instanceof HTMLVideoElement &&
						sourceWidth > 0 &&
						sourceHeight > 0
					? (() => {
							const staging = this.ensureVideoFrameStagingCanvas(
								"background",
								sourceWidth,
								sourceHeight,
							);
							if (!staging) {
								return source;
							}
							staging.context.clearRect(
								0,
								0,
								staging.canvas.width,
								staging.canvas.height,
							);
							staging.context.drawImage(
								source,
								0,
								0,
								staging.canvas.width,
								staging.canvas.height,
							);
							return staging.canvas;
						})()
					: source;

		if (!this.backgroundSprite) {
			const texture = this.createTextureFromSource(resolvedSource);
			this.backgroundSprite = new Sprite(texture);
			this.backgroundTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.backgroundContainer.addChild(this.backgroundSprite);

			if (this.config.backgroundBlur > 0) {
				this.backgroundBlurFilter = new BlurFilter();
				this.backgroundBlurFilter.blur = this.config.backgroundBlur * 3;
				this.backgroundBlurFilter.quality = 4;
				this.backgroundBlurFilter.resolution = this.app?.renderer.resolution ?? 1;
				this.backgroundSprite.filters = [this.backgroundBlurFilter];
			}
		} else if (this.backgroundTextureSource) {
			this.backgroundTextureSource.resource = resolvedSource;
			this.backgroundTextureSource.update();
		}

		applyCoverLayoutToSprite(
			this.backgroundSprite,
			sourceWidth,
			sourceHeight,
			this.config.width,
			this.config.height,
			this.config.width / 2,
			this.config.height / 2,
		);
	}

	private createPreblurredBackgroundCanvas(
		sourceCanvas: HTMLCanvasElement,
	): HTMLCanvasElement | null {
		const blurredCanvas = document.createElement("canvas");
		blurredCanvas.width = sourceCanvas.width;
		blurredCanvas.height = sourceCanvas.height;
		const blurredCtx = configureHighQuality2DContext(blurredCanvas.getContext("2d"));
		if (!blurredCtx) {
			return null;
		}

		blurredCtx.save();
		blurredCtx.filter = `blur(${this.config.backgroundBlur * 3}px)`;
		blurredCtx.drawImage(sourceCanvas, 0, 0, blurredCanvas.width, blurredCanvas.height);
		blurredCtx.restore();

		return blurredCanvas;
	}

	private closeBackgroundDecodedFrame(): void {
		if (!this.backgroundDecodedFrame) {
			return;
		}

		this.backgroundDecodedFrame.close();
		this.backgroundDecodedFrame = null;
	}

	private async restartBackgroundForwardFrameSource(): Promise<void> {
		const sourceUrl = this.backgroundForwardFrameSourceUrl;
		if (!sourceUrl) {
			return;
		}

		const nextSource = new ForwardFrameSource();
		const metadata = await nextSource.initialize(sourceUrl);
		const previousSource = this.backgroundForwardFrameSource;

		this.backgroundForwardFrameSource = nextSource;
		const effectiveDuration = getEffectiveVideoStreamDurationSeconds({
			duration: metadata?.duration,
			streamDuration: metadata?.streamDuration,
		});
		this.backgroundForwardFrameDurationSec =
			Number.isFinite(effectiveDuration) && effectiveDuration > 0 ? effectiveDuration : null;
		this.lastSyncedBackgroundLoopTimeSec = null;

		previousSource?.cancel();
		void previousSource?.destroy();
	}

	private calculateAnnotationScaleFactor(): number {
		const previewWidth = this.config.previewWidth || 1920;
		const previewHeight = this.config.previewHeight || 1080;
		const scaleX = this.config.width / previewWidth;
		const scaleY = this.config.height / previewHeight;
		return (scaleX + scaleY) / 2;
	}

	private hasActiveBlurAnnotations(timeMs: number): boolean {
		return (this.config.annotationRegions ?? []).some(
			(annotation) =>
				annotation.type === "blur" &&
				timeMs >= annotation.startMs &&
				timeMs <= annotation.endMs,
		);
	}

	private ensureExportCompositeCanvas(): ExportCompositeCanvasState | null {
		const targetWidth = Math.max(1, Math.ceil(this.config.width));
		const targetHeight = Math.max(1, Math.ceil(this.config.height));

		if (
			this.exportCompositeCanvas &&
			this.exportCompositeCanvas.canvas.width === targetWidth &&
			this.exportCompositeCanvas.canvas.height === targetHeight
		) {
			return this.exportCompositeCanvas;
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;

		const context = configureHighQuality2DContext(canvas.getContext("2d"));
		if (!context) {
			return null;
		}

		this.exportCompositeCanvas = {
			canvas,
			context,
		};

		return this.exportCompositeCanvas;
	}

	private ensureTemporalCompositeCanvas(): ExportCompositeCanvasState | null {
		const targetWidth = Math.max(1, Math.ceil(this.config.width));
		const targetHeight = Math.max(1, Math.ceil(this.config.height));

		if (
			this.temporalCompositeCanvas &&
			this.temporalCompositeCanvas.canvas.width === targetWidth &&
			this.temporalCompositeCanvas.canvas.height === targetHeight
		) {
			return this.temporalCompositeCanvas;
		}

		const canvas = document.createElement("canvas");
		canvas.width = targetWidth;
		canvas.height = targetHeight;

		const context = configureHighQuality2DContext(canvas.getContext("2d"));
		if (!context) {
			return null;
		}

		this.temporalCompositeCanvas = {
			canvas,
			context,
		};

		return this.temporalCompositeCanvas;
	}

	private drawCaptionOverlay(context: CanvasRenderingContext2D): void {
		if (
			!this.captionContainer?.visible ||
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

	private async composeBlurAnnotationFrame(
		timeMs: number,
		sourceCanvas?: CanvasImageSource,
	): Promise<void> {
		if (!this.app) {
			this.outputCanvasOverride = null;
			return;
		}

		const compositeState = this.ensureExportCompositeCanvas();
		if (!compositeState) {
			this.outputCanvasOverride = null;
			return;
		}

		const { canvas, context } = compositeState;
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.drawImage(sourceCanvas ?? (this.app.canvas as HTMLCanvasElement), 0, 0);

		await renderAnnotations(
			context,
			this.config.annotationRegions ?? [],
			this.config.width,
			this.config.height,
			timeMs,
			this.annotationScaleFactor,
			this.annotationAssets ?? undefined,
		);

		this.drawCaptionOverlay(context);
		this.outputCanvasOverride = canvas;
	}

	private async setupAnnotationLayer(): Promise<void> {
		if (!this.annotationContainer) {
			return;
		}

		for (const entry of this.annotationSprites) {
			entry.sprite.destroy({ texture: false, textureSource: false });
			entry.texture.destroy(true);
		}
		this.annotationSprites = [];
		this.annotationContainer.removeChildren();

		const annotations = [...(this.config.annotationRegions ?? [])].sort(
			(first, second) => first.zIndex - second.zIndex,
		);

		for (const annotation of annotations) {
			const x = (annotation.position.x / 100) * this.config.width;
			const y = (annotation.position.y / 100) * this.config.height;
			const width = (annotation.size.width / 100) * this.config.width;
			const height = (annotation.size.height / 100) * this.config.height;

			if (width <= 0 || height <= 0) {
				continue;
			}

			const canvas = await renderAnnotationToCanvas(
				annotation,
				width,
				height,
				this.annotationScaleFactor,
				this.annotationAssets ?? undefined,
			);
			if (!canvas) {
				continue;
			}

			const texture = Texture.from(canvas);
			const sprite = new Sprite(texture);
			sprite.position.set(x, y);
			sprite.visible = false;
			this.annotationContainer.addChild(sprite);
			this.annotationSprites.push({ annotation, sprite, texture });
		}
	}

	private updateAnnotationLayer(currentTimeMs: number): void {
		for (const entry of this.annotationSprites) {
			entry.sprite.visible =
				currentTimeMs >= entry.annotation.startMs &&
				currentTimeMs <= entry.annotation.endMs;
		}
	}

	private setupCaptionResources(): void {
		if (!this.config.autoCaptions?.length || !this.config.autoCaptionSettings) {
			return;
		}

		this.captionMeasureCanvas = document.createElement("canvas");
		this.captionMeasureCanvas.width = 1;
		this.captionMeasureCanvas.height = 1;
		this.captionMeasureCtx = configureHighQuality2DContext(
			this.captionMeasureCanvas.getContext("2d"),
		);
	}

	private buildCaptionRenderState(timeMs: number): CaptionRenderState | null {
		const settings = this.config.autoCaptionSettings;
		const cues = this.config.autoCaptions;
		const measureCtx = this.captionMeasureCtx;

		if (!settings || !cues?.length || !measureCtx) {
			return null;
		}

		const fontFamily = settings.fontFamily || getDefaultCaptionFontFamily();
		const fontSize = getCaptionScaledFontSize(
			settings.fontSize,
			this.config.width,
			settings.maxWidth,
		);
		measureCtx.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${fontFamily}`;

		const layout = buildActiveCaptionLayout({
			cues,
			timeMs,
			settings,
			maxWidthPx: getCaptionTextMaxWidth(this.config.width, settings.maxWidth, fontSize),
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
			this.config.width * (settings.maxWidth / 100) + padding.x * 2,
			maxMeasuredWidth + padding.x * 2,
		);
		const centerX = this.config.width / 2;
		const centerY =
			this.config.height - (this.config.height * settings.bottomOffset) / 100 - boxHeight / 2;

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

	private ensureCaptionCanvas(width: number, height: number): void {
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
			this.captionContainer?.addChild(this.captionSprite);
			this.captionTextureSource = nextTexture.source as unknown as MutableVideoTextureSource;
		}
	}

	private rasterizeCaptionSprite(state: CaptionRenderState): void {
		this.ensureCaptionCanvas(state.boxWidth, state.boxHeight);

		if (!this.captionCtx || !this.captionCanvas || !this.captionSprite) {
			return;
		}

		const ctx = this.captionCtx;
		const settings = this.config.autoCaptionSettings;
		if (!settings) {
			return;
		}

		ctx.clearRect(0, 0, this.captionCanvas.width, this.captionCanvas.height);
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

		this.captionTextureSource?.update();
		this.captionRenderKey = state.key;
	}

	private updateCaptionLayer(timeMs: number): void {
		const state = this.buildCaptionRenderState(timeMs);
		if (!state || !this.captionContainer) {
			if (this.captionSprite) {
				this.captionSprite.visible = false;
			}
			if (this.captionContainer) {
				this.captionContainer.visible = false;
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

		this.captionContainer.visible = true;
		this.captionSprite.visible = true;
		this.captionSprite.position.set(state.centerX, state.centerY + state.layout.translateY);
		this.captionSprite.scale.set(state.layout.scale);
		this.captionSprite.alpha = state.layout.opacity;
	}

	private async syncBackgroundFrame(timeSeconds: number): Promise<void> {
		if (this.backgroundForwardFrameSource) {
			const duration = this.backgroundForwardFrameDurationSec;
			const shouldLoop = Number.isFinite(duration) && (duration ?? 0) > 0;
			let normalizedTargetTime = shouldLoop
				? ((timeSeconds % duration!) + duration!) % duration!
				: Math.max(0, timeSeconds);

			if (
				shouldLoop &&
				this.lastSyncedBackgroundLoopTimeSec !== null &&
				normalizedTargetTime + 0.001 < this.lastSyncedBackgroundLoopTimeSec
			) {
				try {
					await this.restartBackgroundForwardFrameSource();
				} catch (error) {
					console.warn(
						"[FrameRenderer] Unable to restart looping video wallpaper decoder during export:",
						error,
					);
				}
			}

			const decodedFrame =
				await this.backgroundForwardFrameSource.getFrameAtTime(normalizedTargetTime);
			const resolvedDecodedDuration =
				this.backgroundForwardFrameSource.getResolvedDurationSec();
			if (
				shouldLoop &&
				this.backgroundForwardFrameSource.hasReachedEndOfStream() &&
				Number.isFinite(resolvedDecodedDuration) &&
				(resolvedDecodedDuration ?? 0) > 0 &&
				normalizedTargetTime > (resolvedDecodedDuration ?? 0) + 0.001
			) {
				this.backgroundForwardFrameDurationSec = resolvedDecodedDuration ?? null;
				this.closeBackgroundDecodedFrame();
				try {
					await this.restartBackgroundForwardFrameSource();
					normalizedTargetTime =
						((timeSeconds % resolvedDecodedDuration!) + resolvedDecodedDuration!) %
						resolvedDecodedDuration!;
					const restartedFrame =
						await this.backgroundForwardFrameSource.getFrameAtTime(
							normalizedTargetTime,
						);
					this.backgroundDecodedFrame = restartedFrame;
					if (restartedFrame) {
						this.lastSyncedBackgroundLoopTimeSec = normalizedTargetTime;
						const resolvedBackgroundSource = this.stageVideoFrameForTexture(
							restartedFrame,
							"background",
							restartedFrame.displayWidth,
							restartedFrame.displayHeight,
						);
						this.ensureBackgroundSprite(
							resolvedBackgroundSource,
							restartedFrame.displayWidth,
							restartedFrame.displayHeight,
						);
					}
					return;
				} catch (error) {
					console.warn(
						"[FrameRenderer] Unable to wrap looping video wallpaper at decoded EOF during export:",
						error,
					);
				}
			}
			this.closeBackgroundDecodedFrame();
			this.backgroundDecodedFrame = decodedFrame;
			if (decodedFrame) {
				this.lastSyncedBackgroundLoopTimeSec = normalizedTargetTime;
				const resolvedBackgroundSource = this.stageVideoFrameForTexture(
					decodedFrame,
					"background",
					decodedFrame.displayWidth,
					decodedFrame.displayHeight,
				);
				this.ensureBackgroundSprite(
					resolvedBackgroundSource,
					decodedFrame.displayWidth,
					decodedFrame.displayHeight,
				);
			}
			return;
		}

		const video = this.backgroundVideoElement;
		if (!video) {
			return;
		}

		if (video.duration && Number.isFinite(video.duration)) {
			const targetTime = timeSeconds % video.duration;
			if (Math.abs(video.currentTime - targetTime) > 0.008) {
				if (this.backgroundSeekPromise) {
					await this.backgroundSeekPromise;
				}

				this.backgroundSeekPromise = new Promise<void>((resolve) => {
					let settled = false;
					let fallbackTimeout: number | null = null;
					let animationFrameRequestId: number | null = null;
					let videoFrameRequestId: number | null = null;

					const finish = () => {
						if (settled) {
							return;
						}
						settled = true;
						cleanup();
						resolve();
					};

					const waitForPresentedFrame = () => {
						const requestVideoFrameCallback = (
							video as HTMLVideoElement & {
								requestVideoFrameCallback?: (
									callback: (
										now: DOMHighResTimeStamp,
										metadata: VideoFrameCallbackMetadata,
									) => void,
								) => number;
								cancelVideoFrameCallback?: (handle: number) => void;
							}
						).requestVideoFrameCallback;

						animationFrameRequestId = requestAnimationFrame(() => {
							animationFrameRequestId = null;
							finish();
						});

						if (typeof requestVideoFrameCallback === "function") {
							videoFrameRequestId = requestVideoFrameCallback.call(video, () => {
								videoFrameRequestId = null;
								finish();
							});
						}
					};

					const handleMediaReady = () => {
						if (
							!video.seeking &&
							Math.abs(video.currentTime - targetTime) <= 0.01 &&
							video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
						) {
							waitForPresentedFrame();
						}
					};

					const cleanup = () => {
						video.removeEventListener("seeked", waitForPresentedFrame);
						video.removeEventListener("loadeddata", handleMediaReady);
						video.removeEventListener("canplay", handleMediaReady);
						video.removeEventListener("error", finish);
						if (animationFrameRequestId !== null) {
							cancelAnimationFrame(animationFrameRequestId);
							animationFrameRequestId = null;
						}
						if (
							videoFrameRequestId !== null &&
							typeof (
								video as HTMLVideoElement & {
									cancelVideoFrameCallback?: (handle: number) => void;
								}
							).cancelVideoFrameCallback === "function"
						) {
							(
								video as HTMLVideoElement & {
									cancelVideoFrameCallback: (handle: number) => void;
								}
							).cancelVideoFrameCallback(videoFrameRequestId);
							videoFrameRequestId = null;
						}
						if (fallbackTimeout !== null) {
							window.clearTimeout(fallbackTimeout);
						}
					};

					video.addEventListener("seeked", waitForPresentedFrame, { once: true });
					video.addEventListener("loadeddata", handleMediaReady, { once: true });
					video.addEventListener("canplay", handleMediaReady, { once: true });
					video.addEventListener("error", finish, { once: true });

					fallbackTimeout = window.setTimeout(() => {
						finish();
					}, 50);

					try {
						video.currentTime = targetTime;
					} catch {
						finish();
						return;
					}

					if (
						!video.seeking &&
						Math.abs(video.currentTime - targetTime) <= 0.001 &&
						video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
					) {
						waitForPresentedFrame();
					}
				});

				try {
					await this.backgroundSeekPromise;
				} finally {
					this.backgroundSeekPromise = null;
				}
			}
		}

		this.ensureBackgroundSprite(video, video.videoWidth, video.videoHeight);
	}

	private async resolveWallpaperImageUrl(wallpaper: string): Promise<string> {
		if (
			wallpaper.startsWith("file://") ||
			wallpaper.startsWith("data:") ||
			wallpaper.startsWith("http")
		) {
			return wallpaper;
		}

		const resolved = await getAssetPath(wallpaper.replace(/^\/+/, ""));
		if (resolved.startsWith("/") && window.location.protocol.startsWith("http")) {
			return `${window.location.origin}${resolved}`;
		}

		return resolved;
	}

	private async resolveWallpaperForExport(wallpaper: string): Promise<string> {
		if (!wallpaper) {
			return wallpaper;
		}

		if (isVideoWallpaperSource(wallpaper)) {
			return getExportableVideoUrl(wallpaper);
		}

		if (
			wallpaper.startsWith("#") ||
			wallpaper.startsWith("linear-gradient") ||
			wallpaper.startsWith("radial-gradient")
		) {
			return wallpaper;
		}

		const looksLikeAbsoluteFilePath =
			wallpaper.startsWith("/") &&
			!wallpaper.startsWith("//") &&
			!wallpaper.startsWith("/wallpapers/") &&
			!wallpaper.startsWith("/app-icons/");

		const wallpaperAsset = looksLikeAbsoluteFilePath
			? `file://${encodeURI(wallpaper)}`
			: wallpaper;
		return getRenderableAssetUrl(wallpaperAsset);
	}

	private async setupWebcamSource(): Promise<void> {
		const webcamUrl = this.config.webcamUrl;
		if (!this.config.webcam?.enabled || !webcamUrl) {
			this.webcamForwardFrameSource?.cancel();
			void this.webcamForwardFrameSource?.destroy();
			this.webcamForwardFrameSource = null;
			this.closeWebcamDecodedFrame();
			this.cleanupWebcamSource?.();
			this.cleanupWebcamSource = null;
			this.webcamVideoElement = null;
			this.webcamFrameCacheCanvas = null;
			this.webcamFrameCacheCtx = null;
			this.lastSyncedWebcamTime = null;
			this.lastWebcamCacheRefreshTime = null;
			this.webcamLayoutCache = null;
			this.webcamRenderMode = "hidden";
			return;
		}

		this.webcamForwardFrameSource?.cancel();
		void this.webcamForwardFrameSource?.destroy();
		this.webcamForwardFrameSource = null;
		this.closeWebcamDecodedFrame();
		this.cleanupWebcamSource?.();
		this.cleanupWebcamSource = null;
		this.webcamFrameCacheCanvas = null;
		this.webcamFrameCacheCtx = null;
		this.lastWebcamCacheRefreshTime = null;
		this.webcamLayoutCache = null;
		this.webcamRenderMode = "hidden";

		try {
			const frameSource = new ForwardFrameSource();
			await frameSource.initialize(webcamUrl);
			this.webcamForwardFrameSource = frameSource;
			this.webcamVideoElement = null;
			this.webcamSeekPromise = null;
			this.lastSyncedWebcamTime = null;
			this.lastWebcamCacheRefreshTime = null;
			return;
		} catch (error) {
			console.warn(
				"[FrameRenderer] Decoder-backed webcam source unavailable during export; falling back to media element sync:",
				error,
			);
		}

		const webcamSource = await resolveMediaElementSource(webcamUrl);
		this.cleanupWebcamSource = webcamSource.revoke;

		const video = document.createElement("video");
		video.src = webcamSource.src;
		video.muted = true;
		video.preload = "auto";
		video.playsInline = true;
		video.load();

		await new Promise<void>((resolve, reject) => {
			const onReady = () => {
				if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
					return;
				}
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error("Failed to load webcam source for export"));
			};
			const cleanup = () => {
				video.removeEventListener("loadeddata", onReady);
				video.removeEventListener("canplay", onReady);
				video.removeEventListener("canplaythrough", onReady);
				video.removeEventListener("error", onError);
			};

			if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
				resolve();
				return;
			}

			video.addEventListener("loadeddata", onReady, { once: true });
			video.addEventListener("canplay", onReady, { once: true });
			video.addEventListener("canplaythrough", onReady, { once: true });
			video.addEventListener("error", onError, { once: true });
		}).catch((error) => {
			console.warn("[FrameRenderer] Webcam overlay unavailable during export:", error);
			this.webcamVideoElement = null;
		});

		if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
			this.webcamVideoElement = video;
			return;
		}

		this.webcamVideoElement = null;
		this.lastSyncedWebcamTime = null;
	}

	private ensureWebcamSprite(
		source: CanvasImageSource | VideoFrame,
		sourceWidth: number,
		sourceHeight: number,
	): void {
		if (!this.webcamContainer) {
			return;
		}

		const resolvedSource =
			typeof VideoFrame !== "undefined" && source instanceof VideoFrame
				? this.stageVideoFrameForTexture(source, "webcam", sourceWidth, sourceHeight)
				: source;
		const usesStartupStaging = resolvedSource !== source;

		if (!this.webcamSprite) {
			const texture = this.createTextureFromSource(resolvedSource);
			this.webcamSprite = new Sprite(texture);
			this.webcamTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.webcamContainer.addChildAt(this.webcamSprite, 0);
			this.webcamTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.webcamTextureUsesStartupStaging !== usesStartupStaging) {
			this.webcamTextureSource = this.replaceSpriteTexture(this.webcamSprite, resolvedSource);
			this.webcamTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.webcamTextureSource) {
			this.webcamTextureSource.resource = resolvedSource;
			this.webcamTextureSource.update();
		}

		if (this.webcamRootContainer) {
			this.webcamRootContainer.visible = sourceWidth > 0 && sourceHeight > 0;
		}
	}

	private setWebcamRenderMode(nextMode: "hidden" | "live" | "cached"): void {
		if (this.webcamRenderMode === nextMode) {
			return;
		}

		if (nextMode === "cached") {
			console.log("[FrameRenderer] Webcam export source fell back to the last synced frame");
		} else if (this.webcamRenderMode === "cached" && nextMode === "live") {
			console.log("[FrameRenderer] Webcam export source resynchronized");
		}

		this.webcamRenderMode = nextMode;
	}

	private shouldRefreshWebcamFrameCache(width: number, height: number): boolean {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));

		if (
			!this.webcamFrameCacheCanvas ||
			this.webcamFrameCacheCanvas.width !== targetWidth ||
			this.webcamFrameCacheCanvas.height !== targetHeight
		) {
			return true;
		}

		if (this.lastWebcamCacheRefreshTime === null) {
			return true;
		}

		return Math.abs(this.currentVideoTime - this.lastWebcamCacheRefreshTime) >= 0.25;
	}

	private ensureWebcamFrameCache(width: number, height: number): boolean {
		const targetWidth = Math.max(1, Math.ceil(width));
		const targetHeight = Math.max(1, Math.ceil(height));

		if (
			this.webcamFrameCacheCanvas &&
			this.webcamFrameCacheCanvas.width === targetWidth &&
			this.webcamFrameCacheCanvas.height === targetHeight &&
			this.webcamFrameCacheCtx
		) {
			return true;
		}

		this.webcamFrameCacheCanvas = document.createElement("canvas");
		this.webcamFrameCacheCanvas.width = targetWidth;
		this.webcamFrameCacheCanvas.height = targetHeight;
		this.webcamFrameCacheCtx = configureHighQuality2DContext(
			this.webcamFrameCacheCanvas.getContext("2d"),
		);

		return !!this.webcamFrameCacheCtx;
	}

	private refreshWebcamFrameCache(
		source: CanvasImageSource | VideoFrame,
		width: number,
		height: number,
	): boolean {
		if (!this.ensureWebcamFrameCache(width, height)) {
			return false;
		}

		if (!this.webcamFrameCacheCanvas || !this.webcamFrameCacheCtx) {
			return false;
		}

		this.webcamFrameCacheCtx.clearRect(
			0,
			0,
			this.webcamFrameCacheCanvas.width,
			this.webcamFrameCacheCanvas.height,
		);
		this.webcamFrameCacheCtx.drawImage(
			source,
			0,
			0,
			this.webcamFrameCacheCanvas.width,
			this.webcamFrameCacheCanvas.height,
		);
		this.lastWebcamCacheRefreshTime = this.currentVideoTime;
		return true;
	}

	private getCachedWebcamRenderSource(): WebcamRenderSource | null {
		if (
			!this.webcamFrameCacheCanvas ||
			this.webcamFrameCacheCanvas.width <= 0 ||
			this.webcamFrameCacheCanvas.height <= 0
		) {
			return null;
		}

		return {
			source: this.webcamFrameCacheCanvas,
			width: this.webcamFrameCacheCanvas.width,
			height: this.webcamFrameCacheCanvas.height,
			mode: "cached",
		};
	}

	private resolveRenderableWebcamSource(
		liveSource: CanvasImageSource | VideoFrame | null,
		liveSourceWidth: number,
		liveSourceHeight: number,
		canUseLiveSource: boolean,
	): WebcamRenderSource | null {
		if (canUseLiveSource && liveSource && liveSourceWidth > 0 && liveSourceHeight > 0) {
			if (this.shouldRefreshWebcamFrameCache(liveSourceWidth, liveSourceHeight)) {
				this.refreshWebcamFrameCache(liveSource, liveSourceWidth, liveSourceHeight);
			}
			this.setWebcamRenderMode("live");
			return {
				source: liveSource,
				width: liveSourceWidth,
				height: liveSourceHeight,
				mode: "live",
			};
		}

		const cachedSource = this.getCachedWebcamRenderSource();
		if (cachedSource) {
			this.setWebcamRenderMode("cached");
			return cachedSource;
		}

		if (canUseLiveSource && liveSource && liveSourceWidth > 0 && liveSourceHeight > 0) {
			this.setWebcamRenderMode("live");
			return {
				source: liveSource,
				width: liveSourceWidth,
				height: liveSourceHeight,
				mode: "live",
			};
		}

		this.setWebcamRenderMode("hidden");
		return null;
	}

	private hasMatchingWebcamLayout(nextLayout: WebcamLayoutCache): boolean {
		const previousLayout = this.webcamLayoutCache;
		if (!previousLayout) {
			return false;
		}

		return (
			previousLayout.mirror === nextLayout.mirror &&
			areNearlyEqual(previousLayout.sourceWidth, nextLayout.sourceWidth) &&
			areNearlyEqual(previousLayout.sourceHeight, nextLayout.sourceHeight) &&
			areNearlyEqual(previousLayout.size, nextLayout.size) &&
			areNearlyEqual(previousLayout.positionX, nextLayout.positionX) &&
			areNearlyEqual(previousLayout.positionY, nextLayout.positionY) &&
			areNearlyEqual(previousLayout.radius, nextLayout.radius) &&
			areNearlyEqual(previousLayout.shadowStrength, nextLayout.shadowStrength)
		);
	}

	private applyWebcamLayout(nextLayout: WebcamLayoutCache): void {
		if (!this.webcamRootContainer || !this.webcamSprite || !this.webcamMaskGraphics) {
			return;
		}

		this.webcamRootContainer.position.set(nextLayout.positionX, nextLayout.positionY);

		applyCoverLayoutToSprite(
			this.webcamSprite,
			nextLayout.sourceWidth,
			nextLayout.sourceHeight,
			nextLayout.size,
			nextLayout.size,
			nextLayout.size / 2,
			nextLayout.size / 2,
			nextLayout.mirror,
		);

		this.webcamMaskGraphics.clear();
		drawSquircleOnGraphics(this.webcamMaskGraphics, {
			x: 0,
			y: 0,
			width: nextLayout.size,
			height: nextLayout.size,
			radius: nextLayout.radius,
		});
		this.webcamMaskGraphics.fill({ color: 0xffffff });

		for (const layer of this.webcamShadowLayers) {
			if (nextLayout.shadowStrength <= 0) {
				layer.container.visible = false;
				continue;
			}

			const offsetY = nextLayout.size * layer.offsetScale * nextLayout.shadowStrength;
			this.rasterizeShadowLayer(layer, {
				x: 0,
				y: 0,
				width: nextLayout.size,
				height: nextLayout.size,
				radius: nextLayout.radius,
				offsetY,
				alpha: layer.alphaScale * nextLayout.shadowStrength,
				blur: Math.max(0, nextLayout.size * layer.blurScale * nextLayout.shadowStrength),
			});
		}

		this.webcamLayoutCache = { ...nextLayout };
	}

	private async syncWebcamFrame(targetTime: number): Promise<void> {
		const webcamTargetTime = getWebcamMediaTargetTimeSeconds({
			currentTime: targetTime,
			webcamDuration: Number.isFinite(this.webcamVideoElement?.duration)
				? this.webcamVideoElement?.duration
				: null,
			timeOffsetMs: this.config.webcam?.timeOffsetMs,
		});

		if (this.webcamForwardFrameSource) {
			const clampedTime = clampMediaTimeToDuration(webcamTargetTime, null);
			const decodedFrame = await this.webcamForwardFrameSource.getFrameAtTime(clampedTime);
			this.closeWebcamDecodedFrame();
			this.webcamDecodedFrame = decodedFrame;
			if (decodedFrame) {
				this.lastSyncedWebcamTime = clampedTime;
			}
			return;
		}

		const webcamVideo = this.webcamVideoElement;
		if (!webcamVideo) {
			return;
		}

		const clampedTime = clampMediaTimeToDuration(
			webcamTargetTime,
			Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null,
		);

		if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.008) {
			this.lastSyncedWebcamTime = clampedTime;
			return;
		}

		if (this.webcamSeekPromise) {
			await this.webcamSeekPromise;
		}

		this.webcamSeekPromise = new Promise<void>((resolve) => {
			let settled = false;
			let fallbackTimeout: number | null = null;
			let animationFrameRequestId: number | null = null;
			let videoFrameRequestId: number | null = null;

			const waitForPresentedFrame = () => {
				const requestVideoFrameCallback = (
					webcamVideo as HTMLVideoElement & {
						requestVideoFrameCallback?: (
							callback: (
								now: DOMHighResTimeStamp,
								metadata: VideoFrameCallbackMetadata,
							) => void,
						) => number;
						cancelVideoFrameCallback?: (handle: number) => void;
					}
				).requestVideoFrameCallback;

				const scheduleAnimationFrameFinish = () => {
					animationFrameRequestId = requestAnimationFrame(() => {
						animationFrameRequestId = null;
						finish();
					});
				};

				scheduleAnimationFrameFinish();

				if (typeof requestVideoFrameCallback === "function") {
					videoFrameRequestId = requestVideoFrameCallback.call(webcamVideo, () => {
						videoFrameRequestId = null;
						finish();
					});
				}
			};

			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				if (Math.abs(webcamVideo.currentTime - clampedTime) <= 0.02) {
					this.lastSyncedWebcamTime = clampedTime;
				}
				cleanup();
				resolve();
			};

			const handleMediaReady = () => {
				if (
					!webcamVideo.seeking &&
					Math.abs(webcamVideo.currentTime - clampedTime) <= 0.01 &&
					webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
				) {
					waitForPresentedFrame();
				}
			};

			const cleanup = () => {
				webcamVideo.removeEventListener("seeked", waitForPresentedFrame);
				webcamVideo.removeEventListener("loadeddata", handleMediaReady);
				webcamVideo.removeEventListener("canplay", handleMediaReady);
				webcamVideo.removeEventListener("error", finish);
				if (animationFrameRequestId !== null) {
					cancelAnimationFrame(animationFrameRequestId);
					animationFrameRequestId = null;
				}
				if (
					videoFrameRequestId !== null &&
					typeof (
						webcamVideo as HTMLVideoElement & {
							cancelVideoFrameCallback?: (handle: number) => void;
						}
					).cancelVideoFrameCallback === "function"
				) {
					(
						webcamVideo as HTMLVideoElement & {
							cancelVideoFrameCallback: (handle: number) => void;
						}
					).cancelVideoFrameCallback(videoFrameRequestId);
					videoFrameRequestId = null;
				}
				if (fallbackTimeout !== null) {
					window.clearTimeout(fallbackTimeout);
				}
			};

			webcamVideo.addEventListener("seeked", waitForPresentedFrame, { once: true });
			webcamVideo.addEventListener("loadeddata", handleMediaReady, { once: true });
			webcamVideo.addEventListener("canplay", handleMediaReady, { once: true });
			webcamVideo.addEventListener("error", finish, { once: true });

			fallbackTimeout = window.setTimeout(() => {
				finish();
			}, 50);

			try {
				webcamVideo.currentTime = clampedTime;
			} catch {
				finish();
				return;
			}

			if (
				!webcamVideo.seeking &&
				Math.abs(webcamVideo.currentTime - clampedTime) <= 0.001 &&
				webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
			) {
				waitForPresentedFrame();
			}
		});

		try {
			await this.webcamSeekPromise;
		} finally {
			this.webcamSeekPromise = null;
		}
	}

	private updateWebcamOverlay(): void {
		const webcam = this.config.webcam;
		if (!webcam?.enabled || !this.webcamRootContainer || !this.webcamMaskGraphics) {
			if (this.webcamRootContainer) {
				this.webcamRootContainer.visible = false;
			}
			this.webcamLayoutCache = null;
			this.setWebcamRenderMode("hidden");
			return;
		}

		const webcamSource = this.webcamDecodedFrame ?? this.webcamVideoElement;
		const liveSourceDimensions = webcamSource
			? this.getWebcamSourceDimensions(webcamSource)
			: { width: 0, height: 0 };
		const activeWebcamVideoElement =
			webcamSource === this.webcamVideoElement ? this.webcamVideoElement : null;
		const webcamTimeDrift =
			this.lastSyncedWebcamTime === null
				? 0
				: Math.abs(this.lastSyncedWebcamTime - this.currentVideoTime);
		const canUseLiveSource =
			!!webcamSource &&
			liveSourceDimensions.width > 0 &&
			liveSourceDimensions.height > 0 &&
			webcamTimeDrift <= 0.08 &&
			(!activeWebcamVideoElement ||
				(activeWebcamVideoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
					!activeWebcamVideoElement.seeking));
		const renderableWebcamSource = this.resolveRenderableWebcamSource(
			webcamSource,
			liveSourceDimensions.width,
			liveSourceDimensions.height,
			canUseLiveSource,
		);

		if (!renderableWebcamSource) {
			this.webcamRootContainer.visible = false;
			this.webcamLayoutCache = null;
			return;
		}

		this.ensureWebcamSprite(
			renderableWebcamSource.source,
			renderableWebcamSource.width,
			renderableWebcamSource.height,
		);
		if (!this.webcamSprite) {
			this.webcamRootContainer.visible = false;
			return;
		}

		const margin = webcam.margin ?? 24;
		const size = getWebcamOverlaySizePx({
			containerWidth: this.config.width,
			containerHeight: this.config.height,
			sizePercent: webcam.size ?? 50,
			margin,
			zoomScale: this.animationState.appliedScale || 1,
			reactToZoom: webcam.reactToZoom ?? true,
		});
		const position = getWebcamOverlayPosition({
			containerWidth: this.config.width,
			containerHeight: this.config.height,
			size,
			margin,
			positionPreset: webcam.positionPreset ?? webcam.corner,
			positionX: webcam.positionX ?? 1,
			positionY: webcam.positionY ?? 1,
			legacyCorner: webcam.corner,
		});
		const radius = Math.max(0, webcam.cornerRadius ?? 18);
		const shadowStrength = clampUnitInterval(webcam.shadow ?? 0);

		this.webcamRootContainer.visible = true;

		const nextLayout: WebcamLayoutCache = {
			sourceWidth: renderableWebcamSource.width,
			sourceHeight: renderableWebcamSource.height,
			size,
			positionX: position.x,
			positionY: position.y,
			radius,
			shadowStrength,
			mirror: webcam.mirror,
		};

		if (!this.hasMatchingWebcamLayout(nextLayout)) {
			this.applyWebcamLayout(nextLayout);
		}
	}

	private async renderSceneSample(
		timestamp: number,
		cursorTimestamp: number,
		backgroundTimelineTimestamp: number,
		layoutCache: LayoutCache,
		useVelocityMotionBlur: boolean,
		includeOverlayLayers = true,
	): Promise<RenderSnapshot> {
		if (!this.app || !this.cameraContainer || !this.videoMaskGraphics) {
			throw new Error("Renderer not initialized");
		}

		this.currentVideoTime = timestamp / 1_000_000;

		if (this.webcamForwardFrameSource || this.webcamVideoElement) {
			await this.syncWebcamFrame(Math.max(0, this.currentVideoTime));
		}

		if (this.backgroundForwardFrameSource || this.backgroundVideoElement) {
			await this.syncBackgroundFrame(Math.max(0, backgroundTimelineTimestamp / 1_000_000));
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

		const motionIntensity = this.updateAnimationState(timeMs);

		applyZoomTransform({
			cameraContainer: this.cameraContainer,
			zoomBlurFilter: this.zoomBlurFilter,
			motionBlurFilter: this.motionBlurFilter,
			stageSize: layoutCache.stageSize,
			baseMask: layoutCache.maskRect,
			zoomScale: this.animationState.scale,
			zoomProgress: this.animationState.progress,
			focusX: this.animationState.focusX,
			focusY: this.animationState.focusY,
			motionIntensity,
			motionVector: this.lastMotionVector,
			isPlaying: true,
			motionBlurAmount: useVelocityMotionBlur ? (this.config.zoomMotionBlur ?? 0) : 0,
			transformOverride: {
				scale: this.animationState.appliedScale,
				x: this.animationState.x,
				y: this.animationState.y,
			},
			motionBlurState: this.motionBlurState,
			frameTimeMs: timeMs,
		});

		if (includeOverlayLayers) {
			this.updateAnnotationLayer(timeMs);
			this.updateCaptionLayer(timeMs);
		}
		this.updateWebcamOverlay();

		const annotationContainerVisible = this.annotationContainer?.visible ?? true;
		const captionContainerVisible = this.captionContainer?.visible ?? true;
		if (!includeOverlayLayers) {
			if (this.annotationContainer) {
				this.annotationContainer.visible = false;
			}
			if (this.captionContainer) {
				this.captionContainer.visible = false;
			}
		}

		this.app.render();

		if (!includeOverlayLayers) {
			if (this.annotationContainer) {
				this.annotationContainer.visible = annotationContainerVisible;
			}
			if (this.captionContainer) {
				this.captionContainer.visible = captionContainerVisible;
			}
		}

		return {
			timeMs,
			cursorTimeMs,
			sceneTransform: {
				scale: this.animationState.appliedScale,
				x: this.animationState.x,
				y: this.animationState.y,
			},
			zoom: {
				scale: this.animationState.scale,
				focusX: this.animationState.focusX,
				focusY: this.animationState.focusY,
				progress: this.animationState.progress,
			},
		};
	}

	private async renderTemporalMotionBlurFrame(
		timestamp: number,
		cursorTimestamp: number,
		backgroundTimelineTimestamp: number,
		frameDurationUs: number,
		layoutCache: LayoutCache,
	): Promise<RenderSnapshot | null> {
		if (!this.app) {
			return null;
		}

		const blurConfig = getTemporalMotionBlurConfig(
			this.config.zoomTemporalMotionBlur ?? this.config.zoomMotionBlur,
			{
				sampleCount: this.config.zoomMotionBlurSampleCount,
				shutterFraction: this.config.zoomMotionBlurShutterFraction,
			},
		);
		if (!blurConfig) {
			return null;
		}

		const compositeState = this.ensureTemporalCompositeCanvas();
		if (!compositeState) {
			return null;
		}

		const samplePlan = buildTemporalSamplePlanUs(frameDurationUs, blurConfig);

		compositeState.context.clearRect(
			0,
			0,
			compositeState.canvas.width,
			compositeState.canvas.height,
		);

		let centerSnapshot: RenderSnapshot | null = null;
		let lastSnapshot: RenderSnapshot | null = null;

		for (const { offsetUs: sampleOffsetUs, weight } of samplePlan) {
			const sampleTimestamp = Math.max(0, timestamp + sampleOffsetUs);
			const sampleCursorTimestamp = Math.max(0, cursorTimestamp + sampleOffsetUs);
			const sampleBackgroundTimelineTimestamp = Math.max(
				0,
				backgroundTimelineTimestamp + sampleOffsetUs,
			);
			const snapshot = await this.renderSceneSample(
				sampleTimestamp,
				sampleCursorTimestamp,
				sampleBackgroundTimelineTimestamp,
				layoutCache,
				false,
				false,
			);
			lastSnapshot = snapshot;
			if (Math.abs(sampleOffsetUs) < 0.0001) {
				centerSnapshot = snapshot;
			}

			compositeState.context.save();
			compositeState.context.globalCompositeOperation = "lighter";
			compositeState.context.globalAlpha = weight;
			compositeState.context.drawImage(this.app.canvas as HTMLCanvasElement, 0, 0);
			compositeState.context.restore();
		}

		const resolvedSnapshot = centerSnapshot ?? lastSnapshot;
		if (!resolvedSnapshot) {
			return null;
		}

		const hasOverlayCanvasWork =
			(this.config.annotationRegions?.length ?? 0) > 0 ||
			Boolean(this.captionCanvas && this.captionSprite?.visible);
		if (hasOverlayCanvasWork) {
			await this.composeBlurAnnotationFrame(resolvedSnapshot.timeMs, compositeState.canvas);
		} else {
			this.outputCanvasOverride = compositeState.canvas;
		}

		return resolvedSnapshot;
	}

	async renderFrame(
		videoFrame: VideoFrame,
		timestamp: number,
		cursorTimestamp = timestamp,
		frameDurationUs?: number,
		backgroundTimelineTimestamp = timestamp,
	): Promise<void> {
		if (!this.app || !this.videoContainer || !this.cameraContainer || !this.videoMaskGraphics) {
			throw new Error("Renderer not initialized");
		}

		this.currentVideoTime = timestamp / 1_000_000;

		const resolvedVideoSource = this.stageVideoFrameForTexture(
			videoFrame,
			"scene",
			this.config.videoWidth,
			this.config.videoHeight,
		);
		const usesStartupStaging = resolvedVideoSource !== videoFrame;

		if (!this.videoSprite) {
			const texture = this.createTextureFromSource(resolvedVideoSource);
			this.videoSprite = new Sprite(texture);
			this.videoTextureSource = texture.source as unknown as MutableVideoTextureSource;
			this.videoContainer.addChildAt(this.videoSprite, 0);
			this.videoTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.videoTextureUsesStartupStaging !== usesStartupStaging) {
			this.videoTextureSource = this.replaceSpriteTexture(
				this.videoSprite,
				resolvedVideoSource,
			);
			this.videoTextureUsesStartupStaging = usesStartupStaging;
		} else if (this.videoTextureSource) {
			this.videoTextureSource.resource = resolvedVideoSource;
			this.videoTextureSource.update();
		}

		if (!this.layoutCache) {
			this.updateLayout();
		}
		const layoutCache = this.layoutCache;
		if (!layoutCache) {
			throw new Error("Renderer layout cache is unavailable");
		}

		const temporalSnapshot =
			typeof frameDurationUs === "number" && frameDurationUs > 0
				? await this.renderTemporalMotionBlurFrame(
						timestamp,
						cursorTimestamp,
						backgroundTimelineTimestamp,
						frameDurationUs,
						layoutCache,
					)
				: null;

		if (temporalSnapshot) {
			const sourceCanvas =
				this.outputCanvasOverride ?? this.ensureTemporalCompositeCanvas()?.canvas;
			if (sourceCanvas && this.shouldCompositeExtensionFrame()) {
				this.compositeExtensions(
					temporalSnapshot.timeMs,
					temporalSnapshot.cursorTimeMs,
					sourceCanvas,
				);
				this.outputCanvasOverride = this.compositeCanvas;
			}
			return;
		}

		if (this.webcamForwardFrameSource || this.webcamVideoElement) {
			await this.syncWebcamFrame(Math.max(0, this.currentVideoTime));
		}

		if (this.backgroundForwardFrameSource || this.backgroundVideoElement) {
			await this.syncBackgroundFrame(Math.max(0, backgroundTimelineTimestamp / 1_000_000));
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
		const motionIntensity = this.updateAnimationState(timeMs);
		maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);

		applyZoomTransform({
			cameraContainer: this.cameraContainer,
			zoomBlurFilter: this.zoomBlurFilter,
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

		this.updateAnnotationLayer(timeMs);
		this.updateCaptionLayer(timeMs);
		this.updateWebcamOverlay();

		if (this.hasActiveBlurAnnotations(timeMs)) {
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

			await this.composeBlurAnnotationFrame(timeMs);
			return;
		}

		this.outputCanvasOverride = null;
		this.app.render();
		this.compositeExtensions(timeMs, cursorTimeMs);
	}

	private shouldCompositeExtensionFrame(): boolean {
		return (
			extensionHost.hasCursorEffects() ||
			extensionHost.hasRenderHooks("post-zoom") ||
			extensionHost.hasRenderHooks("post-cursor") ||
			extensionHost.hasRenderHooks("post-annotations") ||
			extensionHost.hasRenderHooks("final")
		);
	}

	private compositeExtensions(
		timeMs: number,
		cursorTimeMs: number,
		sourceCanvas?: CanvasImageSource,
	): void {
		if (!this.app || !this.compositeCtx || !this.compositeCanvas) {
			return;
		}

		if (!this.shouldCompositeExtensionFrame()) {
			return;
		}

		this.compositeCtx.clearRect(0, 0, this.config.width, this.config.height);
		this.compositeCtx.drawImage(sourceCanvas ?? (this.app.canvas as HTMLCanvasElement), 0, 0);

		const maskRect = this.layoutCache?.maskRect;
		const smoothedCursor = mapSmoothedCursorToCanvasNormalized(
			this.cursorOverlay?.getSmoothedCursorSnapshot() ?? null,
			{
				maskRect,
				canvasWidth: this.config.width,
				canvasHeight: this.config.height,
			},
		);
		extensionHost.setSmoothedCursor(
			smoothedCursor
				? {
						timeMs,
						cx: smoothedCursor.cx,
						cy: smoothedCursor.cy,
						trail: smoothedCursor.trail,
					}
				: null,
		);
		const rawCursor = this.getCursorPosition(cursorTimeMs);
		const hookParams = {
			width: this.config.width,
			height: this.config.height,
			timeMs,
			durationMs: 0,
			cursor: smoothedCursor
				? {
						cx: smoothedCursor.cx,
						cy: smoothedCursor.cy,
						interactionType: rawCursor?.interactionType,
					}
				: rawCursor,
			smoothedCursor,
			videoLayout: maskRect
				? {
						maskRect: {
							x: maskRect.x,
							y: maskRect.y,
							width: maskRect.width,
							height: maskRect.height,
						},
						borderRadius: this.config.borderRadius ?? 0,
						padding: this.config.padding ?? 0,
					}
				: undefined,
			zoom: {
				scale: this.animationState.scale,
				focusX: this.animationState.focusX,
				focusY: this.animationState.focusY,
				progress: this.animationState.progress,
			},
			shadow: {
				enabled: this.config.showShadow,
				intensity: this.config.shadowIntensity,
			},
			sceneTransform: {
				scale: this.animationState.appliedScale,
				x: this.animationState.x,
				y: this.animationState.y,
			},
		};

		this.compositeCtx.save();
		applyCanvasSceneTransform(this.compositeCtx, {
			scale: this.animationState.appliedScale,
			x: this.animationState.x,
			y: this.animationState.y,
		});
		executeExtensionRenderHooks("post-video", this.compositeCtx, hookParams);
		executeExtensionRenderHooks("post-zoom", this.compositeCtx, hookParams);
		executeExtensionRenderHooks("post-cursor", this.compositeCtx, hookParams);
		this.emitCursorInteractions(cursorTimeMs);
		executeExtensionCursorEffects(
			this.compositeCtx,
			timeMs,
			this.config.width,
			this.config.height,
			{
				zoom: hookParams.zoom,
				sceneTransform: hookParams.sceneTransform,
				videoLayout: hookParams.videoLayout,
			},
		);
		this.compositeCtx.restore();

		executeExtensionRenderHooks("post-webcam", this.compositeCtx, hookParams);
		executeExtensionRenderHooks("post-annotations", this.compositeCtx, hookParams);
		executeExtensionRenderHooks("final", this.compositeCtx, hookParams);
	}

	private getCursorPosition(
		timeMs: number,
	): { cx: number; cy: number; interactionType?: string } | null {
		const telemetry = this.config.cursorTelemetry;
		if (!telemetry || telemetry.length === 0) {
			return null;
		}

		// Clamp to first/last sample when out of range
		if (timeMs <= telemetry[0].timeMs) {
			const s = telemetry[0];
			return mapCursorToCanvasNormalized(
				{ cx: s.cx, cy: s.cy, interactionType: s.interactionType },
				{
					maskRect: this.layoutCache?.maskRect,
					canvasWidth: this.config.width,
					canvasHeight: this.config.height,
				},
			);
		}
		if (timeMs >= telemetry[telemetry.length - 1].timeMs) {
			const s = telemetry[telemetry.length - 1];
			return mapCursorToCanvasNormalized(
				{ cx: s.cx, cy: s.cy, interactionType: s.interactionType },
				{
					maskRect: this.layoutCache?.maskRect,
					canvasWidth: this.config.width,
					canvasHeight: this.config.height,
				},
			);
		}

		// Binary search for surrounding samples
		let lo = 0;
		let hi = telemetry.length - 1;
		while (lo < hi - 1) {
			const mid = (lo + hi) >> 1;
			if (telemetry[mid].timeMs <= timeMs) {
				lo = mid;
			} else {
				hi = mid;
			}
		}

		const a = telemetry[lo];
		const b = telemetry[hi];
		const span = b.timeMs - a.timeMs;

		// Linear interpolation between samples
		const t = span > 0 ? (timeMs - a.timeMs) / span : 0;
		const cx = a.cx + (b.cx - a.cx) * t;
		const cy = a.cy + (b.cy - a.cy) * t;

		return mapCursorToCanvasNormalized(
			{ cx, cy, interactionType: a.interactionType },
			{
				maskRect: this.layoutCache?.maskRect,
				canvasWidth: this.config.width,
				canvasHeight: this.config.height,
			},
		);
	}

	private emitCursorInteractions(timeMs: number): void {
		const telemetry = this.config.cursorTelemetry;
		if (!telemetry || telemetry.length === 0) {
			return;
		}

		for (const point of telemetry) {
			if (point.timeMs > timeMs) {
				break;
			}
			if (point.timeMs < timeMs - 100) {
				continue;
			}
			if (!point.interactionType || point.interactionType === "move") {
				continue;
			}
			if (point.timeMs === this.lastEmittedClickTimeMs) {
				continue;
			}

			const mappedCursor = mapCursorToCanvasNormalized(
				{ cx: point.cx, cy: point.cy, interactionType: point.interactionType },
				{
					maskRect: this.layoutCache?.maskRect,
					canvasWidth: this.config.width,
					canvasHeight: this.config.height,
				},
			);
			if (!mappedCursor) {
				continue;
			}

			this.lastEmittedClickTimeMs = point.timeMs;
			notifyCursorInteraction(
				point.timeMs,
				mappedCursor.cx,
				mappedCursor.cy,
				point.interactionType,
			);
		}
	}

	private updateLayout(): void {
		if (!this.app || !this.videoSprite || !this.videoMaskGraphics) return;

		const {
			width,
			height,
			cropRegion,
			borderRadius = 0,
			padding = 0,
			videoWidth,
			videoHeight,
		} = this.config;

		const layout = computePaddedLayout({
			width,
			height,
			padding,
			cropRegion,
			videoWidth,
			videoHeight,
		});

		this.videoSprite.scale.set(layout.scale);
		this.videoSprite.position.set(layout.spriteX, layout.spriteY);

		const previewWidth = this.config.previewWidth || 1920;
		const previewHeight = this.config.previewHeight || 1080;
		const canvasScaleFactor = Math.min(width / previewWidth, height / previewHeight);
		const scaledBorderRadius = borderRadius * canvasScaleFactor;

		this.videoMaskGraphics.clear();
		drawSquircleOnGraphics(this.videoMaskGraphics, {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			radius: scaledBorderRadius,
		});
		this.videoMaskGraphics.fill({ color: 0xffffff });

		this.updateVideoShadowLayout({
			maskX: layout.centerOffsetX,
			maskY: layout.centerOffsetY,
			maskWidth: layout.croppedDisplayWidth,
			maskHeight: layout.croppedDisplayHeight,
			maskRadius: scaledBorderRadius,
		});

		this.layoutCache = {
			stageSize: { width, height },
			videoSize: {
				width: videoWidth * cropRegion.width,
				height: videoHeight * cropRegion.height,
			},
			baseScale: layout.scale,
			baseOffset: { x: layout.spriteX, y: layout.spriteY },
			maskRect: {
				x: layout.centerOffsetX,
				y: layout.centerOffsetY,
				width: layout.croppedDisplayWidth,
				height: layout.croppedDisplayHeight,
				sourceCrop: cropRegion,
			},
		};
	}

	private updateVideoShadowLayout(layout: {
		maskX: number;
		maskY: number;
		maskWidth: number;
		maskHeight: number;
		maskRadius: number;
	}): void {
		const shadowStrength = clampUnitInterval(this.config.shadowIntensity);
		for (const layer of this.videoShadowLayers) {
			if (!this.config.showShadow || shadowStrength <= 0) {
				layer.container.visible = false;
				continue;
			}

			const offsetY = layer.offsetScale * shadowStrength;
			this.rasterizeShadowLayer(layer, {
				x: layout.maskX,
				y: layout.maskY,
				width: layout.maskWidth,
				height: layout.maskHeight,
				radius: layout.maskRadius,
				offsetY,
				alpha: layer.alphaScale * shadowStrength,
				blur: Math.max(0, layer.blurScale * shadowStrength),
			});
		}
	}

	private updateAnimationState(timeMs: number): number {
		if (!this.cameraContainer || !this.layoutCache) {
			return 0;
		}

		const { region, strength, blendedScale, transition } = findDominantRegion(
			this.config.zoomRegions,
			timeMs,
			{
				connectZooms: this.config.connectZooms,
				zoomInDurationMs: this.config.zoomInDurationMs,
				zoomOutDurationMs: this.config.zoomOutDurationMs,
			},
		);

		let targetScaleFactor = 1;
		let targetFocus = { ...DEFAULT_FOCUS };
		let targetProgress = 0;

		if (region && strength > 0) {
			const zoomScale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];

			// Cursor follow: use cursor-follow camera for non-manual zoom regions
			let regionFocus = region.focus;
			if (
				!this.config.zoomClassicMode &&
				region.mode !== "manual" &&
				this.config.cursorTelemetry &&
				this.config.cursorTelemetry.length > 0
			) {
				regionFocus = computeCursorFollowFocus(
					this.cursorFollowCamera,
					this.config.cursorTelemetry,
					timeMs,
					zoomScale,
					strength,
					region.focus,
					{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO },
				);
			}

			targetScaleFactor = zoomScale;
			targetFocus = regionFocus;
			targetProgress = strength;

			if (transition) {
				const startTransform = computeZoomTransform({
					stageSize: this.layoutCache.stageSize,
					baseMask: this.layoutCache.maskRect,
					zoomScale: transition.startScale,
					zoomProgress: 1,
					focusX: transition.startFocus.cx,
					focusY: transition.startFocus.cy,
				});
				const endTransform = computeZoomTransform({
					stageSize: this.layoutCache.stageSize,
					baseMask: this.layoutCache.maskRect,
					zoomScale: transition.endScale,
					zoomProgress: 1,
					focusX: transition.endFocus.cx,
					focusY: transition.endFocus.cy,
				});

				const interpolatedTransform = {
					scale:
						startTransform.scale +
						(endTransform.scale - startTransform.scale) * transition.progress,
					x: startTransform.x + (endTransform.x - startTransform.x) * transition.progress,
					y: startTransform.y + (endTransform.y - startTransform.y) * transition.progress,
				};

				targetScaleFactor = interpolatedTransform.scale;
				targetFocus = computeFocusFromTransform({
					stageSize: this.layoutCache.stageSize,
					baseMask: this.layoutCache.maskRect,
					zoomScale: interpolatedTransform.scale,
					x: interpolatedTransform.x,
					y: interpolatedTransform.y,
				});
				targetProgress = 1;
			}
		}

		const state = this.animationState;
		const previousScale = state.appliedScale;
		const previousX = state.x;
		const previousY = state.y;

		state.scale = targetScaleFactor;
		state.focusX = targetFocus.cx;
		state.focusY = targetFocus.cy;
		state.progress = targetProgress;

		const projectedTransform = computeZoomTransform({
			stageSize: this.layoutCache.stageSize,
			baseMask: this.layoutCache.maskRect,
			zoomScale: state.scale,
			zoomProgress: state.progress,
			focusX: state.focusX,
			focusY: state.focusY,
		});

		// Spring-driven zoom animation for export — use content time, not wall-clock,
		// so the spring advances at the same rate as the video regardless of render speed.
		const deltaMs =
			this.lastContentTimeMs !== null ? timeMs - this.lastContentTimeMs : 1000 / 60;
		this.lastContentTimeMs = timeMs;

		const zoomSpringConfig = getZoomSpringConfig(this.config.zoomSmoothness);

		if (this.config.zoomClassicMode) {
			state.appliedScale = projectedTransform.scale;
			state.x = projectedTransform.x;
			state.y = projectedTransform.y;
			resetSpringState(this.springScale, state.appliedScale);
			resetSpringState(this.springX, state.x);
			resetSpringState(this.springY, state.y);
		} else {
			state.appliedScale = stepSpringValue(
				this.springScale,
				projectedTransform.scale,
				deltaMs,
				zoomSpringConfig,
			);
			state.x = stepSpringValue(
				this.springX,
				projectedTransform.x,
				deltaMs,
				zoomSpringConfig,
			);
			state.y = stepSpringValue(
				this.springY,
				projectedTransform.y,
				deltaMs,
				zoomSpringConfig,
			);
		}

		this.lastMotionVector = {
			x: state.x - previousX,
			y: state.y - previousY,
		};

		return Math.max(
			Math.abs(state.appliedScale - previousScale),
			Math.abs(state.x - previousX) / Math.max(1, this.layoutCache.stageSize.width),
			Math.abs(state.y - previousY) / Math.max(1, this.layoutCache.stageSize.height),
		);
	}

	private closeWebcamDecodedFrame(): void {
		if (!this.webcamDecodedFrame) {
			return;
		}

		this.webcamDecodedFrame.close();
		this.webcamDecodedFrame = null;
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.app) {
			throw new Error("Renderer not initialized");
		}

		if (this.shouldCompositeExtensionFrame() && this.compositeCanvas) {
			return this.compositeCanvas;
		}

		return this.outputCanvasOverride ?? (this.app.canvas as HTMLCanvasElement);
	}

	capturePixelsForNativeExport(): Uint8ClampedArray | null {
		if (!this.app) {
			return null;
		}

		const finalCanvas =
			this.outputCanvasOverride ??
			(this.shouldCompositeExtensionFrame() ? this.compositeCanvas : null);

		if (finalCanvas) {
			const context = finalCanvas.getContext("2d");
			return context
				? context.getImageData(0, 0, finalCanvas.width, finalCanvas.height).data
				: null;
		}

		const result = this.app.renderer.extract.pixels(this.app.stage);
		const pixels = result.pixels;

		return pixels instanceof Uint8ClampedArray ? pixels : new Uint8ClampedArray(pixels);
	}

	getRendererBackend(): ExportRenderBackend {
		return this.rendererBackend;
	}

	destroy(): void {
		const texturesToDestroy = new Set<Texture>();
		if (this.videoSprite?.texture) {
			texturesToDestroy.add(this.videoSprite.texture);
		}
		if (this.backgroundSprite?.texture) {
			texturesToDestroy.add(this.backgroundSprite.texture);
		}
		if (this.webcamSprite?.texture) {
			texturesToDestroy.add(this.webcamSprite.texture);
		}
		if (this.captionSprite?.texture) {
			texturesToDestroy.add(this.captionSprite.texture);
		}
		for (const layer of this.videoShadowLayers) {
			if (layer.sprite?.texture) {
				texturesToDestroy.add(layer.sprite.texture);
			}
		}
		for (const layer of this.webcamShadowLayers) {
			if (layer.sprite?.texture) {
				texturesToDestroy.add(layer.sprite.texture);
			}
		}
		for (const entry of this.annotationSprites) {
			texturesToDestroy.add(entry.texture);
		}

		if (this.cursorOverlay) {
			this.cursorOverlay.destroy();
			this.cursorOverlay = null;
		}

		if (this.videoEffectsContainer) {
			this.videoEffectsContainer.filters = null;
		}
		if (this.backgroundSprite) {
			this.backgroundSprite.filters = null;
		}
		this.zoomBlurFilter?.destroy();
		this.motionBlurFilter?.destroy();
		this.backgroundBlurFilter?.destroy();

		this.app?.destroy(true, {
			children: true,
			texture: false,
			textureSource: false,
		});

		for (const texture of texturesToDestroy) {
			try {
				texture.destroy(true);
			} catch (error) {
				console.warn("[FrameRenderer] Failed to destroy texture during cleanup:", error);
			}
		}

		this.app = null;
		this.backgroundContainer = null;
		this.cameraContainer = null;
		this.videoEffectsContainer = null;
		this.videoContainer = null;
		this.cursorContainer = null;
		this.overlayContainer = null;
		this.annotationContainer = null;
		this.captionContainer = null;
		this.webcamRootContainer = null;
		this.webcamContainer = null;
		this.videoSprite = null;
		this.videoTextureSource = null;
		this.backgroundSprite = null;
		this.backgroundTextureSource = null;
		this.videoMaskGraphics = null;
		this.webcamMaskGraphics = null;
		this.zoomBlurFilter = null;
		this.motionBlurFilter = null;
		this.backgroundBlurFilter = null;
		this.annotationAssets = null;
		this.annotationSprites = [];
		this.videoShadowLayers = [];
		this.webcamShadowLayers = [];
		this.webcamSprite = null;
		this.webcamTextureSource = null;

		this.closeBackgroundDecodedFrame();
		this.backgroundForwardFrameSource?.cancel();
		void this.backgroundForwardFrameSource?.destroy();
		this.backgroundForwardFrameSource = null;
		this.backgroundForwardFrameSourceUrl = null;
		this.backgroundForwardFrameDurationSec = null;
		this.lastSyncedBackgroundLoopTimeSec = null;
		if (this.backgroundVideoElement) {
			this.backgroundVideoElement.pause();
			this.backgroundVideoElement.src = "";
			this.backgroundVideoElement.load();
			this.backgroundVideoElement = null;
		}

		this.webcamForwardFrameSource?.cancel();
		void this.webcamForwardFrameSource?.destroy();
		this.webcamForwardFrameSource = null;
		this.closeWebcamDecodedFrame();
		if (this.webcamVideoElement) {
			this.webcamVideoElement.pause();
			this.webcamVideoElement.src = "";
			this.webcamVideoElement.load();
			this.webcamVideoElement = null;
		}
		this.cleanupWebcamSource?.();
		this.cleanupWebcamSource = null;
		this.webcamFrameCacheCanvas = null;
		this.webcamFrameCacheCtx = null;
		this.sceneVideoFrameStagingCanvas = null;
		this.sceneVideoFrameStagingCtx = null;
		this.webcamVideoFrameStagingCanvas = null;
		this.webcamVideoFrameStagingCtx = null;
		this.videoTextureUsesStartupStaging = false;
		this.webcamTextureUsesStartupStaging = false;

		this.captionCanvas = null;
		this.captionCtx = null;
		this.captionMeasureCanvas = null;
		this.captionMeasureCtx = null;
		this.captionSprite = null;
		this.captionTextureSource = null;
		this.captionRenderKey = null;
		this.exportCompositeCanvas = null;
		this.temporalCompositeCanvas = null;
		this.outputCanvasOverride = null;

		this.annotationScaleFactor = 1;
		this.lastSyncedWebcamTime = null;
		this.lastWebcamCacheRefreshTime = null;
		this.webcamRenderMode = "hidden";
		this.webcamLayoutCache = null;
		this.layoutCache = null;
	}
}
