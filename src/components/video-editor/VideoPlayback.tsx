import { Application, Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import { MotionBlurFilter } from "pixi-filters/motion-blur";
import { ZoomBlurFilter } from "pixi-filters/zoom-blur";
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
import { getAssetPath, getRenderableAssetUrl, getRenderableVideoUrl } from "@/lib/assetPath";
import { getWebcamShadowFilter } from "@/lib/exporter/shadowProfile";
import { getSquircleSvgPath } from "@/lib/geometry/squircle";
import {
	clampMediaTimeToDuration,
	enablePitchPreservingPlayback,
	getMediaSyncPlaybackRate,
} from "@/lib/mediaTiming";
import {
	destroyPixiApplication,
	destroyPixiContainer,
	initializePixiApplicationWithTimeout,
} from "@/lib/pixiApplicationLifecycle";
import {
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { type AspectRatio, formatAspectRatioForCSS } from "@/utils/aspectRatioUtils";
import { AnnotationOverlay } from "./AnnotationOverlay";
import { type CaptionEditTarget, normalizeCaptionEditText } from "./captionEditing";
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
	type ClipRegion,
	type CursorClickEffectStyle,
	type CursorStyle,
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_CLICK_EFFECT,
	DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
	DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
	DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
	DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_PADDING,
	DEFAULT_WEBCAM_REACT_TO_ZOOM,
	DEFAULT_WEBCAM_ROUNDNESS,
	DEFAULT_WEBCAM_SHADOW,
	DEFAULT_WEBCAM_SIZE,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_MOTION_BLUR,
	DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
	findClipAtTimelineTime,
	getDefaultCaptionFontFamily,
	mapTimelineTimeToSourceTime,
	type Padding,
	type WebcamOverlaySettings,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomMotionBlurTuning,
	type ZoomRegion,
	type ZoomTransitionEasing,
} from "./types";
import { isAnnotationActiveAtTime } from "./videoPlayback/annotationVisibility";
import { createClipPlayback, findPreviewClipAtTimelineTime } from "./videoPlayback/clipPlayback";
import { DEFAULT_FOCUS } from "./videoPlayback/constants";
import {
	type CursorFollowCameraState,
	createCursorFollowCameraState,
} from "./videoPlayback/cursorFollowCamera";
import {
	DEFAULT_CURSOR_CONFIG,
	PixiCursorOverlay,
	preloadCursorAssets,
} from "./videoPlayback/cursorRenderer";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { clamp01 } from "./videoPlayback/mathUtils";
import {
	createSpringState,
	getZoomSpringConfig,
	resetSpringState,
	type SpringState,
	stepSpringValue,
} from "./videoPlayback/motionSmoothing";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { supportsPreviewPlaybackRate } from "./videoPlayback/playbackRate";
import { PreviewVideoSource } from "./videoPlayback/previewVideoSource";
import { usePreviewVideoReady } from "./videoPlayback/usePreviewVideoReady";
import { getSceneEffectMetrics } from "./videoPlayback/sceneEffects";
import {
	resolvePreviewMotionMode,
	resolveSceneZoomTarget,
	shouldComposePreviewFrame,
} from "./videoPlayback/sceneMotion";
import {
	getWebcamMediaTargetTimeSeconds,
	isWebcamVisibleAtSourceTime,
	isWebcamMediaSynchronized,
	shouldSeekWebcamMedia,
} from "./videoPlayback/webcamSync";
import {
	applyZoomTransform,
	computeZoomTransform,
	createMotionBlurState,
	type MotionBlurState,
} from "./videoPlayback/zoomTransform";
import {
	getCropMatchedWebcamHeightPercent,
	getWebcamCornerRadiusPx,
	getWebcamCropSourceRect,
	getWebcamOverlayDimensionsPx,
	getWebcamOverlayPosition,
	scaleWebcamOverlayPixels,
} from "./webcamOverlay";

type PlaybackAnimationState = {
	scale: number;
	appliedScale: number;
	focusX: number;
	focusY: number;
	progress: number;
	x: number;
	y: number;
};

type CaptionEditSession = {
	target: CaptionEditTarget;
	draft: string;
};

type SceneTransformState = {
	scale: number;
	x: number;
	y: number;
};

type AnnotationRecordingRect = {
	x: number;
	y: number;
	width: number;
	height: number;
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

type PixiPreviewBackend = "webgpu" | "webgl";
type PixiRendererAttempt = {
	backend: PixiPreviewBackend;
	message: string;
};
const PIXI_RENDERER_INIT_TIMEOUT_MS = 8_000;

function toRendererErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error ?? "Unknown renderer init error");
}

function summarizeRendererAttempts(attempts: readonly PixiRendererAttempt[]): string {
	const details = attempts.map((attempt) => `${attempt.backend}: ${attempt.message}`).join(" | ");
	return `No supported Pixi preview renderer was available. Attempted: ${details}`;
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
	autoPlay?: boolean;
	clipRegions: ClipRegion[];
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
	cropRegion?: import("./types").CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamVideoPath?: string | null;
	aspectRatio: AspectRatio;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	onEditAutoCaption?: (target: CaptionEditTarget, text: string) => void;
	selectedAnnotationId?: string | null;
	onSelectAnnotation?: (id: string | null) => void;
	onAnnotationPositionChange?: (id: string, position: { x: number; y: number }) => void;
	onAnnotationSizeChange?: (id: string, size: { width: number; height: number }) => void;
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
	zoomMotionBlur?: number;
	zoomMotionBlurTuning?: ZoomMotionBlurTuning;
	cursorMotionBlur?: number;
	cursorClickEffect?: CursorClickEffectStyle;
	cursorClickEffectColor?: string;
	cursorClickEffectScale?: number;
	cursorClickEffectOpacity?: number;
	cursorClickEffectDurationMs?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	volume?: number;
	suspendRendering?: boolean;
}

export interface VideoPlaybackRef {
	readonly isPlaying: boolean;
	seekTimeline: (time: number) => void;
	video: HTMLVideoElement | null;
	app: Application | null;
	videoSprite: Sprite | null;
	videoContainer: Container | null;
	containerRef: React.RefObject<HTMLDivElement | null>;
	play: () => Promise<void>;
	pause: () => void;
	refreshFrame: () => Promise<void>;
	cancelCaptionEdit: () => void;
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(
	(
		{
			videoPath,
			autoPlay = false,
			onDurationChange,
			onPreviewReadyChange,
			onTimeUpdate,
			currentTime: timelineTime,
			clipRegions,
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
			cropRegion,
			webcam,
			webcamVideoPath,
			aspectRatio,
			annotationRegions = [],
			autoCaptions = [],
			autoCaptionSettings,
			onEditAutoCaption,
			selectedAnnotationId,
			onSelectAnnotation,
			onAnnotationPositionChange,
			onAnnotationSizeChange,
			cursorTelemetry = [],
			showCursor = false,
			cursorStyle = DEFAULT_CURSOR_STYLE,
			cursorSize = DEFAULT_CURSOR_SIZE,
			cursorSmoothing = DEFAULT_CURSOR_SMOOTHING,
			cursorSpringStiffnessMultiplier = 1,
			cursorSpringDampingMultiplier = 1,
			cursorSpringMassMultiplier = 1,
			cameraSpringStiffnessMultiplier = 1,
			cameraSpringDampingMultiplier = 1.13,
			cameraSpringMassMultiplier = 1.12,
			zoomSmoothness = 0.5,
			zoomClassicMode = false,
			zoomMotionBlur = DEFAULT_ZOOM_MOTION_BLUR,
			zoomMotionBlurTuning = DEFAULT_ZOOM_MOTION_BLUR_TUNING,
			cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
			cursorClickEffect = DEFAULT_CURSOR_CLICK_EFFECT,
			cursorClickEffectColor = DEFAULT_CURSOR_CLICK_EFFECT_COLOR,
			cursorClickEffectScale = DEFAULT_CURSOR_CLICK_EFFECT_SCALE,
			cursorClickEffectOpacity = DEFAULT_CURSOR_CLICK_EFFECT_OPACITY,
			cursorClickEffectDurationMs = DEFAULT_CURSOR_CLICK_EFFECT_DURATION_MS,
			cursorClickBounce = DEFAULT_CURSOR_CLICK_BOUNCE,
			cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
			cursorSway = DEFAULT_CURSOR_SWAY,
			volume = 1,
			suspendRendering = false,
		},
		ref,
	) => {
		const videoRef = useRef<HTMLVideoElement | null>(null);
		const previewVideoSourceRef = useRef(new PreviewVideoSource());
		const attachVideo = useCallback((video: HTMLVideoElement | null) => {
			// VideoSource.destroy() clears the media URL, so only destroy it when
			// React detaches the element, never during a layout effect cleanup.
			previewVideoSourceRef.current.setVideo(video);
			videoRef.current = video;
		}, []);
		const previewFrameRef = useRef<HTMLDivElement | null>(null);
		const containerRef = useRef<HTMLDivElement | null>(null);
		const appRef = useRef<Application | null>(null);
		const videoSpriteRef = useRef<Sprite | null>(null);
		const videoEffectsContainerRef = useRef<Container | null>(null);
		const videoContainerRef = useRef<Container | null>(null);
		const cursorContainerRef = useRef<Container | null>(null);
		const zoomBlurFilterRef = useRef<ZoomBlurFilter | null>(null);
		const motionBlurFilterRef = useRef<MotionBlurFilter | null>(null);
		const cameraContainerRef = useRef<Container | null>(null);
		const [pixiReady, setPixiReady] = useState(false);
		const videoReady = usePreviewVideoReady(videoRef, videoPath);
		// Bumped to force a full teardown/recreate of the Pixi renderer after a
		// lost WebGL/WebGPU context (e.g. Windows reclaiming GPU resources from a
		// long-minimized window), since neither backend reliably self-recovers.
		const [rendererGeneration, setRendererGeneration] = useState(0);
		const contextLostCleanupRef = useRef<(() => void) | null>(null);

		const [previewViewportWidth, setPreviewViewportWidth] = useState(640);
		const [annotationSceneTransform, setAnnotationSceneTransform] =
			useState<SceneTransformState>({
				scale: 1,
				x: 0,
				y: 0,
			});
		const [annotationRecordingRect, setAnnotationRecordingRect] =
			useState<AnnotationRecordingRect>({
				x: 0,
				y: 0,
				width: 0,
				height: 0,
			});

		const overlayRef = useRef<HTMLDivElement | null>(null);
		const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
		const webcamVideoRef = useRef<HTMLVideoElement | null>(null);
		const webcamBubbleRef = useRef<HTMLDivElement | null>(null);
		const webcamBubbleInnerRef = useRef<HTMLDivElement | null>(null);
		const [webcamVideoDimensions, setWebcamVideoDimensions] = useState<{
			width: number;
			height: number;
		} | null>(null);
		const webcamSynchronizedPathRef = useRef<string | null>(null);
		const [webcamSynchronizedPath, setWebcamSynchronizedPath] = useState<string | null>(null);
		const webcamMediaSynchronized =
			Boolean(webcamVideoPath) && webcamSynchronizedPath === webcamVideoPath;
		const captionBoxRef = useRef<HTMLDivElement | null>(null);
		const captionEditInputRef = useRef<HTMLTextAreaElement | null>(null);
		const captionEditSessionRef = useRef<CaptionEditSession | null>(null);
		const [captionEditSession, setCaptionEditSession] = useState<CaptionEditSession | null>(
			null,
		);
		const currentTime = mapTimelineTimeToSourceTime(timelineTime * 1000, clipRegions) / 1000;
		const isGap = !findPreviewClipAtTimelineTime(timelineTime * 1000, clipRegions);
		const clipRegionsRef = useRef(clipRegions);
		const clipPlaybackRef = useRef<ReturnType<typeof createClipPlayback> | null>(null);
		const onPlaybackErrorRef = useRef(onError);
		const timelineTimeRef = useRef(timelineTime);
		useEffect(() => {
			onPlaybackErrorRef.current = onError;
			timelineTimeRef.current = timelineTime;
		}, [onError, timelineTime]);
		const currentTimeRef = useRef(0);
		useEffect(() => {
			clipRegionsRef.current = clipRegions;
			clipPlaybackRef.current?.refresh();
		}, [clipRegions]);
		const zoomRegionsRef = useRef<ZoomRegion[]>([]);
		const selectedZoomIdRef = useRef<string | null>(null);
		const animationStateRef = useRef<PlaybackAnimationState>(createPlaybackAnimationState());
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
			renderWidth?: number;
			renderHeight?: number;
			sourceCrop?: {
				x: number;
				y: number;
				width: number;
				height: number;
			};
		}>({ x: 0, y: 0, width: 0, height: 0 });
		const cropBoundsRef = useRef({ startX: 0, endX: 0, startY: 0, endY: 0 });
		const maskGraphicsRef = useRef<Graphics | null>(null);
		const isPlayingRef = useRef(isPlaying);
		const suspendRenderingRef = useRef(suspendRendering);
		const isSeekingRef = useRef(false);
		const shouldSnapPausedFrameRef = useRef(false);
		const lockedVideoDimensionsRef = useRef<{
			width: number;
			height: number;
		} | null>(null);
		const layoutVideoContentRef = useRef<(() => void) | null>(null);
		const lastWebcamSyncTimeRef = useRef<number | null>(null);
		const lastBackgroundSyncTimeRef = useRef<number | null>(null);
		const bgVideoRef = useRef<HTMLVideoElement | null>(null);
		const connectZoomsRef = useRef(connectZooms);
		const zoomInDurationMsRef = useRef(zoomInDurationMs);
		const zoomInOverlapMsRef = useRef(zoomInOverlapMs);
		const zoomOutDurationMsRef = useRef(zoomOutDurationMs);
		const connectedZoomGapMsRef = useRef(connectedZoomGapMs);
		const connectedZoomDurationMsRef = useRef(connectedZoomDurationMs);
		const zoomInEasingRef = useRef(zoomInEasing);
		const zoomOutEasingRef = useRef(zoomOutEasing);
		const connectedZoomEasingRef = useRef(connectedZoomEasing);
		const cursorOverlayRef = useRef<PixiCursorOverlay | null>(null);
		const cursorTelemetryRef = useRef<CursorTelemetryPoint[]>([]);
		const showCursorRef = useRef(showCursor);
		const cursorSizeRef = useRef(cursorSize);
		const cursorStyleRef = useRef(cursorStyle);
		const cursorSmoothingRef = useRef(cursorSmoothing);
		const cursorSpringStiffnessMultiplierRef = useRef(cursorSpringStiffnessMultiplier);
		const cursorSpringDampingMultiplierRef = useRef(cursorSpringDampingMultiplier);
		const cursorSpringMassMultiplierRef = useRef(cursorSpringMassMultiplier);
		const cameraSpringStiffnessMultiplierRef = useRef(cameraSpringStiffnessMultiplier);
		const cameraSpringDampingMultiplierRef = useRef(cameraSpringDampingMultiplier);
		const cameraSpringMassMultiplierRef = useRef(cameraSpringMassMultiplier);
		const cursorMotionBlurRef = useRef(cursorMotionBlur);
		const cursorClickEffectRef = useRef(cursorClickEffect);
		const cursorClickEffectColorRef = useRef(cursorClickEffectColor);
		const cursorClickEffectScaleRef = useRef(cursorClickEffectScale);
		const cursorClickEffectOpacityRef = useRef(cursorClickEffectOpacity);
		const cursorClickEffectDurationMsRef = useRef(cursorClickEffectDurationMs);
		const cursorClickBounceRef = useRef(cursorClickBounce);
		const cursorClickBounceDurationRef = useRef(cursorClickBounceDuration);
		const cursorSwayRef = useRef(cursorSway);
		const zoomMotionBlurRef = useRef(zoomMotionBlur);
		const zoomMotionBlurTuningRef = useRef(zoomMotionBlurTuning);

		// Spring animation state for smooth zoom transitions
		const springScaleRef = useRef<SpringState>(createSpringState(1));
		const springXRef = useRef<SpringState>(createSpringState(0));
		const springYRef = useRef<SpringState>(createSpringState(0));
		const lastRenderedContentTimeRef = useRef<number | null>(null);
		const zoomSmoothnessRef = useRef(zoomSmoothness);
		const zoomClassicModeRef = useRef(zoomClassicMode);
		const cursorFollowCameraRef = useRef<CursorFollowCameraState>(
			createCursorFollowCameraState(),
		);
		/** Requests one exact composition after an output-affecting edit while paused. */
		const requestPausedFrameRefresh = useCallback(() => {
			if (!isPlayingRef.current) {
				shouldSnapPausedFrameRef.current = true;
			}
		}, []);

		const initializePixiRenderer = useCallback(
			async (container: HTMLDivElement): Promise<Application> => {
				const backendOrder: PixiPreviewBackend[] = ["webgl", "webgpu"];
				const attempts: PixiRendererAttempt[] = [];

				for (const backend of backendOrder) {
					if (
						backend === "webgpu" &&
						!(typeof navigator !== "undefined" && "gpu" in navigator)
					) {
						attempts.push({
							backend,
							message: "WebGPU runtime is unavailable in this browser.",
						});
						continue;
					}

					const rendererApp = new Application();
					const initStarted = performance.now();
					try {
						await initializePixiApplicationWithTimeout(
							rendererApp,
							{
								width: container.clientWidth,
								height: container.clientHeight,
								backgroundAlpha: 0,
								antialias: true,
								failIfMajorPerformanceCaveat: false,
								resolution: window.devicePixelRatio || 1,
								autoDensity: true,
								preference: backend,
								autoStart: true,
								sharedTicker: false,
							},
							PIXI_RENDERER_INIT_TIMEOUT_MS,
							backend,
						);
						return rendererApp;
					} catch (error) {
						const elapsed = Math.round(performance.now() - initStarted);
						attempts.push({
							backend,
							message: `${toRendererErrorMessage(error)} (after ${elapsed}ms)`,
						});

						destroyPixiApplication(
							rendererApp,
							`${backend} preview renderer initialization`,
						);
					}
				}

				throw new Error(summarizeRendererAttempts(attempts));
			},
			[],
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

			measurementContext.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${autoCaptionSettings.fontFamily || getDefaultCaptionFontFamily()}`;

			return buildActiveCaptionLayout({
				cues: autoCaptions,
				timeMs: Math.round(currentTime * 1000),
				settings: autoCaptionSettings,
				maxWidthPx: maxTextWidthPx,
				measureText: (text) => measurementContext.measureText(text).width,
			});
		}, [autoCaptionSettings, autoCaptions, currentTime]);
		const isCaptionEditing = captionEditSession !== null;
		const captionEditDraft = captionEditSession?.draft ?? "";
		const captionEditTargetId = captionEditSession?.target.id ?? null;
		const captionEditTextMetrics = useMemo(() => {
			if (!captionEditSession || !autoCaptionSettings || typeof document === "undefined") {
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

			measurementContext.font = `${CAPTION_FONT_WEIGHT} ${fontSize}px ${autoCaptionSettings.fontFamily || getDefaultCaptionFontFamily()}`;
			const measuredWidth = Math.max(
				...captionEditSession.draft
					.split(/\r?\n/)
					.map((line) => measurementContext.measureText(line || " ").width),
			);

			return {
				fontSize,
				maxTextWidthPx,
				widthPx: Math.ceil(
					Math.min(maxTextWidthPx, Math.max(fontSize * 2, measuredWidth + 2)),
				),
			};
		}, [autoCaptionSettings, captionEditSession]);
		const captionEditSizeKey = captionEditSession
			? `${captionEditTextMetrics?.widthPx ?? 0}:${captionEditDraft}`
			: "";

		const beginCaptionEdit = useCallback(() => {
			if (!activeCaptionLayout?.editTarget || !onEditAutoCaption) {
				return;
			}

			clipPlaybackRef.current?.pause();
			const nextSession = {
				target: activeCaptionLayout.editTarget,
				draft: activeCaptionLayout.editTarget.text,
			};
			captionEditSessionRef.current = nextSession;
			setCaptionEditSession(nextSession);
		}, [activeCaptionLayout, onEditAutoCaption]);

		const commitCaptionEdit = useCallback(() => {
			const session = captionEditSessionRef.current;
			if (!session || !onEditAutoCaption) {
				captionEditSessionRef.current = null;
				setCaptionEditSession(null);
				return;
			}

			const normalizedDraft = normalizeCaptionEditText(session.draft);
			captionEditSessionRef.current = null;
			if (!normalizedDraft) {
				setCaptionEditSession(null);
				return;
			}

			if (normalizedDraft !== normalizeCaptionEditText(session.target.text)) {
				onEditAutoCaption(session.target, session.draft);
			}
			setCaptionEditSession(null);
		}, [onEditAutoCaption]);

		const cancelCaptionEdit = useCallback(() => {
			captionEditSessionRef.current = null;
			setCaptionEditSession(null);
		}, []);

		useEffect(() => {
			if (!captionEditTargetId) {
				return;
			}

			const frame = requestAnimationFrame(() => {
				const input = captionEditInputRef.current;
				if (!input) {
					return;
				}

				input.focus();
				const cursorPosition = input.value.length;
				input.setSelectionRange(cursorPosition, cursorPosition);
			});

			return () => cancelAnimationFrame(frame);
		}, [captionEditTargetId]);

		useEffect(() => {
			if (!captionEditSizeKey) {
				return;
			}

			const frame = requestAnimationFrame(() => {
				const input = captionEditInputRef.current;
				if (!input) {
					return;
				}

				input.style.height = "auto";
				input.style.height = `${input.scrollHeight}px`;
			});

			return () => cancelAnimationFrame(frame);
		}, [captionEditSizeKey]);

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
		const webcamEnabled = webcam?.enabled ?? false;
		const webcamMargin = webcam?.margin ?? 24;
		const webcamWidth = webcam?.width ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
		const rawWebcamHeight = webcam?.height ?? webcam?.size ?? DEFAULT_WEBCAM_SIZE;
		const webcamReactToZoom = webcam?.reactToZoom ?? DEFAULT_WEBCAM_REACT_TO_ZOOM;
		const webcamPositionPreset = webcam?.positionPreset ?? webcam?.corner ?? "bottom-right";
		const webcamPositionX = webcam?.positionX ?? 1;
		const webcamPositionY = webcam?.positionY ?? 1;
		const webcamCorner = webcam?.corner ?? "bottom-right";
		const webcamRoundness = webcam?.roundness ?? DEFAULT_WEBCAM_ROUNDNESS;
		const webcamShadow = webcam?.shadow ?? DEFAULT_WEBCAM_SHADOW;
		const webcamTimeOffsetMs = webcam?.timeOffsetMs;
		const webcamCropRegion = webcam?.cropRegion;
		const webcamMirror = webcam?.mirror ?? false;
		const webcamHeight = getCropMatchedWebcamHeightPercent(
			webcamWidth,
			rawWebcamHeight,
			webcamVideoDimensions?.width,
			webcamVideoDimensions?.height,
			webcamCropRegion,
		);
		const webcamCropPreviewContentStyle = useMemo<React.CSSProperties>(() => {
			if (!webcamVideoDimensions) {
				return { opacity: 0 };
			}

			const { sx, sy, sw, sh } = getWebcamCropSourceRect(
				webcamCropRegion,
				webcamVideoDimensions.width,
				webcamVideoDimensions.height,
			);
			const targetAspect = Math.max(0.01, webcamWidth) / Math.max(0.01, webcamHeight);
			const coverScale = Math.max(targetAspect / sw, 1 / sh);
			const drawWidth = webcamVideoDimensions.width * coverScale;
			const drawHeight = webcamVideoDimensions.height * coverScale;
			const drawX = (targetAspect - sw * coverScale) / 2 - sx * coverScale;
			const drawY = (1 - sh * coverScale) / 2 - sy * coverScale;

			return {
				left: `${(drawX / targetAspect) * 100}%`,
				top: `${drawY * 100}%`,
				width: `${(drawWidth / targetAspect) * 100}%`,
				height: `${drawHeight * 100}%`,
				maxWidth: "none",
				willChange: "left, top, width, height",
			};
		}, [webcamCropRegion, webcamHeight, webcamVideoDimensions, webcamWidth]);

		const applyWebcamBubbleLayout = useCallback(
			(zoomScale: number) => {
				const bubble = webcamBubbleRef.current;
				const bubbleInner = webcamBubbleInnerRef.current;
				const overlay = overlayRef.current;
				if (
					!bubble ||
					!bubbleInner ||
					!overlay ||
					!webcamEnabled ||
					!webcamVideoPath ||
					!isWebcamVisibleAtSourceTime(webcam, currentTimeRef.current / 1000)
				) {
					if (bubble) {
						bubble.style.display = "none";
					}
					return;
				}
				const scaledMargin = scaleWebcamOverlayPixels(webcamMargin, overlay.clientWidth);

				const scaledDimensions = getWebcamOverlayDimensionsPx({
					containerWidth: overlay.clientWidth,
					containerHeight: overlay.clientHeight,
					widthPercent: webcamWidth,
					heightPercent: webcamHeight,
					margin: scaledMargin,
					zoomScale,
					reactToZoom: webcamReactToZoom,
				});
				const scaledRadius = getWebcamCornerRadiusPx(
					webcamRoundness,
					scaledDimensions.width,
					scaledDimensions.height,
				);
				const { x, y } = getWebcamOverlayPosition({
					containerWidth: overlay.clientWidth,
					containerHeight: overlay.clientHeight,
					width: scaledDimensions.width,
					height: scaledDimensions.height,
					margin: scaledMargin,
					positionPreset: webcamPositionPreset,
					positionX: webcamPositionX,
					positionY: webcamPositionY,
					legacyCorner: webcamCorner,
				});

				bubble.style.display = "block";
				bubble.style.left = `${x}px`;
				bubble.style.top = `${y}px`;
				bubble.style.width = `${scaledDimensions.width}px`;
				bubble.style.height = `${scaledDimensions.height}px`;
				bubble.style.aspectRatio = `${scaledDimensions.width} / ${scaledDimensions.height}`;
				const squirclePath = getSquircleSvgPath({
					x: 0,
					y: 0,
					width: scaledDimensions.width,
					height: scaledDimensions.height,
					radius: scaledRadius,
				});
				const shadowSize = Math.min(scaledDimensions.width, scaledDimensions.height);
				bubble.style.filter = getWebcamShadowFilter(shadowSize, webcamShadow);
				bubble.style.borderRadius = "0px";
				bubble.style.boxShadow = "none";

				bubbleInner.style.borderRadius = "0px";
				bubbleInner.style.overflow = "hidden";
				bubbleInner.style.contain = "paint";
				bubbleInner.style.clipPath = `path('${squirclePath}')`;
				bubbleInner.style.setProperty("-webkit-clip-path", `path('${squirclePath}')`);
			},
			[
				webcamCorner,
				webcamRoundness,
				webcam,
				webcamEnabled,
				webcamMargin,
				webcamPositionPreset,
				webcamPositionX,
				webcamPositionY,
				webcamReactToZoom,
				webcamShadow,
				webcamHeight,
				webcamVideoPath,
				webcamWidth,
			],
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

		const syncPreviewMotionBlurQuality = useCallback(() => {
			const app = appRef.current;
			const videoEffectsContainer = videoEffectsContainerRef.current;
			const zoomBlurFilter = zoomBlurFilterRef.current;
			const motionBlurFilter = motionBlurFilterRef.current;

			if (!app || !videoEffectsContainer || !motionBlurFilter || !zoomBlurFilter) {
				return;
			}

			const filterResolution = Math.max(
				1,
				app.renderer.resolution || window.devicePixelRatio || 1,
			);
			const stageWidth = Math.max(1, stageSizeRef.current.width || app.screen.width);
			const stageHeight = Math.max(1, stageSizeRef.current.height || app.screen.height);

			motionBlurFilter.resolution = filterResolution;
			zoomBlurFilter.resolution = filterResolution;
			cursorOverlayRef.current?.setFilterResolution(filterResolution);
			videoEffectsContainer.filterArea = new Rectangle(0, 0, stageWidth, stageHeight);
		}, []);

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
				frameInsets: null,
			});

			if (result) {
				stageSizeRef.current = result.stageSize;
				setPreviewViewportWidth((current) =>
					Math.abs(current - result.stageSize.width) < 0.5
						? current
						: result.stageSize.width,
				);
				syncPreviewMotionBlurQuality();
				videoSizeRef.current = result.videoSize;
				baseScaleRef.current = result.baseScale;
				baseOffsetRef.current = result.baseOffset;
				const renderResolution = app.renderer.resolution || window.devicePixelRatio || 1;
				baseMaskRef.current = {
					...result.maskRect,
					renderWidth: result.maskRect.width * renderResolution,
					renderHeight: result.maskRect.height * renderResolution,
				};
				setAnnotationRecordingRect((current) => {
					if (
						Math.abs(current.x - result.maskRect.x) < 0.1 &&
						Math.abs(current.y - result.maskRect.y) < 0.1 &&
						Math.abs(current.width - result.maskRect.width) < 0.1 &&
						Math.abs(current.height - result.maskRect.height) < 0.1
					) {
						return current;
					}

					return {
						x: result.maskRect.x,
						y: result.maskRect.y,
						width: result.maskRect.width,
						height: result.maskRect.height,
					};
				});
				cropBoundsRef.current = result.cropBounds;

				// Layout updates the media geometry, not the composed camera pose.
				// In particular, a ResizeObserver notification while paused must not
				// replace the exported spring position with an unzoomed frame.

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
			applyWebcamBubbleLayout,
			syncPreviewMotionBlurQuality,
		]);

		useEffect(() => {
			const video = videoRef.current;
			if (!video) return;

			enablePitchPreservingPlayback(video);
			const nextVolume = Math.max(0, Math.min(1, volume));
			video.volume = nextVolume;
			video.muted = nextVolume <= 0.001;
		}, [volume]);

		useEffect(() => {
			layoutVideoContentRef.current = layoutVideoContent;
		}, [layoutVideoContent]);

		// Always re-run geometric layout when layout props change, even if frame sprite isn't reloaded.
		useEffect(() => {
			layoutVideoContent();
		}, [layoutVideoContent]);

		const selectedZoom = useMemo(() => {
			if (!selectedZoomId) return null;
			return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
		}, [zoomRegions, selectedZoomId]);

		useImperativeHandle(ref, () => ({
			get isPlaying() {
				return clipPlaybackRef.current?.isPlaying ?? false;
			},
			seekTimeline: (time) => clipPlaybackRef.current?.seek(time),
			video: videoRef.current,
			app: appRef.current,
			videoSprite: videoSpriteRef.current,
			videoContainer: videoContainerRef.current,
			containerRef,
			play: async () => {
				await clipPlaybackRef.current?.play();
			},
			pause: () => {
				clipPlaybackRef.current?.pause();
			},
			cancelCaptionEdit,
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
			requestPausedFrameRefresh();
		}, [zoomRegions, requestPausedFrameRefresh]);

		useEffect(() => {
			selectedZoomIdRef.current = selectedZoomId;
		}, [selectedZoomId]);

		useEffect(() => {
			isPlayingRef.current = isPlaying;
			const bgVideo = bgVideoRef.current;
			if (bgVideo) {
				if (isPlaying) {
					bgVideo.play().catch(() => undefined);
				} else {
					bgVideo.pause();
				}
			}
		}, [isPlaying]);

		useEffect(() => {
			suspendRenderingRef.current = suspendRendering;
			if (!pixiReady) return;
			const app = appRef.current;
			if (!app?.ticker) {
				return;
			}

			if (suspendRendering) {
				app.ticker.stop();
				bgVideoRef.current?.pause();
				webcamVideoRef.current?.pause();
				layoutVideoContentRef.current?.();
				const videoTextureSource = videoSpriteRef.current?.texture?.source as
					| { update?: () => void }
					| undefined;
				videoTextureSource?.update?.();
				app.render();
				return;
			}

			app.ticker.start();
			const video = videoRef.current;
			if (video) {
				const targetTime = clampMediaTimeToDuration(
					currentTimeRef.current / 1000,
					Number.isFinite(video.duration) ? video.duration : null,
				);
				if (Math.abs(video.currentTime - targetTime) > 0.001) {
					try {
						video.currentTime = targetTime;
					} catch {
						// no-op
					}
				}
			}
			layoutVideoContentRef.current?.();
			const videoTextureSource = videoSpriteRef.current?.texture?.source as
				| { update?: () => void }
				| undefined;
			videoTextureSource?.update?.();
			requestAnimationFrame(() => {
				appRef.current?.render();
			});
			if (isPlayingRef.current) {
				bgVideoRef.current?.play().catch(() => undefined);
				webcamVideoRef.current?.play().catch(() => undefined);
			}
		}, [pixiReady, suspendRendering]);

		// Backgrounds run on the output timeline, including empty clip intervals.
		useEffect(() => {
			const bgVideo = bgVideoRef.current;
			if (!bgVideo) return;

			const clipTimelineTime = timelineTime;
			const videoDuration =
				Number.isFinite(bgVideo.duration) && bgVideo.duration > 0 ? bgVideo.duration : null;
			const targetTime = videoDuration
				? clipTimelineTime % videoDuration
				: clampMediaTimeToDuration(clipTimelineTime, videoDuration);

			enablePitchPreservingPlayback(bgVideo);
			const syncedPlaybackRate = getMediaSyncPlaybackRate({
				basePlaybackRate: 1,
				currentTime: bgVideo.currentTime,
				targetTime,
				toleranceSeconds: 0.02,
				correctionWindowSeconds: 1.5,
				maxAdjustment: 0.12,
			});
			if (Math.abs(bgVideo.playbackRate - syncedPlaybackRate) > 0.001) {
				bgVideo.playbackRate = syncedPlaybackRate;
			}

			const previousTimelineTime = lastBackgroundSyncTimeRef.current;
			const timelineJumped =
				previousTimelineTime === null ||
				Math.abs(clipTimelineTime - previousTimelineTime) > 0.25;
			const driftThreshold = isPlaying ? 0.35 : 0.01;
			if (timelineJumped || Math.abs(bgVideo.currentTime - targetTime) > driftThreshold) {
				try {
					bgVideo.currentTime = targetTime;
				} catch {
					// no-op
				}
			}

			if (isPlaying) {
				const playPromise = bgVideo.play();
				if (playPromise) {
					playPromise.catch(() => undefined);
				}
			} else {
				bgVideo.pause();
			}

			lastBackgroundSyncTimeRef.current = clipTimelineTime;
		}, [timelineTime, isPlaying]);

		useEffect(() => {
			if (!pixiReady) return;
			const videoEffectsContainer = videoEffectsContainerRef.current;
			const zoomBlurFilter = zoomBlurFilterRef.current;
			const motionBlurFilter = motionBlurFilterRef.current;

			if (!videoEffectsContainer || !motionBlurFilter || !zoomBlurFilter) {
				return;
			}

			videoEffectsContainer.filters =
				(zoomMotionBlurRef.current ?? 0) > 0 ? [motionBlurFilter, zoomBlurFilter] : null;
			motionBlurFilter.velocity = { x: 0, y: 0 };
			motionBlurFilter.kernelSize = 5;
			motionBlurFilter.offset = 0;
			zoomBlurFilter.strength = 0;
			zoomBlurFilter.innerRadius = 0;
			zoomBlurFilter.radius = -1;
			motionBlurStateRef.current = createMotionBlurState();
		}, [pixiReady]);

		useEffect(() => {
			connectZoomsRef.current = connectZooms;
			requestPausedFrameRefresh();
		}, [connectZooms, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomInDurationMsRef.current = zoomInDurationMs;
			requestPausedFrameRefresh();
		}, [zoomInDurationMs, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomInOverlapMsRef.current = zoomInOverlapMs;
			requestPausedFrameRefresh();
		}, [zoomInOverlapMs, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomOutDurationMsRef.current = zoomOutDurationMs;
			requestPausedFrameRefresh();
		}, [zoomOutDurationMs, requestPausedFrameRefresh]);

		useEffect(() => {
			connectedZoomGapMsRef.current = connectedZoomGapMs;
			requestPausedFrameRefresh();
		}, [connectedZoomGapMs, requestPausedFrameRefresh]);

		useEffect(() => {
			connectedZoomDurationMsRef.current = connectedZoomDurationMs;
			requestPausedFrameRefresh();
		}, [connectedZoomDurationMs, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomInEasingRef.current = zoomInEasing;
			requestPausedFrameRefresh();
		}, [zoomInEasing, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomOutEasingRef.current = zoomOutEasing;
			requestPausedFrameRefresh();
		}, [zoomOutEasing, requestPausedFrameRefresh]);

		useEffect(() => {
			connectedZoomEasingRef.current = connectedZoomEasing;
			requestPausedFrameRefresh();
		}, [connectedZoomEasing, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorTelemetryRef.current = cursorTelemetry;
			requestPausedFrameRefresh();
		}, [cursorTelemetry, requestPausedFrameRefresh]);

		useEffect(() => {
			showCursorRef.current = showCursor;
			requestPausedFrameRefresh();
		}, [showCursor, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorStyleRef.current = cursorStyle;
			requestPausedFrameRefresh();
		}, [cursorStyle, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorSizeRef.current = cursorSize;
			requestPausedFrameRefresh();
		}, [cursorSize, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorSmoothingRef.current = cursorSmoothing;
			requestPausedFrameRefresh();
		}, [cursorSmoothing, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorSpringStiffnessMultiplierRef.current = cursorSpringStiffnessMultiplier;
			requestPausedFrameRefresh();
		}, [cursorSpringStiffnessMultiplier, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorSpringDampingMultiplierRef.current = cursorSpringDampingMultiplier;
			requestPausedFrameRefresh();
		}, [cursorSpringDampingMultiplier, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorSpringMassMultiplierRef.current = cursorSpringMassMultiplier;
			requestPausedFrameRefresh();
		}, [cursorSpringMassMultiplier, requestPausedFrameRefresh]);

		useEffect(() => {
			cameraSpringStiffnessMultiplierRef.current = cameraSpringStiffnessMultiplier;
			requestPausedFrameRefresh();
		}, [cameraSpringStiffnessMultiplier, requestPausedFrameRefresh]);

		useEffect(() => {
			cameraSpringDampingMultiplierRef.current = cameraSpringDampingMultiplier;
			requestPausedFrameRefresh();
		}, [cameraSpringDampingMultiplier, requestPausedFrameRefresh]);

		useEffect(() => {
			cameraSpringMassMultiplierRef.current = cameraSpringMassMultiplier;
			requestPausedFrameRefresh();
		}, [cameraSpringMassMultiplier, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomSmoothnessRef.current = zoomSmoothness;
			requestPausedFrameRefresh();
		}, [zoomSmoothness, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomMotionBlurRef.current = zoomMotionBlur;
			requestPausedFrameRefresh();

			const videoEffectsContainer = videoEffectsContainerRef.current;
			const zoomBlurFilter = zoomBlurFilterRef.current;
			const motionBlurFilter = motionBlurFilterRef.current;

			if (!videoEffectsContainer || !zoomBlurFilter || !motionBlurFilter) {
				return;
			}

			motionBlurStateRef.current = createMotionBlurState();
			videoEffectsContainer.filters =
				zoomMotionBlur > 0 ? [motionBlurFilter, zoomBlurFilter] : null;
		}, [zoomMotionBlur, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomMotionBlurTuningRef.current = zoomMotionBlurTuning;
			requestPausedFrameRefresh();
		}, [zoomMotionBlurTuning, requestPausedFrameRefresh]);

		useEffect(() => {
			zoomClassicModeRef.current = zoomClassicMode;
			requestPausedFrameRefresh();
		}, [zoomClassicMode, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorMotionBlurRef.current = cursorMotionBlur;
			requestPausedFrameRefresh();
		}, [cursorMotionBlur, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickEffectRef.current = cursorClickEffect;
			requestPausedFrameRefresh();
		}, [cursorClickEffect, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickEffectColorRef.current = cursorClickEffectColor;
			requestPausedFrameRefresh();
		}, [cursorClickEffectColor, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickEffectScaleRef.current = cursorClickEffectScale;
			requestPausedFrameRefresh();
		}, [cursorClickEffectScale, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickEffectOpacityRef.current = cursorClickEffectOpacity;
			requestPausedFrameRefresh();
		}, [cursorClickEffectOpacity, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickEffectDurationMsRef.current = cursorClickEffectDurationMs;
			requestPausedFrameRefresh();
		}, [cursorClickEffectDurationMs, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickBounceRef.current = cursorClickBounce;
			requestPausedFrameRefresh();
		}, [cursorClickBounce, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorClickBounceDurationRef.current = cursorClickBounceDuration;
			requestPausedFrameRefresh();
		}, [cursorClickBounceDuration, requestPausedFrameRefresh]);

		useEffect(() => {
			cursorSwayRef.current = cursorSway;
			requestPausedFrameRefresh();
		}, [cursorSway, requestPausedFrameRefresh]);

		useEffect(() => {
			const timeMs = currentTime * 1000;
			currentTimeRef.current = timeMs;
		}, [currentTime]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			animationStateRef.current = createPlaybackAnimationState();
			cursorOverlayRef.current?.reset();
			motionBlurStateRef.current = createMotionBlurState();
			layoutVideoContent();
			// The next ticker frame applies the current zoom; layout must never stop playback.
			shouldSnapPausedFrameRef.current = true;
		}, [pixiReady, videoReady, layoutVideoContent]);

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
		}, [applyWebcamBubbleLayout, pixiReady, videoReady]);

		const syncWebcamMedia = useCallback(() => {
			const webcamVideo = webcamVideoRef.current;
			if (!webcamVideo || !webcamEnabled || !webcamVideoPath) {
				return;
			}

			const webcamDuration = Number.isFinite(webcamVideo.duration)
				? webcamVideo.duration
				: null;
			const targetTime = getWebcamMediaTargetTimeSeconds({
				currentTime: currentTimeRef.current / 1000,
				webcamDuration,
				timeOffsetMs: webcamTimeOffsetMs,
			});
			const mediaTargetTime =
				targetTime <= 0 && webcamDuration !== null && webcamDuration > 0
					? Math.min(1 / 60, webcamDuration)
					: targetTime;

			if (
				webcamSynchronizedPathRef.current !== webcamVideoPath &&
				!isWebcamMediaSynchronized({
					currentTime: webcamVideo.currentTime,
					targetTime: mediaTargetTime,
					readyState: webcamVideo.readyState,
					isSeeking: webcamVideo.seeking,
				})
			) {
				webcamVideo.pause();
				if (
					webcamVideo.readyState >= HTMLMediaElement.HAVE_METADATA &&
					!webcamVideo.seeking &&
					Math.abs(webcamVideo.currentTime - mediaTargetTime) > 0.01
				) {
					try {
						webcamVideo.currentTime = mediaTargetTime;
					} catch {
						// The next media-ready event retries once the source accepts seeks.
					}
				}
				return;
			}

			if (webcamSynchronizedPathRef.current !== webcamVideoPath) {
				webcamSynchronizedPathRef.current = webcamVideoPath;
				setWebcamSynchronizedPath(webcamVideoPath);
				lastWebcamSyncTimeRef.current = targetTime;
			}

			const targetPlaybackRate =
				findClipAtTimelineTime(timelineTime * 1000, clipRegions)?.speed ?? 1;
			if (!supportsPreviewPlaybackRate(targetPlaybackRate)) {
				webcamVideo.pause();
				return;
			}
			enablePitchPreservingPlayback(webcamVideo);
			if (Math.abs(webcamVideo.playbackRate - targetPlaybackRate) > 0.001) {
				webcamVideo.playbackRate = targetPlaybackRate;
			}

			const previousTimelineTime = lastWebcamSyncTimeRef.current;
			if (
				shouldSeekWebcamMedia({
					desiredTime: mediaTargetTime,
					isPlaying,
					isSeeking: webcamVideo.seeking,
					previousTimelineTime,
					timelineTime: targetTime,
					webcamCurrentTime: webcamVideo.currentTime,
				})
			) {
				try {
					webcamVideo.currentTime = mediaTargetTime;
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
		}, [
			timelineTime,
			clipRegions,
			isPlaying,
			webcamEnabled,
			webcamTimeOffsetMs,
			webcamVideoPath,
		]);

		const handleWebcamMediaReady = useCallback(
			(event: React.SyntheticEvent<HTMLVideoElement>) => {
				const video = event.currentTarget;
				if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
					setWebcamVideoDimensions({
						width: video.videoWidth,
						height: video.videoHeight,
					});
				}
				syncWebcamMedia();
			},
			[syncWebcamMedia],
		);

		useEffect(() => {
			syncWebcamMedia();
		}, [syncWebcamMedia]);

		// biome-ignore lint/correctness/useExhaustiveDependencies: The media path intentionally triggers source-specific state reset.
		useEffect(() => {
			webcamSynchronizedPathRef.current = null;
			setWebcamSynchronizedPath(null);
			setWebcamVideoDimensions(null);
			lastWebcamSyncTimeRef.current = null;
		}, [webcamVideoPath]);

		// biome-ignore lint/correctness/useExhaustiveDependencies: The wallpaper identity intentionally resets media synchronization.
		useEffect(() => {
			lastBackgroundSyncTimeRef.current = null;
		}, [wallpaper]);

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

				app = await initializePixiRenderer(container);

				app.ticker.maxFPS = 60;

				if (!mounted) {
					destroyPixiApplication(app, "unmounted preview renderer");
					return;
				}

				appRef.current = app;
				container.appendChild(app.canvas);

				// A lost WebGL context (common after Windows reclaims GPU resources
				// from a window minimized/occluded for a long time) leaves the canvas
				// permanently black with no further Pixi errors. Force a full
				// teardown/recreate rather than relying on browser-level restore,
				// which PixiJS does not reliably resume from.
				const canvasEl = app.canvas as unknown as HTMLCanvasElement;
				const handleContextLost = (event: Event) => {
					event.preventDefault();
					console.warn("Preview renderer lost its GPU context; recreating.");
					setRendererGeneration((generation) => generation + 1);
				};
				canvasEl.addEventListener("webglcontextlost", handleContextLost, false);
				contextLostCleanupRef.current = () =>
					canvasEl.removeEventListener("webglcontextlost", handleContextLost, false);

				// Camera container - this will be scaled/positioned for zoom
				const cameraContainer = new Container();
				cameraContainerRef.current = cameraContainer;
				app.stage.addChild(cameraContainer);

				// Match the export scene graph so zoom motion blur is applied to the
				// same layer in preview and export.
				const videoEffectsContainer = new Container();
				videoEffectsContainerRef.current = videoEffectsContainer;
				zoomBlurFilterRef.current = new ZoomBlurFilter({ strength: 0, maxKernelSize: 13 });
				motionBlurFilterRef.current = new MotionBlurFilter([0, 0], 5, 0);
				videoEffectsContainer.filters = [
					motionBlurFilterRef.current,
					zoomBlurFilterRef.current,
				];
				cameraContainer.addChild(videoEffectsContainer);
				syncPreviewMotionBlurQuality();

				// Video container - holds the masked video sprite
				const videoContainer = new Container();
				videoContainerRef.current = videoContainer;
				videoEffectsContainer.addChild(videoContainer);

				const cursorContainer = new Container();
				cursorContainerRef.current = cursorContainer;
				cameraContainer.addChild(cursorContainer);

				// Cursor overlay - rendered above the masked video so it can sit in front
				// of the content without getting clipped.
				if (cursorOverlayEnabled) {
					const cursorOverlay = new PixiCursorOverlay({
						dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius * cursorSizeRef.current,
						minViewportScale: 0,
						style: cursorStyleRef.current,
						smoothingFactor: cursorSmoothingRef.current,
						springTuning: {
							stiffnessMultiplier: cursorSpringStiffnessMultiplierRef.current,
							dampingMultiplier: cursorSpringDampingMultiplierRef.current,
							massMultiplier: cursorSpringMassMultiplierRef.current,
						},
						motionBlur: cursorMotionBlurRef.current,
						clickEffect: cursorClickEffectRef.current,
						clickEffectColor: cursorClickEffectColorRef.current,
						clickEffectScale: cursorClickEffectScaleRef.current,
						clickEffectOpacity: cursorClickEffectOpacityRef.current,
						clickEffectDurationMs: cursorClickEffectDurationMsRef.current,
						clickBounce: cursorClickBounceRef.current,
						clickBounceDuration: cursorClickBounceDurationRef.current,
						sway: cursorSwayRef.current,
					});
					cursorOverlayRef.current = cursorOverlay;
					cursorOverlay.setFilterResolution(
						app.renderer.resolution || window.devicePixelRatio || 1,
					);
					cursorContainer.addChild(cursorOverlay.container);
				} else {
					cursorOverlayRef.current = null;
				}

				setPixiReady(true);
			})().catch((error) => {
				if (!mounted) return;
				console.error("Failed to initialize preview renderer:", error);
				onError(toRendererErrorMessage(error));
			});

			return () => {
				mounted = false;
				setPixiReady(false);
				if (cursorOverlayRef.current) {
					cursorOverlayRef.current.destroy();
					cursorOverlayRef.current = null;
				}
				if (videoEffectsContainerRef.current) {
					videoEffectsContainerRef.current.filters = null;
				}
				zoomBlurFilterRef.current?.destroy();
				motionBlurFilterRef.current?.destroy();
				zoomBlurFilterRef.current = null;
				motionBlurFilterRef.current = null;
				contextLostCleanupRef.current?.();
				contextLostCleanupRef.current = null;
				destroyPixiApplication(app, "preview renderer");
				appRef.current = null;
				cameraContainerRef.current = null;
				videoEffectsContainerRef.current = null;
				videoContainerRef.current = null;
				cursorContainerRef.current = null;
				videoSpriteRef.current = null;
			};
		}, [initializePixiRenderer, onError, syncPreviewMotionBlurQuality, rendererGeneration]);

		// Safety net for GPU context loss that doesn't fire `webglcontextlost`
		// (e.g. the WebGPU backend, or a stalled hidden <video> decoder session)
		// after the window was minimized/occluded for a long time.
		useEffect(() => {
			let hiddenAtMs: number | null = document.hidden ? performance.now() : null;
			const RECOVERY_THRESHOLD_MS = 60_000;

			const handleVisibilityChange = () => {
				if (document.hidden) {
					hiddenAtMs = performance.now();
					return;
				}

				if (hiddenAtMs !== null && performance.now() - hiddenAtMs >= RECOVERY_THRESHOLD_MS) {
					setRendererGeneration((generation) => generation + 1);
				}
				hiddenAtMs = null;
			};

			document.addEventListener("visibilitychange", handleVisibilityChange);
			return () => {
				document.removeEventListener("visibilitychange", handleVisibilityChange);
			};
		}, []);

		// biome-ignore lint/correctness/useExhaustiveDependencies: A new media path must reset the persistent video element.
		useEffect(() => {
			const video = videoRef.current;
			if (!video) return;
			video.pause();
			video.currentTime = 0;
			lastRenderedContentTimeRef.current = null;
			shouldSnapPausedFrameRef.current = true;
			lockedVideoDimensionsRef.current = null;
		}, [videoPath]);

		useEffect(() => {
			onPreviewReadyChange?.(videoReady);
		}, [onPreviewReadyChange, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const video = videoRef.current;
			const app = appRef.current;
			const videoEffectsContainer = videoEffectsContainerRef.current;
			const videoContainer = videoContainerRef.current;
			const cursorContainer = cursorContainerRef.current;
			const cameraContainer = cameraContainerRef.current;

			if (
				!video ||
				!app ||
				!videoEffectsContainer ||
				!videoContainer ||
				!cursorContainer ||
				!cameraContainer
			)
				return;
			if (video.videoWidth === 0 || video.videoHeight === 0) return;

			const source = previewVideoSourceRef.current.getSource();
			const videoTexture = Texture.from(source);

			const videoSprite = new Sprite(videoTexture);
			videoSpriteRef.current = videoSprite;

			const maskGraphics = new Graphics();
			videoContainer.addChild(videoSprite);
			cameraContainer.addChild(maskGraphics);
			videoEffectsContainer.mask = maskGraphics;
			maskGraphicsRef.current = maskGraphics;
			if (cursorOverlayRef.current) {
				cursorContainer.addChild(cursorOverlayRef.current.container);
			}

			animationStateRef.current = createPlaybackAnimationState();

			layoutVideoContentRef.current?.();
			video.pause();

			let preserveCameraAcrossCut = false;
			const transport = createClipPlayback({
				video,
				getClips: () => clipRegionsRef.current,
				onSourceSeek: (reason) => {
					preserveCameraAcrossCut = reason === "cut";
				},
				onTime: (time, source) => {
					timelineTimeRef.current = time;
					if (source !== null) currentTimeRef.current = source * 1000;
					onTimeUpdate(time);
				},
				onPlaying: (playing) => {
					isPlayingRef.current = playing;
					onPlayStateChange(playing);
				},
				onError: (error) =>
					onPlaybackErrorRef.current(
						error instanceof Error ? error.message : String(error),
					),
			});
			clipPlaybackRef.current = transport;
			transport.seek(timelineTimeRef.current);
			if (autoPlay)
				void transport.play().catch((error) => onPlaybackErrorRef.current(String(error)));
			const handleSeeked = () => {
				isSeekingRef.current = false;
				// A source seek at a contiguous cut must not reset the camera springs.
				if (!preserveCameraAcrossCut || !isPlayingRef.current)
					shouldSnapPausedFrameRef.current = true;
				preserveCameraAcrossCut = false;
			};
			const handleSeeking = () => {
				isSeekingRef.current = true;
				if (!preserveCameraAcrossCut) shouldSnapPausedFrameRef.current = true;
			};
			video.addEventListener("seeked", handleSeeked);
			video.addEventListener("seeking", handleSeeking);

			return () => {
				video.removeEventListener("seeked", handleSeeked);
				video.removeEventListener("seeking", handleSeeking);
				transport.dispose();
				clipPlaybackRef.current = null;

				videoEffectsContainer.mask = null;
				videoContainer.mask = null;
				destroyPixiContainer(videoSprite);
				destroyPixiContainer(maskGraphics);
				maskGraphicsRef.current = null;
				if (!videoTexture.destroyed) videoTexture.destroy(false);
				previewVideoSourceRef.current.suspend();

				videoSpriteRef.current = null;
			};
		}, [autoPlay, onPlayStateChange, onTimeUpdate, pixiReady, videoReady]);

		useEffect(() => {
			if (!pixiReady || !videoReady) return;

			const app = appRef.current;
			const videoSprite = videoSpriteRef.current;
			const videoEffectsContainer = videoEffectsContainerRef.current;
			const videoContainer = videoContainerRef.current;
			if (!app || !videoSprite || !videoEffectsContainer || !videoContainer) return;

			const applyTransform = (
				transform: { scale: number; x: number; y: number },
				focus: ZoomFocus,
			) => {
				const cameraContainer = cameraContainerRef.current;
				if (!cameraContainer) return;

				const state = animationStateRef.current;

				const appliedTransform = applyZoomTransform({
					cameraContainer,
					zoomBlurFilter: zoomBlurFilterRef.current,
					motionBlurFilter: motionBlurFilterRef.current,
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: focus.cx,
					focusY: focus.cy,
					isPlaying: isPlayingRef.current,
					motionBlurAmount: zoomMotionBlurRef.current,
					motionBlurTuning: zoomMotionBlurTuningRef.current,
					transformOverride: transform,
					motionBlurState: motionBlurStateRef.current,
					frameTimeMs: timelineTimeRef.current * 1000,
				});

				state.x = appliedTransform.x;
				state.y = appliedTransform.y;
				state.appliedScale = appliedTransform.scale;
				setAnnotationSceneTransform((current) => {
					if (
						Math.abs(current.scale - appliedTransform.scale) < 0.001 &&
						Math.abs(current.x - appliedTransform.x) < 0.1 &&
						Math.abs(current.y - appliedTransform.y) < 0.1
					) {
						return current;
					}

					return {
						scale: appliedTransform.scale,
						x: appliedTransform.x,
						y: appliedTransform.y,
					};
				});
			};

			const ticker = () => {
				if (suspendRenderingRef.current) {
					return;
				}

				// The export compositor advances exactly once for each output timestamp.
				// Do the same here: repeated Pixi ticks at one media timestamp must not
				// advance cursor springs or clear the blur calculated for that frame.
				const contentTimeMs = timelineTimeRef.current * 1000;
				const previousContentTimeMs = lastRenderedContentTimeRef.current;
				const deltaMs =
					previousContentTimeMs !== null
						? contentTimeMs - previousContentTimeMs
						: 1000 / 60;
				const contentTimeChanged =
					previousContentTimeMs === null || Math.abs(deltaMs) > 0.0001;
				const motionMode = resolvePreviewMotionMode({
					isPlaying: isPlayingRef.current,
					isSeeking: isSeekingRef.current,
					shouldSnapPausedFrame: shouldSnapPausedFrameRef.current,
					zoomClassicMode: zoomClassicModeRef.current,
				});
				if (
					!shouldComposePreviewFrame({
						motionMode,
						isSeeking: isSeekingRef.current || Boolean(videoRef.current?.seeking),
						contentTimeChanged,
						shouldSnapPausedFrame: shouldSnapPausedFrameRef.current,
					})
				) {
					return;
				}
				lastRenderedContentTimeRef.current = contentTimeMs;

				const target = resolveSceneZoomTarget({
					zoomRegions: zoomRegionsRef.current,
					timeMs: timelineTimeRef.current * 1000,
					cursorTimeMs: currentTimeRef.current,
					connectZooms: connectZoomsRef.current,
					zoomInDurationMs: zoomInDurationMsRef.current,
					zoomOutDurationMs: zoomOutDurationMsRef.current,
					zoomClassicMode: zoomClassicModeRef.current,
					cursorTelemetry: cursorTelemetryRef.current,
					cursorFollowCamera: cursorFollowCameraRef.current,
				});

				const state = animationStateRef.current;

				state.scale = target.scale;
				state.focusX = target.focus.cx;
				state.focusY = target.focus.cy;
				state.progress = target.progress;

				const projectedTransform = computeZoomTransform({
					stageSize: stageSizeRef.current,
					baseMask: baseMaskRef.current,
					zoomScale: state.scale,
					zoomProgress: state.progress,
					focusX: state.focusX,
					focusY: state.focusY,
				});

				// Advance scene motion from the source frame's media timestamp, exactly as
				// export does. Wall-clock ticker time makes speed regions and dropped UI
				// frames produce a different camera path from the encoded output.
				const contentAdvanced = previousContentTimeMs === null || deltaMs > 0;

				const zoomSpringConfig = getZoomSpringConfig(zoomSmoothnessRef.current, {
					stiffnessMultiplier: cameraSpringStiffnessMultiplierRef.current,
					dampingMultiplier: cameraSpringDampingMultiplierRef.current,
					massMultiplier: cameraSpringMassMultiplierRef.current,
				});
				let appliedScale: number;
				let appliedX: number;
				let appliedY: number;

				if (motionMode === "spring" && contentAdvanced) {
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
				} else if (motionMode === "snap") {
					// Timeline seeks and classic mode intentionally evaluate the exact target.
					appliedScale = projectedTransform.scale;
					appliedX = projectedTransform.x;
					appliedY = projectedTransform.y;
					resetSpringState(springScaleRef.current, appliedScale);
					resetSpringState(springXRef.current, appliedX);
					resetSpringState(springYRef.current, appliedY);
				} else {
					appliedScale = state.appliedScale;
					appliedX = state.x;
					appliedY = state.y;
				}

				applyTransform({ scale: appliedScale, x: appliedX, y: appliedY }, target.focus);

				applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);

				const timeMs = currentTimeRef.current;
				const cursorOverlay = cursorOverlayRef.current;
				if (cursorOverlay) {
					cursorOverlay.update(
						cursorTelemetryRef.current,
						timeMs,
						baseMaskRef.current,
						showCursorRef.current,
						isSeekingRef.current || shouldSnapPausedFrameRef.current,
					);
				}

				// Seeking events request one exact composition. Further Pixi ticks at the
				// same media timestamp must hold it just like an exported frame.
				if (shouldSnapPausedFrameRef.current) {
					shouldSnapPausedFrameRef.current = false;
				}
			};

			app.ticker.add(ticker);
			return () => {
				if (app && app.ticker) {
					app.ticker.remove(ticker);
				}
			};
		}, [pixiReady, videoReady, applyWebcamBubbleLayout]);

		useEffect(() => {
			const overlay = cursorOverlayRef.current;
			if (!pixiReady || !overlay) {
				return;
			}

			let cancelled = false;

			overlay.setDotRadius(DEFAULT_CURSOR_CONFIG.dotRadius * cursorSize);
			overlay.setSmoothingFactor(cursorSmoothing);
			overlay.setSpringTuning({
				stiffnessMultiplier: cursorSpringStiffnessMultiplier,
				dampingMultiplier: cursorSpringDampingMultiplier,
				massMultiplier: cursorSpringMassMultiplier,
			});
			overlay.setMotionBlur(cursorMotionBlur);
			overlay.setClickEffect(cursorClickEffect);
			overlay.setClickEffectColor(cursorClickEffectColor);
			overlay.setClickEffectScale(cursorClickEffectScale);
			overlay.setClickEffectOpacity(cursorClickEffectOpacity);
			overlay.setClickEffectDurationMs(cursorClickEffectDurationMs);
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
				requestPausedFrameRefresh();
			})();

			return () => {
				cancelled = true;
			};
		}, [
			pixiReady,
			requestPausedFrameRefresh,
			cursorStyle,
			cursorSize,
			cursorSmoothing,
			cursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier,
			cursorSpringMassMultiplier,
			cursorMotionBlur,
			cursorClickEffect,
			cursorClickEffectColor,
			cursorClickEffectScale,
			cursorClickEffectOpacity,
			cursorClickEffectDurationMs,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
		]);

		const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
			const video = e.currentTarget;
			onDurationChange(video.duration);

			const targetTime = clampMediaTimeToDuration(
				currentTime,
				Number.isFinite(video.duration) ? video.duration : null,
			);
			if (Math.abs(video.currentTime - targetTime) > 1e-8) video.currentTime = targetTime;
			video.pause();
			currentTimeRef.current = targetTime * 1000;
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
						const videoSrc = await getRenderableVideoUrl(wallpaper);
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
		const sceneEffects = getSceneEffectMetrics({
			viewportWidth: previewViewportWidth,
			backgroundBlur,
			shadowIntensity: showShadow ? shadowIntensity : 0,
		});
		const captionFontFamily = autoCaptionSettings?.fontFamily || getDefaultCaptionFontFamily();
		// Overscan blurred wallpaper layers so the browser never samples transparent
		// pixels beyond the preview bounds, which otherwise looks like a vignette.
		const backgroundBlurOverscan = sceneEffects.backgroundOverscanPx;
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
				ref={previewFrameRef}
				className="relative overflow-hidden"
				style={{
					width: "100%",
					aspectRatio: formatAspectRatioForCSS(aspectRatio, nativeAspectRatio),
					borderRadius: 0,
					clipPath: "none",
				}}
			>
				{/* Background layer */}
				{resolvedWallpaperKind === "video" && resolvedWallpaper ? (
					<video
						key={resolvedWallpaper}
						ref={bgVideoRef}
						className="absolute object-cover"
						src={resolvedWallpaper}
						muted
						loop
						playsInline
						style={{
							filter:
								sceneEffects.backgroundBlurPx > 0
									? `blur(${sceneEffects.backgroundBlurPx}px)`
									: "none",
							inset: -backgroundBlurOverscan,
							width: `calc(100% + ${backgroundBlurOverscan * 2}px)`,
							height: `calc(100% + ${backgroundBlurOverscan * 2}px)`,
						}}
					/>
				) : (
					<div
						className="absolute inset-0 bg-cover bg-center"
						style={{
							...backgroundStyle,
							filter:
								sceneEffects.backgroundBlurPx > 0
									? `blur(${sceneEffects.backgroundBlurPx}px)`
									: "none",
							inset: -backgroundBlurOverscan,
						}}
					/>
				)}
				<div
					ref={containerRef}
					className="absolute inset-0"
					style={{
						filter: sceneEffects.shadowFilter,
						visibility: isGap ? "hidden" : "visible",
					}}
				/>
				{/* Only render overlay after PIXI and video are fully initialized */}
				{pixiReady && videoReady && (
					<div
						ref={overlayRef}
						data-preview-overlay
						className="absolute inset-0 select-none"
						style={{
							pointerEvents: "none",
							visibility: isGap ? "hidden" : "visible",
						}}
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
								data-webcam-overlay
								className="absolute"
								style={{
									display:
										webcam.enabled &&
										!isGap &&
										isWebcamVisibleAtSourceTime(webcam, currentTime)
											? "block"
											: "none",
									pointerEvents: "none",
								}}
							>
								<div
									ref={webcamBubbleInnerRef}
									className="relative h-full w-full overflow-hidden"
								>
									<div
										className="pointer-events-none absolute inset-0 overflow-hidden"
										style={{
											opacity:
												webcamVideoDimensions && webcamMediaSynchronized
													? 1
													: 0,
											transform: webcamMirror ? "scaleX(-1)" : undefined,
										}}
									>
										<div
											className="pointer-events-none absolute"
											style={webcamCropPreviewContentStyle}
										>
											<video
												ref={webcamVideoRef}
												src={webcamVideoPath}
												className="pointer-events-none absolute inset-0 block h-full w-full object-fill"
												muted
												playsInline
												preload="auto"
												aria-hidden="true"
												onLoadedMetadata={handleWebcamMediaReady}
												onLoadedData={handleWebcamMediaReady}
												onCanPlay={handleWebcamMediaReady}
												onSeeked={handleWebcamMediaReady}
											/>
										</div>
									</div>
								</div>
							</div>
						) : null}
						{!isGap && activeCaptionLayout && autoCaptionSettings ? (
							<div
								className="absolute inset-x-0 flex justify-center"
								style={{
									bottom: `${autoCaptionSettings.bottomOffset}%`,
									pointerEvents: onEditAutoCaption ? "auto" : "none",
								}}
							>
								<div
									style={{
										maxWidth: `${autoCaptionSettings.maxWidth}%`,
										opacity: activeCaptionLayout.opacity,
										transform: `translateY(${activeCaptionLayout.translateY}px) scale(${activeCaptionLayout.scale})`,
										transformOrigin: "center center",
									}}
								>
									<div
										ref={captionBoxRef}
										className="focus-visible:outline-2 focus-visible:outline-accent"
										role={
											onEditAutoCaption && !isCaptionEditing
												? "button"
												: undefined
										}
										tabIndex={
											onEditAutoCaption && !isCaptionEditing ? 0 : undefined
										}
										aria-label={
											onEditAutoCaption && !isCaptionEditing
												? "Edit current caption"
												: undefined
										}
										onClick={(event) => event.stopPropagation()}
										onDoubleClick={(event) => {
											event.stopPropagation();
											if (!isCaptionEditing) {
												beginCaptionEdit();
											}
										}}
										onPointerDown={(event) => {
											event.stopPropagation();
										}}
										onKeyDown={(event) => {
											if (!onEditAutoCaption || isCaptionEditing) {
												return;
											}

											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												beginCaptionEdit();
											}
										}}
										style={{
											backgroundColor: `rgba(0, 0, 0, ${autoCaptionSettings.backgroundOpacity})`,
											fontFamily: captionFontFamily,
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
											cursor:
												onEditAutoCaption && !isCaptionEditing
													? "text"
													: undefined,
											pointerEvents: onEditAutoCaption ? "auto" : undefined,
										}}
									>
										{captionEditSession ? (
											<textarea
												ref={captionEditInputRef}
												value={captionEditSession.draft}
												onChange={(event) => {
													const draft = event.target.value;
													setCaptionEditSession((session) => {
														const nextSession = session
															? { ...session, draft }
															: session;
														captionEditSessionRef.current = nextSession;
														return nextSession;
													});
												}}
												onBlur={commitCaptionEdit}
												onClick={(event) => event.stopPropagation()}
												onKeyDown={(event) => {
													if (event.key === "Escape") {
														event.preventDefault();
														cancelCaptionEdit();
														return;
													}

													if (event.key === "Enter" && !event.shiftKey) {
														event.preventDefault();
														event.currentTarget.blur();
													}
												}}
												rows={Math.max(
													1,
													activeCaptionLayout.visibleLines.length,
												)}
												aria-label="Edit current caption"
												style={{
													display: "block",
													width: `${
														captionEditTextMetrics?.widthPx ??
														Math.max(
															48,
															activeCaptionLayout.visibleLines.reduce(
																(width, line) =>
																	Math.max(width, line.width),
																0,
															),
														)
													}px`,
													maxWidth: `${
														captionEditTextMetrics?.maxTextWidthPx ??
														getCaptionTextMaxWidth(
															overlayRef.current?.clientWidth || 960,
															autoCaptionSettings.maxWidth,
															getCaptionScaledFontSize(
																autoCaptionSettings.fontSize,
																overlayRef.current?.clientWidth ||
																	960,
																autoCaptionSettings.maxWidth,
															),
														)
													}px`,
													minHeight: `${
														Math.max(
															1,
															activeCaptionLayout.visibleLines.length,
														) *
														(
															captionEditTextMetrics?.fontSize ??
																getCaptionScaledFontSize(
																	autoCaptionSettings.fontSize,
																	overlayRef.current
																		?.clientWidth || 960,
																	autoCaptionSettings.maxWidth,
																)
														) *
														CAPTION_LINE_HEIGHT
													}px`,
													resize: "none",
													border: "0",
													outline: "0",
													padding: "0",
													margin: "0",
													overflow: "hidden",
													background: "transparent",
													color: autoCaptionSettings.textColor,
													font: "inherit",
													lineHeight: "inherit",
													textAlign: "center",
												}}
											/>
										) : (
											activeCaptionLayout.visibleLines.map((line) => (
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
														const visualState =
															getCaptionWordVisualState(
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
											))
										)}
									</div>
								</div>
							</div>
						) : null}
						<div
							className="absolute inset-0"
							style={{
								pointerEvents: "none",
								transform: `matrix(${annotationSceneTransform.scale}, 0, 0, ${annotationSceneTransform.scale}, ${annotationSceneTransform.x}, ${annotationSceneTransform.y})`,
								transformOrigin: "top left",
							}}
						>
							<div
								className="absolute"
								style={{
									pointerEvents: "none",
									left: 0,
									top: 0,
									width: overlayRef.current?.clientWidth || 800,
									height: overlayRef.current?.clientHeight || 600,
								}}
							>
								{(() => {
									const timeMs = Math.round(timelineTime * 1000);
									const filtered = (annotationRegions || []).filter(
										(annotation) =>
											isAnnotationActiveAtTime(annotation, timeMs),
									);

									const sorted = [...filtered].sort(
										(a, b) => a.zIndex - b.zIndex,
									);

									const handleAnnotationClick = (clickedId: string) => {
										if (!onSelectAnnotation) return;

										if (
											clickedId === selectedAnnotationId &&
											sorted.length > 1
										) {
											const currentIndex = sorted.findIndex(
												(a) => a.id === clickedId,
											);
											const nextIndex = (currentIndex + 1) % sorted.length;
											onSelectAnnotation(sorted[nextIndex].id);
										} else {
											onSelectAnnotation(clickedId);
										}
									};

									return sorted.map((annotation) => (
										<AnnotationOverlay
											key={annotation.id}
											annotation={annotation}
											isSelected={annotation.id === selectedAnnotationId}
											containerWidth={
												annotationRecordingRect.width ||
												overlayRef.current?.clientWidth ||
												800
											}
											containerHeight={
												annotationRecordingRect.height ||
												overlayRef.current?.clientHeight ||
												600
											}
											recordingRect={{
												x: annotationRecordingRect.x,
												y: annotationRecordingRect.y,
												width:
													annotationRecordingRect.width ||
													overlayRef.current?.clientWidth ||
													800,
												height:
													annotationRecordingRect.height ||
													overlayRef.current?.clientHeight ||
													600,
											}}
											sceneTransform={{ scale: 1, x: 0, y: 0 }}
											interactionScale={annotationSceneTransform.scale}
											onPositionChange={(id, position) =>
												onAnnotationPositionChange?.(id, position)
											}
											onSizeChange={(id, size) =>
												onAnnotationSizeChange?.(id, size)
											}
											onClick={handleAnnotationClick}
											zIndex={annotation.zIndex}
											isSelectedBoost={annotation.id === selectedAnnotationId}
										/>
									));
								})()}
							</div>
						</div>
					</div>
				)}
				{/* Keep the source video off-screen instead of display:none so the
					browser continues producing presented frames for Pixi and preview sync. */}
				<video
					ref={attachVideo}
					src={videoPath}
					className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
					style={{ visibility: isGap ? "hidden" : "visible" }}
					preload="auto"
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
