import type { CursorIdleHideSettings } from "@/components/video-editor/videoPlayback/cursorIdleVisibility";
import { Container, Sprite, Texture } from "pixi.js";
import { buildActiveCaptionLayout } from "@/components/video-editor/captionLayout";
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
import type { ExportRenderBackend } from "./types";

export interface FrameRenderConfig {
	timelineEffects?: boolean;
	width: number;
	height: number;
	preferredRenderBackend?: ExportRenderBackend;
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
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	nativeReadbackMode?: "pixels" | "canvas";
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

export interface MutableVideoTextureSource {
	resource: CanvasImageSource | VideoFrame;
	update: () => void;
}

export interface ShadowLayer {
	container: Container;
	sprite: Sprite | null;
	canvas: HTMLCanvasElement | null;
	context: CanvasRenderingContext2D | null;
	textureSource: MutableVideoTextureSource | null;
	offsetScale: number;
	alphaScale: number;
	blurScale: number;
}

export interface WebcamRenderSource {
	source: CanvasImageSource | VideoFrame;
	width: number;
	height: number;
	mode: "live" | "cached";
}

export interface WebcamLayoutCache {
	exponent: number;
	sourceWidth: number;
	sourceHeight: number;
	width: number;
	height: number;
	positionX: number;
	positionY: number;
	radius: number;
	mirror: boolean;
}

export interface AnnotationSpriteEntry {
	annotation: AnnotationRegion;
	sprite: Sprite;
	texture: Texture;
}

export interface ExportCompositeCanvasState {
	canvas: HTMLCanvasElement;
	context: CanvasRenderingContext2D;
}

export type ResolvedCaptionLayout = NonNullable<ReturnType<typeof buildActiveCaptionLayout>>;

export interface CaptionRenderState {
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

export type PixiRendererAttempt = {
	backend: ExportRenderBackend;
	message: string;
};
