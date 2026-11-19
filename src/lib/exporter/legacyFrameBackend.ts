import { ensureCaptionFontLoaded } from "@/components/video-editor/captionFonts";
import { Application, Container, Graphics, Rectangle } from "pixi.js";
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
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import {
	configureHighQuality2DContext,
	ExportRenderBackend,
	isCanvasRenderer,
	PIXI_RENDERER_INIT_TIMEOUT_MS,
	PixiRendererAttempt,
	summarizeRendererAttempts,
	toErrorMessage,
} from "./legacyFrameRendererContext";

export async function createPixiApplication(
	context: Pick<LegacyFrameRendererContext, "config">,
	canvas: HTMLCanvasElement,
): Promise<{ app: Application; backend: ExportRenderBackend }> {
	const baseOptions = {
		canvas,
		width: context.config.width,
		height: context.config.height,
		backgroundAlpha: 0,
		antialias: true,
		failIfMajorPerformanceCaveat: false,
		resolution: 1,
		autoDensity: true,
		autoStart: false,
		sharedTicker: false,
		powerPreference: "high-performance" as const,
	};

	const preferredRenderBackend = context.config.preferredRenderBackend;
	const backendOrder =
		preferredRenderBackend === "webgpu"
			? (["webgpu", "webgl"] as const)
			: preferredRenderBackend === "webgl"
				? (["webgl", "webgpu"] as const)
				: (["webgl", "webgpu"] as const);
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
				(typeof performance === "undefined" ? Date.now() : performance.now()) - initStarted,
			);
			if (isCanvasRenderer(app)) {
				throw new Error(
					`Renderer initialized with unsupported fallback backend after ${elapsed}ms: ${app.renderer.constructor?.name ?? "unknown"}`,
				);
			}
			return { app, backend };
		} catch (error) {
			const elapsed = Math.round(
				(typeof performance === "undefined" ? Date.now() : performance.now()) - initStarted,
			);
			failures.push({
				backend,
				message: `${toErrorMessage(error)} (after ${elapsed}ms)`,
			});
			console.warn(
				`[FrameRenderer] ${backend} renderer unavailable after ${elapsed}ms; trying next backend.`,
				error,
			);
			destroyPixiApplication(app, `${backend} export renderer initialization`);
		}
	}

	throw new Error(summarizeRendererAttempts(failures));
}

export async function initialize(
	context: Pick<
		LegacyFrameRendererContext,
		| "config"
		| "createPixiApplication"
		| "app"
		| "cameraContainer"
		| "videoEffectsContainer"
		| "videoContainer"
		| "cursorContainer"
		| "cursorOverlay"
		| "setupBackground"
		| "setupWebcamSource"
		| "zoomBlurFilter"
		| "motionBlurFilter"
		| "compositeCanvas"
		| "compositeCtx"
		| "shadowCanvas"
		| "shadowCtx"
		| "maskGraphics"
	>,
): Promise<void> {
	if (context.config.autoCaptionSettings?.enabled)
		await ensureCaptionFontLoaded(context.config.autoCaptionSettings);
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
	canvas.width = context.config.width;
	canvas.height = context.config.height;

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
	const { app, backend } = await context.createPixiApplication(canvas);
	context.app = app;
	console.log(`[FrameRenderer] Export renderer backend: ${backend}`);

	// Setup containers
	context.cameraContainer = new Container();
	context.videoEffectsContainer = new Container();
	context.videoContainer = new Container();
	context.cursorContainer = new Container();
	context.app.stage.addChild(context.cameraContainer);
	context.cameraContainer.addChild(context.videoEffectsContainer);
	context.cameraContainer.addChild(context.cursorContainer);
	context.videoEffectsContainer.addChild(context.videoContainer);

	if (cursorOverlayEnabled) {
		context.cursorOverlay = new PixiCursorOverlay({
			idleHide: context.config.cursorIdleHide,
			dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * (context.config.cursorSize ?? 1.4),
			style: context.config.cursorStyle ?? "tahoe",
			smoothingFactor:
				context.config.cursorSmoothing ?? DEFAULT_CURSOR_CONFIG.smoothingFactor,
			springTuning: {
				stiffnessMultiplier: context.config.cursorSpringStiffnessMultiplier,
				dampingMultiplier: context.config.cursorSpringDampingMultiplier,
				massMultiplier: context.config.cursorSpringMassMultiplier,
			},
			motionBlur: context.config.cursorMotionBlur ?? 0,
			clickEffect: context.config.cursorClickEffect ?? DEFAULT_CURSOR_CONFIG.clickEffect,
			clickEffectColor:
				context.config.cursorClickEffectColor ?? DEFAULT_CURSOR_CONFIG.clickEffectColor,
			clickEffectScale:
				context.config.cursorClickEffectScale ?? DEFAULT_CURSOR_CONFIG.clickEffectScale,
			clickEffectOpacity:
				context.config.cursorClickEffectOpacity ?? DEFAULT_CURSOR_CONFIG.clickEffectOpacity,
			clickEffectDurationMs:
				context.config.cursorClickEffectDurationMs ??
				DEFAULT_CURSOR_CONFIG.clickEffectDurationMs,
			clickBounce: context.config.cursorClickBounce ?? DEFAULT_CURSOR_CONFIG.clickBounce,
			clickBounceDuration:
				context.config.cursorClickBounceDuration ??
				DEFAULT_CURSOR_CONFIG.clickBounceDuration,
			sway: context.config.cursorSway ?? DEFAULT_CURSOR_CONFIG.sway,
		});
	}

	// Setup background (render separately, not in PixiJS)
	await context.setupBackground();
	await context.setupWebcamSource();

	if ((context.config.zoomMotionBlur ?? 0) > 0) {
		const blurFilters = createVideoBlurFilters();
		context.zoomBlurFilter = blurFilters.zoom;
		context.motionBlurFilter = blurFilters.motion;
		context.videoEffectsContainer.filterArea = new Rectangle(
			0,
			0,
			context.config.width,
			context.config.height,
		);
		context.videoEffectsContainer.filters = [context.motionBlurFilter, context.zoomBlurFilter];
	} else {
		context.videoEffectsContainer.filters = null;
	}

	// Setup composite canvas for final output with shadows
	context.compositeCanvas = document.createElement("canvas");
	context.compositeCanvas.width = context.config.width;
	context.compositeCanvas.height = context.config.height;
	context.compositeCtx = configureHighQuality2DContext(
		context.compositeCanvas.getContext("2d", {
			willReadFrequently: false,
		}),
	);

	if (!context.compositeCtx) {
		throw new Error("Failed to get 2D context for composite canvas");
	}

	// Setup shadow canvas if needed
	if (context.config.showShadow) {
		context.shadowCanvas = document.createElement("canvas");
		context.shadowCanvas.width = context.config.width;
		context.shadowCanvas.height = context.config.height;
		context.shadowCtx = configureHighQuality2DContext(
			context.shadowCanvas.getContext("2d", {
				willReadFrequently: false,
			}),
		);

		if (!context.shadowCtx) {
			throw new Error("Failed to get 2D context for shadow canvas");
		}
	}

	// Setup mask
	context.maskGraphics = new Graphics();
	context.videoEffectsContainer.addChild(context.maskGraphics);
	context.videoContainer.mask = context.maskGraphics;
	if (context.cursorOverlay) {
		context.cursorContainer.addChild(context.cursorOverlay.container);
	}
}
