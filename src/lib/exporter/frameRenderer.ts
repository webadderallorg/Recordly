import { Application, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";
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
import {
	BASE_PREVIEW_HEIGHT,
	BASE_PREVIEW_WIDTH,
	ZOOM_DEPTH_SCALES,
} from "@/components/video-editor/types";
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
import { renderAnnotations } from "./annotationRenderer";
import { renderCaptions } from "./captionRenderer";
import { ForwardFrameSource } from "./forwardFrameSource";
import { resolveMediaElementSource } from "./localMediaSource";
import {
	buildTemporalSamplePlanUs,
	getTemporalMotionBlurConfig,
} from "./temporalMotionBlur";

interface FrameRenderConfig {
	width: number;
	height: number;
	preferredRenderBackend?: "webgl" | "webgpu";
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
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	frame?: string | null;
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

interface VideoTextureSource {
	resource: VideoFrame | CanvasImageSource;
	update: () => void;
}

type PixiTextureInput = Parameters<typeof Texture.from>[0];

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

interface RenderSnapshot {
	timeMs: number;
	cursorTimeMs: number;
	smoothedCursor: ReturnType<typeof mapSmoothedCursorToCanvasNormalized>;
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

// Renders video frames with all effects (background, zoom, crop, blur, shadow) to an offscreen canvas for export.

export class FrameRenderer {
	private app: Application | null = null;
	private cameraContainer: Container | null = null;
	private videoContainer: Container | null = null;
	private cursorContainer: Container | null = null;
	private videoSprite: Sprite | null = null;
	private videoTextureSource: VideoTextureSource | null = null;
	private backgroundSprite: HTMLCanvasElement | null = null;
	private maskGraphics: Graphics | null = null;
	private zoomBlurFilter: ZoomBlurFilter | null = null;
	private motionBlurFilter: MotionBlurFilter | null = null;
	private shadowCanvas: HTMLCanvasElement | null = null;
	private shadowCtx: CanvasRenderingContext2D | null = null;
	private compositeCanvas: HTMLCanvasElement | null = null;
	private compositeCtx: CanvasRenderingContext2D | null = null;
	private temporalAccumulationCanvas: HTMLCanvasElement | null = null;
	private temporalAccumulationCtx: CanvasRenderingContext2D | null = null;
	private backgroundForwardFrameSource: ForwardFrameSource | null = null;
	private backgroundForwardFrameSourceUrl: string | null = null;
	private backgroundForwardFrameDurationSec: number | null = null;
	private backgroundDecodedFrame: VideoFrame | null = null;
	private backgroundVideoElement: HTMLVideoElement | null = null;
	private backgroundCtx: CanvasRenderingContext2D | null = null;
	private backgroundSeekPromise: Promise<void> | null = null;
	private lastSyncedBackgroundLoopTimeSec: number | null = null;
	private cleanupBackgroundSource: (() => void) | null = null;
	private config: FrameRenderConfig;
	private animationState: AnimationState;
	private motionBlurState: MotionBlurState;
	private layoutCache: LayoutCache | null = null;
	private currentVideoTime = 0;
	private lastMotionVector = { x: 0, y: 0 };
	private springScale: SpringState;
	private springX: SpringState;
	private springY: SpringState;
	private cursorFollowCamera: CursorFollowCameraState;
	private lastContentTimeMs: number | null = null;
	private cursorOverlay: PixiCursorOverlay | null = null;
	private webcamForwardFrameSource: ForwardFrameSource | null = null;
	private webcamDecodedFrame: VideoFrame | null = null;
	private webcamVideoElement: HTMLVideoElement | null = null;
	private webcamSeekPromise: Promise<void> | null = null;
	private webcamFrameCacheCanvas: HTMLCanvasElement | null = null;
	private webcamFrameCacheCtx: CanvasRenderingContext2D | null = null;
	private webcamBubbleCanvas: HTMLCanvasElement | null = null;
	private webcamBubbleCtx: CanvasRenderingContext2D | null = null;
	private lastSyncedWebcamTime: number | null = null;
	private cleanupWebcamSource: (() => void) | null = null;
	private frameImage: HTMLImageElement | null = null;
	private frameInsets: { top: number; right: number; bottom: number; left: number } | null = null;
	private frameDraw: ((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null =
		null;

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

		// Create canvas for rendering
		const canvas = document.createElement("canvas");
		canvas.width = this.config.width;
		canvas.height = this.config.height;

		// Try to set colorSpace if supported (may not be available on all platforms)
		try {
			if (canvas && "colorSpace" in canvas) {
				canvas.colorSpace = "srgb";
			}
		} catch (error) {
			// Silently ignore colorSpace errors on platforms that don't support it
			console.warn("[FrameRenderer] colorSpace not supported on this platform:", error);
		}

		// Initialize PixiJS with optimized settings for export performance
		this.app = new Application();
		await this.app.init({
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
			powerPreference: "high-performance",
			...(this.config.preferredRenderBackend
				? { preference: this.config.preferredRenderBackend }
				: {}),
		});

		// Setup containers
		this.cameraContainer = new Container();
		this.videoContainer = new Container();
		this.cursorContainer = new Container();
		this.app.stage.addChild(this.cameraContainer);
		this.cameraContainer.addChild(this.videoContainer);
		this.cameraContainer.addChild(this.cursorContainer);

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
		}

		// Setup background (render separately, not in PixiJS)
		await this.setupBackground();
		await this.setupWebcamSource();
		await this.setupFrame();

		if ((this.config.zoomMotionBlur ?? 0) > 0) {
			this.zoomBlurFilter = new ZoomBlurFilter({ strength: 0 });
			this.motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
			this.videoContainer.filterArea = new Rectangle(
				0,
				0,
				this.config.width,
				this.config.height,
			);
			this.videoContainer.filters = [this.zoomBlurFilter, this.motionBlurFilter];
		} else {
			this.videoContainer.filters = null;
		}

		// Setup composite canvas for final output with shadows
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

		this.temporalAccumulationCanvas = document.createElement("canvas");
		this.temporalAccumulationCanvas.width = this.config.width;
		this.temporalAccumulationCanvas.height = this.config.height;
		this.temporalAccumulationCtx = configureHighQuality2DContext(
			this.temporalAccumulationCanvas.getContext("2d", {
				willReadFrequently: true,
			}),
		);

		if (!this.temporalAccumulationCtx) {
			throw new Error("Failed to get 2D context for temporal accumulation canvas");
		}

		// Setup shadow canvas if needed
		if (this.config.showShadow) {
			this.shadowCanvas = document.createElement("canvas");
			this.shadowCanvas.width = this.config.width;
			this.shadowCanvas.height = this.config.height;
			this.shadowCtx = configureHighQuality2DContext(
				this.shadowCanvas.getContext("2d", {
					willReadFrequently: false,
				}),
			);

			if (!this.shadowCtx) {
				throw new Error("Failed to get 2D context for shadow canvas");
			}
		}

		// Setup mask
		this.maskGraphics = new Graphics();
		this.videoContainer.addChild(this.maskGraphics);
		this.videoContainer.mask = this.maskGraphics;
		if (this.cursorOverlay) {
			this.cursorContainer.addChild(this.cursorOverlay.container);
		}
	}

	private async setupBackground(): Promise<void> {
		const wallpaper = await this.resolveWallpaperForExport(this.config.wallpaper);

		// Create background canvas for separate rendering (not affected by zoom)
		const bgCanvas = document.createElement("canvas");
		bgCanvas.width = this.config.width;
		bgCanvas.height = this.config.height;
		const bgCtx = configureHighQuality2DContext(bgCanvas.getContext("2d"));

		if (!bgCtx) {
			throw new Error("Failed to get 2D context for background canvas");
		}

		this.backgroundCtx = bgCtx;
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
		this.backgroundSeekPromise = null;

		try {
			// Check for video wallpaper first
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
					this.backgroundSprite = bgCanvas;
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
				this.drawVideoFrameToBackground();
				this.backgroundSprite = bgCanvas;
				return;
			}

			// Render background based on type
			if (
				wallpaper.startsWith("file://") ||
				wallpaper.startsWith("data:") ||
				wallpaper.startsWith("/") ||
				wallpaper.startsWith("http")
			) {
				// Image background
				const img = new Image();
				const imageUrl = await this.resolveWallpaperImageUrl(wallpaper);
				// Don't set crossOrigin for same-origin images to avoid CORS taint.
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

				// Draw the image using cover and center positioning
				const imgAspect = img.width / img.height;
				const canvasAspect = this.config.width / this.config.height;

				let drawWidth, drawHeight, drawX, drawY;

				if (imgAspect > canvasAspect) {
					drawHeight = this.config.height;
					drawWidth = drawHeight * imgAspect;
					drawX = (this.config.width - drawWidth) / 2;
					drawY = 0;
				} else {
					drawWidth = this.config.width;
					drawHeight = drawWidth / imgAspect;
					drawX = 0;
					drawY = (this.config.height - drawHeight) / 2;
				}

				bgCtx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
			} else if (wallpaper.startsWith("#")) {
				bgCtx.fillStyle = wallpaper;
				bgCtx.fillRect(0, 0, this.config.width, this.config.height);
			} else if (
				wallpaper.startsWith("linear-gradient") ||
				wallpaper.startsWith("radial-gradient")
			) {
				const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
				if (gradientMatch) {
					const [, type, params] = gradientMatch;
					const parts = params.split(",").map((s) => s.trim());

					let gradient: CanvasGradient;

					if (type === "linear") {
						gradient = bgCtx.createLinearGradient(0, 0, 0, this.config.height);
						parts.forEach((part, index) => {
							if (part.startsWith("to ") || part.includes("deg")) return;

							const colorMatch = part.match(
								/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/,
							);
							if (colorMatch) {
								const color = colorMatch[1];
								const position = index / (parts.length - 1);
								gradient.addColorStop(position, color);
							}
						});
					} else {
						const cx = this.config.width / 2;
						const cy = this.config.height / 2;
						const radius = Math.max(this.config.width, this.config.height) / 2;
						gradient = bgCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);

						parts.forEach((part, index) => {
							const colorMatch = part.match(
								/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+)/,
							);
							if (colorMatch) {
								const color = colorMatch[1];
								const position = index / (parts.length - 1);
								gradient.addColorStop(position, color);
							}
						});
					}

					bgCtx.fillStyle = gradient;
					bgCtx.fillRect(0, 0, this.config.width, this.config.height);
				} else {
					console.warn("[FrameRenderer] Could not parse gradient, using black fallback");
					bgCtx.fillStyle = "#000000";
					bgCtx.fillRect(0, 0, this.config.width, this.config.height);
				}
			} else {
				bgCtx.fillStyle = wallpaper;
				bgCtx.fillRect(0, 0, this.config.width, this.config.height);
			}
		} catch (error) {
			console.error("[FrameRenderer] Error setting up background, using fallback:", error);
			bgCtx.fillStyle = "#000000";
			bgCtx.fillRect(0, 0, this.config.width, this.config.height);
		}

		// Store the background canvas for compositing
		this.backgroundSprite = bgCanvas;
	}

	private drawVideoFrameToBackground(): void {
		const video = this.backgroundVideoElement;
		if (!video) return;

		this.drawBackgroundSourceToCanvas(video, video.videoWidth, video.videoHeight);
	}

	private drawBackgroundSourceToCanvas(
		source: CanvasImageSource,
		sourceWidth: number,
		sourceHeight: number,
	): void {
		const ctx = this.backgroundCtx;
		if (!ctx) return;

		const w = this.config.width;
		const h = this.config.height;
		const safeSourceWidth = Math.max(1, sourceWidth);
		const safeSourceHeight = Math.max(1, sourceHeight);
		const videoAspect = safeSourceWidth / safeSourceHeight;
		const canvasAspect = w / h;

		let drawWidth: number, drawHeight: number, drawX: number, drawY: number;
		if (videoAspect > canvasAspect) {
			drawHeight = h;
			drawWidth = drawHeight * videoAspect;
			drawX = (w - drawWidth) / 2;
			drawY = 0;
		} else {
			drawWidth = w;
			drawHeight = drawWidth / videoAspect;
			drawX = 0;
			drawY = (h - drawHeight) / 2;
		}

		ctx.clearRect(0, 0, w, h);
		ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
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
						this.drawBackgroundSourceToCanvas(
							restartedFrame,
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
				this.drawBackgroundSourceToCanvas(
					decodedFrame,
					decodedFrame.displayWidth,
					decodedFrame.displayHeight,
				);
			}
			return;
		}

		await this.syncBackgroundVideo(timeSeconds);
	}

	private async syncBackgroundVideo(timeSeconds: number): Promise<void> {
		const video = this.backgroundVideoElement;
		if (!video) return;

		if (video.duration && Number.isFinite(video.duration)) {
			const targetTime = timeSeconds % video.duration;
			if (Math.abs(video.currentTime - targetTime) > 0.01) {
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
		this.drawVideoFrameToBackground();
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
			return;
		}

		this.webcamForwardFrameSource?.cancel();
		void this.webcamForwardFrameSource?.destroy();
		this.webcamForwardFrameSource = null;
		this.closeWebcamDecodedFrame();
		this.cleanupWebcamSource?.();
		this.cleanupWebcamSource = null;

		try {
			const frameSource = new ForwardFrameSource();
			await frameSource.initialize(webcamUrl);
			this.webcamForwardFrameSource = frameSource;
			this.webcamVideoElement = null;
			this.webcamSeekPromise = null;
			this.webcamFrameCacheCanvas = null;
			this.webcamFrameCacheCtx = null;
			this.lastSyncedWebcamTime = null;
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
		this.webcamFrameCacheCanvas = null;
		this.webcamFrameCacheCtx = null;
		this.lastSyncedWebcamTime = null;
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
					return;
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

			webcamVideo.addEventListener("seeked", waitForPresentedFrame, {
				once: true,
			});
			webcamVideo.addEventListener("loadeddata", handleMediaReady, {
				once: true,
			});
			webcamVideo.addEventListener("canplay", handleMediaReady, {
				once: true,
			});
			webcamVideo.addEventListener("error", finish, {
				once: true,
			});
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

	private async setupFrame(): Promise<void> {
		const frameId = this.config.frame;
		if (!frameId) return;

		const { extensionHost } = await import("@/lib/extensions/extensionHost");
		const frames = extensionHost.getFrames();
		const frame = frames.find((f) => f.id === frameId);
		if (!frame) {
			console.warn(`[FrameRenderer] Device frame "${frameId}" not found`);
			return;
		}

		this.frameInsets = frame.screenInsets;

		if (frame.draw) {
			// Prefer draw function — renders at export resolution, no bitmap scaling
			this.frameDraw = frame.draw;
			return;
		}

		const img = new Image();
		img.crossOrigin = "anonymous";
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error(`Failed to load device frame image: ${frameId}`));
			img.src = frame.filePath;
		});

		this.frameImage = img;
	}

	async renderFrame(
		videoFrame: VideoFrame,
		timestamp: number,
		cursorTimestamp = timestamp,
		frameDurationUs?: number,
		backgroundTimelineTimestamp = timestamp,
	): Promise<void> {
		if (!this.app || !this.videoContainer || !this.cameraContainer) {
			throw new Error("Renderer not initialized");
		}

		this.currentVideoTime = timestamp / 1000000;

		// Create or update video sprite from VideoFrame
		if (!this.videoSprite) {
			const texture = Texture.from(videoFrame as unknown as PixiTextureInput);
			this.videoSprite = new Sprite(texture);
			this.videoTextureSource = texture.source as unknown as VideoTextureSource;
			this.videoContainer.addChild(this.videoSprite);
			if (this.cursorOverlay && this.cursorContainer) {
				this.cursorContainer.addChild(this.cursorOverlay.container);
			}
			if (this.maskGraphics) {
				this.videoContainer.addChild(this.maskGraphics);
			}
		} else {
			this.videoTextureSource ??= this.videoSprite.texture
				.source as unknown as VideoTextureSource;
			this.videoTextureSource.resource = videoFrame;
			this.videoTextureSource.update();
		}

		// Apply layout
		this.updateLayout();
		const layoutCache = this.layoutCache;
		if (!layoutCache) {
			return;
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
			extensionHost.setSmoothedCursor(
				temporalSnapshot.smoothedCursor
					? {
							timeMs: temporalSnapshot.timeMs,
							cx: temporalSnapshot.smoothedCursor.cx,
							cy: temporalSnapshot.smoothedCursor.cy,
							trail: temporalSnapshot.smoothedCursor.trail,
						}
					: null,
			);

			this.drawFrame();

			if (
				this.config.annotationRegions &&
				this.config.annotationRegions.length > 0 &&
				this.compositeCtx
			) {
				const scaleX = this.config.width / BASE_PREVIEW_WIDTH;
				const scaleY = this.config.height / BASE_PREVIEW_HEIGHT;
				const scaleFactor = (scaleX + scaleY) / 2;

				await renderAnnotations(
					this.compositeCtx,
					this.config.annotationRegions,
					this.config.width,
					this.config.height,
					temporalSnapshot.timeMs,
					scaleFactor,
				);
			}

			if (
				this.config.autoCaptions &&
				this.config.autoCaptions.length > 0 &&
				this.config.autoCaptionSettings &&
				this.compositeCtx
			) {
				renderCaptions(
					this.compositeCtx,
					this.config.autoCaptions,
					this.config.autoCaptionSettings,
					this.config.width,
					this.config.height,
					temporalSnapshot.timeMs,
				);
			}

			if (this.compositeCtx) {
				const maskRect = this.layoutCache?.maskRect;
				const hookParams = {
					width: this.config.width,
					height: this.config.height,
					timeMs: temporalSnapshot.timeMs,
					durationMs: 0,
					cursor: temporalSnapshot.smoothedCursor
						? {
								cx: temporalSnapshot.smoothedCursor.cx,
								cy: temporalSnapshot.smoothedCursor.cy,
								interactionType: this.getCursorPosition(
									temporalSnapshot.cursorTimeMs,
								)?.interactionType,
							}
						: this.getCursorPosition(temporalSnapshot.cursorTimeMs),
					smoothedCursor: temporalSnapshot.smoothedCursor,
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
					zoom: temporalSnapshot.zoom,
					shadow: {
						enabled: this.config.showShadow,
						intensity: this.config.shadowIntensity,
					},
					sceneTransform: temporalSnapshot.sceneTransform,
				};

				this.compositeCtx.save();
				applyCanvasSceneTransform(this.compositeCtx, temporalSnapshot.sceneTransform);
				executeExtensionRenderHooks("post-video", this.compositeCtx, hookParams);
				executeExtensionRenderHooks("post-zoom", this.compositeCtx, hookParams);
				executeExtensionRenderHooks("post-cursor", this.compositeCtx, hookParams);
				this.emitCursorInteractions(temporalSnapshot.cursorTimeMs);
				executeExtensionCursorEffects(
					this.compositeCtx,
					temporalSnapshot.timeMs,
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

			return;
		}

		if (this.webcamForwardFrameSource || this.webcamVideoElement) {
			const targetTime = Math.max(0, this.currentVideoTime);
			await this.syncWebcamFrame(targetTime);
		}

		// Sync video wallpaper frame
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

		const smoothedCursor = mapSmoothedCursorToCanvasNormalized(
			this.cursorOverlay?.getSmoothedCursorSnapshot() ?? null,
			{
				maskRect: layoutCache.maskRect,
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

		const TICKS_PER_FRAME = 1;

		let maxMotionIntensity = 0;
		for (let i = 0; i < TICKS_PER_FRAME; i++) {
			const motionIntensity = this.updateAnimationState(timeMs);
			maxMotionIntensity = Math.max(maxMotionIntensity, motionIntensity);
		}

		// Apply transform once with maximum motion intensity from all ticks
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

		// Render the PixiJS stage to its canvas (video only, transparent background)
		this.app.renderer.render(this.app.stage);

		// Composite with shadows to final output canvas
		this.compositeWithShadows();

		// Draw device frame overlay on top of video content
		this.drawFrame();

		// Render annotations on top if present
		if (
			this.config.annotationRegions &&
			this.config.annotationRegions.length > 0 &&
			this.compositeCtx
		) {
			// Calculate scale factor based on export vs preview dimensions
			const scaleX = this.config.width / BASE_PREVIEW_WIDTH;
			const scaleY = this.config.height / BASE_PREVIEW_HEIGHT;
			const scaleFactor = (scaleX + scaleY) / 2;

			await renderAnnotations(
				this.compositeCtx,
				this.config.annotationRegions,
				this.config.width,
				this.config.height,
				timeMs,
				scaleFactor,
			);
		}

		if (
			this.config.autoCaptions &&
			this.config.autoCaptions.length > 0 &&
			this.config.autoCaptionSettings &&
			this.compositeCtx
		) {
			renderCaptions(
				this.compositeCtx,
				this.config.autoCaptions,
				this.config.autoCaptionSettings,
				this.config.width,
				this.config.height,
				timeMs,
			);
		}

		// Extension render hooks — run after all built-in rendering
		if (this.compositeCtx) {
			const maskRect = this.layoutCache?.maskRect;
			const hookParams = {
				width: this.config.width,
				height: this.config.height,
				timeMs,
				durationMs: 0,
				cursor: smoothedCursor
					? {
							cx: smoothedCursor.cx,
							cy: smoothedCursor.cy,
							interactionType: this.getCursorPosition(cursorTimeMs)?.interactionType,
						}
					: this.getCursorPosition(cursorTimeMs),
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

			// Cursor click effects
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
	}

	/**
	 * Get the cursor position (normalized 0-1) at the given time.
	 */
	private getCursorPosition(
		timeMs: number,
	): { cx: number; cy: number; interactionType?: string } | null {
		const telemetry = this.config.cursorTelemetry;
		if (!telemetry || telemetry.length === 0) return null;

		// Find the closest telemetry point
		let closest = telemetry[0];
		let minDist = Math.abs(telemetry[0].timeMs - timeMs);
		for (let i = 1; i < telemetry.length; i++) {
			const dist = Math.abs(telemetry[i].timeMs - timeMs);
			if (dist < minDist) {
				minDist = dist;
				closest = telemetry[i];
			}
			if (telemetry[i].timeMs > timeMs) break;
		}

		return mapCursorToCanvasNormalized(
			{ cx: closest.cx, cy: closest.cy, interactionType: closest.interactionType },
			{
				maskRect: this.layoutCache?.maskRect,
				canvasWidth: this.config.width,
				canvasHeight: this.config.height,
			},
		);
	}

	/**
	 * Emit cursor interaction events for extensions based on telemetry clicks.
	 */
	private lastEmittedClickTimeMs = -1;

	private emitCursorInteractions(timeMs: number): void {
		const telemetry = this.config.cursorTelemetry;
		if (!telemetry || telemetry.length === 0) return;

		// Find click events near this time
		for (const point of telemetry) {
			if (point.timeMs > timeMs) break;
			if (point.timeMs < timeMs - 100) continue;
			if (!point.interactionType || point.interactionType === "move") continue;
			if (point.timeMs === this.lastEmittedClickTimeMs) continue;

			const mappedCursor = mapCursorToCanvasNormalized(
				{ cx: point.cx, cy: point.cy, interactionType: point.interactionType },
				{
					maskRect: this.layoutCache?.maskRect,
					canvasWidth: this.config.width,
					canvasHeight: this.config.height,
				},
			);
			if (!mappedCursor) continue;

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
		if (!this.app || !this.videoSprite || !this.maskGraphics || !this.videoContainer) return;

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
			frameInsets: this.frameInsets,
			cropRegion,
			videoWidth,
			videoHeight,
		});

		this.videoSprite.scale.set(layout.scale);
		this.videoSprite.position.set(layout.spriteX, layout.spriteY);

		this.videoContainer.position.set(0, 0);

		const canvasScaleFactor = Math.min(
			width / BASE_PREVIEW_WIDTH,
			height / BASE_PREVIEW_HEIGHT,
		);

		const scaledBorderRadius = borderRadius * canvasScaleFactor;

		this.maskGraphics.clear();
		drawSquircleOnGraphics(this.maskGraphics, {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			radius: scaledBorderRadius,
		});
		this.maskGraphics.fill({ color: 0xffffff });

		// Cache layout info
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

	private updateAnimationState(timeMs: number): number {
		if (!this.cameraContainer || !this.layoutCache) return 0;

		const { region, strength, blendedScale, transition } = findDominantRegion(
			this.config.zoomRegions,
			timeMs,
			{
				connectZooms: this.config.connectZooms,
				zoomInDurationMs: this.config.zoomInDurationMs,
				zoomOutDurationMs: this.config.zoomOutDurationMs,
			},
		);

		const defaultFocus = DEFAULT_FOCUS;
		let targetScaleFactor = 1;
		let targetFocus = { ...defaultFocus };
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

		const prevScale = state.appliedScale;
		const prevX = state.x;
		const prevY = state.y;

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
			x: state.x - prevX,
			y: state.y - prevY,
		};

		return Math.max(
			Math.abs(state.appliedScale - prevScale),
			Math.abs(state.x - prevX) / Math.max(1, this.layoutCache.stageSize.width),
			Math.abs(state.y - prevY) / Math.max(1, this.layoutCache.stageSize.height),
		);
	}

	private async renderSceneSample(
		timestamp: number,
		cursorTimestamp: number,
		backgroundTimelineTimestamp: number,
		layoutCache: LayoutCache,
		useVelocityMotionBlur: boolean,
	): Promise<RenderSnapshot> {
		if (!this.app || !this.cameraContainer) {
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

		const smoothedCursor = mapSmoothedCursorToCanvasNormalized(
			this.cursorOverlay?.getSmoothedCursorSnapshot() ?? null,
			{
				maskRect: layoutCache.maskRect,
				canvasWidth: this.config.width,
				canvasHeight: this.config.height,
			},
		);

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

		this.app.renderer.render(this.app.stage);
		this.compositeWithShadows();

		return {
			timeMs,
			cursorTimeMs,
			smoothedCursor,
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
		if (
			!this.compositeCanvas ||
			!this.compositeCtx ||
			!this.temporalAccumulationCtx
		) {
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

		const samplePlan = buildTemporalSamplePlanUs(frameDurationUs, blurConfig);

		this.temporalAccumulationCtx.clearRect(0, 0, this.config.width, this.config.height);

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
			);
			lastSnapshot = snapshot;
			if (Math.abs(sampleOffsetUs) < 0.0001) {
				centerSnapshot = snapshot;
			}

			this.temporalAccumulationCtx.save();
			this.temporalAccumulationCtx.globalCompositeOperation = "lighter";
			this.temporalAccumulationCtx.globalAlpha = weight;
			this.temporalAccumulationCtx.drawImage(this.compositeCanvas, 0, 0);
			this.temporalAccumulationCtx.restore();
		}
		this.compositeCtx.clearRect(0, 0, this.config.width, this.config.height);
		this.compositeCtx.drawImage(this.temporalAccumulationCanvas!, 0, 0);

		return centerSnapshot ?? lastSnapshot;
	}

	private compositeWithShadows(): void {
		if (!this.compositeCanvas || !this.compositeCtx || !this.app) return;

		const videoCanvas = this.app.canvas as HTMLCanvasElement;
		const ctx = this.compositeCtx;
		const w = this.compositeCanvas.width;
		const h = this.compositeCanvas.height;

		// Clear composite canvas
		ctx.clearRect(0, 0, w, h);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = "high";

		// Step 1: Draw background layer (with optional blur, not affected by zoom)
		if (this.backgroundSprite) {
			const bgCanvas = this.backgroundSprite;

			if (this.config.backgroundBlur > 0) {
				ctx.save();
				ctx.filter = `blur(${this.config.backgroundBlur * 3}px)`;
				ctx.drawImage(bgCanvas, 0, 0, w, h);
				ctx.restore();
			} else {
				ctx.drawImage(bgCanvas, 0, 0, w, h);
			}
		} else {
			console.warn("[FrameRenderer] No background sprite found during compositing!");
		}

		// Draw video layer with shadows on top of background
		if (
			this.config.showShadow &&
			this.config.shadowIntensity > 0 &&
			this.shadowCanvas &&
			this.shadowCtx
		) {
			const shadowCtx = this.shadowCtx;
			shadowCtx.clearRect(0, 0, w, h);
			shadowCtx.imageSmoothingEnabled = true;
			shadowCtx.imageSmoothingQuality = "high";
			shadowCtx.save();

			// Calculate shadow parameters based on intensity (0-1)
			const intensity = this.config.shadowIntensity;
			const baseBlur1 = 48 * intensity;
			const baseBlur2 = 16 * intensity;
			const baseBlur3 = 8 * intensity;
			const baseAlpha1 = 0.7 * intensity;
			const baseAlpha2 = 0.5 * intensity;
			const baseAlpha3 = 0.3 * intensity;
			const baseOffset = 12 * intensity;

			shadowCtx.filter = `drop-shadow(0 ${baseOffset}px ${baseBlur1}px rgba(0,0,0,${baseAlpha1})) drop-shadow(0 ${baseOffset / 3}px ${baseBlur2}px rgba(0,0,0,${baseAlpha2})) drop-shadow(0 ${baseOffset / 6}px ${baseBlur3}px rgba(0,0,0,${baseAlpha3}))`;
			shadowCtx.drawImage(videoCanvas, 0, 0, w, h);
			shadowCtx.restore();
			ctx.drawImage(this.shadowCanvas, 0, 0, w, h);
		} else {
			ctx.drawImage(videoCanvas, 0, 0, w, h);
		}

		this.drawWebcamOverlay(ctx, w, h);
	}

	private drawFrame(): void {
		if ((!this.frameImage && !this.frameDraw) || !this.compositeCtx || !this.layoutCache)
			return;

		const ctx = this.compositeCtx;
		const maskRect = this.layoutCache.maskRect;
		const insets = this.frameInsets;

		if (!insets) {
			// No insets: draw frame spanning entire mask area
			if (this.frameDraw) {
				const c = document.createElement("canvas");
				c.width = Math.round(maskRect.width);
				c.height = Math.round(maskRect.height);
				const dCtx = c.getContext("2d");
				if (dCtx) this.frameDraw(dCtx, c.width, c.height);
				ctx.drawImage(c, maskRect.x, maskRect.y, maskRect.width, maskRect.height);
			} else {
				ctx.drawImage(
					this.frameImage!,
					maskRect.x,
					maskRect.y,
					maskRect.width,
					maskRect.height,
				);
			}
			return;
		}

		// Calculate frame dimensions from insets
		const screenW = maskRect.width;
		const screenH = maskRect.height;
		const frameW = screenW / (1 - insets.left - insets.right);
		const frameH = screenH / (1 - insets.top - insets.bottom);
		const frameX = maskRect.x - insets.left * frameW;
		const frameY = maskRect.y - insets.top * frameH;

		if (this.frameDraw) {
			// Draw at the exact export resolution — no bitmap scaling
			const c = document.createElement("canvas");
			c.width = Math.round(frameW);
			c.height = Math.round(frameH);
			const dCtx = c.getContext("2d");
			if (dCtx) this.frameDraw(dCtx, c.width, c.height);
			ctx.drawImage(c, frameX, frameY, frameW, frameH);
		} else {
			ctx.drawImage(this.frameImage!, frameX, frameY, frameW, frameH);
		}
	}

	private drawWebcamOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
		const webcam = this.config.webcam;
		const webcamDecodedFrame = this.webcamDecodedFrame;
		const webcamVideo = this.webcamVideoElement;
		if (!webcam?.enabled || (!webcamDecodedFrame && !webcamVideo)) {
			return;
		}

		const hasCachedWebcamFrame = Boolean(
			this.webcamFrameCacheCanvas &&
				this.webcamFrameCacheCanvas.width > 0 &&
				this.webcamFrameCacheCanvas.height > 0,
		);
		const hasLiveWebcamFrame = webcamDecodedFrame
			? webcamDecodedFrame.displayWidth > 0 && webcamDecodedFrame.displayHeight > 0
			: Boolean(
					webcamVideo &&
						webcamVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
						webcamVideo.videoWidth > 0 &&
						webcamVideo.videoHeight > 0,
				);
		if (!hasLiveWebcamFrame && !hasCachedWebcamFrame) {
			return;
		}

		const margin = webcam.margin ?? 24;
		const size = getWebcamOverlaySizePx({
			containerWidth: width,
			containerHeight: height,
			sizePercent: webcam.size ?? 50,
			margin,
			zoomScale: this.animationState.appliedScale || 1,
			reactToZoom: webcam.reactToZoom ?? true,
		});
		const { x, y } = getWebcamOverlayPosition({
			containerWidth: width,
			containerHeight: height,
			size,
			margin,
			positionPreset: webcam.positionPreset ?? webcam.corner,
			positionX: webcam.positionX ?? 1,
			positionY: webcam.positionY ?? 1,
			legacyCorner: webcam.corner,
		});
		const radius = Math.max(0, webcam.cornerRadius ?? 18);

		const bubbleCanvas = this.webcamBubbleCanvas ?? document.createElement("canvas");
		const bubbleSize = Math.max(1, Math.ceil(size));
		if (bubbleCanvas.width !== bubbleSize || bubbleCanvas.height !== bubbleSize) {
			bubbleCanvas.width = bubbleSize;
			bubbleCanvas.height = bubbleSize;
		}
		this.webcamBubbleCanvas = bubbleCanvas;
		const bubbleCtx =
			this.webcamBubbleCtx ?? configureHighQuality2DContext(bubbleCanvas.getContext("2d"));
		if (!bubbleCtx) {
			return;
		}
		this.webcamBubbleCtx = bubbleCtx;
		bubbleCtx.clearRect(0, 0, bubbleCanvas.width, bubbleCanvas.height);
		bubbleCtx.imageSmoothingEnabled = true;
		bubbleCtx.imageSmoothingQuality = "high";

		const canRefreshCache =
			hasLiveWebcamFrame &&
			this.lastSyncedWebcamTime !== null &&
			Math.abs(this.lastSyncedWebcamTime - this.currentVideoTime) <= 0.02 &&
			(webcamDecodedFrame
				? true
				: Boolean(
						webcamVideo &&
							!webcamVideo.seeking &&
							Math.abs(webcamVideo.currentTime - this.currentVideoTime) <= 0.02 &&
							webcamVideo.videoWidth > 0 &&
							webcamVideo.videoHeight > 0,
					));

		if (canRefreshCache) {
			const liveFrameWidth = webcamDecodedFrame?.displayWidth ?? webcamVideo?.videoWidth ?? 0;
			const liveFrameHeight =
				webcamDecodedFrame?.displayHeight ?? webcamVideo?.videoHeight ?? 0;
			if (
				!this.webcamFrameCacheCanvas ||
				this.webcamFrameCacheCanvas.width !== liveFrameWidth ||
				this.webcamFrameCacheCanvas.height !== liveFrameHeight
			) {
				this.webcamFrameCacheCanvas = document.createElement("canvas");
				this.webcamFrameCacheCanvas.width = liveFrameWidth;
				this.webcamFrameCacheCanvas.height = liveFrameHeight;
				this.webcamFrameCacheCtx = configureHighQuality2DContext(
					this.webcamFrameCacheCanvas.getContext("2d"),
				);
			}

			this.webcamFrameCacheCtx?.clearRect(
				0,
				0,
				this.webcamFrameCacheCanvas!.width,
				this.webcamFrameCacheCanvas!.height,
			);
			this.webcamFrameCacheCtx?.drawImage(
				webcamDecodedFrame ?? webcamVideo!,
				0,
				0,
				this.webcamFrameCacheCanvas!.width,
				this.webcamFrameCacheCanvas!.height,
			);
		}

		const webcamFrameSource =
			this.webcamFrameCacheCanvas ??
			(hasLiveWebcamFrame ? (webcamDecodedFrame ?? webcamVideo) : null);
		if (!webcamFrameSource) {
			return;
		}

		const sourceWidth =
			("displayWidth" in webcamFrameSource
				? webcamFrameSource.displayWidth
				: "videoWidth" in webcamFrameSource
					? webcamFrameSource.videoWidth
					: webcamFrameSource.width) || size;
		const sourceHeight =
			("displayHeight" in webcamFrameSource
				? webcamFrameSource.displayHeight
				: "videoHeight" in webcamFrameSource
					? webcamFrameSource.videoHeight
					: webcamFrameSource.height) || size;
		const coverScale = Math.max(size / sourceWidth, size / sourceHeight);
		const drawWidth = sourceWidth * coverScale;
		const drawHeight = sourceHeight * coverScale;
		const drawX = (size - drawWidth) / 2;
		const drawY = (size - drawHeight) / 2;

		bubbleCtx.save();
		drawSquircleOnCanvas(bubbleCtx, { x: 0, y: 0, width: size, height: size, radius });
		bubbleCtx.clip();
		if (webcam.mirror) {
			bubbleCtx.save();
			bubbleCtx.translate(size, 0);
			bubbleCtx.scale(-1, 1);
			bubbleCtx.drawImage(webcamFrameSource, drawX, drawY, drawWidth, drawHeight);
			bubbleCtx.restore();
		} else {
			bubbleCtx.drawImage(webcamFrameSource, drawX, drawY, drawWidth, drawHeight);
		}
		bubbleCtx.restore();

		if ((webcam.shadow ?? 0) > 0) {
			const shadow = Math.max(0, Math.min(1, webcam.shadow));
			ctx.save();
			ctx.filter = `drop-shadow(0 ${Math.round(size * 0.06)}px ${Math.round(size * 0.22)}px rgba(0,0,0,${shadow}))`;
			ctx.drawImage(bubbleCanvas, x, y, size, size);
			ctx.restore();
			return;
		}

		ctx.drawImage(bubbleCanvas, x, y, size, size);
	}

	private closeWebcamDecodedFrame(): void {
		if (!this.webcamDecodedFrame) {
			return;
		}

		this.webcamDecodedFrame.close();
		this.webcamDecodedFrame = null;
	}

	getCanvas(): HTMLCanvasElement {
		if (!this.compositeCanvas) {
			throw new Error("Renderer not initialized");
		}
		return this.compositeCanvas;
	}

	destroy(): void {
		if (this.videoSprite) {
			const videoTexture = this.videoSprite.texture;
			this.videoSprite.destroy({ texture: false, textureSource: false });
			videoTexture?.destroy(true);
			this.videoSprite = null;
			this.videoTextureSource = null;
		}
		this.backgroundSprite = null;
		if (this.app) {
			this.app.destroy(true, {
				children: true,
				texture: false,
				textureSource: false,
			});
			this.app = null;
		}
		this.zoomBlurFilter?.destroy();
		this.motionBlurFilter?.destroy();
		this.cameraContainer = null;
		this.videoContainer = null;
		this.maskGraphics = null;
		this.zoomBlurFilter = null;
		this.motionBlurFilter = null;
		if (this.cursorOverlay) {
			this.cursorOverlay.destroy();
			this.cursorOverlay = null;
		}
		this.shadowCanvas = null;
		this.shadowCtx = null;
		this.compositeCanvas = null;
		this.compositeCtx = null;
		this.temporalAccumulationCanvas = null;
		this.temporalAccumulationCtx = null;
		this.backgroundCtx = null;
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
		this.cleanupBackgroundSource?.();
		this.cleanupBackgroundSource = null;
		if (this.webcamVideoElement) {
			this.webcamVideoElement.pause();
			this.webcamVideoElement.src = "";
			this.webcamVideoElement.load();
			this.webcamVideoElement = null;
		}
		this.webcamForwardFrameSource?.cancel();
		void this.webcamForwardFrameSource?.destroy();
		this.webcamForwardFrameSource = null;
		this.closeWebcamDecodedFrame();
		this.cleanupWebcamSource?.();
		this.cleanupWebcamSource = null;
		this.webcamFrameCacheCanvas = null;
		this.webcamFrameCacheCtx = null;
		this.webcamBubbleCanvas = null;
		this.webcamBubbleCtx = null;
		this.lastSyncedWebcamTime = null;
		this.frameImage = null;
		this.frameInsets = null;
		this.frameDraw = null;
	}
}
