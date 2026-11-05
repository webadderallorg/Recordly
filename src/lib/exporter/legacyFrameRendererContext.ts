import type { CursorIdleHideSettings } from "@/components/video-editor/videoPlayback/cursorIdleVisibility";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { ZoomBlurFilter } from "pixi-filters/zoom-blur";
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	WebcamOverlaySettings,
	ZoomMotionBlurTuning,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import { DEFAULT_FOCUS } from "@/components/video-editor/videoPlayback/constants";
import { type CursorFollowCameraState } from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import { PixiCursorOverlay } from "@/components/video-editor/videoPlayback/cursorRenderer";
import { type SpringState } from "@/components/video-editor/videoPlayback/motionSmoothing";
import { type MotionBlurState } from "@/components/video-editor/videoPlayback/zoomTransform";
import { WebcamMotionBlur } from "@/components/video-editor/webcamMotionBlur";
import { ForwardFrameSource } from "./forwardFrameSource";
import type { SourceRedactionCanvas } from "./sourceRedaction";

export interface FrameRenderConfig {
	/** Sparse samples seek optional media directly instead of scanning their prefix. */
	preferMediaElementSampling?: boolean;
	timelineEffects?: boolean;
	width: number;
	height: number;
	preferredRenderBackend?: "webgl" | "webgpu";
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
	zoomMotionBlurTuning?: ZoomMotionBlurTuning;
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
	cameraSpringStiffnessMultiplier?: number;
	cameraSpringDampingMultiplier?: number;
	cameraSpringMassMultiplier?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	cursorMotionBlur?: number;
	cursorClickEffect?: CursorClickEffectStyle;
	cursorClickEffectColor?: string;
	cursorClickEffectScale?: number;
	cursorClickEffectOpacity?: number;
	cursorClickEffectDurationMs?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	cursorIdleHide?: CursorIdleHideSettings;
}

export interface AnimationState {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
}

export type ExportRenderBackend = "webgl" | "webgpu";

export type PixiRendererAttempt = {
	backend: ExportRenderBackend;
	message: string;
};

export const PIXI_RENDERER_INIT_TIMEOUT_MS = 8_000;

export const BACKGROUND_MEDIA_ELEMENT_READY_TIMEOUT_MS = 5_000;

export function isCanvasRenderer(renderer: Application): boolean {
	const rendererName = renderer?.renderer?.constructor?.name?.toLowerCase();
	return Boolean(
		rendererName &&
			(rendererName.includes("canvasrenderer") || rendererName.includes("canvas")),
	);
}

export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "Unknown renderer init error");
}

export function summarizeRendererAttempts(attempts: readonly PixiRendererAttempt[]): string {
	const details = attempts.map((attempt) => `${attempt.backend}: ${attempt.message}`).join(" | ");
	return `No supported Pixi export backend was available. Attempted: ${details}`;
}

export interface VideoTextureSource {
	resource: VideoFrame | CanvasImageSource;
	update: () => void;
}

export type PixiTextureInput = Parameters<typeof Texture.from>[0];

export interface LayoutCache {
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

export interface LegacyFrameRendererContext {
	sourceRedaction: SourceRedactionCanvas;
	sourceRedactionTextureActive: boolean;
	app: Application | null;
	cameraContainer: Container | null;
	videoEffectsContainer: Container | null;
	videoContainer: Container | null;
	cursorContainer: Container | null;
	videoSprite: Sprite | null;
	videoTextureSource: VideoTextureSource | null;
	backgroundSprite: HTMLCanvasElement | null;
	maskGraphics: Graphics | null;
	zoomBlurFilter: ZoomBlurFilter | null;
	motionBlurFilter: MotionBlurFilter | null;
	shadowCanvas: HTMLCanvasElement | null;
	shadowCtx: CanvasRenderingContext2D | null;
	compositeCanvas: HTMLCanvasElement | null;
	compositeCtx: CanvasRenderingContext2D | null;
	pendingMediaCancellations: Set<() => void>;
	mediaCancelled: boolean;
	backgroundForwardFrameSource: ForwardFrameSource | null;
	backgroundForwardFrameSourceUrl: string | null;
	backgroundForwardFrameDurationSec: number | null;
	backgroundDecodedFrame: VideoFrame | null;
	backgroundVideoElement: HTMLVideoElement | null;
	backgroundCtx: CanvasRenderingContext2D | null;
	backgroundSeekPromise: Promise<void> | null;
	lastSyncedBackgroundLoopTimeSec: number | null;
	cleanupBackgroundSource: (() => void) | null;
	config: FrameRenderConfig;
	animationState: AnimationState;
	motionBlurState: MotionBlurState;
	layoutCache: LayoutCache | null;
	webcamMotionBlur: WebcamMotionBlur;
	webcamMotionTimeMs: number;
	currentVideoTime: number;
	springScale: SpringState;
	springX: SpringState;
	springY: SpringState;
	cursorFollowCamera: CursorFollowCameraState;
	lastContentTimeMs: number | null;
	cursorOverlay: PixiCursorOverlay | null;
	webcamForwardFrameSource: ForwardFrameSource | null;
	webcamDecodedFrame: VideoFrame | null;
	webcamVideoElement: HTMLVideoElement | null;
	webcamSeekPromise: Promise<void> | null;
	webcamFrameCacheCanvas: HTMLCanvasElement | null;
	webcamFrameCacheCtx: CanvasRenderingContext2D | null;
	lastSyncedWebcamTime: number | null;
	cleanupWebcamSource: (() => void) | null;
	createPixiApplication(
		canvas: HTMLCanvasElement,
	): Promise<{ app: Application; backend: ExportRenderBackend }>;
	initialize(): Promise<void>;
	setupBackground(): Promise<void>;
	drawVideoFrameToBackground(): void;
	drawBackgroundSourceToCanvas(
		source: CanvasImageSource,
		sourceWidth: number,
		sourceHeight: number,
	): void;
	closeBackgroundDecodedFrame(): void;
	restartBackgroundForwardFrameSource(): Promise<void>;
	syncBackgroundFrame(timeSeconds: number): Promise<void>;
	fallbackBackgroundForwardFrameSourceToMediaElement(): Promise<boolean>;
	loadBackgroundMediaElementSource(videoSrc: string, errorLabel: string): Promise<boolean>;
	syncBackgroundVideo(timeSeconds: number): Promise<void>;
	resolveWallpaperImageUrl(wallpaper: string): Promise<string>;
	resolveWallpaperForExport(wallpaper: string): Promise<string>;
	setupWebcamSource(): Promise<void>;
	syncWebcamFrame(targetTime: number): Promise<void>;
	cancelPendingMedia(): void;
	renderFrame(
		videoFrame: VideoFrame | null,
		timestamp: number,
		cursorTimestamp?: number,
		_frameDurationUs?: number,
		backgroundTimelineTimestamp?: number,
	): Promise<void>;
	updateLayout(): void;
	updateAnimationState(timeMs: number, cursorTimeMs?: number): number;
	compositeWithShadows(includeWebcam?: boolean): void;
	drawWebcamOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void;
	closeWebcamDecodedFrame(): void;
	getCanvas(): HTMLCanvasElement;
	destroy(): void;
}
