import { ensureCaptionFontLoaded } from "@/components/video-editor/captionFonts";
import { Application, Container, Graphics, Rectangle, RendererType, Sprite } from "pixi.js";
import type { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "@/components/video-editor/videoPlayback/cursorRenderer";
import { createVideoBlurFilters } from "@/lib/exporter/videoBlurFilters";
import {
	destroyPixiApplication,
	initializePixiApplicationWithTimeout,
} from "@/lib/pixiApplicationLifecycle";
import { preloadAnnotationAssets } from "./annotationRenderer";
import type { FrameRenderContext } from "./modernFrameRenderer";
import type { MutableVideoTextureSource, PixiRendererAttempt } from "./modernFrameTypes";
import {
	isCanvasRenderer,
	isKnownRendererUnavailableError,
	PIXI_RENDERER_INIT_TIMEOUT_MS,
	summarizeRendererAttempts,
	toErrorMessage,
} from "./modernFrameUtils";
import { VIDEO_SHADOW_LAYER_PROFILES } from "./shadowProfile";
import type { ExportRenderBackend } from "./types";

/** Owns scene resources for one export renderer. */
export class FrameScene {
	constructor(
		private readonly context: Pick<
			FrameRenderContext,
			"config" | "shadows" | "background" | "webcamMedia" | "annotations" | "captions"
		>,
	) {}

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

	videoMaskGraphics: Graphics | null = null;

	webcamMaskGraphics: Graphics | null = null;

	zoomBlurFilter: ZoomBlurFilter | null = null;

	motionBlurFilter: MotionBlurFilter | null = null;

	cursorOverlay: PixiCursorOverlay | null = null;

	videoTextureUsesStartupStaging = false;

	shouldUseZoomMotionBlur(): boolean {
		return (this.context.config.zoomMotionBlur ?? 0) > 0;
	}

	updateVideoEffectsFilterState(): void {
		if (!this.videoEffectsContainer) {
			return;
		}

		const activeFilters =
			this.shouldUseZoomMotionBlur() && this.motionBlurFilter && this.zoomBlurFilter
				? [this.motionBlurFilter, this.zoomBlurFilter]
				: null;
		this.videoEffectsContainer.filters = activeFilters;
	}

	async initialize(): Promise<void> {
		if (this.context.config.autoCaptionSettings?.enabled)
			await ensureCaptionFontLoaded(this.context.config.autoCaptionSettings);
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
		canvas.width = this.context.config.width;
		canvas.height = this.context.config.height;

		try {
			const exportCanvas = canvas as HTMLCanvasElement & {
				colorSpace?: string;
			};
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

		this.context.shadows.videoShadowLayers = this.context.shadows.createShadowLayers(
			this.cameraContainer,
			VIDEO_SHADOW_LAYER_PROFILES,
		);

		this.cameraContainer.addChild(this.videoEffectsContainer);
		this.cameraContainer.addChild(this.cursorContainer);
		this.videoEffectsContainer.addChild(this.videoContainer);
		this.videoEffectsContainer.filterArea = new Rectangle(
			0,
			0,
			this.context.config.width,
			this.context.config.height,
		);

		this.webcamRootContainer.addChild(this.webcamContainer);
		this.webcamRootContainer.visible = false;

		this.overlayContainer.addChild(this.webcamRootContainer);
		this.cameraContainer.addChild(this.annotationContainer);
		this.overlayContainer.addChild(this.captionContainer);

		this.videoMaskGraphics = new Graphics();
		this.videoEffectsContainer.addChild(this.videoMaskGraphics);
		this.videoContainer.mask = this.videoMaskGraphics;

		this.webcamMaskGraphics = new Graphics();
		this.webcamContainer.addChild(this.webcamMaskGraphics);
		this.webcamContainer.mask = this.webcamMaskGraphics;

		if (cursorOverlayEnabled) {
			this.cursorOverlay = new PixiCursorOverlay({
				idleHide: this.context.config.cursorIdleHide,
				dotRadius:
					DEFAULT_CURSOR_CONFIG.dotRadius * (this.context.config.cursorSize ?? 1.4),
				style: this.context.config.cursorStyle ?? "tahoe",
				smoothingFactor:
					this.context.config.cursorSmoothing ?? DEFAULT_CURSOR_CONFIG.smoothingFactor,
				springTuning: {
					stiffnessMultiplier: this.context.config.cursorSpringStiffnessMultiplier,
					dampingMultiplier: this.context.config.cursorSpringDampingMultiplier,
					massMultiplier: this.context.config.cursorSpringMassMultiplier,
				},
				motionBlur: this.context.config.cursorMotionBlur ?? 0,
				clickEffect:
					this.context.config.cursorClickEffect ?? DEFAULT_CURSOR_CONFIG.clickEffect,
				clickEffectColor:
					this.context.config.cursorClickEffectColor ??
					DEFAULT_CURSOR_CONFIG.clickEffectColor,
				clickEffectScale:
					this.context.config.cursorClickEffectScale ??
					DEFAULT_CURSOR_CONFIG.clickEffectScale,
				clickEffectOpacity:
					this.context.config.cursorClickEffectOpacity ??
					DEFAULT_CURSOR_CONFIG.clickEffectOpacity,
				clickEffectDurationMs:
					this.context.config.cursorClickEffectDurationMs ??
					DEFAULT_CURSOR_CONFIG.clickEffectDurationMs,
				clickBounce:
					this.context.config.cursorClickBounce ?? DEFAULT_CURSOR_CONFIG.clickBounce,
				clickBounceDuration:
					this.context.config.cursorClickBounceDuration ??
					DEFAULT_CURSOR_CONFIG.clickBounceDuration,
				sway: this.context.config.cursorSway ?? DEFAULT_CURSOR_CONFIG.sway,
			});
			this.cursorContainer.addChild(this.cursorOverlay.container);
		}

		await this.context.background.setupBackground();
		await this.context.webcamMedia.setupWebcamSource();

		this.context.annotations.annotationScaleFactor =
			this.context.annotations.calculateAnnotationScaleFactor();
		this.context.annotations.annotationAssets = await preloadAnnotationAssets(
			this.context.config.annotationRegions ?? [],
		);
		await this.context.annotations.setupAnnotationLayer();
		this.context.captions.setupCaptionResources();

		if (this.shouldUseZoomMotionBlur()) {
			const blurFilters = createVideoBlurFilters();
			this.zoomBlurFilter = blurFilters.zoom;
			this.motionBlurFilter = blurFilters.motion;
		}

		this.updateVideoEffectsFilterState();

		console.log(`[FrameRenderer] Export renderer backend: ${this.rendererBackend}`);
	}

	async createPixiApplication(
		canvas: HTMLCanvasElement,
	): Promise<{ app: Application; backend: ExportRenderBackend }> {
		const baseOptions = {
			canvas,
			width: this.context.config.width,
			height: this.context.config.height,
			backgroundAlpha: 0,
			antialias: true,
			failIfMajorPerformanceCaveat: false,
			resolution: 1,
			autoDensity: true,
			autoStart: false,
			sharedTicker: false,
			powerPreference: "high-performance" as const,
		};

		const preferredRenderBackend = this.context.config.preferredRenderBackend;
		// WebGPU is opt-in: some Chromium runtimes expose navigator.gpu but fail
		// inside Pixi's bind-group path during rendering.
		const backendOrder: ExportRenderBackend[] =
			preferredRenderBackend === "webgpu" ? ["webgpu", "webgl"] : ["webgl", "webgpu"];
		const failures: PixiRendererAttempt[] = [];

		for (const backend of backendOrder) {
			if (backend === "webgpu" && !(typeof navigator !== "undefined" && "gpu" in navigator)) {
				failures.push({
					backend,
					message: "WebGPU runtime is unavailable in this environment.",
				});
				continue;
			}

			const app = new Application();
			const initStarted = typeof performance === "undefined" ? Date.now() : performance.now();
			try {
				await initializePixiApplicationWithTimeout(
					app,
					{
						...baseOptions,
						preference: backend,
					},
					PIXI_RENDERER_INIT_TIMEOUT_MS,
					backend,
				);
				const elapsed = Math.round(
					(typeof performance === "undefined" ? Date.now() : performance.now()) -
						initStarted,
				);
				if (isCanvasRenderer(app)) {
					throw new Error(
						`Renderer initialized with unsupported fallback backend after ${elapsed}ms: ${app.renderer.constructor?.name ?? "unknown"}`,
					);
				}
				const actualBackend =
					app.renderer.type === RendererType.WEBGL
						? "webgl"
						: app.renderer.type === RendererType.WEBGPU
							? "webgpu"
							: backend;
				return { app, backend: actualBackend };
			} catch (error) {
				const elapsed = Math.round(
					(typeof performance === "undefined" ? Date.now() : performance.now()) -
						initStarted,
				);
				failures.push({
					backend,
					message: `${toErrorMessage(error)} (after ${elapsed}ms)`,
				});
				const rendererMessage = isKnownRendererUnavailableError(error)
					? "renderer backend unavailable in this runtime"
					: "renderer init failed";
				console.warn(
					`[FrameRenderer] ${backend} export renderer unavailable (${rendererMessage}) after ${elapsed}ms; trying next backend:`,
					error,
				);
				destroyPixiApplication(app, `${backend} export renderer initialization`);
			}
		}

		throw new Error(summarizeRendererAttempts(failures));
	}
}
