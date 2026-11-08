import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import {
	type CursorFollowCameraState,
	createCursorFollowCameraState,
} from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import { PixiCursorOverlay } from "@/components/video-editor/videoPlayback/cursorRenderer";
import {
	createSpringState,
	type SpringState,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import {
	createMotionBlurState,
	type MotionBlurState,
} from "@/components/video-editor/videoPlayback/zoomTransform";
import { WebcamMotionBlur } from "@/components/video-editor/webcamMotionBlur";
import { ForwardFrameSource } from "./forwardFrameSource";
import {
	createPixiApplication as createPixiApplicationOperation,
	initialize as initializeOperation,
} from "./legacyFrameBackend";
import {
	drawBackgroundSourceToCanvas as drawBackgroundSourceToCanvasOperation,
	drawVideoFrameToBackground as drawVideoFrameToBackgroundOperation,
	resolveWallpaperForExport as resolveWallpaperForExportOperation,
	resolveWallpaperImageUrl as resolveWallpaperImageUrlOperation,
	setupBackground as setupBackgroundOperation,
} from "./legacyFrameBackground";
import {
	loadBackgroundMediaElementSource as loadBackgroundMediaElementSourceOperation,
	syncBackgroundVideo as syncBackgroundVideoOperation,
} from "./legacyFrameBackgroundMedia";
import {
	closeBackgroundDecodedFrame as closeBackgroundDecodedFrameOperation,
	fallbackBackgroundForwardFrameSourceToMediaElement as fallbackBackgroundForwardFrameSourceToMediaElementOperation,
	restartBackgroundForwardFrameSource as restartBackgroundForwardFrameSourceOperation,
	syncBackgroundFrame as syncBackgroundFrameOperation,
} from "./legacyFrameBackgroundStream";
import {
	compositeWithShadows as compositeWithShadowsOperation,
	drawWebcamOverlay as drawWebcamOverlayOperation,
} from "./legacyFrameComposite";
import {
	updateAnimationState as updateAnimationStateOperation,
	updateLayout as updateLayoutOperation,
} from "./legacyFrameLayout";
import {
	cancelPendingMedia as cancelPendingMediaOperation,
	destroy as destroyOperation,
	getCanvas as getCanvasOperation,
} from "./legacyFrameLifecycle";
import { renderFrame as renderFrameOperation } from "./legacyFramePipeline";
import type { LegacyFrameRendererContext } from "./legacyFrameRendererContext";
import {
	AnimationState,
	createAnimationState,
	ExportRenderBackend,
	FrameRenderConfig,
	LayoutCache,
	VideoTextureSource,
} from "./legacyFrameRendererContext";
import {
	closeWebcamDecodedFrame as closeWebcamDecodedFrameOperation,
	setupWebcamSource as setupWebcamSourceOperation,
	syncWebcamFrame as syncWebcamFrameOperation,
} from "./legacyFrameWebcamMedia";
import { SourceRedactionCanvas } from "./sourceRedaction";

export class FrameRenderer {
	private get context(): LegacyFrameRendererContext {
		// Preserve one shared resource owner across the focused rendering/export operations.
		return this as unknown as LegacyFrameRendererContext;
	}

	protected sourceRedaction = new SourceRedactionCanvas();
	protected sourceRedactionTextureActive = false;

	protected app: Application | null = null;

	protected cameraContainer: Container | null = null;

	protected videoEffectsContainer: Container | null = null;

	protected videoContainer: Container | null = null;

	protected cursorContainer: Container | null = null;

	protected videoSprite: Sprite | null = null;

	protected videoTextureSource: VideoTextureSource | null = null;

	protected backgroundSprite: HTMLCanvasElement | null = null;

	protected maskGraphics: Graphics | null = null;

	protected zoomBlurFilter: ZoomBlurFilter | null = null;

	protected motionBlurFilter: MotionBlurFilter | null = null;

	protected shadowCanvas: HTMLCanvasElement | null = null;

	protected shadowCtx: CanvasRenderingContext2D | null = null;

	protected compositeCanvas: HTMLCanvasElement | null = null;

	protected compositeCtx: CanvasRenderingContext2D | null = null;

	protected pendingMediaCancellations = new Set<() => void>();

	protected mediaCancelled = false;

	protected backgroundForwardFrameSource: ForwardFrameSource | null = null;

	protected backgroundForwardFrameSourceUrl: string | null = null;

	protected backgroundForwardFrameDurationSec: number | null = null;

	protected backgroundDecodedFrame: VideoFrame | null = null;

	protected backgroundVideoElement: HTMLVideoElement | null = null;

	protected backgroundCtx: CanvasRenderingContext2D | null = null;

	protected backgroundSeekPromise: Promise<void> | null = null;

	protected lastSyncedBackgroundLoopTimeSec: number | null = null;

	protected cleanupBackgroundSource: (() => void) | null = null;

	protected config: FrameRenderConfig;

	protected animationState: AnimationState;

	protected motionBlurState: MotionBlurState;

	protected layoutCache: LayoutCache | null = null;

	protected webcamMotionBlur = new WebcamMotionBlur();

	protected webcamMotionTimeMs = 0;

	protected currentVideoTime = 0;

	protected springScale: SpringState;

	protected springX: SpringState;

	protected springY: SpringState;

	protected cursorFollowCamera: CursorFollowCameraState;

	protected lastContentTimeMs: number | null = null;

	protected cursorOverlay: PixiCursorOverlay | null = null;

	protected webcamForwardFrameSource: ForwardFrameSource | null = null;

	protected webcamDecodedFrame: VideoFrame | null = null;

	protected webcamVideoElement: HTMLVideoElement | null = null;

	protected webcamSeekPromise: Promise<void> | null = null;

	protected webcamFrameCacheCanvas: HTMLCanvasElement | null = null;

	protected webcamFrameCacheCtx: CanvasRenderingContext2D | null = null;

	protected lastSyncedWebcamTime: number | null = null;

	protected cleanupWebcamSource: (() => void) | null = null;

	constructor(config: FrameRenderConfig) {
		this.config = config;
		this.animationState = createAnimationState();
		this.motionBlurState = createMotionBlurState();
		this.springScale = createSpringState(1);
		this.springX = createSpringState(0);
		this.springY = createSpringState(0);
		this.cursorFollowCamera = createCursorFollowCameraState();
	}

	protected async createPixiApplication(
		canvas: HTMLCanvasElement,
	): Promise<{ app: Application; backend: ExportRenderBackend }> {
		return createPixiApplicationOperation(this.context, canvas);
	}

	async initialize(): Promise<void> {
		return initializeOperation(this.context);
	}

	protected async setupBackground(): Promise<void> {
		return setupBackgroundOperation(this.context);
	}

	protected drawVideoFrameToBackground(): void {
		return drawVideoFrameToBackgroundOperation(this.context);
	}

	protected drawBackgroundSourceToCanvas(
		source: CanvasImageSource,
		sourceWidth: number,
		sourceHeight: number,
	): void {
		return drawBackgroundSourceToCanvasOperation(
			this.context,
			source,
			sourceWidth,
			sourceHeight,
		);
	}

	protected closeBackgroundDecodedFrame(): void {
		return closeBackgroundDecodedFrameOperation(this.context);
	}

	protected async restartBackgroundForwardFrameSource(): Promise<void> {
		return restartBackgroundForwardFrameSourceOperation(this.context);
	}

	protected async syncBackgroundFrame(timeSeconds: number): Promise<void> {
		return syncBackgroundFrameOperation(this.context, timeSeconds);
	}

	protected async fallbackBackgroundForwardFrameSourceToMediaElement(): Promise<boolean> {
		return fallbackBackgroundForwardFrameSourceToMediaElementOperation(this.context);
	}

	protected async loadBackgroundMediaElementSource(
		videoSrc: string,
		errorLabel: string,
	): Promise<boolean> {
		return loadBackgroundMediaElementSourceOperation(this.context, videoSrc, errorLabel);
	}

	protected async syncBackgroundVideo(timeSeconds: number): Promise<void> {
		return syncBackgroundVideoOperation(this.context, timeSeconds);
	}

	protected async resolveWallpaperImageUrl(wallpaper: string): Promise<string> {
		return resolveWallpaperImageUrlOperation(this.context, wallpaper);
	}

	protected async resolveWallpaperForExport(wallpaper: string): Promise<string> {
		return resolveWallpaperForExportOperation(this.context, wallpaper);
	}

	protected async setupWebcamSource(): Promise<void> {
		return setupWebcamSourceOperation(this.context);
	}

	protected async syncWebcamFrame(targetTime: number): Promise<void> {
		return syncWebcamFrameOperation(this.context, targetTime);
	}

	cancelPendingMedia(): void {
		return cancelPendingMediaOperation(this.context);
	}

	async renderFrame(
		videoFrame: VideoFrame | null,
		timestamp: number,
		cursorTimestamp = timestamp,
		_frameDurationUs?: number,
		backgroundTimelineTimestamp = timestamp,
	): Promise<void> {
		return renderFrameOperation(
			this.context,
			videoFrame,
			timestamp,
			cursorTimestamp,
			_frameDurationUs,
			backgroundTimelineTimestamp,
		);
	}

	protected updateLayout(): void {
		return updateLayoutOperation(this.context);
	}

	protected updateAnimationState(timeMs: number, cursorTimeMs = timeMs): number {
		return updateAnimationStateOperation(this.context, timeMs, cursorTimeMs);
	}

	protected compositeWithShadows(includeWebcam = true): void {
		return compositeWithShadowsOperation(this.context, includeWebcam);
	}

	protected drawWebcamOverlay(
		ctx: CanvasRenderingContext2D,
		width: number,
		height: number,
	): void {
		return drawWebcamOverlayOperation(this.context, ctx, width, height);
	}

	protected closeWebcamDecodedFrame(): void {
		return closeWebcamDecodedFrameOperation(this.context);
	}

	getCanvas(): HTMLCanvasElement {
		return getCanvasOperation(this.context);
	}

	destroy(): void {
		return destroyOperation(this.context);
	}
}
