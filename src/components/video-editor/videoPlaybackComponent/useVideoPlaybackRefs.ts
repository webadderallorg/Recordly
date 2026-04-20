import { useRef, useState } from "react";
import { BlurFilter, Container, Graphics, Sprite, type Application } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type {
	CursorStyle,
	CursorTelemetryPoint,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
	ZoomTransitionEasing,
} from "../types";
import { createSpringState, type SpringState } from "../videoPlayback/motionSmoothing";
import {
	createCursorFollowCameraState,
	type CursorFollowCameraState,
} from "../videoPlayback/cursorFollowCamera";
import { createMotionBlurState, type MotionBlurState } from "../videoPlayback/zoomTransform";
import { createPlaybackAnimationState, type VideoPlaybackRuntimeRefs } from "./shared";

interface UseVideoPlaybackRefsParams {
	frame: string | null;
	isPlaying: boolean;
	zoomRegions: ZoomRegion[];
	selectedZoomId: string | null;
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	zoomMotionBlur: number;
	connectZooms: boolean;
	zoomInDurationMs: number;
	zoomInOverlapMs: number;
	zoomOutDurationMs: number;
	connectedZoomGapMs: number;
	connectedZoomDurationMs: number;
	zoomInEasing: ZoomTransitionEasing;
	zoomOutEasing: ZoomTransitionEasing;
	connectedZoomEasing: ZoomTransitionEasing;
	cursorTelemetry: CursorTelemetryPoint[];
	showCursor: boolean;
	cursorStyle: CursorStyle;
	cursorSize: number;
	cursorSmoothing: number;
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
	cursorSway: number;
	zoomSmoothness: number;
	zoomClassicMode: boolean;
}

export function useVideoPlaybackRefs({
	frame,
	isPlaying,
	zoomRegions,
	selectedZoomId,
	trimRegions,
	speedRegions,
	zoomMotionBlur,
	connectZooms,
	zoomInDurationMs,
	zoomInOverlapMs,
	zoomOutDurationMs,
	connectedZoomGapMs,
	connectedZoomDurationMs,
	zoomInEasing,
	zoomOutEasing,
	connectedZoomEasing,
	cursorTelemetry,
	showCursor,
	cursorStyle,
	cursorSize,
	cursorSmoothing,
	cursorMotionBlur,
	cursorClickBounce,
	cursorClickBounceDuration,
	cursorSway,
	zoomSmoothness,
	zoomClassicMode,
}: UseVideoPlaybackRefsParams) {
	const [pixiReady, setPixiReady] = useState(false);
	const [videoReady, setVideoReady] = useState(false);
	const [resolvedWallpaper, setResolvedWallpaper] = useState<string | null>(null);
	const [resolvedWallpaperKind, setResolvedWallpaperKind] = useState<
		"image" | "video" | "style"
	>("image");

	const refs: VideoPlaybackRuntimeRefs = {
		videoRef: useRef<HTMLVideoElement | null>(null),
		containerRef: useRef<HTMLDivElement | null>(null),
		appRef: useRef<Application | null>(null),
		videoSpriteRef: useRef<Sprite | null>(null),
		videoContainerRef: useRef<Container | null>(null),
		cursorContainerRef: useRef<Container | null>(null),
		cameraContainerRef: useRef<Container | null>(null),
		timeUpdateAnimationRef: useRef<number | null>(null),
		overlayRef: useRef<HTMLDivElement | null>(null),
		focusIndicatorRef: useRef<HTMLDivElement | null>(null),
		webcamVideoRef: useRef<HTMLVideoElement | null>(null),
		webcamBubbleRef: useRef<HTMLDivElement | null>(null),
		webcamBubbleInnerRef: useRef<HTMLDivElement | null>(null),
		captionBoxRef: useRef<HTMLDivElement | null>(null),
		currentTimeRef: useRef(0),
		zoomRegionsRef: useRef(zoomRegions),
		selectedZoomIdRef: useRef<string | null>(selectedZoomId),
		animationStateRef: useRef(createPlaybackAnimationState()),
		blurFilterRef: useRef<BlurFilter | null>(null),
		motionBlurFilterRef: useRef<MotionBlurFilter | null>(null),
		isDraggingFocusRef: useRef(false),
		stageSizeRef: useRef({ width: 0, height: 0 }),
		videoSizeRef: useRef({ width: 0, height: 0 }),
		baseScaleRef: useRef(1),
		baseOffsetRef: useRef({ x: 0, y: 0 }),
		baseMaskRef: useRef({ x: 0, y: 0, width: 0, height: 0 }),
		cropBoundsRef: useRef({ startX: 0, endX: 0, startY: 0, endY: 0 }),
		maskGraphicsRef: useRef<Graphics | null>(null),
		frameSpriteRef: useRef<Sprite | null>(null),
		frameContainerRef: useRef<Container | null>(null),
		frameIdRef: useRef<string | null>(frame),
		isPlayingRef: useRef(isPlaying),
		isSeekingRef: useRef(false),
		allowPlaybackRef: useRef(false),
		lockedVideoDimensionsRef: useRef<{ width: number; height: number } | null>(null),
		layoutVideoContentRef: useRef<(() => void) | null>(null),
		trimRegionsRef: useRef<TrimRegion[]>(trimRegions),
		speedRegionsRef: useRef<SpeedRegion[]>(speedRegions),
		lastWebcamSyncTimeRef: useRef<number | null>(null),
		bgVideoRef: useRef<HTMLVideoElement | null>(null),
		zoomMotionBlurRef: useRef(zoomMotionBlur),
		connectZoomsRef: useRef(connectZooms),
		zoomInDurationMsRef: useRef(zoomInDurationMs),
		zoomInOverlapMsRef: useRef(zoomInOverlapMs),
		zoomOutDurationMsRef: useRef(zoomOutDurationMs),
		connectedZoomGapMsRef: useRef(connectedZoomGapMs),
		connectedZoomDurationMsRef: useRef(connectedZoomDurationMs),
		zoomInEasingRef: useRef(zoomInEasing),
		zoomOutEasingRef: useRef(zoomOutEasing),
		connectedZoomEasingRef: useRef(connectedZoomEasing),
		videoReadyRafRef: useRef<number | null>(null),
		cursorOverlayRef: useRef(null),
		cursorEffectsCanvasRef: useRef<HTMLCanvasElement | null>(null),
		cursorTelemetryRef: useRef(cursorTelemetry),
		showCursorRef: useRef(showCursor),
		cursorSizeRef: useRef(cursorSize),
		cursorStyleRef: useRef(cursorStyle),
		cursorSmoothingRef: useRef(cursorSmoothing),
		cursorMotionBlurRef: useRef(cursorMotionBlur),
		cursorClickBounceRef: useRef(cursorClickBounce),
		cursorClickBounceDurationRef: useRef(cursorClickBounceDuration),
		cursorSwayRef: useRef(cursorSway),
		lastEmittedClickTimeMsRef: useRef(-1),
		springScaleRef: useRef<SpringState>(createSpringState(1)),
		springXRef: useRef<SpringState>(createSpringState(0)),
		springYRef: useRef<SpringState>(createSpringState(0)),
		lastTickTimeRef: useRef<number | null>(null),
		zoomSmoothnessRef: useRef(zoomSmoothness),
		zoomClassicModeRef: useRef(zoomClassicMode),
		cursorFollowCameraRef: useRef<CursorFollowCameraState>(createCursorFollowCameraState()),
		motionBlurStateRef: useRef<MotionBlurState>(createMotionBlurState()),
	};

	return {
		refs,
		pixiReady,
		setPixiReady,
		videoReady,
		setVideoReady,
		resolvedWallpaper,
		setResolvedWallpaper,
		resolvedWallpaperKind,
		setResolvedWallpaperKind,
	};
}