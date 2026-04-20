import type React from "react";
import type { Application, Container, Graphics, Sprite } from "pixi.js";
import type { MotionBlurFilter } from "pixi-filters/motion-blur";
import type { BlurFilter } from "pixi.js";
import { extensionHost } from "@/lib/extensions";
import { mapCursorToCanvasNormalized } from "@/lib/extensions/cursorCoordinates";
import { DEFAULT_FOCUS } from "../videoPlayback/constants";
import type { PixiCursorOverlay } from "../videoPlayback/cursorRenderer";
import type { CursorFollowCameraState } from "../videoPlayback/cursorFollowCamera";
import type { MotionBlurState } from "../videoPlayback/zoomTransform";
import type { SpringState } from "../videoPlayback/motionSmoothing";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type {
	AnnotationRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomFocus,
	ZoomRegion,
	ZoomTransitionEasing,
} from "../types";

export interface VideoPlaybackProps {
	videoPath: string;
	onDurationChange: (duration: number) => void;
	onPreviewReadyChange?: (ready: boolean) => void;
	onTimeUpdate: (time: number) => void;
	currentTime: number;
	onPlayStateChange: (playing: boolean) => void;
	onError: (error: string) => void;
	wallpaper?: string;
	zoomRegions: ZoomRegion[];
	selectedZoomId: string | null;
	onSelectZoom: (id: string | null) => void;
	onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
	isPlaying: boolean;
	showShadow?: boolean;
	shadowIntensity?: number;
	backgroundBlur?: number;
	zoomMotionBlur?: number;
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
	padding?: number;
	frame?: string | null;
	cropRegion?: CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamVideoPath?: string | null;
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	aspectRatio: AspectRatio;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	cursorStyle?: CursorStyle;
	cursorSize?: number;
	cursorSmoothing?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	volume?: number;
}

export interface VideoPlaybackRef {
	video: HTMLVideoElement | null;
	app: Application | null;
	videoSprite: Sprite | null;
	videoContainer: Container | null;
	containerRef: React.RefObject<HTMLDivElement>;
	play: () => Promise<void>;
	pause: () => void;
	refreshFrame: () => Promise<void>;
}

export type PlaybackAnimationState = {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
};

export interface VideoPlaybackRuntimeRefs {
	videoRef: React.MutableRefObject<HTMLVideoElement | null>;
	containerRef: React.MutableRefObject<HTMLDivElement | null>;
	appRef: React.MutableRefObject<Application | null>;
	videoSpriteRef: React.MutableRefObject<Sprite | null>;
	videoContainerRef: React.MutableRefObject<Container | null>;
	cursorContainerRef: React.MutableRefObject<Container | null>;
	cameraContainerRef: React.MutableRefObject<Container | null>;
	timeUpdateAnimationRef: React.MutableRefObject<number | null>;
	overlayRef: React.MutableRefObject<HTMLDivElement | null>;
	focusIndicatorRef: React.MutableRefObject<HTMLDivElement | null>;
	webcamVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	webcamBubbleRef: React.MutableRefObject<HTMLDivElement | null>;
	webcamBubbleInnerRef: React.MutableRefObject<HTMLDivElement | null>;
	captionBoxRef: React.MutableRefObject<HTMLDivElement | null>;
	currentTimeRef: React.MutableRefObject<number>;
	zoomRegionsRef: React.MutableRefObject<ZoomRegion[]>;
	selectedZoomIdRef: React.MutableRefObject<string | null>;
	animationStateRef: React.MutableRefObject<PlaybackAnimationState>;
	blurFilterRef: React.MutableRefObject<BlurFilter | null>;
	motionBlurFilterRef: React.MutableRefObject<MotionBlurFilter | null>;
	isDraggingFocusRef: React.MutableRefObject<boolean>;
	stageSizeRef: React.MutableRefObject<{ width: number; height: number }>;
	videoSizeRef: React.MutableRefObject<{ width: number; height: number }>;
	baseScaleRef: React.MutableRefObject<number>;
	baseOffsetRef: React.MutableRefObject<{ x: number; y: number }>;
	baseMaskRef: React.MutableRefObject<{
		x: number;
		y: number;
		width: number;
		height: number;
		sourceCrop?: { x: number; y: number; width: number; height: number };
	}>;
	cropBoundsRef: React.MutableRefObject<{
		startX: number;
		endX: number;
		startY: number;
		endY: number;
	}>;
	maskGraphicsRef: React.MutableRefObject<Graphics | null>;
	frameSpriteRef: React.MutableRefObject<Sprite | null>;
	frameContainerRef: React.MutableRefObject<Container | null>;
	frameIdRef: React.MutableRefObject<string | null>;
	isPlayingRef: React.MutableRefObject<boolean>;
	isSeekingRef: React.MutableRefObject<boolean>;
	allowPlaybackRef: React.MutableRefObject<boolean>;
	lockedVideoDimensionsRef: React.MutableRefObject<{ width: number; height: number } | null>;
	layoutVideoContentRef: React.MutableRefObject<(() => void) | null>;
	trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
	speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
	lastWebcamSyncTimeRef: React.MutableRefObject<number | null>;
	bgVideoRef: React.MutableRefObject<HTMLVideoElement | null>;
	zoomMotionBlurRef: React.MutableRefObject<number>;
	connectZoomsRef: React.MutableRefObject<boolean>;
	zoomInDurationMsRef: React.MutableRefObject<number>;
	zoomInOverlapMsRef: React.MutableRefObject<number>;
	zoomOutDurationMsRef: React.MutableRefObject<number>;
	connectedZoomGapMsRef: React.MutableRefObject<number>;
	connectedZoomDurationMsRef: React.MutableRefObject<number>;
	zoomInEasingRef: React.MutableRefObject<ZoomTransitionEasing>;
	zoomOutEasingRef: React.MutableRefObject<ZoomTransitionEasing>;
	connectedZoomEasingRef: React.MutableRefObject<ZoomTransitionEasing>;
	videoReadyRafRef: React.MutableRefObject<number | null>;
	cursorOverlayRef: React.MutableRefObject<PixiCursorOverlay | null>;
	cursorEffectsCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
	cursorTelemetryRef: React.MutableRefObject<CursorTelemetryPoint[]>;
	showCursorRef: React.MutableRefObject<boolean>;
	cursorSizeRef: React.MutableRefObject<number>;
	cursorStyleRef: React.MutableRefObject<CursorStyle>;
	cursorSmoothingRef: React.MutableRefObject<number>;
	cursorMotionBlurRef: React.MutableRefObject<number>;
	cursorClickBounceRef: React.MutableRefObject<number>;
	cursorClickBounceDurationRef: React.MutableRefObject<number>;
	cursorSwayRef: React.MutableRefObject<number>;
	lastEmittedClickTimeMsRef: React.MutableRefObject<number>;
	springScaleRef: React.MutableRefObject<SpringState>;
	springXRef: React.MutableRefObject<SpringState>;
	springYRef: React.MutableRefObject<SpringState>;
	lastTickTimeRef: React.MutableRefObject<number | null>;
	zoomSmoothnessRef: React.MutableRefObject<number>;
	zoomClassicModeRef: React.MutableRefObject<boolean>;
	cursorFollowCameraRef: React.MutableRefObject<CursorFollowCameraState>;
	motionBlurStateRef: React.MutableRefObject<MotionBlurState>;
}

export function getContributedCursorStylesSignature() {
	return extensionHost
		.getContributedCursorStyles()
		.map(
			(cursorStyle) =>
				`${cursorStyle.id}:${cursorStyle.resolvedDefaultUrl}:${cursorStyle.resolvedClickUrl ?? ""}:${cursorStyle.cursorStyle.hotspot?.x ?? ""}:${cursorStyle.cursorStyle.hotspot?.y ?? ""}`,
		)
		.sort()
		.join("|");
}

export function createPlaybackAnimationState(): PlaybackAnimationState {
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

export function getCursorPositionAtTime(
	telemetry: CursorTelemetryPoint[],
	timeMs: number,
	params?: {
		maskRect?: { x: number; y: number; width: number; height: number } | null;
		canvasWidth: number;
		canvasHeight: number;
	},
): { cx: number; cy: number; interactionType?: string } | null {
	if (telemetry.length === 0) {
		return null;
	}

	let closest = telemetry[0];
	let minDist = Math.abs(telemetry[0].timeMs - timeMs);

	for (let index = 1; index < telemetry.length; index++) {
		const point = telemetry[index];
		const distance = Math.abs(point.timeMs - timeMs);
		if (distance < minDist) {
			minDist = distance;
			closest = point;
		}
		if (point.timeMs > timeMs) {
			break;
		}
	}

	return mapCursorToCanvasNormalized(
		{
			cx: closest.cx,
			cy: closest.cy,
			interactionType: closest.interactionType,
		},
		params ?? { canvasWidth: 1, canvasHeight: 1 },
	);
}

export function getEffectiveNativeAspectRatio(
	dimensions: { width: number; height: number } | null | undefined,
	cropRegion?: CropRegion,
): number {
	if (!dimensions || dimensions.height <= 0 || dimensions.width <= 0) {
		return 16 / 9;
	}

	const cropWidth = cropRegion?.width ?? 1;
	const cropHeight = cropRegion?.height ?? 1;
	const effectiveWidth = dimensions.width * cropWidth;
	const effectiveHeight = dimensions.height * cropHeight;

	if (effectiveWidth <= 0 || effectiveHeight <= 0) {
		return dimensions.width / dimensions.height;
	}

	return effectiveWidth / effectiveHeight;
}