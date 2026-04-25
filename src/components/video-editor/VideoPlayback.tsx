import {
	Application,
	BlurFilter,
	Container,
	Graphics,
	Sprite,
	Texture,
	VideoSource,
} from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import type React from "react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import { clampMediaTimeToDuration } from "@/lib/mediaTiming";
import {
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { buildActiveCaptionLayout } from "./captionLayout";
import {
	CAPTION_FONT_WEIGHT,
	CAPTION_LINE_HEIGHT,
	getCaptionPadding,
	getCaptionScaledFontSize,
	getCaptionScaledRadius,
	getCaptionTextMaxWidth,
	getCaptionWordVisualState,
} from "./captionStyle";
import {
	type AnnotationRegion,
	type AutoCaptionSettings,
	type CaptionCue,
	type CursorStyle,
	type Padding,
	type SpeedRegion,
	type TrimRegion,
	type WebcamOverlaySettings,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
	type ZoomTransitionEasing,
} from "./types";
import { DEFAULT_FOCUS } from "./videoPlayback/constants";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "./videoPlayback/cursorRenderer";
import { clamp01 } from "./videoPlayback/mathUtils";
import {
	createSpringState,
	getZoomSpringConfig,
	resetSpringState,
	type SpringState,
	stepSpringValue,
} from "./videoPlayback/motionSmoothing";

function getContributedCursorStylesSignature() {
	return extensionHost
		.getContributedCursorStyles()
		.map(
			(cursorStyle) =>
				`${cursorStyle.id}:${cursorStyle.resolvedDefaultUrl}:${cursorStyle.resolvedClickUrl ?? ""}:${cursorStyle.cursorStyle.hotspot?.x ?? ""}:${cursorStyle.cursorStyle.hotspot?.y ?? ""}`,
		)
		.sort()
		.join("|");
}

import { extensionHost } from "@/lib/extensions";
import {
	mapCursorToCanvasNormalized,
	mapSmoothedCursorToCanvasNormalized,
} from "@/lib/extensions/cursorCoordinates";
import {
	clearCursorEffects,
	executeExtensionCursorEffects,
	executeExtensionRenderHooks,
	notifyCursorInteraction,
} from "@/lib/extensions/renderHooks";
import { applyCanvasSceneTransform } from "@/lib/extensions/sceneTransform";
import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import { type AspectRatio, formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import {
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_PADDING,
	DEFAULT_WEBCAM_CORNER_RADIUS,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
	getDefaultCaptionFontFamily,
} from "./types";
import {
	type CursorFollowCameraState,
	computeCursorFollowFocus,
	createCursorFollowCameraState,
	resetCursorFollowCamera,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "./videoPlayback/cursorFollowCamera";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";
import { getWebcamPreviewTargetTimeSeconds } from "./videoPlayback/webcamSync";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import {
	applyZoomTransform,
	computeFocusFromTransform,
	computeZoomTransform,
	createMotionBlurState,
	type MotionBlurState,
} from "./videoPlayback/zoomTransform";
import { getWebcamOverlayPosition, getWebcamOverlaySizePx } from "./webcamOverlay";

type PlaybackAnimationState = {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
};

function createPlaybackAnimationState(): PlaybackAnimationState {
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

function getCursorPositionAtTime(
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

function getEffectiveNativeAspectRatio(
	dimensions: { width: number; height: number } | null | undefined,
	cropRegion?: import("./types").CropRegion,
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

interface VideoPlaybackProps {
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
	padding?: Padding | number;
	frame?: string | null;
	cropRegion?: import("./types").CropRegion;
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

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(
	(
		{
			videoPath,
			onDurationChange,
			onPreviewReadyChange,
			onTimeUpdate,
			currentTime,
			onPlayStateChange,
			onError,
			wallpaper,
			zoomRegions,
			selectedZoomId,
			onSelectZoom,
			onZoomFocusChange,
			isPlaying,
			showShadow,
			shadowIntensity = 0,
			backgroundBlur = 0,
			zoomMotionBlur = 0,
			connectZooms = true,
			zoomInDurationMs = DEFAULT_ZOOM_IN_DURATION_MS,
			zoomInOverlapMs = DEFAULT_ZOOM_IN_OVERLAP_MS,
			zoomOutDurationMs = DEFAULT_ZOOM_OUT_DURATION_MS,
			connectedZoomGapMs = DEFAULT_CONNECTED_ZOOM_GAP_MS,
			connectedZoomDurationMs = DEFAULT_CONNECTED_ZOOM_DURATION_MS,
			zoomInEasing = DEFAULT_ZOOM_IN_EASING,
			zoomOutEasing = DEFAULT_ZOOM_OUT_EASING,
			connectedZoomEasing = DEFAULT_CONNECTED_ZOOM_EASING,
			borderRadius = 0,
			padding = DEFAULT_PADDING,
			frame = null,
			cropRegion,
			webcam,
			webcamVideoPath,
			trimRegions = [],
			speedRegions = [],
			aspectRatio,
			annotationRegions = [],
			autoCaptions = [],
			autoCaptionSettings,
			selectedAnnotationId,
			onSelectAnnotation,
			onAnnotationPositionChange,
			onAnnotationSizeChange,
			cursorTelemetry = [],
			showCursor = false,
			cursorStyle = "tahoe",
			cursorSize = DEFAULT_CURSOR_SIZE,
			cursorSmoothing = DEFAULT_CURSOR_SMOOTHING,
			zoomSmoothness = 0.5,
			zoomClassicMode = false,
			cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
			cursorClickBounce = DEFAULT_CURSOR_CLICK_BOUNCE,
			cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
			cursorSway = DEFAULT_CURSOR_SWAY,
			volume = 1,
		},
		ref,
	) => {
		const videoRef = useRef<HTMLVideoElement | null>(null);
		const containerRef = useRef<HTMLDivElement | null>(null);
		const appRef = useRef<Application | null>(null);
		const videoSpriteRef = useRef<Sprite | null>(null);
		const videoContainerRef = useRef<Container | null>(null);
		const cursorContainerRef = useRef<Container | null>(null);
		const cameraContainerRef = useRef<Container | null>(null);
		const timeUpdateAnimationRef = useRef<number | null>(null);
		const [pixiReady, setPixiReady] = useState(false);
		const [videoReady, setVideoReady] = useState(false);
		const overlayRef = useRef<HTMLDivElement | null>(null);
		const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
		const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
		const webcamBubbleRef = useRef<HTMLDivElement | null>(null);
		const webcamBubbleInnerRef = useRef<HTMLDivElement | null>(null);
		const captionBoxRef = useRef<HTMLDivElement | null>(null);
		const currentTimeRef = useRef(0);
		const zoomRegionsRef = useRef<ZoomRegion[]>([]);
		const selectedZoomIdRef = useRef<string | null>(null);
		const animationStateRef = useRef<PlaybackAnimationState>(createPlaybackAnimationState());
		const blurFilterRef = useRef<BlurFilter | null>(null);
		const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);
		const isDraggingFocusRef = useRef(false);
		const stageSizeRef = useRef({ width: 0, height: 0 });
		const videoSizeRef = useRef({ width: 0, height: 0 });
		const baseScaleRef = useRef(1);
		const baseOffsetRef = useRef({ x: 0, y: 0 });
		const baseMaskRef = useRef<{
			x: number;
			y: number;
			width: number;
			height: number;
			sourceCrop?: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
		}>({ x: 0, y: 0, width: 0, height: 0 });
		const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
		const maskGraphicsRef = useRef<Graphics | null>(null);
		const frameSpriteRef = useRef<Sprite | null>(null);
		const frameContainerRef = useRef<Container | null>(null);
		const frameIdRef = useRef<string | null>(frame);
		const isPlayingRef = useRef(isPlaying);
		const isSeekingRef = useRef(false);
		const allowPlaybackRef = useRef(false);
		const lockedVideoDimensionsRef = useRef<{
			width: number;
			height: number;
		} | null>(null);
		const layoutVideoContentRef = useRef<(() => void) | null>(null);
		const trimRegionsRef = useRef<TrimRegion[]>([]);
		const speedRegionsRef = useRef<SpeedRegion[]>([]);
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
		const cursorOverlayRef = useRef<PixiCursorOverlay | null>(null);
		const cursorEffectsCanvasRef = useRef<HTMLCanvasElement | null>(null);
		const cursorTelemetryRef = useRef<CursorTelemetryPoint[]>([]);
		const showCursorRef = useRef(showCursor);
		const cursorSizeRef = useRef(cursorSize);
		const cursorStyleRef = useRef(cursorStyle);
		const cursorSmoothingRef = useRef(cursorSmoothing);
		const cursorMotionBlurRef = useRef(cursorMotionBlur);
		const cursorClickBounceRef = useRef(cursorClickBounce);
		const cursorClickBounceDurationRef = useRef(cursorClickBounceDuration);
		const cursorSwayRef = useRef(cursorSway);
		const lastEmittedClickTimeMsRef = useRef(-1);

		// Spring animation state for smooth zoom transitions
		const springScaleRef = useRef<SpringState>(createSpringState(1));
		const springXRef = useRef<SpringState>(createSpringState(0));
		const springYRef = useRef<SpringState>(createSpringState(0));
		const lastTickTimeRef = useRef<number | null>(null);
		const zoomSmoothnessRef = useRef(zoomSmoothness);
		const zoomClassicModeRef = useRef(zoomClassicMode);
		const cursorFollowCameraRef = useRef<CursorFollowCameraState>(
			createCursorFollowCameraState(),
		);

		const activeCaptionLayout = useMemo(() => {
			if (
				!autoCaptionSettings?.enabled ||
				autoCaptions.length === 0 ||
				typeof document === "undefined"
			) {
				return null;
			}

			const overlayWidth = overlayRef.current?.clientWidth || 960;
			const fontSize = getCaptionScaledFontSize(
				autoCaptionSettings.fontSize,
				overlayWidth,
				autoCaptionSettings.maxWidth,
			);
			const maxTextWidthPx = getCaptionTextMaxWidth(
				overlayWidth,
				autoCaptionSettings.maxWidth,
				fontSize,
			);
			const measurementCanvas = document.createElement("canvas");
			const measurementContext = measurementCanvas.getContext("2d");
			if (!measurementContext) {
				return null;
			}

			measurementContext.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${getDefaultCaptionFontFamily()}`;

			return buildActiveCaptionLayout({
				cues: autoCaptions,
				timeMs: Math.round(currentTime * 1000),
				settings: autoCaptionSettings,
				maxWidthPx: maxTextWidthPx,
				measureText: (text) => measurementContext.measureText(text).width,
			});
		}, [autoCaptionSettings, autoCaptions, currentTime]);

		useEffect(() => {
			const captionBox = captionBoxRef.current;
			if (!captionBox || !activeCaptionLayout || !autoCaptionSettings) {
				if (captionBox) {
					captionBox.style.clipPath = "";
					captionBox.style.removeProperty("-webkit-clip-path");
				}
				return;
			}

			const frame = requestAnimationFrame(() => {
				const width = captionBox.offsetWidth;
				const height = captionBox.offsetHeight;
				if (width <= 0 || height <= 0) {
					return;
				}

				const fontSize = getCaptionScaledFontSize(
					autoCaptionSettings.fontSize,
					overlayRef.current?.clientWidth || 960,
					autoCaptionSettings.maxWidth,
				);

				const squirclePath = getSquircleSvgPath({
					x: 0,
					y: 0,
					width,
					height,
					radius: getCaptionScaledRadius(autoCaptionSettings.boxRadius, fontSize),
				});
				captionBox.style.clipPath = `path('${squirclePath}')`;
				captionBox.style.setProperty("-webkit-clip-path", `path('${squirclePath}')`);
			});

			return () => cancelAnimationFrame(frame);
		}, [activeCaptionLayout, autoCaptionSettings]);
		const motionBlurStateRef = useRef<MotionBlurState>(createMotionBlurState());

		const applyWebcamBubbleLayout = useCallback(
			(zoomScale: number) => {
				const bubble = webcamBubbleRef.current;
				const bubbleInner = webcamBubbleInnerRef.current;
				const overlay = overlayRef.current;
				if (!bubble || !bubbleInner || !overlay || !webcam?.enabled || !webcamVideoPath) {
					if (bubble) {
						bubble.style.display = "none";
					}
					return;
				}

				const margin = webcam.margin ?? 24;
				const scaledSize = getWebcamOverlaySizePx({
					containerWidth: overlay.clientWidth,
					containerHeight: overlay.clientHeight,
					sizePercent: webcam.size ?? DEFAULT_WEBCAM_SIZE,
					margin,
					zoomScale,
					reactToZoom: webcam.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM,
				});
				const { x, y } = getWebcamOverlayPosition({
					containerWidth: overlay.clientWidth,
					containerHeight: overlay.clientHeight,
					size: scaledSize,
					margin,
					positionPreset: webcam.positionPreset ?? webcam.corner,
					positionX: webcam.positionX ?? 1,
					positionY: webcam.positionY ?? 1,
					legacyCorner: webcam.corner,
				});

				bubble.style.display = "block";
				bubble.style.left = `${x}px`;
				bubble.style.top = `${y}px`;
				bubble.style.width = `${scaledSize}px`;
				bubble.style.height = `${scaledSize}px`;
				const squirclePath = getSquircleSvgPath({
					x: 0,
					y: 0,
					width: scaledSize,
					height: scaledSize,
					radius: webcam.cornerRadius ?? DEFAULT_WEBCAM_CORNER_RADIUS,
				});
				bubble.style.filter = `drop-shadow(0 ${Math.round(scaledSize * 0.06)}px ${Math.round(
					scaledSize * 0.22,
				)}px rgba(0, 0, 0, ${webcam.shadow ?? DEFAULT_WEBCAM_SHADOW}))`;
				bubble.style.borderRadius = "0px";
				bubble.style.boxShadow = "none";

				bubbleInner.style.borderRadius = "0px";
				bubbleInner.style.clipPath = `path('${squirclePath}')`;
				bubbleInner.style.setProperty("-webkit-clip-path", `path('${squirclePath}')`);
			},
			[webcam, webcamVideoPath],
		);

		const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
			return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
		}, []);

		const updateOverlayForRegion = useCallback(
			(region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
				const overlayEl = overlayRef.current;
				const indicatorEl = focusIndicatorRef.current;

				if (!overlayEl || !indicatorEl) {
					return;
				}

				// Update stage size from overlay dimensions
				const stageWidth = overlayEl.clientWidth;
				const stageHeight = overlayEl.clientHeight;
				if (stageWidth && stageHeight) {
					stageSizeRef.current = { width: stageWidth, height: stageHeight };
				}

				updateOverlayIndicator({
					overlayEl,
					indicatorEl,
					region,
					focusOverride,
					baseMask: baseMaskRef.current,
					isPlaying: isPlayingRef.current,
				});
			},
			[],
		);

		const layoutVideoContent = useCallback(() => {
			const container = containerRef.current;
			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const maskGraphics = maskGraphicsRef.current;
			const videoElement = videoRef.current;
			const cameraContainer = cameraContainerRef.current;

			if (
				!container ||
				!app ||
				!videoSprite ||
				!maskGraphics ||
				!videoElement ||
				!cameraContainer
			) {
				return;
			}

			// Lock video dimensions on first layout to prevent resize issues
			if (
				!lockedVideoDimensionsRef.current &&
				videoElement.videoWidth > 0 &&
				videoElement.videoHeight > 0
			) {
				lockedVideoDimensionsRef.current = {
					width: videoElement.videoWidth,
					height: videoElement.videoHeight,
				};
			}

			// Look up device frame insets so layout centers the full frame (video + bezels)
			let frameInsets: { top: number; right: number; bottom: number; left: number } | null =
				null;
			if (frame) {
				const frames = extensionHost.getFrames();
				const frameData = frames.find((f) => f.id === frame);
				if (frameData?.screenInsets) {
					frameInsets = frameData.screenInsets;
				}
			}

			const result = layoutVideoContentUtil({
				container,
				app,
				videoSprite,
				maskGraphics,
				videoElement,
				cropRegion,
				lockedVideoDimensions: lockedVideoDimensionsRef.current,
				borderRadius,
				padding,
				frameInsets,
			});

			if (result) {
				stageSizeRef.current = result.stageSize;
				videoSizeRef.current = result.videoSize;
				baseScaleRef.current = result.baseScale;
				baseOffsetRef.current = result.baseOffset;
				baseMaskRef.current = result.maskRect;
				cropBoundsRef.current = result.cropBounds;

				// Sync extension cursor effects canvas resolution with renderer
				const effectsCanvas = cursorEffectsCanvasRef.current;
				if (effectsCanvas) {
					const w = result.stageSize.width;
					const h = result.stageSize.height;
					if (effectsCanvas.width !== w || effectsCanvas.height !== h) {
						effectsCanvas.width = w;
						effectsCanvas.height = h;
					}
				}

				// Push layout info to extension host for query APIs
				extensionHost.setVideoLayout({
					maskRect: {
						x: result.maskRect.x,
						y: result.maskRect.y,
						width: result.maskRect.width,
						height: result.maskRect.height,
					},
					canvasWidth: result.stageSize.width,
					canvasHeight: result.stageSize.height,
					borderRadius,
					padding,
				});
				extensionHost.setShadowConfig({
					enabled: Boolean(showShadow) && shadowIntensity > 0,
					intensity: shadowIntensity,
				});

				// Position device frame sprite to fill the stage
				const frameSprite = frameSpriteRef.current;
				if (frameSprite && frame) {
					const frames = extensionHost.getFrames();
					const frameData = frames.find((f) => f.id === frame);
					if (frameData) {
						const maskRect = result.maskRect;
						const insets = frameData.screenInsets;
						if (insets) {
							// Frame is larger than screen area — compute full frame size from insets
							const screenW = maskRect.width;
							const screenH = maskRect.height;
							const frameW = screenW / (1 - insets.left - insets.right);
							const frameH = screenH / (1 - insets.top - insets.bottom);
							const frameX = maskRect.x - insets.left * frameW;
							const frameY = maskRect.y - insets.top * frameH;
							frameSprite.position.set(frameX, frameY);
							frameSprite.width = frameW;
							frameSprite.height = frameH;
						} else {
							frameSprite.position.set(maskRect.x, maskRect.y);
							frameSprite.width = maskRect.width;
							frameSprite.height = maskRect.height;
						}
					}
				}

				// Reset camera container to identity
				cameraContainer.scale.set(1);
				cameraContainer.position.set(0, 0);

				const selectedId = selectedZoomIdRef.current;
				const activeRegion = selectedId
					? (zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null)
					: null;

				updateOverlayForRegion(activeRegion);
				applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
			}
		}, [
			updateOverlayForRegion,
			cropRegion,
			borderRadius,
			padding,
			frame,
			showShadow,
			shadowIntensity,
			applyWebcamBubbleLayout,
		]);

		useEffect(() => {
			const video = videoRef.current;
			if (!video) return;

			const nextVolume = Math.max(0, Math.min(1, volume));
			video.volume = nextVolume;
			video.muted = nextVolume <= 0.001;
		}, [volume, videoPath]);

		useEffect(() => {
			layoutVideoContentRef.current = layoutVideoContent;
		}, [layoutVideoContent]);

		// Sync device frame ref
		useEffect(() => {
			frameIdRef.current = frame;
			extensionHost.setActiveFrame(frame ?? null);
		}, [frame]);

		// Manage device frame sprite
		useEffect(() => {
			const frameContainer = frameContainerRef.current;
			if (!frameContainer) return;

			// Clear existing frame sprite
			if (frameSpriteRef.current) {
				frameContainer.removeChild(frameSpriteRef.current);
				frameSpriteRef.current.destroy();
				frameSpriteRef.current = null;
			}

			if (!frame) {
				layoutVideoContentRef.current?.();
				return;
			}

			let cancelled = false;

			function tryLoadFrame() {
				if (cancelled) return;
				const container = frameContainerRef.current;
				if (!container) return false;
				const frames = extensionHost.getFrames();
				const frameData = frames.find((f) => f.id === frame);
				if (!frameData) return false;

				if (frameData.draw) {
					// Resolution-independent: draw at a reasonable size, Pixi handles the rest
					const drawW = 1920;
					const drawH = 1080;
					const canvas = document.createElement("canvas");
					canvas.width = drawW;
					canvas.height = drawH;
					const ctx = canvas.getContext("2d");
					if (ctx) frameData.draw(ctx, drawW, drawH);
					if (cancelled || frameIdRef.current !== frame) return true;
					const texture = Texture.from(canvas);
					const sprite = new Sprite(texture);
					frameSpriteRef.current = sprite;
					container.addChild(sprite);
					layoutVideoContentRef.current?.();
				} else {
					const img = new Image();
					img.onload = () => {
						if (cancelled || frameIdRef.current !== frame) return;
						const texture = Texture.from(img);
						const sprite = new Sprite(texture);
						frameSpriteRef.current = sprite;
						container.addChild(sprite);
						layoutVideoContentRef.current?.();
					};
					img.src = frameData.filePath;
				}
				return true;
			}

			// Try immediately; if extension hasn't registered frames yet,
			// listen for changes and retry once they become available.
			if (!tryLoadFrame()) {
				const unsub = extensionHost.onChange(() => {
					if (tryLoadFrame()) unsub();
				});
				return () => {
					cancelled = true;
					unsub();
				};
			}

			return () => {
				cancelled = true;
			};
		}, [frame]);

		const selectedZoom = useMemo(() => {
			if (!selectedZoomId) return null;
			return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
		}, [zoomRegions, selectedZoomId]);

		useImperativeHandle(ref, () => ({
			video: videoRef.current,
			app: appRef.current,
			videoSprite: videoSpriteRef.current,
			videoContainer: videoContainerRef.current,
			containerRef,
			play: async () => {
				const vid = videoRef.current;
				if (!vid) return;
				try {
					allowPlaybackRef.current = true;
					await vid.play();
				} catch (error) {
					allowPlaybackRef.current = false;
					throw error;
				}
			},
			pause: () => {
				const video = videoRef.current;
				allowPlaybackRef.current = false;
				if (!video) {
					return;
				}
				video.pause();
			},
			refreshFrame: async () => {
				const video = videoRef.current;
				if (!video || Number.isNaN(video.currentTime)) {
					return;
				}

				const restoreTime = video.currentTime;
				const duration = Number.isFinite(video.duration) ? video.duration : 0;
				const epsilon =
					duration > 0 ? Math.min(1 / 120, duration / 1000 || 1 / 120) : 1 / 120;
				const nudgeTarget =
					restoreTime > epsilon
						? restoreTime - epsilon
						: Math.min(duration || restoreTime + epsilon, restoreTime + epsilon);

				if (Math.abs(nudgeTarget - restoreTime) < 0.000001) {
					return;
				}

				await new Promise<void>((resolve) => {
					const handleFirstSeeked = () => {
						video.removeEventListener("seeked", handleFirstSeeked);
						const handleSecondSeeked = () => {
							video.removeEventListener("seeked", handleSecondSeeked);
							video.pause();
							resolve();
						};

						video.addEventListener("seeked", handleSecondSeeked, {
							once: true,
						});
						video.currentTime = restoreTime;
					};

					video.addEventListener("seeked", handleFirstSeeked, { once: true });
					video.currentTime = nudgeTarget;
				});
			},
		}));

		const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
			const overlayEl = overlayRef.current;
			if (!overlayEl) return;

			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;

			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region) return;

			const rect = overlayEl.getBoundingClientRect();
			const stageWidth = rect.width;
			const stageHeight = rect.height;

			if (!stageWidth || !stageHeight) {
				return;
			}

			stageSizeRef.current = { width: stageWidth, height: stageHeight };

			const localX = clientX - rect.left;
			const localY = clientY - rect.top;
			const baseMask = baseMaskRef.current;

			const unclampedFocus: ZoomFocus = {
				cx: clamp01((localX - baseMask.x) / Math.max(1, baseMask.width)),
				cy: clamp01((localY - baseMask.y) / Math.max(1, baseMask.height)),
			};
			const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

			onZoomFocusChange(region.id, clampedFocus);
			updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
		};

		const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
			if (isPlayingRef.current) return;
			const regionId = selectedZoomIdRef.current;
			if (!regionId) return;
			const region = zoomRegionsRef.current.find((r) => r.id === regionId);
			if (!region || region.mode !== "manual") return;
			onSelectZoom(region.id);
			event.preventDefault();
			isDraggingFocusRef.current = true;
			event.currentTarget.setPointerCapture(event.pointerId);
			updateFocusFromClientPoint(event.clientX, event.clientY);
		};

		const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
			if (!isDraggingFocusRef.current) return;
			event.preventDefault();
			updateFocusFromClientPoint(event.clientX, event.clientY);
		};

		const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
			if (!isDraggingFocusRef.current) return;
			isDraggingFocusRef.current = false;
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				/* Pointer capture may already be released during drag cleanup. */
			}
		};

		const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
			endFocusDrag(event);
		};

		const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
			endFocusDrag(event);
		};

		useEffect(() => {
			zoomRegionsRef.current = zoomRegions;
		}, [zoomRegions]);

		useEffect(() => {
			selectedZoomIdRef.current = selectedZoomId;
		}, [selectedZoomId]);

		useEffect(() => {
			isPlayingRef.current = isPlaying;
			extensionHost.emitEvent({
				type: isPlaying ? "playback:play" : "playback:pause",
				timeMs: currentTimeRef.current,
			});
			// Snap springs to current position when pausing so scrubbing is instant
			if (!isPlaying) {
				resetSpringState(springScaleRef.current);
				resetSpringState(springXRef.current);
				resetSpringState(springYRef.current);
				resetCursorFollowCamera(cursorFollowCameraRef.current);
				lastTickTimeRef.current = null;
			}
			const bgVideo = bgVideoRef.current;
			if (bgVideo) {
				if (isPlaying) {
					bgVideo.play().catch(() => undefined);
				} else {
					bgVideo.pause();
				}
			}
		}, [isPlaying]);

		// Sync background video wallpaper with timeline scrubbing
		useEffect(() => {
			const bgVideo = bgVideoRef.current;
			if (!bgVideo) return;
			if (!isPlaying && bgVideo.duration && Number.isFinite(bgVideo.duration)) {
				bgVideo.currentTime = currentTime % bgVideo.duration;
			}
		}, [currentTime, isPlaying]);

		useEffect(() => {
			trimRegionsRef.current = trimRegions;
		}, [trimRegions]);

		useEffect(() => {
			speedRegionsRef.current = speedRegions;
		}, [speedRegions]);

		useEffect(() => {
			zoomMotionBlurRef.current = zoomMotionBlur;
		}, [zoomMotionBlur]);

		useEffect(() => {
			connectZoomsRef.current = connectZooms;
		}, [connectZooms]);

		useEffect(() => {
			zoomInDurationMsRef.current = zoomInDurationMs;
		}, [zoomInDurationMs]);

		useEffect(() => {
			zoomInOverlapMsRef.current = zoomInOverlapMs;
		}, [zoomInOverlapMs]);

		useEffect(() => {
			zoomOutDurationMsRef.current = zoomOutDurationMs;
		}, [zoomOutDurationMs]);

		useEffect(() => {
			connectedZoomGapMsRef.current = connectedZoomGapMs;
		}, [connectedZoomGapMs]);

		useEffect(() => {
			connectedZoomDurationMsRef.current = connectedZoomDurationMs;
		}, [connectedZoomDurationMs]);

		useEffect(() => {
			zoomInEasingRef.current = zoomInEasing;
		}, [zoomInEasing]);

		useEffect(() => {
			zoomOutEasingRef.current = zoomOutEasing;
		}, [zoomOutEasing]);

		useEffect(() => {
			connectedZoomEasingRef.current = connectedZoomEasing;
		}, [connectedZoomEasing]);

		useEffect(() => {
			cursorTelemetryRef.current = cursorTelemetry;
			// Push to extension host for query APIs
			extensionHost.setCursorTelemetry(
				cursorTelemetry.map((p) => ({
					timeMs: p.timeMs,
					cx: p.cx,
					cy: p.cy,
					interactionType: p.interactionType,
					pressure: p.pressure,
				})),
			);
		}, [cursorTelemetry]);

		useEffect(() => {
			showCursorRef.current = showCursor;
		}, [showCursor]);

		useEffect(() => {
			cursorStyleRef.current = cursorStyle;
		}, [cursorStyle]);

		useEffect(() => {
			cursorSizeRef.current = cursorSize;
		}, [cursorSize]);

		useEffect(() => {
			cursorSmoothingRef.current = cursorSmoothing;
		}, [cursorSmoothing]);

		useEffect(() => {
			zoomSmoothnessRef.current = zoomSmoothness;
		}, [zoomSmoothness]);

		useEffect(() => {
			zoomClassicModeRef.current = zoomClassicMode;
		}, [zoomClassicMode]);

		useEffect(() => {
			cursorMotionBlurRef.current = cursorMotionBlur;
		}, [cursorMotionBlur]);

		useEffect(() => {
			cursorClickBounceRef.current = cursorClickBounce;
		}, [cursorClickBounce]);

		useEffect(() => {
			cursorClickBounceDurationRef.current = cursorClickBounceDuration;
		}, [cursorClickBounceDuration]);

		useEffect(() => {
			cursorSwayRef.current = cursorSway;
		}, [cursorSway]);

		useEffect(() => {
			const timeMs = currentTime * 1000;
			currentTimeRef.current = timeMs;
			const videoInfo = extensionHost.getVideoInfoSnapshot();
			extensionHost.setPlaybackState({
				currentTimeMs: timeMs,
				durationMs: videoInfo?.durationMs ?? 0,
				isPlaying,
			});
		}, [currentTime, isPlaying]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const cameraContainer = cameraContainerRef.current;
			const video = videoRef.current;

			if (!app || !cameraContainer || !video) return;

			const tickerWasStarted = app.ticker?.started || false;
			if (tickerWasStarted && app.ticker) {
				app.ticker.stop();
			}

			const wasPlaying = !video.paused;
			if (wasPlaying) {
				video.pause();
			}

			animationStateRef.current = createPlaybackAnimationState();
			cursorOverlayRef.current?.reset();
			motionBlurStateRef.current = createMotionBlurState();

			if (blurFilterRef.current) {
				blurFilterRef.current.blur = 0;
			}

			requestAnimationFrame(() => {
				const container = cameraContainerRef.current;
				const videoStage = videoContainerRef.current;
				const sprite = videoSpriteRef.current;
				const currentApp = appRef.current;
				if (!container || !videoStage || !sprite || !currentApp) {
					return;
				}

				container.scale.set(1);
				container.position.set(0, 0);
				videoStage.scale.set(1);
				videoStage.position.set(0, 0);
				sprite.scale.set(1);
				sprite.position.set(0, 0);

				layoutVideoContent();

				applyZoomTransform({
					cameraContainer: container,
					blurFilter: blurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: 1,
					focusX: DEFAULT_FOCUS.cx,
					focusY: DEFAULT_FOCUS.cy,
					motionIntensity: 0,
					isPlaying: false,
					motionBlurAmount: zoomMotionBlurRef.current,
				});

				requestAnimationFrame(() => {
					const finalApp = appRef.current;
					if (wasPlaying && video) {
						video.play().catch(() => undefined);
					}
					if (tickerWasStarted && finalApp?.ticker) {
						finalApp.ticker.start();
					}
				});
			});
		}, [pixiReady, videoReady, layoutVideoContent, cropRegion]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			const container = containerRef.current;
			if (!container) return;

			if (typeof ResizeObserver === "undefined") {
				return;
			}

			const observer = new ResizeObserver(() => {
				layoutVideoContent();
			});

			observer.observe(container);
			return () => {
				observer.disconnect();
			};
		}, [pixiReady, videoReady, layoutVideoContent]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			updateOverlayForRegion(selectedZoom);
		}, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;
			applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
		}, [applyWebcamBubbleLayout, pixiReady, videoReady, webcam, webcamVideoPath]);

		useEffect(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcam?.enabled || !webcamVideoPath) {
				return;
			}

			const targetTime = getWebcamPreviewTargetTimeSeconds({
				currentTime,
				webcamDuration: Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null,
				timeOffsetMs: webcam.timeOffsetMs,
			});

			const activeSpeedRegion = speedRegionsRef.current.find(
				(region) => targetTime * 1000 >= region.startMs && targetTime * 1000 < region.endMs,
			);
			const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
			if (Math.abs(webcamVideo.playbackRate - targetPlaybackRate) > 0.001) {
				webcamVideo.playbackRate = targetPlaybackRate;
			}

			const previousTimelineTime = lastWebcamSyncTimeRef.current;
			const timelineJumped =
				previousTimelineTime === null || Math.abs(targetTime - previousTimelineTime) > 0.25;
			const driftThreshold = isPlaying ? 0.35 : 0.01;
			if (timelineJumped || Math.abs(webcamVideo.currentTime - targetTime) > driftThreshold) {
				try {
					webcamVideo.currentTime = targetTime;
				} catch {
					// no-op
				}
			}

			if (isPlaying) {
				const playPromise = webcamVideo.play();
				if (playPromise) {
					playPromise.catch(() => undefined);
				}
			} else {
				webcamVideo.pause();
			}

			lastWebcamSyncTimeRef.current = targetTime;
		}, [currentTime, isPlaying, webcam, webcamVideoPath]);

		useEffect(() => {
			lastWebcamSyncTimeRef.current = null;
		}, [webcamVideoPath]);

		useEffect(() => {
			const overlayEl = overlayRef.current;
			if (!overlayEl) return;
			if (!selectedZoom || selectedZoom.mode !== "manual") {
				overlayEl.style.cursor = "default";
				overlayEl.style.pointerEvents = "none";
				return;
			}
			overlayEl.style.cursor = isPlaying ? "not-allowed" : "crosshair";
			overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
		}, [selectedZoom, isPlaying]);

		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			let mounted = true;
			let app: Application | null = null;

			(async () => {
				let cursorOverlayEnabled = true;
				try {
					await preloadCursorAssets();
				} catch (error) {
					cursorOverlayEnabled = false;
					console.warn(
						"Native cursor assets are unavailable in preview; continuing without cursor overlay.",
						error,
					);
				}

				app = new Application();

				await app.init({
					width: container.clientWidth,
					height: container.clientHeight,
					backgroundAlpha: 0,
					antialias: true,
					failIfMajorPerformanceCaveat: false,
					resolution: window.devicePixelRatio || 1,
					autoDensity: true,
					preference: "webgl",
				});

				app.ticker.maxFPS = 60;

				if (!mounted) {
					app.destroy(true, {
						children: true,
						texture: false,
						textureSource: false,
					});
					return;
				}

				appRef.current = app;
				container.appendChild(app.canvas);

				// Camera container - this will be scaled/positioned for zoom
				const cameraContainer = new Container();
				cameraContainerRef.current = cameraContainer;
				app.stage.addChild(cameraContainer);

				// Video container - holds the masked video sprite
				const videoContainer = new Container();
				videoContainerRef.current = videoContainer;
				cameraContainer.addChild(videoContainer);

				// Device frame overlay container — sits above video but below cursor
				const frameContainer = new Container();
				frameContainerRef.current = frameContainer;
				cameraContainer.addChild(frameContainer);

				const cursorContainer = new Container();
				cursorContainerRef.current = cursorContainer;
				cameraContainer.addChild(cursorContainer);

				// Cursor overlay - rendered above the masked video so it can sit in front
				// of the content without getting clipped.
				if (cursorOverlayEnabled) {
					const cursorOverlay = new PixiCursorOverlay({
						dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * cursorSizeRef.current,
						style: cursorStyleRef.current,
						smoothingFactor: cursorSmoothingRef.current,
						motionBlur: cursorMotionBlurRef.current,
						clickBounce: cursorClickBounceRef.current,
						clickBounceDuration: cursorClickBounceDurationRef.current,
						sway: cursorSwayRef.current,
					});
					cursorOverlayRef.current = cursorOverlay;
					cursorContainer.addChild(cursorOverlay.container);
				} else {
					cursorOverlayRef.current = null;
				}

				setPixiReady(true);
			})().catch((error) => {
				console.error("Failed to initialize preview renderer:", error);
				onError(
					error instanceof Error
						? error.message
						: "Failed to initialize preview renderer",
				);
			});

			return () => {
				mounted = false;
				setPixiReady(false);
				if (cursorOverlayRef.current) {
					cursorOverlayRef.current.destroy();
					cursorOverlayRef.current = null;
				}
				if (app && app.renderer) {
					app.destroy(true, {
						children: true,
						texture: false,
						textureSource: false,
					});
				}
				appRef.current = null;
				cameraContainerRef.current = null;
				videoContainerRef.current = null;
				frameContainerRef.current = null;
				frameSpriteRef.current = null;
				cursorContainerRef.current = null;
				videoSpriteRef.current = null;
			};
		}, [onError]);

		useEffect(() => {
			const video = videoRef.current;
			if (!video) return;
			video.pause();
			video.currentTime = 0;
			allowPlaybackRef.current = false;
			lockedVideoDimensionsRef.current = null;
			setVideoReady(false);
			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}
		}, [videoPath]);

		useEffect(() => {
			onPreviewReadyChange?.(videoReady);
		}, [onPreviewReadyChange, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const video = videoRef.current;
			const app = appRef.current;
			const videoContainer = videoContainerRef.current;
			const cursorContainer = cursorContainerRef.current;

			if (!video || !app || !videoContainer || !cursorContainer) return;
			if (video.videoWidth === 0 || video.videoHeight === 0) return;

			const source = VideoSource.from(video);
			if ("autoPlay" in source) {
				(source as { autoPlay?: boolean }).autoPlay = false;
			}
			if ("autoUpdate" in source) {
				(source as { autoUpdate?: boolean }).autoUpdate = true;
			}
			const videoTexture = Texture.from(source);

			const videoSprite = new Sprite(videoTexture);
			videoSpriteRef.current = videoSprite;

			const maskGraphics = new Graphics();
			videoContainer.addChild(videoSprite);
			videoContainer.addChild(maskGraphics);
			videoContainer.mask = maskGraphics;
			maskGraphicsRef.current = maskGraphics;
			if (cursorOverlayRef.current) {
				cursorContainer.addChild(cursorOverlayRef.current.container);
			}

			animationStateRef.current = createPlaybackAnimationState();

			const blurFilter = new BlurFilter();
			blurFilter.quality = 3;
			blurFilter.resolution = app.renderer.resolution;
			blurFilter.blur = 0;
			const motionBlurFilter = new MotionBlurFilter([0, 0], 5, 0);
			// Don't attach filters by default — the filter pipeline forces the video
			// through an intermediate RenderTexture at renderer resolution, downsampling
			// the native video and destroying detail. Filters are attached conditionally
			// in the ticker only when zoom motion blur is actually active.
			videoContainer.filters = null;
			blurFilterRef.current = blurFilter;
			motionBlurFilterRef.current = motionBlurFilter;

			layoutVideoContent();
			video.pause();

			const { handlePlay, handlePause, handleSeeked, handleSeeking, dispose } =
				createVideoEventHandlers({
					video,
					isSeekingRef,
					isPlayingRef,
					allowPlaybackRef,
					currentTimeRef,
					timeUpdateAnimationRef,
					onPlayStateChange,
					onTimeUpdate,
					trimRegionsRef,
					speedRegionsRef,
				});

			video.addEventListener("play", handlePlay);
			video.addEventListener("pause", handlePause);
			video.addEventListener("ended", handlePause);
			video.addEventListener("seeked", handleSeeked);
			video.addEventListener("seeking", handleSeeking);

			return () => {
				video.removeEventListener("play", handlePlay);
				video.removeEventListener("pause", handlePause);
				video.removeEventListener("ended", handlePause);
				video.removeEventListener("seeked", handleSeeked);
				video.removeEventListener("seeking", handleSeeking);
				dispose();

				if (videoSprite) {
					videoContainer.removeChild(videoSprite);
					videoSprite.destroy();
				}
				if (maskGraphics) {
					videoContainer.removeChild(maskGraphics);
					maskGraphics.destroy();
				}
				videoContainer.mask = null;
				maskGraphicsRef.current = null;
				if (blurFilterRef.current) {
					videoContainer.filters = [];
					blurFilterRef.current.destroy();
					blurFilterRef.current = null;
				}
				if (motionBlurFilterRef.current) {
					motionBlurFilterRef.current.destroy();
					motionBlurFilterRef.current = null;
				}
				videoTexture.destroy(false);

				videoSpriteRef.current = null;
			};
		}, [pixiReady, videoReady, onTimeUpdate, updateOverlayForRegion]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const videoContainer = videoContainerRef.current;
			if (!app || !videoSprite || !videoContainer) return;

			const applyTransform = (
				transform: { scale: number; x: number; y: number },
				focus: ZoomFocus,
				motionIntensity: number,
				motionVector: { x: number; y: number },
			) => {
				const cameraContainer = cameraContainerRef.current;
				if (!cameraContainer) return;

				const state = animationStateRef.current;

				const appliedTransform = applyZoomTransform({
					cameraContainer,
					blurFilter: blurFilterRef.current,
					motionBlurFilter: motionBlurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: focus.cx,
					focusY: focus.cy,
					motionIntensity,
					motionVector,
					isPlaying: isPlayingRef.current,
					motionBlurAmount: zoomMotionBlurRef.current,
					transformOverride: transform,
					motionBlurState: motionBlurStateRef.current,
					frameTimeMs: performance.now(),
				});

				state.x = appliedTransform.x;
				state.y = appliedTransform.y;
				state.appliedScale = appliedTransform.scale;
			};

			const ticker = () => {
				const { region, strength, blendedScale, transition } = findDominantRegion(
					zoomRegionsRef.current,
					currentTimeRef.current,
					{
						connectZooms: connectZoomsRef.current,
					},
				);

				const defaultFocus = DEFAULT_FOCUS;
				let targetScaleFactor = 1;
				let targetFocus = defaultFocus;
				let targetProgress = 0;

				// If a zoom is selected but video is not playing, show default unzoomed view
				// (the overlay will show where the zoom will be)
				const selectedId = selectedZoomIdRef.current;
				const hasSelectedZoom = selectedId !== null;
				const shouldShowUnzoomedView = hasSelectedZoom && !isPlayingRef.current;

				if (region && strength > 0 && !shouldShowUnzoomedView) {
					const zoomScale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];

					// Cursor follow: use cursor-follow camera for non-manual zoom regions
					let regionFocus = region.focus;
					if (
						!zoomClassicModeRef.current &&
						region.mode !== "manual" &&
						cursorTelemetryRef.current.length > 0
					) {
						regionFocus = computeCursorFollowFocus(
							cursorFollowCameraRef.current,
							cursorTelemetryRef.current,
							currentTimeRef.current,
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
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: transition.startScale,
							zoomProgress: 1,
							focusX: transition.startFocus.cx,
							focusY: transition.startFocus.cy,
						});
						const endTransform = computeZoomTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: transition.endScale,
							zoomProgress: 1,
							focusX: transition.endFocus.cx,
							focusY: transition.endFocus.cy,
						});

						const interpolatedTransform = {
							scale:
								startTransform.scale +
								(endTransform.scale - startTransform.scale) * transition.progress,
							x:
								startTransform.x +
								(endTransform.x - startTransform.x) * transition.progress,
							y:
								startTransform.y +
								(endTransform.y - startTransform.y) * transition.progress,
						};

						targetScaleFactor = interpolatedTransform.scale;
						targetFocus = computeFocusFromTransform({
							stageSize: stageSizeRef.current,
							baseMask: baseMaskRef.current,
							zoomScale: interpolatedTransform.scale,
							x: interpolatedTransform.x,
							y: interpolatedTransform.y,
						});
						targetProgress = 1;
					}
				}

				const state = animationStateRef.current;
				const prevScale = state.appliedScale;
				const prevX = state.x;
				const prevY = state.y;

				state.scale = targetScaleFactor;
				state.focusX = targetFocus.cx;
				state.focusY = targetFocus.cy;
				state.progress = targetProgress;

				// Push zoom state to extension host for query APIs
				extensionHost.setZoomState({
					scale: targetScaleFactor,
					focusX: targetFocus.cx,
					focusY: targetFocus.cy,
					progress: targetProgress,
				});

				const projectedTransform = computeZoomTransform({
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: state.focusX,
					focusY: state.focusY,
				});

				// Spring-driven zoom animation
				const now = performance.now();
				const deltaMs =
					lastTickTimeRef.current !== null ? now - lastTickTimeRef.current : 1000 / 60;
				lastTickTimeRef.current = now;

				const zoomSpringConfig = getZoomSpringConfig(zoomSmoothnessRef.current);
				const useSpring =
					isPlayingRef.current && !isSeekingRef.current && !zoomClassicModeRef.current;

				let appliedScale: number;
				let appliedX: number;
				let appliedY: number;

				if (useSpring) {
					appliedScale = stepSpringValue(
						springScaleRef.current,
						projectedTransform.scale,
						deltaMs,
						zoomSpringConfig,
					);
					appliedX = stepSpringValue(
						springXRef.current,
						projectedTransform.x,
						deltaMs,
						zoomSpringConfig,
					);
					appliedY = stepSpringValue(
						springYRef.current,
						projectedTransform.y,
						deltaMs,
						zoomSpringConfig,
					);
				} else {
					// Snap instantly when paused, seeking, or in classic mode
					appliedScale = projectedTransform.scale;
					appliedX = projectedTransform.x;
					appliedY = projectedTransform.y;
					resetSpringState(springScaleRef.current, appliedScale);
					resetSpringState(springXRef.current, appliedX);
					resetSpringState(springYRef.current, appliedY);
				}

				const motionIntensity = Math.max(
					Math.abs(appliedScale - prevScale),
					Math.abs(appliedX - prevX) / Math.max(1, stageSizeRef.current.width),
					Math.abs(appliedY - prevY) / Math.max(1, stageSizeRef.current.height),
				);

				const motionVector = {
					x: appliedX - prevX,
					y: appliedY - prevY,
				};

				applyTransform(
					{ scale: appliedScale, x: appliedX, y: appliedY },
					targetFocus,
					motionIntensity,
					motionVector,
				);

				// Conditionally attach motion blur filter only when the camera is
				// actually moving. When filters are attached, PixiJS routes the video
				// through an intermediate RenderTexture at renderer resolution, which
				// downsamples the native video and degrades preview quality.
				// Hysteresis prevents flickering when motionIntensity oscillates near threshold.
				const filtersActive =
					Array.isArray(videoContainer.filters) && videoContainer.filters.length > 0;
				const cameraIsMoving = filtersActive
					? motionIntensity > 0.002
					: motionIntensity > 0.008;
				const needsFilters =
					zoomMotionBlurRef.current > 0 && isPlayingRef.current && cameraIsMoving;
				if (needsFilters && !filtersActive && motionBlurFilterRef.current) {
					videoContainer.filters = [motionBlurFilterRef.current];
				} else if (!needsFilters && filtersActive) {
					videoContainer.filters = null;
				}

				applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);

				const timeMs = currentTimeRef.current;
				const effectsCanvas = cursorEffectsCanvasRef.current;
				const extensionCanvasWidth = effectsCanvas?.width || stageSizeRef.current.width;
				const extensionCanvasHeight = effectsCanvas?.height || stageSizeRef.current.height;
				let smoothedCursorForHooks: {
					cx: number;
					cy: number;
					trail: Array<{ cx: number; cy: number }>;
				} | null = null;

				// Update cursor overlay + emit cursor events
				const cursorOverlay = cursorOverlayRef.current;
				if (cursorOverlay) {
					const telemetry = cursorTelemetryRef.current;
					cursorOverlay.update(
						telemetry,
						timeMs,
						baseMaskRef.current,
						showCursorRef.current,
						!isPlayingRef.current || isSeekingRef.current,
					);

					smoothedCursorForHooks = mapSmoothedCursorToCanvasNormalized(
						cursorOverlay.getSmoothedCursorSnapshot(),
						{
							maskRect: baseMaskRef.current,
							canvasWidth: extensionCanvasWidth,
							canvasHeight: extensionCanvasHeight,
						},
					);
					extensionHost.setSmoothedCursor(
						smoothedCursorForHooks
							? {
									timeMs,
									cx: smoothedCursorForHooks.cx,
									cy: smoothedCursorForHooks.cy,
									trail: smoothedCursorForHooks.trail,
								}
							: null,
					);

					// Emit cursor:click events for extensions
					if (isPlayingRef.current && telemetry.length > 0) {
						for (let i = telemetry.length - 1; i >= 0; i--) {
							const p = telemetry[i];
							if (p.timeMs > timeMs) continue;
							if (p.timeMs < timeMs - 100) break;
							if (
								p.interactionType &&
								p.interactionType !== "move" &&
								p.timeMs !== lastEmittedClickTimeMsRef.current
							) {
								const extensionCursor = mapCursorToCanvasNormalized(
									{
										cx: p.cx,
										cy: p.cy,
										interactionType: p.interactionType,
									},
									{
										maskRect: baseMaskRef.current,
										canvasWidth: extensionCanvasWidth,
										canvasHeight: extensionCanvasHeight,
									},
								);
								lastEmittedClickTimeMsRef.current = p.timeMs;
								extensionHost.emitEvent({
									type: "cursor:click",
									timeMs: p.timeMs,
									data: extensionCursor,
								});
								if (extensionCursor) {
									notifyCursorInteraction(
										p.timeMs,
										extensionCursor.cx,
										extensionCursor.cy,
										p.interactionType,
									);
								}
							}
							break;
						}
					}
				}

				if (!cursorOverlay) {
					extensionHost.setSmoothedCursor(null);
				}

				if (effectsCanvas && effectsCanvas.width > 0 && effectsCanvas.height > 0) {
					const ctx2d = effectsCanvas.getContext("2d");
					if (ctx2d) {
						ctx2d.clearRect(0, 0, effectsCanvas.width, effectsCanvas.height);

						const maskRect = baseMaskRef.current;
						const animationState = animationStateRef.current;
						const videoInfo = extensionHost.getVideoInfoSnapshot();
						const rawCursor = getCursorPositionAtTime(
							cursorTelemetryRef.current,
							timeMs,
							{
								maskRect,
								canvasWidth: effectsCanvas.width,
								canvasHeight: effectsCanvas.height,
							},
						);
						const hookParams = {
							width: effectsCanvas.width,
							height: effectsCanvas.height,
							timeMs,
							durationMs: videoInfo?.durationMs ?? 0,
							cursor: smoothedCursorForHooks
								? {
										cx: smoothedCursorForHooks.cx,
										cy: smoothedCursorForHooks.cy,
										interactionType: rawCursor?.interactionType,
									}
								: rawCursor,
							smoothedCursor: smoothedCursorForHooks,
							videoLayout:
								maskRect.width > 0 && maskRect.height > 0
									? {
											maskRect: {
												x: maskRect.x,
												y: maskRect.y,
												width: maskRect.width,
												height: maskRect.height,
											},
											borderRadius,
											padding,
										}
									: undefined,
							zoom: {
								scale: animationState.scale,
								focusX: animationState.focusX,
								focusY: animationState.focusY,
								progress: animationState.progress,
							},
							shadow: {
								enabled: Boolean(showShadow) && shadowIntensity > 0,
								intensity: shadowIntensity,
							},
							sceneTransform: {
								scale: animationState.appliedScale,
								x: animationState.x,
								y: animationState.y,
							},
						};

						ctx2d.save();
						applyCanvasSceneTransform(ctx2d, {
							scale: animationState.appliedScale,
							x: animationState.x,
							y: animationState.y,
						});
						executeExtensionRenderHooks("post-video", ctx2d, hookParams);
						executeExtensionRenderHooks("post-zoom", ctx2d, hookParams);
						executeExtensionRenderHooks("post-cursor", ctx2d, hookParams);

						if (isSeekingRef.current) {
							clearCursorEffects();
						} else {
							executeExtensionCursorEffects(
								ctx2d,
								timeMs,
								effectsCanvas.width,
								effectsCanvas.height,
								{
									zoom: hookParams.zoom,
									sceneTransform: hookParams.sceneTransform,
									videoLayout: hookParams.videoLayout,
								},
							);
						}
						ctx2d.restore();

						executeExtensionRenderHooks("post-webcam", ctx2d, hookParams);
						executeExtensionRenderHooks("post-annotations", ctx2d, hookParams);

						executeExtensionRenderHooks("final", ctx2d, hookParams);
					}
				}
			};

			app.ticker.add(ticker);
			return () => {
				if (app && app.ticker) {
					app.ticker.remove(ticker);
				}
			};
		}, [
			pixiReady,
			videoReady,
			clampFocusToStage,
			applyWebcamBubbleLayout,
			borderRadius,
			padding,
			showShadow,
			shadowIntensity,
		]);

		useEffect(() => {
			const overlay = cursorOverlayRef.current;
			if (!overlay) {
				return;
			}

			let cancelled = false;

			overlay.setDotRadius(DEFAULT_CURSOR_CONFIG.dotRadius * cursorSize);
			overlay.setSmoothingFactor(cursorSmoothing);
			overlay.setMotionBlur(cursorMotionBlur);
			overlay.setClickBounce(cursorClickBounce);
			overlay.setClickBounceDuration(cursorClickBounceDuration);
			overlay.setSway(cursorSway);

			void (async () => {
				try {
					await preloadCursorAssets();
				} catch (error) {
					console.warn("Failed to refresh cursor assets for preview:", error);
					return;
				}

				if (cancelled || cursorOverlayRef.current !== overlay) {
					return;
				}

				overlay.setStyle(cursorStyle);
				overlay.reset();
			})();

			return () => {
				cancelled = true;
			};
		}, [
			cursorStyle,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
		]);

		useEffect(() => {
			let cancelled = false;
			let signature = getContributedCursorStylesSignature();

			const refreshSelectedCursorStyle = async () => {
				const overlay = cursorOverlayRef.current;
				if (!overlay) {
					return;
				}

				try {
					await preloadCursorAssets();
				} catch (error) {
					console.warn("Failed to refresh contributed cursor styles in preview:", error);
					return;
				}

				if (cancelled || cursorOverlayRef.current !== overlay) {
					return;
				}

				overlay.setStyle(cursorStyleRef.current);
				overlay.reset();
			};

			const unsubscribe = extensionHost.onChange(() => {
				const nextSignature = getContributedCursorStylesSignature();
				if (nextSignature === signature) {
					return;
				}

				signature = nextSignature;
				void refreshSelectedCursorStyle();
			});

			return () => {
				cancelled = true;
				unsubscribe();
			};
		}, []);

		const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
			const video = e.currentTarget;
			onDurationChange(video.duration);

			// Push video info to extension host for query APIs
			extensionHost.setVideoInfo({
				width: video.videoWidth,
				height: video.videoHeight,
				durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : 0,
				fps: 60, // Not available from HTMLVideoElement; default to 60
			});
			const targetTime = clampMediaTimeToDuration(
				currentTime,
				Number.isFinite(video.duration) ? video.duration : null,
			);
			video.currentTime = targetTime;
			video.pause();
			allowPlaybackRef.current = false;
			currentTimeRef.current = targetTime * 1000;

			if (videoReadyRafRef.current) {
				cancelAnimationFrame(videoReadyRafRef.current);
				videoReadyRafRef.current = null;
			}

			const waitForRenderableFrame = () => {
				const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0;
				const hasData = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
				if (hasDimensions && hasData) {
					videoReadyRafRef.current = null;
					setVideoReady(true);
					return;
				}
				videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
			};

			videoReadyRafRef.current = requestAnimationFrame(waitForRenderableFrame);
		};

		const [resolvedWallpaper, setResolvedWallpaper] = useState<string | null>(null);
		const [resolvedWallpaperKind, setResolvedWallpaperKind] = useState<
			"image" | "video" | "style"
		>("image");

		useEffect(() => {
			let mounted = true;
			const revokeResolvedWallpaper = () => undefined;
			(async () => {
				try {
					if (!wallpaper) {
						const def = await getAssetPath(DEFAULT_WALLPAPER_RELATIVE_PATH);
						if (mounted) {
							setResolvedWallpaper(def);
							setResolvedWallpaperKind("image");
						}
						return;
					}

					if (
						wallpaper.startsWith("#") ||
						wallpaper.startsWith("linear-gradient") ||
						wallpaper.startsWith("radial-gradient")
					) {
						if (mounted) {
							setResolvedWallpaper(wallpaper);
							setResolvedWallpaperKind("style");
						}
						return;
					}

					if (isVideoWallpaperSource(wallpaper)) {
						let videoSrc = wallpaper;
						if (wallpaper.startsWith("/") && !wallpaper.startsWith("//")) {
							videoSrc = await getAssetPath(wallpaper.replace(/^\//, ""));
						}
						if (mounted) {
							setResolvedWallpaper(videoSrc);
							setResolvedWallpaperKind("video");
						}
						return;
					}

					// If it's a data URL (custom uploaded image), use as-is
					if (wallpaper.startsWith("data:")) {
						if (mounted) {
							setResolvedWallpaper(wallpaper);
							setResolvedWallpaperKind("image");
						}
						return;
					}

					if (
						wallpaper.startsWith("http") ||
						wallpaper.startsWith("file://") ||
						wallpaper.startsWith("/")
					) {
						const renderable = await getRenderableAssetUrl(wallpaper);
						if (mounted) {
							setResolvedWallpaper(renderable);
							setResolvedWallpaperKind("image");
						}
						return;
					}
					const p = await getRenderableAssetUrl(
						await getAssetPath(wallpaper.replace(/^\//, "")),
					);
					if (mounted) {
						setResolvedWallpaper(p);
						setResolvedWallpaperKind("image");
					}
				} catch (_err) {
					if (mounted) {
						setResolvedWallpaper(wallpaper || DEFAULT_WALLPAPER_PATH);
						setResolvedWallpaperKind(
							isVideoWallpaperSource(wallpaper || "") ? "video" : "image",
						);
					}
				}
			})();
			return () => {
				mounted = false;
				revokeResolvedWallpaper();
			};
		}, [wallpaper]);

		useEffect(() => {
			return () => {
				if (videoReadyRafRef.current) {
					cancelAnimationFrame(videoReadyRafRef.current);
					videoReadyRafRef.current = null;
				}
			};
		}, []);

		const isImageUrl =
			resolvedWallpaperKind === "image" &&
			Boolean(
				resolvedWallpaper &&
					(resolvedWallpaper.startsWith("file://") ||
						resolvedWallpaper.startsWith("http") ||
						resolvedWallpaper.startsWith("/") ||
						resolvedWallpaper.startsWith("data:")),
			);
		const backgroundStyle = isImageUrl
			? { backgroundImage: `url(${resolvedWallpaper || ""})` }
			: resolvedWallpaperKind === "video"
				? {}
				: { background: resolvedWallpaper || "" };

		const nativeAspectRatio = (() => {
			const locked = lockedVideoDimensionsRef.current;
			if (locked) {
				return getEffectiveNativeAspectRatio(locked, cropRegion);
			}
			const video = videoRef.current;
			if (video && video.videoHeight > 0 && video.videoWidth > 0) {
				return getEffectiveNativeAspectRatio(
					{
						width: video.videoWidth,
						height: video.videoHeight,
					},
					cropRegion,
				);
			}
			return 16 / 9;
		})();

		return (
			<div
				className="relative rounded-sm overflow-hidden"
				style={{
					width: "100%",
					aspectRatio: formatAspectRatioForCSS(aspectRatio, nativeAspectRatio),
				}}
			>
				{/* Background layer */}
				{resolvedWallpaperKind === "video" && resolvedWallpaper ? (
					<video
						key={resolvedWallpaper}
						ref={bgVideoRef}
						className="absolute inset-0 h-full w-full object-cover"
						src={resolvedWallpaper}
						muted
						loop
						playsInline
						style={{
							filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : "none",
						}}
					/>
				) : (
					<div
						className="absolute inset-0 bg-cover bg-center"
						style={{
							...backgroundStyle,
							filter: backgroundBlur > 0 ? `blur(${backgroundBlur}px)` : "none",
						}}
					/>
				)}
				<div
					ref={containerRef}
					className="absolute inset-0"
					style={{
						filter:
							showShadow && shadowIntensity > 0
								? `drop-shadow(0 ${shadowIntensity * 12}px ${shadowIntensity * 48}px rgba(0,0,0,${shadowIntensity * 0.7})) drop-shadow(0 ${shadowIntensity * 4}px ${shadowIntensity * 16}px rgba(0,0,0,${shadowIntensity * 0.5})) drop-shadow(0 ${shadowIntensity * 2}px ${shadowIntensity * 8}px rgba(0,0,0,${shadowIntensity * 0.3}))`
								: "none",
					}}
				/>
				{/* Canvas overlay for extension cursor effects (drawn via Canvas 2D API) */}
				<canvas
					ref={cursorEffectsCanvasRef}
					className="absolute inset-0 w-full h-full pointer-events-none"
					style={{ zIndex: 1 }}
				/>
				{/* Only render overlay after PIXI and video are fully initialized */}
				{pixiReady && videoReady && (
					<div
						ref={overlayRef}
						className="absolute inset-0 select-none"
						style={{ pointerEvents: "none" }}
						onPointerDown={handleOverlayPointerDown}
						onPointerMove={handleOverlayPointerMove}
						onPointerUp={handleOverlayPointerUp}
						onPointerLeave={handleOverlayPointerLeave}
					>
						<div
							ref={focusIndicatorRef}
							className="absolute rounded-md border border-[#2563EB]/80 bg-[#2563EB]/20 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]"
							style={{ display: "none", pointerEvents: "none" }}
						/>
						{webcam && webcamVideoPath ? (
							<div
								ref={webcamBubbleRef}
								className="absolute"
								style={{
									display: webcam.enabled ? "block" : "none",
									pointerEvents: "none",
								}}
							>
								<div
									ref={webcamBubbleInnerRef}
									className="h-full w-full overflow-hidden bg-black/80"
								>
									<video
										ref={webcamVideoRef}
										src={webcamVideoPath}
										className="h-full w-full object-cover"
										muted
										playsInline
										preload="auto"
										style={{
											transform: webcam.mirror ? "scaleX(-1)" : undefined,
										}}
									/>
								</div>
							</div>
						) : null}
						{activeCaptionLayout && autoCaptionSettings ? (
							<div
								className="pointer-events-none absolute inset-x-0 flex justify-center"
								style={{
									bottom: `${autoCaptionSettings.bottomOffset}%`,
								}}
							>
								<div
									style={{
										maxWidth: `${autoCaptionSettings.maxWidth}%`,
										opacity: activeCaptionLayout.opacity,
										transform: `translateY(${activeCaptionLayout.translateY}px) scale(${activeCaptionLayout.scale})`,
										transformOrigin: "center bottom",
										filter: "drop-shadow(0 12px 30px rgba(0, 0, 0, 0.28))",
									}}
								>
									<div
										ref={captionBoxRef}
										style={{
											backgroundColor: `rgba(0, 0, 0, ${autoCaptionSettings.backgroundOpacity})`,
											fontFamily: getDefaultCaptionFontFamily(),
											fontSize: `${getCaptionScaledFontSize(
												autoCaptionSettings.fontSize,
												overlayRef.current?.clientWidth || 960,
												autoCaptionSettings.maxWidth,
											)}px`,
											lineHeight: CAPTION_LINE_HEIGHT,
											textAlign: "center",
											fontWeight: CAPTION_FONT_WEIGHT,
											padding: `${
												getCaptionPadding(
													getCaptionScaledFontSize(
														autoCaptionSettings.fontSize,
														overlayRef.current?.clientWidth || 960,
														autoCaptionSettings.maxWidth,
													),
												).y
											}px ${
												getCaptionPadding(
													getCaptionScaledFontSize(
														autoCaptionSettings.fontSize,
														overlayRef.current?.clientWidth || 960,
														autoCaptionSettings.maxWidth,
													),
												).x
											}px`,
											borderRadius: `${getCaptionScaledRadius(
												autoCaptionSettings.boxRadius,
												getCaptionScaledFontSize(
													autoCaptionSettings.fontSize,
													overlayRef.current?.clientWidth || 960,
													autoCaptionSettings.maxWidth,
												),
											)}px`,
											boxSizing: "border-box",
										}}
									>
										{activeCaptionLayout.visibleLines.map((line) => (
											<div
												key={`${activeCaptionLayout.blockKey}-${line.startWordIndex}`}
												style={{
													display: "flex",
													justifyContent: "center",
													flexWrap: "nowrap",
													whiteSpace: "nowrap",
												}}
											>
												{line.words.map((word) => {
													const visualState = getCaptionWordVisualState(
														activeCaptionLayout.hasWordTimings,
														word.state,
													);

													return (
														<span
															key={`${activeCaptionLayout.blockKey}-${word.index}`}
															style={{
																display: "inline-block",
																whiteSpace: "pre",
																color: visualState.isInactive
																	? autoCaptionSettings.inactiveTextColor
																	: autoCaptionSettings.textColor,
																opacity: visualState.opacity,
															}}
														>
															{`${word.leadingSpace ? " " : ""}${word.text}`}
														</span>
													);
												})}
											</div>
										))}
									</div>
								</div>
							</div>
						) : null}
						{(() => {
							const filtered = (annotationRegions || []).filter((annotation) => {
								if (
									typeof annotation.startMs !== "number" ||
									typeof annotation.endMs !== "number"
								)
									return false;

								if (annotation.id === selectedAnnotationId) return true;

								const timeMs = Math.round(currentTime * 1000);
								return timeMs >= annotation.startMs && timeMs <= annotation.endMs;
							});

							// Sort by z-index (lowest to highest) so higher z-index renders on top
							const sorted = [...filtered].sort((a, b) => a.zIndex - b.zIndex);

							// Handle click-through cycling: when clicking same annotation, cycle to next
							const handleAnnotationClick = (clickedId: string) => {
								if (!onSelectAnnotation) return;

								// If clicking on already selected annotation and there are multiple overlapping
								if (clickedId === selectedAnnotationId && sorted.length > 1) {
									// Find current index and cycle to next
									const currentIndex = sorted.findIndex(
										(a) => a.id === clickedId,
									);
									const nextIndex = (currentIndex + 1) % sorted.length;
									onSelectAnnotation(sorted[nextIndex].id);
								} else {
									// First click or clicking different annotation
									onSelectAnnotation(clickedId);
								}
							};

							return sorted.map((annotation) => (
								<AnnotationOverlay
									key={annotation.id}
									annotation={annotation}
									isSelected={annotation.id === selectedAnnotationId}
									containerWidth={overlayRef.current?.clientWidth || 800}
									containerHeight={overlayRef.current?.clientHeight || 600}
									onPositionChange={(id, position) =>
										onAnnotationPositionChange?.(id, position)
									}
									onSizeChange={(id, size) => onAnnotationSizeChange?.(id, size)}
									onClick={handleAnnotationClick}
									zIndex={annotation.zIndex}
									isSelectedBoost={annotation.id === selectedAnnotationId}
								/>
							));
						})()}
					</div>
				)}
				{/* Keep the source video off-screen instead of display:none so the
					browser continues producing presented frames for Pixi and preview sync. */}
				<video
					ref={videoRef}
					src={videoPath}
					className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
					preload="metadata"
					playsInline
					aria-hidden="true"
					onLoadedMetadata={handleLoadedMetadata}
					onDurationChange={(e) => {
						onDurationChange(e.currentTarget.duration);
					}}
					onError={(e) => {
						const mediaError = e.currentTarget.error;
						const code = mediaError?.code;
						const msg = mediaError?.message;
						const detail =
							code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
								? "format not supported"
								: code === MediaError.MEDIA_ERR_NETWORK
									? "network error"
									: code === MediaError.MEDIA_ERR_DECODE
										? "decode error"
										: msg || `code ${code ?? "unknown"}`;
						console.error(
							"[VideoPlayback] Video load error:",
							detail,
							"src:",
							videoPath,
						);
						onError(`Failed to load video (${detail})`);
					}}
				/>
			</div>
		);
	},
);

VideoPlayback.displayName = "VideoPlayback";

export default VideoPlayback;
