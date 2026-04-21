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

	const videoRef = useRef<HTMLVideoElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const appRef = useRef<Application | null>(null);
	const videoSpriteRef = useRef<Sprite | null>(null);
	const videoContainerRef = useRef<Container | null>(null);
	const cursorContainerRef = useRef<Container | null>(null);
	const cameraContainerRef = useRef<Container | null>(null);
	const timeUpdateAnimationRef = useRef<number | null>(null);
	const overlayRef = useRef<HTMLDivElement | null>(null);
	const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
	const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
	const webcamBubbleRef = useRef<HTMLDivElement | null>(null);
	const webcamBubbleInnerRef = useRef<HTMLDivElement | null>(null);
	const captionBoxRef = useRef<HTMLDivElement | null>(null);
	const currentTimeRef = useRef(0);
	const zoomRegionsRef = useRef(zoomRegions);
	const selectedZoomIdRef = useRef<string | null>(selectedZoomId);
	const animationStateRef = useRef(createPlaybackAnimationState());
	const blurFilterRef = useRef<BlurFilter | null>(null);
	const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);
	const isDraggingFocusRef = useRef(false);
	const stageSizeRef = useRef({ width: 0, height: 0 });
	const videoSizeRef = useRef({ width: 0, height: 0 });
	const baseScaleRef = useRef(1);
	const baseOffsetRef = useRef({ x: 0, y: 0 });
	const baseMaskRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
	const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
	const maskGraphicsRef = useRef<Graphics | null>(null);
	const frameSpriteRef = useRef<Sprite | null>(null);
	const frameContainerRef = useRef<Container | null>(null);
	const frameIdRef = useRef<string | null>(frame);
	const isPlayingRef = useRef(isPlaying);
	const isSeekingRef = useRef(false);
	const allowPlaybackRef = useRef(false);
	const lockedVideoDimensionsRef = useRef<{ width: number; height: number } | null>(null);
	const layoutVideoContentRef = useRef<(() => void) | null>(null);
	const trimRegionsRef = useRef<TrimRegion[]>(trimRegions);
	const speedRegionsRef = useRef<SpeedRegion[]>(speedRegions);
	const lastWebcamSyncTimeRef = useRef<number | null>(null);
	const bgVideoRef = useRef<HTMLVideoElement | null>(null);
	const zoomMotionBlurRef = useRef(zoomMotionBlur);
	const connectZoomsRef = useRef(connectZooms);
	const zoomInDurationMsRef = useRef(zoomInDurationMs);
	const zoomInOverlapMsRef = useRef(zoomInOverlapMs);
	const zoomOutDurationMsRef = useRef(zoomOutDurationMs);
	const connectedZoomGapMsRef = useRef(connectedZoomGapMs);
	const connectedZoomDurationMsRef = useRef(connectedZoomDurationMs);
	const zoomInEasingRef = useRef(zoomInEasing);
	const zoomOutEasingRef = useRef(zoomOutEasing);
	const connectedZoomEasingRef = useRef(connectedZoomEasing);
	const videoReadyRafRef = useRef<number | null>(null);
	const cursorOverlayRef = useRef(null);
	const cursorEffectsCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const cursorTelemetryRef = useRef(cursorTelemetry);
	const showCursorRef = useRef(showCursor);
	const cursorSizeRef = useRef(cursorSize);
	const cursorStyleRef = useRef(cursorStyle);
	const cursorSmoothingRef = useRef(cursorSmoothing);
	const cursorMotionBlurRef = useRef(cursorMotionBlur);
	const cursorClickBounceRef = useRef(cursorClickBounce);
	const cursorClickBounceDurationRef = useRef(cursorClickBounceDuration);
	const cursorSwayRef = useRef(cursorSway);
	const lastEmittedClickTimeMsRef = useRef(-1);
	const springScaleRef = useRef<SpringState>(createSpringState(1));
	const springXRef = useRef<SpringState>(createSpringState(0));
	const springYRef = useRef<SpringState>(createSpringState(0));
	const lastTickTimeRef = useRef<number | null>(null);
	const zoomSmoothnessRef = useRef(zoomSmoothness);
	const zoomClassicModeRef = useRef(zoomClassicMode);
	const cursorFollowCameraRef = useRef<CursorFollowCameraState>(createCursorFollowCameraState());
	const motionBlurStateRef = useRef<MotionBlurState>(createMotionBlurState());

	const refsRef = useRef<VideoPlaybackRuntimeRefs | null>(null);
	if (!refsRef.current) {
		refsRef.current = {
			videoRef,
			containerRef,
			appRef,
			videoSpriteRef,
			videoContainerRef,
			cursorContainerRef,
			cameraContainerRef,
			timeUpdateAnimationRef,
			overlayRef,
			focusIndicatorRef,
			webcamVideoRef,
			webcamBubbleRef,
			webcamBubbleInnerRef,
			captionBoxRef,
			currentTimeRef,
			zoomRegionsRef,
			selectedZoomIdRef,
			animationStateRef,
			blurFilterRef,
			motionBlurFilterRef,
			isDraggingFocusRef,
			stageSizeRef,
			videoSizeRef,
			baseScaleRef,
			baseOffsetRef,
			baseMaskRef,
			cropBoundsRef,
			maskGraphicsRef,
			frameSpriteRef,
			frameContainerRef,
			frameIdRef,
			isPlayingRef,
			isSeekingRef,
			allowPlaybackRef,
			lockedVideoDimensionsRef,
			layoutVideoContentRef,
			trimRegionsRef,
			speedRegionsRef,
			lastWebcamSyncTimeRef,
			bgVideoRef,
			zoomMotionBlurRef,
			connectZoomsRef,
			zoomInDurationMsRef,
			zoomInOverlapMsRef,
			zoomOutDurationMsRef,
			connectedZoomGapMsRef,
			connectedZoomDurationMsRef,
			zoomInEasingRef,
			zoomOutEasingRef,
			connectedZoomEasingRef,
			videoReadyRafRef,
			cursorOverlayRef,
			cursorEffectsCanvasRef,
			cursorTelemetryRef,
			showCursorRef,
			cursorSizeRef,
			cursorStyleRef,
			cursorSmoothingRef,
			cursorMotionBlurRef,
			cursorClickBounceRef,
			cursorClickBounceDurationRef,
			cursorSwayRef,
			lastEmittedClickTimeMsRef,
			springScaleRef,
			springXRef,
			springYRef,
			lastTickTimeRef,
			zoomSmoothnessRef,
			zoomClassicModeRef,
			cursorFollowCameraRef,
			motionBlurStateRef,
		};
	}

	const refs = refsRef.current;

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