import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	ClipRegion,
	CropRegion,
	CursorClickEffectStyle,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SourceAudioTrackSettings,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
	ZoomMotionBlurTuning,
	ZoomRegion,
	ZoomTransitionEasing,
} from "@/components/video-editor/types";
import { ZOOM_DEPTH_SCALES } from "@/components/video-editor/types";
import { DEFAULT_FOCUS } from "@/components/video-editor/videoPlayback/constants";
import {
	computeCursorFollowFocus,
	createCursorFollowCameraState,
	SNAP_TO_EDGES_RATIO_AUTO,
} from "@/components/video-editor/videoPlayback/cursorFollowCamera";
import {
	buildNativeCursorAtlas,
	DEFAULT_CURSOR_CONFIG,
	interpolateCursorPosition,
	type NativeCursorAtlas,
} from "@/components/video-editor/videoPlayback/cursorRenderer";
import { projectCursorPositionToViewport } from "@/components/video-editor/videoPlayback/cursorViewport";
import {
	computePaddedLayout,
	scalePreviewBorderRadius,
} from "@/components/video-editor/videoPlayback/layoutUtils";
import {
	createSpringState,
	getZoomSpringConfig,
	resetSpringState,
	stepSpringValue,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import { getCursorStyleSizeMultiplier } from "@/components/video-editor/videoPlayback/uploadedCursorAssets";
import { findDominantRegion } from "@/components/video-editor/videoPlayback/zoomRegionUtils";
import {
	analyzeZoomMotionBlurStep,
	computeZoomTransform,
} from "@/components/video-editor/videoPlayback/zoomTransform";
import {
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
} from "@/components/video-editor/webcamOverlay";
import { extensionHost } from "@/lib/extensions";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import {
	DEFAULT_WALLPAPER_PATH,
	DEFAULT_WALLPAPER_RELATIVE_PATH,
	isVideoWallpaperSource,
} from "@/lib/wallpapers";
import { formatLogTs } from "../log";
import { AudioProcessor, isAacAudioEncodingSupported } from "./audioEncoder";
import {
	normalizeLightningRuntimePlatform,
	shouldPreferNativeAutoBackend,
	shouldPreferNativeStaticLayoutBeforeBreeze,
} from "./backendPolicy";
import { type CursorRect, computeCursorSpriteStripSize } from "./cursorSpriteOverlay";
import { buildEditedTrackSourceSegments, classifyEditedTrackStrategy } from "./editedTrackStrategy";
import {
	type ExportBackpressureProfile,
	getExportBackpressureProfile,
	getNativeRawFrameBackpressureLimits,
	getNativeRawFrameByteSize,
	getPreferredWebCodecsLatencyModes,
	getWebCodecsEncodeQueueLimit,
	getWebCodecsKeyFrameInterval,
	NativeRawFrameBackpressureQueue,
} from "./exportTuning";
import {
	advanceFinalizationProgress,
	type FinalizationProgressWatchdog,
	type FinalizationTimeoutWorkload,
	INITIAL_FINALIZATION_PROGRESS_STATE,
	withFinalizationTimeout,
} from "./finalizationTimeout";
import { getLocalFilePath } from "./localMediaSource";
import { FrameRenderer as ModernFrameRenderer } from "./modernFrameRenderer";
import {
	getOrderedSupportedMp4EncoderCandidates,
	type SupportedMp4EncoderPath,
} from "./mp4Support";
import { VideoMuxer } from "./muxer";
import { captureCanvasFrameForNativeExport } from "./nativeFrameCapture";
import { roundNativeStaticLayoutContentSize } from "./nativeStaticLayoutGeometry";
import type {
	NativeCursorSpriteOverlayLayer,
	NativeCursorSpritePosition,
	NativeStaticLayoutOverlayLayer,
	NativeTiledOverlayFrameDelta,
	NativeTiledOverlayLayerDescriptor,
	NativeTiledOverlayRawFallbackReason,
	NativeTiledOverlayStaticTileRecord,
	NativeTiledOverlayTileRecord,
} from "./nativeStaticLayoutOverlays";
import {
	areNativeStaticLayoutOverlayFramesEqual,
	clampNativeCursorSpritePosition,
	getNativeStaticLayoutOverlayFrameByteSize,
	getNativeTiledOverlayTileColumns,
	getNativeTiledOverlayTileCount,
	getNativeTiledOverlayTileIndex,
	getNativeTiledOverlayTileRows,
	NATIVE_CURSOR_SPRITE_LAYER_KIND,
	NATIVE_TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION,
	NATIVE_TILED_OVERLAY_MAX_PAYLOAD_BYTES_FRACTION,
	NATIVE_TILED_OVERLAY_PIXEL_FORMAT,
	NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE,
	NATIVE_TILED_OVERLAY_TILE_SIZE,
	resolveNativeTiledOverlayRawFallbackReason,
	sortNativeStaticLayoutOverlayLayers,
	sortNativeTiledOverlayLayers,
	validateNativeCursorSpriteOverlayLayer,
} from "./nativeStaticLayoutOverlays";
import { buildNativeStaticLayoutCursorTelemetry } from "./nativeStaticLayoutTelemetry";
import { resolveSourceAudioFallbackPaths } from "./sourceAudioFallback";
import { type DecodedVideoInfo, StreamingVideoDecoder } from "./streamingDecoder";
import { getTemporalMotionBlurConfig } from "./temporalMotionBlur";
import type {
	ExportConfig,
	ExportEncodeBackend,
	ExportFfmpegAudioMuxBreakdown,
	ExportFinalizationStageMetrics,
	ExportMetrics,
	ExportNativeTransportMode,
	ExportProgress,
	ExportRenderBackend,
	ExportResult,
} from "./types";

interface VideoExporterConfig extends ExportConfig {
	videoUrl: string;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
	zoomMotionBlurTuning?: ZoomMotionBlurTuning;
	zoomTemporalMotionBlur?: number;
	zoomMotionBlurSampleCount?: number | null;
	zoomMotionBlurShutterFraction?: number | null;
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
	videoPadding?: Padding | number;
	cropRegion: CropRegion;
	webcam?: WebcamOverlaySettings;
	webcamUrl?: string | null;
	annotationRegions?: AnnotationRegion[];
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
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
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	frame?: string | null;
	audioRegions?: AudioRegion[];
	clipRegions?: ClipRegion[];
	sourceAudioFallbackPaths?: string[];
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
	sourceAudioTrackSettings?: SourceAudioTrackSettings;
	previewWidth?: number;
	previewHeight?: number;
	onProgress?: (progress: ExportProgress) => void;
	preferredEncoderPath?: SupportedMp4EncoderPath | null;
}

/**
 * Result shape for the native static-layout overlay sidecar. The renderer
 * currently composites every overlay element (cursor, captions, annotations,
 * webcam, frame) into a single transparent RGBA canvas in
 * `ModernFrameRenderer.renderOverlayFrame`, so this result usually contains a
 * single logical "native-effects" layer that is either tiled (sparse) or raw
 * (dense/unsupported fallback). Both arrays are returned, sorted by order then
 * id, and forwarded to `nativeStaticLayoutExport` so a future split renderer
 * can emit mixed raw + tiled layers with preserved z-order; the native consumer
 * in `electron/ipc/export/native-video.ts` already validates, sorts, and
 * composites both lists.
 */

type NativeStaticLayoutOverlayLayerUnion =
	| NativeStaticLayoutOverlayLayer
	| NativeCursorSpriteOverlayLayer;

type NativeStaticLayoutOverlayPreparationResult = {
	overlayLayers: NativeStaticLayoutOverlayLayerUnion[];
	tiledOverlayLayers: NativeTiledOverlayLayerDescriptor[];
	rawFallbackReason: NativeTiledOverlayRawFallbackReason | null;
	/**
	 * Number of frames the renderer actually rendered and captured (canvas
	 * readback). When a proven static optimization is available this is 1 even
	 * though the sidecar represents totalFrames logical frames; when the bake
	 * visits every frame this equals totalFrames. 0 for the fast-lane empty
	 * sidecar (no renderer work at all).
	 */
	renderedFrames: number;
};

/**
 * Result type returned by `window.electronAPI.nativeStaticLayoutExport`.
 * Mirrors the IPC return shape so the streaming path can type its concurrent
 * native promise without importing electron types.
 */
type NativeStaticLayoutExportIpcResult =
	| Awaited<ReturnType<typeof window.electronAPI.nativeStaticLayoutExport>>
	| {
			success: false;
			error: string;
			route?: undefined;
			tempPath?: undefined;
			encoderName?: undefined;
			metrics?: undefined;
	  };

/**
 * Combined result from the streaming raw-overlay path: the overlay
 * preparation (raw layer + rendered frame count) and the native IPC result,
 * settled concurrently.
 */
type StreamingRawOverlayResult = {
	overlayPreparation: NativeStaticLayoutOverlayPreparationResult | null;
	nativeResult: NativeStaticLayoutExportIpcResult | null;
	streamingRawOverlay: true;
};

/**
 * Combined result from the streaming cursor-sprite path: the overlay
 * preparation (cursor-sprite layer) and the native IPC result, settled
 * concurrently with the ROI bake.
 */
type StreamingCursorSpriteResult = {
	overlayPreparation: NativeStaticLayoutOverlayPreparationResult | null;
	nativeResult: NativeStaticLayoutExportIpcResult | null;
	streamingCursorSprite: true;
};

/**
 * Precomputed cursor-sprite streaming plan: fixed strip dimensions plus the
 * per-frame clamped ROIs and positions, derived from cursor telemetry BEFORE
 * the bake so the native IPC can launch concurrently while the strip is still
 * being rendered and written.
 */
type NativeCursorSpriteStreamPlan = {
	stripWidth: number;
	stripHeight: number;
	positions: NativeCursorSpritePosition[];
	rois: CursorRect[];
};

/** Discriminates a cursor-sprite layer from a fixed-position rgba layer. */
function isCursorSpriteOverlayLayer(
	layer: NativeStaticLayoutOverlayLayerUnion,
): layer is NativeCursorSpriteOverlayLayer {
	return (layer as { kind?: string }).kind === NATIVE_CURSOR_SPRITE_LAYER_KIND;
}

type NativeAudioPlan =
	| {
			audioMode: "none";
	  }
	| {
			audioMode: "copy-source" | "trim-source";
			audioSourcePath: string;
			audioSourceCodec?: string;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
	  }
	| {
			audioMode: "edited-track";
			strategy: "offline-render-fallback";
			sourceAudioFallbackPaths?: string[];
	  }
	| {
			audioMode: "edited-track";
			strategy: "filtergraph-fast-path";
			audioSourcePath: string;
			audioSourceCodec?: string;
			audioSourceSampleRate: number;
			editedTrackSegments: Array<{
				startMs: number;
				endMs: number;
				speed: number;
			}>;
	  };

const FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE = 48_000;

function hasNonDefaultSourceTrackSettings(sourceAudioTrackSettings?: SourceAudioTrackSettings) {
	if (!sourceAudioTrackSettings) {
		return false;
	}
	return Object.values(sourceAudioTrackSettings).some(
		(settings) =>
			Math.abs((settings?.volume ?? 1) - 1) > 0.0005 || Boolean(settings?.normalize),
	);
}
const MIN_NATIVE_STATIC_LAYOUT_SPEED = 0.25;
const MAX_NATIVE_STATIC_LAYOUT_SPEED = 30;

type NativeStaticLayoutTimelineSegment = {
	sourceStartMs: number;
	sourceEndMs: number;
	outputStartMs: number;
	outputEndMs: number;
	speed: number;
};

function canUseNativeStaticLayoutSpeed(speed: number): boolean {
	return (
		Number.isFinite(speed) &&
		speed >= MIN_NATIVE_STATIC_LAYOUT_SPEED &&
		speed <= MAX_NATIVE_STATIC_LAYOUT_SPEED
	);
}

function buildNativeStaticLayoutTimelineSegments(
	segments: Array<{ startMs: number; endMs: number; speed: number }>,
): NativeStaticLayoutTimelineSegment[] {
	const timelineSegments: NativeStaticLayoutTimelineSegment[] = [];
	let outputCursorMs = 0;

	for (const segment of segments) {
		const sourceStartMs = Math.max(0, segment.startMs);
		const sourceEndMs = Math.max(sourceStartMs, segment.endMs);
		const speed = segment.speed;
		if (
			!Number.isFinite(sourceStartMs) ||
			!Number.isFinite(sourceEndMs) ||
			!Number.isFinite(speed) ||
			sourceEndMs - sourceStartMs <= 0.5 ||
			speed <= 0
		) {
			return [];
		}

		const outputDurationMs = (sourceEndMs - sourceStartMs) / speed;
		if (!Number.isFinite(outputDurationMs) || outputDurationMs <= 0.5) {
			return [];
		}

		const outputStartMs = outputCursorMs;
		const outputEndMs = outputStartMs + outputDurationMs;
		timelineSegments.push({
			sourceStartMs,
			sourceEndMs,
			outputStartMs,
			outputEndMs,
			speed,
		});
		outputCursorMs = outputEndMs;
	}

	return timelineSegments;
}

type NativeStaticLayoutBackground =
	| {
			backgroundColor: string;
			backgroundImagePath?: null;
			temporaryPath?: string;
	  }
	| {
			backgroundColor: string;
			backgroundImagePath: string;
			temporaryPath?: string;
	  };

/**
 * Config-only native static-layout preparation started before the metadata
 * probe because neither task depends on videoInfo/audioPlan. The promises are
 * consumed by tryExportNativeStaticLayout (reused instead of re-run); when an
 * attempt is skipped before consumption, settleNativeStaticLayoutConfigPrep()
 * releases any materialized background temp file. The cursor atlas is purely
 * in-memory (a PNG data URL) so it needs no cleanup.
 */
type NativeStaticLayoutConfigPrep = {
	background: Promise<NativeStaticLayoutBackground | null>;
	cursorAtlas: Promise<NativeCursorAtlas | null> | null;
};

type NativeStaticLayoutWebcamOverlay = {
	inputPath: string;
	left: number;
	top: number;
	size: number;
	radius: number;
	shadowIntensity: number;
	mirror: boolean;
	timeOffsetMs: number;
};

type NativeStaticLayoutZoomSample = {
	timeMs: number;
	scale: number;
	x: number;
	y: number;
	/**
	 * Renderer-equivalent radial zoom-blur strength for the step that ends at
	 * this sample (0 when the step is not zoom motion). Computed once per frame
	 * from the applied zoom telemetry so the CUDA compositor can reproduce the
	 * spatial ZoomBlurFilter without re-deriving camera-step analysis.
	 */
	blurStrength?: number;
	/** Output-space zoom-blur center (pixels), matching the renderer's filter. */
	blurCenterX?: number;
	blurCenterY?: number;
};

const NATIVE_EXPORT_ENGINE_NAME = "Breeze";
const MEDIA_SOURCE_RETRY_ERROR_TOKENS = [
	"readavpacket",
	"get_media_info",
	"avfoundation",
	"failed after 3 attempts",
	"pipeline failed",
];
const LIGHTNING_PIPELINE_NAME = "Lightning (Beta)";
const STATIC_LAYOUT_CHUNK_DURATION_SEC = 120;
const MISSING_NATIVE_WALLPAPER_FALLBACK_COLOR = "#ffffff";
const NATIVE_STATIC_LAYOUT_MAX_EXTRACTING_PROGRESS = 95;
const NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS = 96;
const NATIVE_OVERLAY_PREPARATION_PROGRESS_INTERVAL_MS = 300;

// Upper bound in bytes for a single coalesced overlay sidecar IPC chunk.
// Pixel-identical consecutive frames in the raw sidecar are coalesced into one
// contiguous chunk (instead of one writeExportStreamChunk call per frame) to
// remove per-frame IPC round-trips for static overlay stretches, while capping
// the chunk so a long identical run never buffers the whole 4K sidecar at once.
const NATIVE_RAW_OVERLAY_RUN_BATCH_MAX_BYTES = 48 * 1024 * 1024;
const HEVC_NATIVE_STATIC_LAYOUT_ROUTES = new Set([
	"cuda-overlay",
	"cuda-scale-cpu-pad",
	"cuda-static-composite",
	"nvidia-cuda-compositor",
]);

/**
 * The native cursor atlas is only required when the cursor is NOT baked into the
 * transparent overlay sidecar. When overlay layers are prepared, the cursor is
 * rendered into the sidecar, so a missing atlas must never skip the native
 * static-layout route (previously this fell back to the slow renderer raw path
 * for every cursor export).
 */
export function shouldSkipForMissingCursorAtlas(options: {
	needsOverlayLayers: boolean;
	hasCursorTelemetry: boolean;
	hasCursorAtlas: boolean;
}): boolean {
	return !options.needsOverlayLayers && options.hasCursorTelemetry && !options.hasCursorAtlas;
}

/**
 * A native static-layout result can only preserve zoom motion blur over
 * transparent overlay sidecars, and temporal zoom motion blur in general, on
 * the generalized CUDA compositor. Other routes (FFmpeg effectful overlay,
 * D3D11 helper) would silently drop the effect, so the renderer rejects them
 * and falls back to raw frames.
 */
export function shouldRejectNativeStaticLayoutResultForEffectPreservation(options: {
	hasSpatialZoomMotionBlur: boolean;
	hasTemporalMotionBlur: boolean;
	hasOverlayContent: boolean;
	route: string | null | undefined;
}): boolean {
	const requiresCudaCompositor =
		(options.hasSpatialZoomMotionBlur && options.hasOverlayContent) ||
		options.hasTemporalMotionBlur;
	return requiresCudaCompositor && options.route !== "nvidia-cuda-compositor";
}

/**
 * Detailed skip reason for the deterministic no-browser-overlay fast lane.
 */
export type NativeStaticLayoutFastLaneSkipReason =
	| "not-native-cuda-route"
	| "browser-overlay-pixels-present"
	| "cursor-sidecar-required"
	| "edited-audio-render-required"
	| "native-source-not-authoritative";

export type NativeStaticLayoutFastLaneEligibility = {
	eligible: boolean;
	skipReasons: NativeStaticLayoutFastLaneSkipReason[];
};

/**
 * Deterministic no-browser-overlay fast lane for native CUDA static-layout
 * export. When every visual input the browser would otherwise render is already
 * authoritative natively (source video is a local file, no captions/annotations/
 * webcam/frame pixels, the cursor is either disabled or owned by the native CUDA
 * compositor, and there is no edited-audio render), the export can skip renderer
 * initialization, per-frame canvas capture, overlay sidecar creation, and cursor
 * atlas generation and start the native export as early as safely allowed.
 *
 * The predicate is explicit and returns detailed skip reasons so callers can
 * prove (and log) exactly why the fast lane was or was not selected. It never
 * bypasses source validation/security, required audio muxing, timeline/zoom/
 * temporal native plans, cancellation/cleanup/progress settlement, or strict HEVC
 * Hardware CUDA-only failure behavior.
 */
export function getNativeStaticLayoutFastLaneEligibility(options: {
	canUseNativeGpuStaticLayout: boolean;
	hasBrowserOverlayPixels: boolean;
	cursorDisabled: boolean;
	cursorNativeOwnershipActive: boolean;
	requiresEditedAudioRender: boolean;
	hasAuthoritativeNativeSource: boolean;
}): NativeStaticLayoutFastLaneEligibility {
	const skipReasons: NativeStaticLayoutFastLaneSkipReason[] = [];
	if (!options.canUseNativeGpuStaticLayout) {
		skipReasons.push("not-native-cuda-route");
	}
	if (options.hasBrowserOverlayPixels) {
		skipReasons.push("browser-overlay-pixels-present");
	}
	if (!options.cursorDisabled && !options.cursorNativeOwnershipActive) {
		skipReasons.push("cursor-sidecar-required");
	}
	if (options.requiresEditedAudioRender) {
		skipReasons.push("edited-audio-render-required");
	}
	if (!options.hasAuthoritativeNativeSource) {
		skipReasons.push("native-source-not-authoritative");
	}
	return { eligible: skipReasons.length === 0, skipReasons };
}

export class ModernVideoExporter {
	private static readonly NATIVE_ENCODER_QUEUE_LIMIT = 64;
	private static readonly NATIVE_WRITE_BATCH_MAX_CHUNKS = 12;
	private static readonly NATIVE_WRITE_BATCH_MAX_BYTES = 2 * 1024 * 1024;

	private config: VideoExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: ModernFrameRenderer | null = null;
	private encoder: VideoEncoder | null = null;
	private muxer: VideoMuxer | null = null;
	private audioProcessor: AudioProcessor | null = null;
	private cancelled = false;
	private encodeQueue = 0;
	private webCodecsEncodeQueueLimit = 0;
	private keyFrameInterval = 0;
	private videoDescription: Uint8Array | undefined;
	private videoColorSpace: VideoColorSpaceInit | undefined;
	private pendingMuxing: Promise<void> = Promise.resolve();
	private chunkCount = 0;
	private exportStartTimeMs = 0;
	private lastThroughputLogTimeMs = 0;
	private renderBackend: ExportRenderBackend | null = null;
	private encodeBackend: ExportEncodeBackend | null = null;
	private encoderName: string | null = null;
	private backpressureProfile: ExportBackpressureProfile | null = null;
	private nativeExportSessionId: string | null = null;
	private nativeStaticLayoutSessionId: string | null = null;
	private nativeStaticLayoutAverageFps: number | null = null;
	private nativeStaticLayoutFpsSource: "native" | "estimated" | null = null;
	private nativeWritePromises = new Set<Promise<void>>();
	private nativeRawWritePromises = new Set<Promise<void>>();
	private nativeWriteError: Error | null = null;
	private pendingNativeWriteChunks: Uint8Array[] = [];
	private pendingNativeWriteBytes = 0;
	private maxNativeWriteInFlight = 1;
	private nativeRawBackpressure: NativeRawFrameBackpressureQueue | null = null;
	private maxNativeRawWriteFrames = 1;
	private maxNativeRawWriteBytes = 0;
	private nativeTransportMode: ExportNativeTransportMode | null = null;
	private nativeTransportFallbackReason: string | null = null;
	private lastNativeExportError: string | null = null;
	private nativeStaticLayoutSkipReason: string | null = null;
	private nativeStaticLayoutSkipReasons: string[] = [];
	private nativeStaticLayoutBackgroundSkipReason: string | null = null;
	private nativeStaticLayoutOverlayFailure: {
		stage: string;
		message: string;
	} | null = null;
	private nativeH264Encoder: VideoEncoder | null = null;
	private nativeEncoderError: Error | null = null;
	private nativeRawFrameMode = false;
	private effectiveDurationSec = 0;
	private totalExportStartTimeMs = 0;
	private metadataLoadTimeMs = 0;
	private rendererInitTimeMs = 0;
	private nativeSessionStartTimeMs = 0;
	private decodeLoopTimeMs = 0;
	private frameCallbackTimeMs = 0;
	private renderFrameTimeMs = 0;
	private encodeWaitTimeMs = 0;
	private encodeWaitEvents = 0;
	private encoderError: Error | null = null;
	private peakEncodeQueueSize = 0;
	private peakNativeWriteInFlight = 0;
	private nativeCaptureTimeMs = 0;
	private nativeWriteTimeMs = 0;
	private nativeWriteAckTimeMs = 0;
	private nativeFrameTransportTimeMs = 0;
	private nativeRawBytesSubmitted = 0;
	private nativeRawFramesSubmitted = 0;
	private peakNativeWriteInFlightBytes = 0;
	private finalizationTimeMs = 0;
	private finalizationStageMs: ExportFinalizationStageMetrics = {};
	private processedFrameCount = 0;
	private encodeCapacityWaiters = new Set<() => void>();
	private activeFinalizationProgressWatchdog: FinalizationProgressWatchdog | null = null;
	private lastFinalizationRenderProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
	private lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
	private lastProgressSampleTimeMs = 0;
	private lastProgressSampleFrame = 0;
	private displayedRenderFps = 0;
	private lastPreparingTotalFrames: number | null = null;
	private lastPreparingSubstate: string | null = null;
	private lastPreparingSubstateLabel: string | null = null;
	private nativeStaticLayoutOverlayRenderedFrames = 0;
	private nativeStaticLayoutOverlayPreparationMs = 0;
	// Renderer-streamed edited-audio export stream id. Set while the deferred
	// edited-track audio render writes its WAV payload; cancel()/cleanup() abort
	// the stream so main's bounded mux wait can never hang on a cancelled export.
	private deferredEditedAudioStreamId: string | null = null;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		let useFallbackMediaSource = false;
		let retriedWithFallbackMediaSource = false;

		while (true) {
			let shouldRetryWithFallbackMediaSource = false;
			try {
				this.cleanup();
				this.cancelled = false;
				this.encoderError = null;
				this.nativeEncoderError = null;
				this.nativeStaticLayoutSkipReason = null;
				this.nativeStaticLayoutSkipReasons = [];
				this.nativeStaticLayoutBackgroundSkipReason = null;
				this.totalExportStartTimeMs = this.getNowMs();
				const backendPreference = this.config.backendPreference ?? "auto";
				const runtimePlatform = this.getRuntimePlatform();
				// HEVC Auto/Hardware may use the NVIDIA CUDA compositor first. Rawvideo
				// remains the strict fallback for unsupported effects and unavailable GPU
				// routes; H.264 + Auto keeps its existing route selection unchanged.
				const forceNativeRawFrame = this.shouldForceNativeRawFrame();
				let useNativeEncoder = false;
				let triedNativeStaticLayoutWithProbe = false;
				const prefersNativeStaticLayoutBeforeBreeze =
					!forceNativeRawFrame &&
					shouldPreferNativeStaticLayoutBeforeBreeze(runtimePlatform, backendPreference);
				const shouldTryNativeStaticLayout =
					!forceNativeRawFrame &&
					(this.canUseNativeGpuStaticLayout() ||
						backendPreference === "breeze" ||
						this.config.experimentalNvidiaCudaExport === true ||
						prefersNativeStaticLayoutBeforeBreeze);
				let shouldDeferNativeEncoderStart =
					!forceNativeRawFrame &&
					(this.canUseNativeGpuStaticLayout() ||
						backendPreference === "breeze" ||
						this.config.experimentalNvidiaCudaExport === true ||
						prefersNativeStaticLayoutBeforeBreeze);
				this.lastNativeExportError = null;

				// Strict HEVC Hardware: the CUDA static-layout route is mandatory. If it
				// cannot even be selected (CUDA opt-in off / helper absent), fail now
				// instead of falling through to the renderer raw/WebCodecs path.
				if (this.requiresStrictNativeCudaRoute() && !this.canUseNativeGpuStaticLayout()) {
					console.error(
						formatLogTs(),
						"[VideoExporter] Strict HEVC Hardware policy: CUDA compositor not eligible; refusing renderer raw fallback",
						{
							exportVideoCodec: this.config.exportVideoCodec,
							exportEncoderPreference: this.config.exportEncoderPreference,
							experimentalNativeExport: this.config.experimentalNativeExport === true,
							experimentalNvidiaCudaExport:
								this.config.experimentalNvidiaCudaExport === true,
							skipReason: this.nativeStaticLayoutSkipReason,
							skipReasons: this.nativeStaticLayoutSkipReasons,
						},
					);
					throw this.buildStrictNativeCudaHardwareError(
						this.nativeStaticLayoutSkipReason ?? "native-cuda-not-enabled",
					);
				}

				let stageStartedAt = this.getNowMs();
				if (forceNativeRawFrame) {
					// Explicit per-request codec/encoder: start the native raw-frame encoder
					// directly with no WebCodecs/static-layout fallback. If it cannot start
					// (e.g. Hardware HEVC with no usable encoder), surface the error instead of
					// silently switching codecs.
					useNativeEncoder = await this.tryStartNativeVideoExportRawFrame();
					this.nativeSessionStartTimeMs = this.getNowMs() - stageStartedAt;
					if (!useNativeEncoder) {
						throw new Error(
							this.lastNativeExportError ??
								`${NATIVE_EXPORT_ENGINE_NAME} export could not start native ${this.config.exportVideoCodec?.toUpperCase() ?? "video"} encoding on this system.`,
						);
					}
				} else if (shouldDeferNativeEncoderStart) {
					// Defer the streaming native encoder until after metadata is known so
					// static-layout exports can use the fastest compatible compositor first.
				} else if (
					backendPreference === "auto" &&
					shouldPreferNativeAutoBackend(runtimePlatform)
				) {
					stageStartedAt = this.getNowMs();
					useNativeEncoder = await this.tryStartNativeVideoExport();
					this.nativeSessionStartTimeMs = this.getNowMs() - stageStartedAt;

					if (!useNativeEncoder) {
						console.warn(
							`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} auto-preferred native export was unavailable; falling back to WebCodecs.`,
							this.lastNativeExportError,
						);
						stageStartedAt = this.getNowMs();
						await this.initializeEncoder();
					}
				} else {
					try {
						const configuredWebCodecsPath = await this.initializeEncoder();
						if (
							backendPreference === "auto" &&
							configuredWebCodecsPath.hardwareAcceleration === "prefer-software"
						) {
							console.warn(
								"[VideoExporter] Auto backend resolved to a software WebCodecs encoder; trying Breeze native export instead.",
							);
							stageStartedAt = this.getNowMs();
							useNativeEncoder = await this.tryStartNativeVideoExport();
							this.nativeSessionStartTimeMs = this.getNowMs() - stageStartedAt;
							if (useNativeEncoder) {
								this.disposeEncoder();
							}
						}
					} catch (error) {
						const webCodecsError =
							error instanceof Error ? error : new Error(String(error));
						if (backendPreference === "webcodecs") {
							throw webCodecsError;
						}

						console.warn(
							`[VideoExporter] WebCodecs encoder unavailable, trying ${NATIVE_EXPORT_ENGINE_NAME} native export fallback`,
							webCodecsError,
						);
						this.disposeEncoder();

						stageStartedAt = this.getNowMs();
						useNativeEncoder = await this.tryStartNativeVideoExport();
						this.nativeSessionStartTimeMs = this.getNowMs() - stageStartedAt;

						if (!useNativeEncoder) {
							throw webCodecsError;
						}
					}
				}

				this.backpressureProfile = getExportBackpressureProfile({
					encodeBackend:
						shouldDeferNativeEncoderStart || useNativeEncoder ? "ffmpeg" : "webcodecs",
					width: this.config.width,
					height: this.config.height,
					frameRate: this.config.frameRate,
					encodingMode: this.config.encodingMode,
				});
				console.log(formatLogTs(), "[VideoExporter] Native static-layout decision", {
					exportVideoCodec: this.config.exportVideoCodec ?? "h264",
					exportEncoderPreference: this.config.exportEncoderPreference ?? "auto",
					experimentalNativeExport: this.config.experimentalNativeExport === true,
					experimentalNvidiaCudaExport: this.config.experimentalNvidiaCudaExport === true,
					backendPreference: this.config.backendPreference ?? "auto",
					canUseNativeGpuStaticLayout: this.canUseNativeGpuStaticLayout(),
					shouldForceNativeRawFrame: forceNativeRawFrame,
					shouldTryNativeStaticLayout,
					shouldDeferNativeEncoderStart,
					useNativeEncoder,
					zoomMotionBlur: this.config.zoomMotionBlur ?? 0,
					zoomTemporalMotionBlur: this.config.zoomTemporalMotionBlur ?? 0,
					hasOverlayContent: this.hasNativeStaticLayoutOverlayContent(),
					hasBrowserOverlayPixels: this.hasNativeStaticLayoutBrowserOverlayPixels(),
					showCursor: this.config.showCursor === true,
					cursorTelemetrySamples: this.config.cursorTelemetry?.length ?? 0,
					cursorMotionBlur: this.config.cursorMotionBlur ?? 0,
					cursorSway: this.config.cursorSway ?? 0,
					cursorAtlasOwnershipEligible: this.canUseNativeCursorAtlasOwnership(),
					webcamNativePixelsEligible: this.canUseNativeStaticLayoutWebcamPixels(),
					webcamNativeOwnershipEligible: this.canUseNativeWebcamOwnership(),
				});
				this.maxNativeWriteInFlight = useNativeEncoder
					? Math.max(
							1,
							Math.floor(
								this.config.maxInFlightNativeWrites ??
									this.backpressureProfile.maxInFlightNativeWrites,
							),
						)
					: 1;
				if (useNativeEncoder && this.nativeRawFrameMode) {
					this.configureNativeRawFrameBackpressure();
				}

				console.log("[VideoExporter] Backpressure profile", {
					profile: this.backpressureProfile.name,
					encodeBackend:
						shouldDeferNativeEncoderStart || useNativeEncoder ? "ffmpeg" : "webcodecs",
					maxEncodeQueue:
						this.config.maxEncodeQueue ?? this.backpressureProfile.maxEncodeQueue,
					maxDecodeQueue:
						this.config.maxDecodeQueue ?? this.backpressureProfile.maxDecodeQueue,
					maxPendingFrames:
						this.config.maxPendingFrames ?? this.backpressureProfile.maxPendingFrames,
					maxInFlightNativeWrites: this.maxNativeWriteInFlight,
					maxInFlightNativeRawFrames: this.nativeRawFrameMode
						? this.maxNativeRawWriteFrames
						: undefined,
					maxInFlightNativeRawBytes: this.nativeRawFrameMode
						? this.maxNativeRawWriteBytes
						: undefined,
				});

				if (shouldTryNativeStaticLayout && !useNativeEncoder) {
					// Start the config-only native static-layout preparation (background
					// materialization + cursor atlas asset preload) before the metadata
					// probe: neither depends on videoInfo/audioPlan, so their wall time
					// overlaps the probe instead of serializing after it. Audio options
					// are still prepared in parallel inside tryExportNativeStaticLayout
					// once the audioPlan is known.
					const nativePrep = this.startNativeStaticLayoutConfigPrep();
					this.exportStartTimeMs = this.getNowMs();
					this.reportProgress(
						0,
						0,
						"preparing",
						undefined,
						undefined,
						"native-preparation",
						"Preparing export",
					);
					const nativeVideoInfo = await this.loadNativeStaticLayoutVideoInfo();
					if (nativeVideoInfo) {
						triedNativeStaticLayoutWithProbe = true;
						const nativeAudioPlan = this.buildNativeAudioPlan(nativeVideoInfo);
						const effectiveDuration =
							this.getNativeStaticLayoutEffectiveDuration(nativeVideoInfo);
						this.effectiveDurationSec = effectiveDuration;
						const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
						const staticLayoutResult = await this.tryExportNativeStaticLayout(
							nativeVideoInfo,
							nativeAudioPlan,
							effectiveDuration,
							totalFrames,
							nativePrep,
						);
						if (staticLayoutResult) {
							this.disposeEncoder();
							return staticLayoutResult;
						}
					} else {
						// The probe produced no videoInfo, so tryExportNativeStaticLayout
						// never consumed the prep; release any materialized background
						// temp file so the early-start work cannot leak.
						await this.settleNativeStaticLayoutConfigPrep(nativePrep);
						if (this.requiresStrictNativeCudaRoute()) {
							this.nativeStaticLayoutSkipReason = "native-metadata-probe-unavailable";
							this.nativeStaticLayoutSkipReasons = [
								this.nativeStaticLayoutSkipReason,
							];
						}
					}
				}

				this.streamingDecoder = new StreamingVideoDecoder({
					maxDecodeQueue:
						this.config.maxDecodeQueue ?? this.backpressureProfile.maxDecodeQueue,
					maxPendingFrames:
						this.config.maxPendingFrames ?? this.backpressureProfile.maxPendingFrames,
				});
				stageStartedAt = this.getNowMs();
				const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl, {
					useFallbackMediaSource,
				});
				this.metadataLoadTimeMs = this.getNowMs() - stageStartedAt;
				const nativeAudioPlan = this.buildNativeAudioPlan(videoInfo);
				const shouldUsePitchPreservingFfmpegAudio =
					nativeAudioPlan.audioMode === "edited-track" &&
					nativeAudioPlan.strategy === "filtergraph-fast-path";
				const shouldUseFfmpegAudioFallback =
					!useNativeEncoder &&
					nativeAudioPlan.audioMode !== "none" &&
					(shouldUsePitchPreservingFfmpegAudio || !(await isAacAudioEncodingSupported()));
				const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
					this.config.trimRegions,
					this.config.speedRegions,
				);
				this.effectiveDurationSec = effectiveDuration;
				const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

				if (
					shouldTryNativeStaticLayout &&
					!useNativeEncoder &&
					!triedNativeStaticLayoutWithProbe
				) {
					const staticLayoutResult = await this.tryExportNativeStaticLayout(
						videoInfo,
						nativeAudioPlan,
						effectiveDuration,
						totalFrames,
					);
					if (staticLayoutResult) {
						this.disposeEncoder();
						return staticLayoutResult;
					}
				}

				if (shouldDeferNativeEncoderStart && !useNativeEncoder) {
					if (this.requiresStrictNativeCudaRoute()) {
						// Strict HEVC Hardware: the CUDA static-layout route did not produce
						// video (skip, IPC failure, route mismatch, or post-validation
						// failure). Never fall back to the renderer raw frame path, Breeze,
						// WebGPU, or CPU; hard-fail with the first skip reason.
						console.error(
							formatLogTs(),
							"[VideoExporter] Strict HEVC Hardware policy: CUDA static-layout route did not render; refusing raw renderer fallback",
							{
								skipReason: this.nativeStaticLayoutSkipReason,
								skipReasons: this.nativeStaticLayoutSkipReasons,
								lastNativeExportError: this.lastNativeExportError,
								canUseNativeGpuStaticLayout: this.canUseNativeGpuStaticLayout(),
								experimentalNvidiaCudaExport:
									this.config.experimentalNvidiaCudaExport === true,
							},
						);
						throw this.buildStrictNativeCudaHardwareError(
							this.nativeStaticLayoutSkipReason ??
								this.lastNativeExportError ??
								"native-cuda-route-unavailable",
						);
					}
					if (this.requiresNativeRawFrame()) {
						// Guaranteed observable reason when the native static-layout route
						// did not produce video and HEVC/explicit-Hardware forces the raw
						// renderer frame path. The skip reasons and last native error are
						// surfaced here so a raw hevc_nvenc session can always be traced
						// back to its cause.
						console.warn(
							formatLogTs(),
							"[VideoExporter] Native static-layout route did not render; starting raw renderer frame path",
							{
								exportVideoCodec: this.config.exportVideoCodec ?? "h264",
								exportEncoderPreference:
									this.config.exportEncoderPreference ?? "auto",
								experimentalNativeExport:
									this.config.experimentalNativeExport === true,
								experimentalNvidiaCudaExport:
									this.config.experimentalNvidiaCudaExport === true,
								canUseNativeGpuStaticLayout: this.canUseNativeGpuStaticLayout(),
								skipReason: this.nativeStaticLayoutSkipReason,
								skipReasons: this.nativeStaticLayoutSkipReasons,
								lastNativeExportError: this.lastNativeExportError,
							},
						);
					}
					stageStartedAt = this.getNowMs();
					useNativeEncoder = this.requiresNativeRawFrame()
						? await this.tryStartNativeVideoExportRawFrame()
						: await this.tryStartNativeVideoExport();
					this.nativeSessionStartTimeMs = this.getNowMs() - stageStartedAt;
					if (!useNativeEncoder) {
						const nativeFailure =
							this.lastNativeExportError ??
							`${NATIVE_EXPORT_ENGINE_NAME} export is unavailable for this output profile on this system.`;
						if (this.requiresNativeRawFrame()) {
							throw new Error(nativeFailure);
						}
						console.warn(
							`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} native export unavailable after static-layout fallback; falling back to WebCodecs.`,
							nativeFailure,
						);
						shouldDeferNativeEncoderStart = false;
						this.backpressureProfile = getExportBackpressureProfile({
							encodeBackend: "webcodecs",
							width: this.config.width,
							height: this.config.height,
							frameRate: this.config.frameRate,
							encodingMode: this.config.encodingMode,
						});
						this.maxNativeWriteInFlight = 1;
						await this.initializeEncoder();
					}
					if (useNativeEncoder && this.nativeRawFrameMode) {
						this.configureNativeRawFrameBackpressure();
					}
				}

				stageStartedAt = this.getNowMs();
				this.renderer = new ModernFrameRenderer({
					width: this.config.width,
					height: this.config.height,
					preferredRenderBackend: undefined,
					wallpaper: this.config.wallpaper,
					zoomRegions: this.config.zoomRegions,
					showShadow: this.config.showShadow,
					shadowIntensity: this.config.shadowIntensity,
					backgroundBlur: this.config.backgroundBlur,
					zoomMotionBlur: this.config.zoomMotionBlur,
					zoomMotionBlurTuning: this.config.zoomMotionBlurTuning,
					zoomTemporalMotionBlur: this.config.zoomTemporalMotionBlur,
					zoomMotionBlurSampleCount: this.config.zoomMotionBlurSampleCount,
					zoomMotionBlurShutterFraction: this.config.zoomMotionBlurShutterFraction,
					connectZooms: this.config.connectZooms,
					zoomInDurationMs: this.config.zoomInDurationMs,
					zoomInOverlapMs: this.config.zoomInOverlapMs,
					zoomOutDurationMs: this.config.zoomOutDurationMs,
					connectedZoomGapMs: this.config.connectedZoomGapMs,
					connectedZoomDurationMs: this.config.connectedZoomDurationMs,
					zoomInEasing: this.config.zoomInEasing,
					zoomOutEasing: this.config.zoomOutEasing,
					connectedZoomEasing: this.config.connectedZoomEasing,
					borderRadius: this.config.borderRadius,
					padding: this.config.padding,
					cropRegion: this.config.cropRegion,
					webcam: this.config.webcam,
					webcamUrl: this.config.webcamUrl,
					videoWidth: videoInfo.width,
					videoHeight: videoInfo.height,
					annotationRegions: this.config.annotationRegions,
					autoCaptions: this.config.autoCaptions,
					autoCaptionSettings: this.config.autoCaptionSettings,
					speedRegions: this.config.speedRegions,
					previewWidth: this.config.previewWidth,
					previewHeight: this.config.previewHeight,
					cursorTelemetry: this.config.cursorTelemetry,
					showCursor: this.config.showCursor,
					cursorStyle: this.config.cursorStyle,
					cursorSize: this.config.cursorSize,
					cursorSmoothing: this.config.cursorSmoothing,
					cursorSpringStiffnessMultiplier: this.config.cursorSpringStiffnessMultiplier,
					cursorSpringDampingMultiplier: this.config.cursorSpringDampingMultiplier,
					cursorSpringMassMultiplier: this.config.cursorSpringMassMultiplier,
					cameraSpringStiffnessMultiplier: this.config.cameraSpringStiffnessMultiplier,
					cameraSpringDampingMultiplier: this.config.cameraSpringDampingMultiplier,
					cameraSpringMassMultiplier: this.config.cameraSpringMassMultiplier,
					cursorMotionBlur: this.config.cursorMotionBlur,
					cursorClickEffect: this.config.cursorClickEffect,
					cursorClickEffectColor: this.config.cursorClickEffectColor,
					cursorClickEffectScale: this.config.cursorClickEffectScale,
					cursorClickEffectOpacity: this.config.cursorClickEffectOpacity,
					cursorClickEffectDurationMs: this.config.cursorClickEffectDurationMs,
					cursorClickBounce: this.config.cursorClickBounce,
					cursorClickBounceDuration: this.config.cursorClickBounceDuration,
					cursorSway: this.config.cursorSway,
					zoomSmoothness: this.config.zoomSmoothness,
					zoomClassicMode: this.config.zoomClassicMode,
					frame: this.config.frame,
				});
				await this.renderer.initialize();
				this.rendererInitTimeMs = this.getNowMs() - stageStartedAt;
				this.renderBackend = this.renderer.getRendererBackend();
				console.log(`[VideoExporter] Using ${this.renderBackend} render backend`);

				if (!useNativeEncoder) {
					const hasAudio = nativeAudioPlan.audioMode !== "none";
					this.muxer = new VideoMuxer(
						this.config,
						hasAudio && !shouldUseFfmpegAudioFallback,
					);
					await this.muxer.initialize();
				}

				console.log("[VideoExporter] Original duration:", videoInfo.duration, "s");
				console.log("[VideoExporter] Effective duration:", effectiveDuration, "s");
				console.log("[VideoExporter] Total frames to export:", totalFrames);
				console.log(
					`[VideoExporter] Using ${useNativeEncoder ? `${NATIVE_EXPORT_ENGINE_NAME} native` : "WebCodecs"} encode path`,
				);

				const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
				let frameIndex = 0;
				this.exportStartTimeMs = this.getNowMs();
				this.lastThroughputLogTimeMs = this.exportStartTimeMs;
				this.lastProgressSampleTimeMs = this.exportStartTimeMs;
				this.lastProgressSampleFrame = 0;
				this.displayedRenderFps = 0;
				const decodeLoopStartedAt = this.getNowMs();

				await this.streamingDecoder.decodeAll(
					this.config.frameRate,
					this.config.trimRegions,
					this.config.speedRegions,
					async (
						videoFrame,
						_exportTimestampUs,
						sourceTimestampMs,
						cursorTimestampMs,
					) => {
						const callbackStartedAt = this.getNowMs();
						if (this.cancelled) {
							return;
						}

						const timestamp = frameIndex * frameDuration;
						const sourceTimestampUs = sourceTimestampMs * 1000;
						const cursorTimestampUs = cursorTimestampMs * 1000;
						const renderStartedAt = this.getNowMs();
						await this.renderer!.renderFrame(
							videoFrame,
							sourceTimestampUs,
							cursorTimestampUs,
							frameDuration,
							timestamp,
						);
						this.renderFrameTimeMs += this.getNowMs() - renderStartedAt;

						if (this.cancelled) {
							return;
						}

						if (useNativeEncoder) {
							await this.encodeRenderedFrameNative(
								timestamp,
								frameDuration,
								frameIndex,
							);
						} else {
							await this.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
						}
						this.frameCallbackTimeMs += this.getNowMs() - callbackStartedAt;
						frameIndex++;
						this.processedFrameCount = frameIndex;
						this.reportProgress(frameIndex, totalFrames, "extracting");
						extensionHost.emitEvent({
							type: "export:frame",
							data: { frameIndex, totalFrames },
						});
					},
				);
				this.decodeLoopTimeMs = this.getNowMs() - decodeLoopStartedAt;

				if (this.cancelled) {
					if (this.encoderError) {
						return {
							success: false,
							error: this.buildLightningExportError(this.encoderError),
							metrics: this.buildExportMetrics(),
						};
					}

					return {
						success: false,
						error: "Export cancelled",
						metrics: this.buildExportMetrics(),
					};
				}

				this.reportFinalizingProgress(totalFrames, 96);

				if (useNativeEncoder) {
					stageStartedAt = this.getNowMs();
					this.reportFinalizingProgress(totalFrames, 99);
					if (this.nativeH264Encoder && !this.nativeRawFrameMode) {
						await this.measureFinalizationStage("nativeEncoderFlushMs", async () => {
							await this.nativeH264Encoder!.flush();
						});
					}
					const finishResult = await this.finishNativeVideoExport(nativeAudioPlan);
					this.finalizationTimeMs = this.getNowMs() - stageStartedAt;
					if (
						!finishResult.success ||
						(!finishResult.tempFilePath && !finishResult.blob)
					) {
						return {
							success: false,
							error:
								finishResult.error || `${NATIVE_EXPORT_ENGINE_NAME} export failed`,
							metrics: this.buildExportMetrics(),
						};
					}

					return {
						success: true,
						tempFilePath: finishResult.tempFilePath,
						blob: finishResult.blob,
						metrics: this.buildExportMetrics(),
					};
				}

				stageStartedAt = this.getNowMs();
				if (this.encoder && this.encoder.state === "configured") {
					this.reportFinalizingProgress(totalFrames, 97);
					await this.measureFinalizationStage("encoderFlushMs", async () => {
						await this.awaitWithFinalizationTimeout(
							this.encoder!.flush(),
							"encoder flush",
						);
					});
				}

				this.reportFinalizingProgress(totalFrames, 98);
				await this.measureFinalizationStage("queuedMuxingMs", async () => {
					await this.awaitWithFinalizationTimeout(
						this.pendingMuxing,
						"muxing queued video chunks",
					);
				});

				// Surface muxing errors before proceeding with finalization
				if (this.encoderError) {
					throw this.encoderError;
				}

				if (
					nativeAudioPlan.audioMode !== "none" &&
					!shouldUseFfmpegAudioFallback &&
					!this.cancelled
				) {
					const demuxer = this.streamingDecoder.getDemuxer();
					if (
						demuxer ||
						(this.config.audioRegions ?? []).length > 0 ||
						(this.config.sourceAudioFallbackPaths ?? []).length > 0
					) {
						this.audioProcessor = new AudioProcessor();
						this.audioProcessor.setOnProgress((progress) => {
							this.reportFinalizingProgress(totalFrames, 99, progress);
						});
						this.reportFinalizingProgress(totalFrames, 99);
						await this.measureFinalizationStage("audioProcessingMs", async () => {
							await this.awaitWithFinalizationTimeout(
								this.audioProcessor!.process(
									demuxer,
									this.muxer!,
									this.config.videoUrl,
									this.config.trimRegions,
									this.config.speedRegions,
									undefined,
									this.config.audioRegions,
									this.config.sourceAudioFallbackPaths,
									this.config.sourceAudioFallbackStartDelayMsByPath,
									this.config.sourceAudioTrackSettings,
									this.config.clipRegions,
								),
								"audio processing",
								"audio",
								true,
							);
						});
					}
				}

				this.reportFinalizingProgress(totalFrames, 99);
				const muxerResult = await this.measureFinalizationStage(
					"muxerFinalizeMs",
					async () =>
						this.awaitWithFinalizationTimeout(
							this.muxer!.finalize(),
							"muxer finalization",
							nativeAudioPlan.audioMode !== "none" && !shouldUseFfmpegAudioFallback
								? "audio"
								: "default",
						),
				);

				if (shouldUseFfmpegAudioFallback) {
					console.warn(
						shouldUsePitchPreservingFfmpegAudio
							? "[VideoExporter] Using FFmpeg audio muxing for pitch-preserving speed edits."
							: "[VideoExporter] Browser AAC encoding is unavailable; falling back to FFmpeg audio muxing.",
					);
					const muxedResult = await this.finalizeExportWithFfmpegAudio(
						muxerResult,
						nativeAudioPlan,
					);
					this.finalizationTimeMs = this.getNowMs() - stageStartedAt;
					if (!muxedResult.success || (!muxedResult.blob && !muxedResult.tempFilePath)) {
						return {
							success: false,
							error: muxedResult.error || "Failed to mux audio with FFmpeg",
							metrics: this.buildExportMetrics(),
						};
					}

					return {
						success: true,
						blob: muxedResult.blob,
						tempFilePath: muxedResult.tempFilePath,
						metrics: muxedResult.metrics ?? this.buildExportMetrics(),
					};
				}

				this.finalizationTimeMs = this.getNowMs() - stageStartedAt;
				if (muxerResult.mode === "stream") {
					return {
						success: true,
						tempFilePath: muxerResult.tempFilePath,
						metrics: this.buildExportMetrics(),
					};
				}
				return {
					success: true,
					blob: muxerResult.blob,
					metrics: this.buildExportMetrics(),
				};
			} catch (error) {
				if (
					!useFallbackMediaSource &&
					!retriedWithFallbackMediaSource &&
					this.shouldRetryWithFallbackMediaSource(error)
				) {
					retriedWithFallbackMediaSource = true;
					useFallbackMediaSource = true;
					shouldRetryWithFallbackMediaSource = true;
					console.warn(
						"[VideoExporter] Primary decode path failed; retrying export once with a fresh media source.",
						error,
					);
				} else {
					if (this.cancelled && !this.encoderError) {
						return {
							success: false,
							error: "Export cancelled",
							metrics: this.buildExportMetrics(),
						};
					}

					const resolvedError = this.encoderError ?? error;
					console.error("Export error:", error);
					return {
						success: false,
						error: this.buildLightningExportError(resolvedError),
						metrics: this.buildExportMetrics(),
					};
				}
			} finally {
				if (!shouldRetryWithFallbackMediaSource && this.totalExportStartTimeMs > 0) {
					console.log(
						`[VideoExporter] Final metrics ${JSON.stringify(this.buildExportMetrics())}`,
					);
				}
				this.cleanup();
			}

			if (shouldRetryWithFallbackMediaSource) {
				continue;
			}
		}
	}

	private shouldRetryWithFallbackMediaSource(error: unknown): boolean {
		const resolvedError = this.encoderError ?? error;
		const message =
			resolvedError instanceof Error ? resolvedError.message : String(resolvedError);
		const normalizedMessage = message.toLowerCase();
		return MEDIA_SOURCE_RETRY_ERROR_TOKENS.some((token) => normalizedMessage.includes(token));
	}

	private getPlatformLabel(): string {
		switch (this.getRuntimePlatform()) {
			case "win32":
				return "Windows";
			case "linux":
				return "Linux";
			case "darwin":
				return "macOS";
			default:
				if (typeof navigator === "undefined") {
					return "Unknown";
				}

				return navigator.platform || navigator.userAgent || "Unknown";
		}
	}

	private getRuntimePlatform() {
		if (typeof navigator === "undefined") {
			return "unknown";
		}

		return normalizeLightningRuntimePlatform(navigator.platform || navigator.userAgent || "");
	}

	private getLightningErrorGuidance(message: string): string[] {
		const guidance = new Set<string>();
		const platform = this.getPlatformLabel();

		guidance.add(
			"Lightning is designed to work on macOS, Windows, and Linux, but the available encoder path depends on WebCodecs support, GPU drivers, and the bundled FFmpeg encoders.",
		);

		if (/even output dimensions/i.test(message)) {
			guidance.add(
				"Use an export size with even width and height. Switching quality presets usually fixes this automatically.",
			);
		}

		if (
			/not supported on this system|H\.264 encoding|encoder path .* is not supported|Video encoding/i.test(
				message,
			)
		) {
			guidance.add("Try Good or Medium quality to reduce output resolution and bitrate.");
			guidance.add(
				"Update GPU and media drivers so system H.264 encoding paths are available.",
			);
		}

		if (this.lastNativeExportError) {
			guidance.add(
				`Check that the packaged FFmpeg build includes a compatible ${NATIVE_EXPORT_ENGINE_NAME} encoder path for ${platform}, plus libx264 as a software fallback.`,
			);
		}

		if (platform === "Windows") {
			guidance.add(
				"Windows Lightning exports can use WebCodecs or FFmpeg encoders such as h264_nvenc, h264_qsv, h264_amf, h264_mf, or libx264 depending on the machine.",
			);
		} else if (platform === "Linux") {
			guidance.add(
				"Linux Lightning exports can use WebCodecs when supported, or FFmpeg encoders such as libx264 and optional GPU paths depending on the distro build.",
			);
		} else if (platform === "macOS") {
			guidance.add(
				"macOS Lightning exports can use WebCodecs or VideoToolbox/libx264 through Breeze depending on the output profile.",
			);
		}

		return [...guidance];
	}

	private resolveRequestedBackendLabel(): string {
		// The CUDA compositor is the active requested backend whenever the native
		// CUDA route is selected (user opt-in for Auto, or mandatory for HEVC +
		// Hardware). This is what the export will actually use for eligible jobs.
		if (this.config.experimentalNvidiaCudaExport === true) {
			return "NVIDIA CUDA compositor";
		}

		switch (this.config.backendPreference) {
			case "webcodecs":
				return "WebCodecs";
			case "breeze":
				return "Breeze";
			default:
				return "auto";
		}
	}

	private buildLightningExportError(error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		const resolvedEncodePath =
			this.encodeBackend === "ffmpeg"
				? `${NATIVE_EXPORT_ENGINE_NAME} native`
				: this.encodeBackend === "webcodecs"
					? "WebCodecs"
					: null;
		const lines = [
			`${LIGHTNING_PIPELINE_NAME} export failed.`,
			`Reason: ${message}`,
			`Platform: ${this.getPlatformLabel()}`,
			`Requested backend mode: ${this.resolveRequestedBackendLabel()}`,
			`Output: ${this.config.width}x${this.config.height} @ ${this.config.frameRate} FPS`,
		];

		if (this.renderBackend) {
			lines.push(`Renderer: ${this.renderBackend}`);
		}

		if (resolvedEncodePath) {
			lines.push(
				`Encoder path: ${resolvedEncodePath}${this.encoderName ? ` (${this.encoderName})` : ""}`,
			);
		}

		if (this.lastNativeExportError && !message.includes(this.lastNativeExportError)) {
			lines.push(`${NATIVE_EXPORT_ENGINE_NAME} fallback: ${this.lastNativeExportError}`);
		}

		const guidance = this.getLightningErrorGuidance(message);
		if (guidance.length > 0) {
			lines.push("Suggested actions:");
			for (const item of guidance) {
				lines.push(`- ${item}`);
			}
		}

		return lines.join("\n");
	}

	private async awaitWithFinalizationTimeout<T>(
		promise: Promise<T>,
		stage: string,
		workload: FinalizationTimeoutWorkload = "default",
		progressAware = false,
	): Promise<T> {
		return withFinalizationTimeout({
			promise,
			stage,
			effectiveDurationSec: this.effectiveDurationSec,
			workload,
			progressAware,
			onWatchdogChanged: (watchdog) => {
				this.activeFinalizationProgressWatchdog = watchdog;
			},
		});
	}

	private getNativeVideoSourcePath(): string | null {
		return this.config.videoUrl ? getLocalFilePath(this.config.videoUrl) : null;
	}

	private getNativeWebcamSourcePath(): string | null {
		const source = this.config.webcam?.sourcePath || this.config.webcamUrl || "";
		return source ? getLocalFilePath(source) : null;
	}

	private async loadNativeStaticLayoutVideoInfo(): Promise<DecodedVideoInfo | null> {
		if (typeof window === "undefined" || !window.electronAPI?.probeNativeVideoMetadata) {
			return null;
		}

		const sourcePath = this.getNativeVideoSourcePath();
		if (!sourcePath) {
			return null;
		}

		const startedAt = this.getNowMs();
		try {
			const result = await window.electronAPI.probeNativeVideoMetadata(sourcePath);
			this.metadataLoadTimeMs = this.getNowMs() - startedAt;
			if (!result.success || !result.metadata) {
				console.info("[VideoExporter] Native metadata probe unavailable", {
					error: result.error,
				});
				return null;
			}

			return result.metadata;
		} catch (error) {
			this.metadataLoadTimeMs = this.getNowMs() - startedAt;
			console.info("[VideoExporter] Native metadata probe failed", error);
			return null;
		}
	}

	private buildNativeTrimSegments(durationMs: number): Array<{ startMs: number; endMs: number }> {
		const trimRegions = [...(this.config.trimRegions ?? [])].sort(
			(a, b) => a.startMs - b.startMs,
		);
		if (trimRegions.length === 0) {
			return [{ startMs: 0, endMs: Math.max(0, durationMs) }];
		}

		const segments: Array<{ startMs: number; endMs: number }> = [];
		let cursorMs = 0;

		for (const region of trimRegions) {
			const startMs = Math.max(0, Math.min(region.startMs, durationMs));
			const endMs = Math.max(startMs, Math.min(region.endMs, durationMs));
			if (startMs > cursorMs) {
				segments.push({ startMs: cursorMs, endMs: startMs });
			}
			cursorMs = Math.max(cursorMs, endMs);
		}

		if (cursorMs < durationMs) {
			segments.push({ startMs: cursorMs, endMs: durationMs });
		}

		return segments.filter((segment) => segment.endMs - segment.startMs > 0.5);
	}

	private getNativeStaticLayoutEffectiveDuration(videoInfo: DecodedVideoInfo): number {
		const sourceDurationSec = getEffectiveVideoStreamDurationSeconds({
			duration: videoInfo.duration,
			streamDuration: videoInfo.streamDuration,
		});
		const sourceDurationMs = sourceDurationSec * 1000;
		const speedRegions = this.config.speedRegions ?? [];
		if (speedRegions.length > 0) {
			const timelineSegments = this.buildNativeStaticLayoutSourceSegments(sourceDurationMs);
			if (timelineSegments.length > 0) {
				return timelineSegments.reduce(
					(totalSec, segment) =>
						totalSec + (segment.endMs - segment.startMs) / segment.speed / 1000,
					0,
				);
			}
		}

		const trimSegments = this.buildNativeTrimSegments(sourceDurationMs);
		return trimSegments.reduce(
			(totalSec, segment) => totalSec + (segment.endMs - segment.startMs) / 1000,
			0,
		);
	}

	private buildNativeStaticLayoutSourceSegments(sourceDurationMs: number) {
		if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0) {
			return [];
		}

		const speedRegions = this.config.speedRegions ?? [];
		if (
			speedRegions.some(
				(region) =>
					!Number.isFinite(region.startMs) ||
					!Number.isFinite(region.endMs) ||
					!canUseNativeStaticLayoutSpeed(region.speed),
			)
		) {
			return [];
		}

		const normalizedSpeedRegions = speedRegions
			.map((region) => ({
				startMs: Math.max(0, Math.min(region.startMs, sourceDurationMs)),
				endMs: Math.max(0, Math.min(region.endMs, sourceDurationMs)),
				speed: region.speed,
			}))
			.filter((region) => region.endMs - region.startMs > 0.5);
		const sourceSegments: Array<{
			startMs: number;
			endMs: number;
			speed: number;
		}> = [];

		for (const keptRange of this.buildNativeTrimSegments(sourceDurationMs)) {
			const boundaries = new Set<number>([keptRange.startMs, keptRange.endMs]);
			for (const speedRegion of normalizedSpeedRegions) {
				const startMs = Math.max(keptRange.startMs, speedRegion.startMs);
				const endMs = Math.min(keptRange.endMs, speedRegion.endMs);
				if (endMs - startMs > 0.5) {
					boundaries.add(startMs);
					boundaries.add(endMs);
				}
			}

			const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
			for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
				const startMs = orderedBoundaries[index] ?? 0;
				const endMs = orderedBoundaries[index + 1] ?? 0;
				if (endMs - startMs <= 0.5) {
					continue;
				}

				const midpointMs = startMs + (endMs - startMs) / 2;
				const speedRegion = normalizedSpeedRegions.find(
					(region) => midpointMs >= region.startMs && midpointMs < region.endMs,
				);
				sourceSegments.push({
					startMs,
					endMs,
					speed: speedRegion?.speed ?? 1,
				});
			}
		}

		return sourceSegments;
	}

	private buildNativeStaticLayoutVideoTimelineSegments(
		videoInfo: DecodedVideoInfo,
	): NativeStaticLayoutTimelineSegment[] {
		const sourceDurationMs = Math.max(
			0,
			Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
		);
		const sourceSegments = this.buildNativeStaticLayoutSourceSegments(sourceDurationMs);
		return buildNativeStaticLayoutTimelineSegments(sourceSegments);
	}

	private getNativeAudioFallbackPaths(videoInfo: DecodedVideoInfo): string[] {
		const sourceAudioFallbackPaths = (this.config.sourceAudioFallbackPaths ?? []).filter(
			(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
		);
		const localVideoSourcePath = this.getNativeVideoSourcePath();
		if (!videoInfo.hasAudio || !localVideoSourcePath) {
			return sourceAudioFallbackPaths;
		}

		const { externalAudioPaths } = resolveSourceAudioFallbackPaths(
			localVideoSourcePath,
			sourceAudioFallbackPaths,
		);
		if (externalAudioPaths.length === 0) {
			return sourceAudioFallbackPaths;
		}

		return [localVideoSourcePath, ...externalAudioPaths];
	}

	private shouldUseNativeStaticLayoutTimelineMap(
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): boolean {
		const speedRegions = this.config.speedRegions ?? [];
		if (speedRegions.length > 0) {
			return true;
		}

		const trimRegions = this.config.trimRegions ?? [];
		return (
			trimRegions.length > 0 &&
			!this.canUseNativeStaticTailTrim(videoInfo, effectiveDurationSec)
		);
	}

	private buildNativeAudioPlan(videoInfo: DecodedVideoInfo): NativeAudioPlan {
		const speedRegions = this.config.speedRegions ?? [];
		const audioRegions = this.config.audioRegions ?? [];
		const sourceAudioFallbackPaths = this.getNativeAudioFallbackPaths(videoInfo);
		const hasTimedSourceAudioFallback = sourceAudioFallbackPaths.some(
			(audioPath) =>
				(this.config.sourceAudioFallbackStartDelayMsByPath?.[audioPath] ?? 0) > 0,
		);
		const localVideoSourcePath = this.getNativeVideoSourcePath();
		const primaryAudioSourcePath =
			(videoInfo.hasAudio ? localVideoSourcePath : null) ??
			sourceAudioFallbackPaths[0] ??
			null;
		const usesEmbeddedPrimaryAudio =
			Boolean(videoInfo.hasAudio) && primaryAudioSourcePath === localVideoSourcePath;
		const primaryAudioSourceSampleRate = usesEmbeddedPrimaryAudio
			? videoInfo.audioSampleRate
			: FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE;
		const primaryAudioSourceCodec = usesEmbeddedPrimaryAudio ? videoInfo.audioCodec : undefined;

		if (
			!videoInfo.hasAudio &&
			sourceAudioFallbackPaths.length === 0 &&
			audioRegions.length === 0
		) {
			return { audioMode: "none" };
		}

		if (
			speedRegions.length > 0 ||
			audioRegions.length > 0 ||
			sourceAudioFallbackPaths.length > 1 ||
			hasTimedSourceAudioFallback ||
			hasNonDefaultSourceTrackSettings(this.config.sourceAudioTrackSettings) ||
			(this.config.clipRegions ?? []).some((clip) => Boolean(clip.muted))
		) {
			const sourceDurationMs = Math.max(
				0,
				Math.round(
					getEffectiveVideoStreamDurationSeconds({
						duration: videoInfo.duration,
						streamDuration: videoInfo.streamDuration,
					}) * 1000,
				),
			);
			const trimRegions = this.config.trimRegions ?? [];
			const canUsePrimaryAudioFiltergraph =
				Boolean(primaryAudioSourcePath) &&
				!hasTimedSourceAudioFallback &&
				(usesEmbeddedPrimaryAudio ||
					sourceAudioFallbackPaths.includes(primaryAudioSourcePath ?? "")) &&
				typeof primaryAudioSourceSampleRate === "number" &&
				Number.isFinite(primaryAudioSourceSampleRate) &&
				primaryAudioSourceSampleRate > 0;
			const requiresRenderedEditedTrack =
				hasNonDefaultSourceTrackSettings(this.config.sourceAudioTrackSettings) ||
				(this.config.clipRegions ?? []).some((clip) => Boolean(clip.muted));
			const strategy =
				canUsePrimaryAudioFiltergraph && !requiresRenderedEditedTrack
					? classifyEditedTrackStrategy({
							primaryAudioSourcePath,
							sourceDurationMs,
							trimRegions,
							speedRegions,
							audioRegions,
							sourceAudioFallbackPaths,
						})
					: "offline-render-fallback";

			if (strategy === "filtergraph-fast-path") {
				const audioSourcePath = primaryAudioSourcePath;
				const audioSourceSampleRate = primaryAudioSourceSampleRate;
				const editedTrackSegments = buildEditedTrackSourceSegments(
					sourceDurationMs,
					trimRegions,
					speedRegions,
				);
				if (
					audioSourcePath &&
					typeof audioSourceSampleRate === "number" &&
					editedTrackSegments.length > 0
				) {
					return {
						audioMode: "edited-track",
						strategy,
						audioSourcePath,
						audioSourceCodec: primaryAudioSourceCodec,
						audioSourceSampleRate,
						editedTrackSegments,
					};
				}
			}

			return {
				audioMode: "edited-track",
				strategy: "offline-render-fallback",
				sourceAudioFallbackPaths,
			};
		}

		if (!primaryAudioSourcePath) {
			return {
				audioMode: "edited-track",
				strategy: "offline-render-fallback",
				sourceAudioFallbackPaths,
			};
		}

		if ((this.config.trimRegions ?? []).length > 0) {
			const sourceDurationMs = Math.max(
				0,
				Math.round(
					getEffectiveVideoStreamDurationSeconds({
						duration: videoInfo.duration,
						streamDuration: videoInfo.streamDuration,
					}) * 1000,
				),
			);
			const trimSegments = this.buildNativeTrimSegments(sourceDurationMs);
			if (trimSegments.length === 0) {
				return { audioMode: "none" };
			}

			return {
				audioMode: "trim-source",
				audioSourcePath: primaryAudioSourcePath,
				audioSourceCodec: primaryAudioSourceCodec,
				trimSegments,
			};
		}

		return {
			audioMode: "copy-source",
			audioSourcePath: primaryAudioSourcePath,
			audioSourceCodec: primaryAudioSourceCodec,
		};
	}

	private isDefaultCropRegion(): boolean {
		const crop = this.config.cropRegion;
		const epsilon = 0.0001;
		return (
			Math.abs(crop.x) <= epsilon &&
			Math.abs(crop.y) <= epsilon &&
			Math.abs(crop.width - 1) <= epsilon &&
			Math.abs(crop.height - 1) <= epsilon
		);
	}

	private getNativeStaticLayoutSourceCrop(videoInfo: DecodedVideoInfo) {
		const crop = this.config.cropRegion;
		const sourceWidth = Math.max(2, Math.round(videoInfo.width));
		const sourceHeight = Math.max(2, Math.round(videoInfo.height));
		const cropX = Math.min(1, Math.max(0, crop.x));
		const cropY = Math.min(1, Math.max(0, crop.y));
		const cropRight = Math.min(1, Math.max(cropX, crop.x + crop.width));
		const cropBottom = Math.min(1, Math.max(cropY, crop.y + crop.height));

		const left = Math.min(sourceWidth - 2, Math.max(0, Math.floor(cropX * sourceWidth))) & ~1;
		const top = Math.min(sourceHeight - 2, Math.max(0, Math.floor(cropY * sourceHeight))) & ~1;
		const right = Math.min(sourceWidth, Math.max(left + 2, Math.ceil(cropRight * sourceWidth)));
		const bottom = Math.min(
			sourceHeight,
			Math.max(top + 2, Math.ceil(cropBottom * sourceHeight)),
		);
		const width = Math.max(2, right - left) & ~1;
		const height = Math.max(2, bottom - top) & ~1;

		return {
			x: left,
			y: top,
			width: Math.min(width, sourceWidth - left),
			height: Math.min(height, sourceHeight - top),
		};
	}

	private canUseNativeStaticTailTrim(
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): boolean {
		const trimRegions = this.config.trimRegions ?? [];
		if (trimRegions.length === 0) {
			return true;
		}

		if (trimRegions.length !== 1) {
			return false;
		}

		const [trim] = trimRegions;
		const sourceDurationMs = Math.max(
			0,
			Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
		);
		const outputDurationMs = Math.max(0, Math.round(effectiveDurationSec * 1000));
		const toleranceMs = 250;

		return (
			Math.abs(trim.startMs - outputDurationMs) <= toleranceMs &&
			Math.abs(trim.endMs - sourceDurationMs) <= toleranceMs
		);
	}

	private canUseNativeStaticLayoutAudioPlan(audioPlan: NativeAudioPlan): boolean {
		switch (audioPlan.audioMode) {
			case "none":
			case "copy-source":
				return true;
			case "trim-source":
				return true;
			case "edited-track":
				return (
					audioPlan.strategy === "offline-render-fallback" ||
					audioPlan.strategy === "filtergraph-fast-path"
				);
		}
	}

	private getHevcNativeGpuFeatureSkipReasons(): string[] {
		if (!this.canUseNativeGpuStaticLayout()) {
			return [];
		}

		const reasons: string[] = [];

		// Cursor motion blur is rendered into the transparent native overlay layer.

		const extensionHookPhases = [
			"background",
			"post-video",
			"post-zoom",
			"post-cursor",
			"post-webcam",
			"post-annotations",
			"final",
		] as const;
		if (
			extensionHost.hasCursorEffects() ||
			extensionHookPhases.some((phase) => extensionHost.hasRenderHooks(phase))
		) {
			reasons.push("unsupported-extension-hook");
		}

		return reasons;
	}
	private getNativeStaticLayoutSkipReasons(
		audioPlan: NativeAudioPlan,
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): string[] {
		const reasons: string[] = [];
		if ((this.config.zoomTemporalMotionBlur ?? 0) > 0.0005) {
			const canUseNativeTemporalBlur =
				this.config.experimentalNativeExport === true &&
				this.config.experimentalNvidiaCudaExport === true;
			if (!canUseNativeTemporalBlur) {
				// Temporal zoom motion blur needs multi-frame shutter sampling. The
				// generalized CUDA compositor implements it natively from the resolved
				// temporal sample plan; without the CUDA route neither the FFmpeg
				// effectful route nor the D3D11 helper can reproduce it, so keep an
				// explicit, non-duplicated skip that surfaces in diagnostics instead of
				// silently dropping the effect.
				reasons.push("unsupported-temporal-motion-blur");
			}
		}
		if (
			typeof window === "undefined" ||
			!window.electronAPI?.nativeStaticLayoutExport ||
			!window.electronAPI?.nativeStaticLayoutExportCancel
		) {
			reasons.push("native-static-api-unavailable");
		}

		if (this.config.width % 2 !== 0 || this.config.height % 2 !== 0) {
			reasons.push("odd-output-dimensions");
		}

		if (!this.canUseNativeStaticLayoutAudioPlan(audioPlan)) {
			reasons.push(`unsupported-audio-mode:${audioPlan.audioMode}`);
		}

		const speedRegions = this.config.speedRegions ?? [];
		const configuredWallpaper = this.config.wallpaper?.trim() ?? "";
		if (isVideoWallpaperSource(configuredWallpaper)) {
			reasons.push("unsupported-background-video");
		}
		const unsupportedOverlayContent = this.hasUnsupportedNativeStaticLayoutOverlayContent();
		if (unsupportedOverlayContent) {
			reasons.push(unsupportedOverlayContent);
		}

		const hasZoomRegions = (this.config.zoomRegions ?? []).length > 0;
		const needsTimelineMap = this.shouldUseNativeStaticLayoutTimelineMap(
			videoInfo,
			effectiveDurationSec,
		);
		if (needsTimelineMap && this.config.experimentalNativeExport !== true) {
			reasons.push("native-timeline-requires-windows-gpu");
		}
		if (
			needsTimelineMap &&
			this.hasNativeStaticLayoutOverlayContent() &&
			!this.canUseNativeGpuStaticLayout()
		) {
			// The generalized CUDA compositor maps output frames through the
			// timeline AND alpha-composites the overlay sidecar (overlay frames are
			// indexed by output frame), so timeline + overlay sidecars are supported
			// on the CUDA route. Only the D3D11/FFmpeg fallback routes cannot
			// preserve both, so keep the skip for those routes only.
			reasons.push("overlay-layers-do-not-support-native-timeline");
		}
		if (
			needsTimelineMap &&
			this.buildNativeStaticLayoutVideoTimelineSegments(videoInfo).length === 0
		) {
			reasons.push(
				speedRegions.length > 0
					? "unsupported-native-speed-timeline"
					: "unsupported-native-trim-timeline",
			);
		}
		if (hasZoomRegions && this.config.experimentalNativeExport !== true) {
			reasons.push("native-zoom-requires-windows-gpu");
		}
		if (this.config.webcam?.enabled && !this.getNativeWebcamSourcePath()) {
			reasons.push("unsupported-webcam-source");
		}

		const crop = this.config.cropRegion;
		if (
			!Number.isFinite(crop.x) ||
			!Number.isFinite(crop.y) ||
			!Number.isFinite(crop.width) ||
			!Number.isFinite(crop.height) ||
			crop.width <= 0 ||
			crop.height <= 0
		) {
			reasons.push("invalid-crop-region");
		}

		reasons.push(...this.getHevcNativeGpuFeatureSkipReasons());
		return reasons;
	}

	private getNativeStaticLayoutSkipReason(
		audioPlan: NativeAudioPlan,
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): string | null {
		return (
			this.getNativeStaticLayoutSkipReasons(audioPlan, videoInfo, effectiveDurationSec)[0] ??
			null
		);
	}

	private async resolveNativeStaticLayoutBackground(): Promise<NativeStaticLayoutBackground | null> {
		this.nativeStaticLayoutBackgroundSkipReason = null;
		const configuredWallpaper = this.config.wallpaper?.trim() ?? "";
		const wallpaper = configuredWallpaper || DEFAULT_WALLPAPER_PATH;
		if (/^#?[0-9a-f]{6}$/i.test(wallpaper)) {
			return {
				backgroundColor: wallpaper.startsWith("#") ? wallpaper : `#${wallpaper}`,
				backgroundImagePath: null,
			};
		}

		if (wallpaper.startsWith("data:image/") || wallpaper.startsWith("blob:")) {
			const materialized = await this.materializeNativeStaticLayoutImageSource(wallpaper);
			if (materialized) {
				return materialized;
			}
			this.nativeStaticLayoutBackgroundSkipReason =
				"unsupported-background-image-materialize-failed";
			return null;
		}

		if (wallpaper.startsWith("linear-gradient") || wallpaper.startsWith("radial-gradient")) {
			const materialized =
				await this.materializeNativeStaticLayoutGradientBackground(wallpaper);
			if (materialized) {
				return materialized;
			}
			this.nativeStaticLayoutBackgroundSkipReason =
				"unsupported-background-gradient-materialize-failed";
			return null;
		}

		if (isVideoWallpaperSource(wallpaper)) {
			this.nativeStaticLayoutBackgroundSkipReason = "unsupported-background-video";
			return null;
		}

		if (wallpaper.startsWith("data:") || wallpaper.startsWith("blob:")) {
			this.nativeStaticLayoutBackgroundSkipReason = "unsupported-background-data-or-blob";
			return null;
		}

		if (wallpaper.startsWith("http")) {
			this.nativeStaticLayoutBackgroundSkipReason = "unsupported-background-remote";
			return null;
		}

		if (wallpaper.startsWith("/wallpapers/") || wallpaper.startsWith("/app-icons/")) {
			const assetPath = await this.resolveNativeBundledAssetPath(wallpaper);
			if (assetPath) {
				return { backgroundColor: "#101010", backgroundImagePath: assetPath };
			}

			const fallbackAssetPath = await this.resolveNativeBundledAssetPath(
				`/${DEFAULT_WALLPAPER_RELATIVE_PATH}`,
			);
			return fallbackAssetPath
				? { backgroundColor: "#101010", backgroundImagePath: fallbackAssetPath }
				: {
						backgroundColor: MISSING_NATIVE_WALLPAPER_FALLBACK_COLOR,
						backgroundImagePath: null,
					};
		}

		const localPath = getLocalFilePath(wallpaper);
		if (localPath) {
			return { backgroundColor: "#101010", backgroundImagePath: localPath };
		}

		this.nativeStaticLayoutBackgroundSkipReason = "unsupported-background-local-path";
		return null;
	}

	private async materializeNativeStaticLayoutImageSource(
		imageSource: string,
	): Promise<NativeStaticLayoutBackground | null> {
		if (typeof fetch !== "function") {
			return null;
		}

		try {
			const response = await fetch(imageSource);
			if (!response.ok) {
				return null;
			}

			const blob = await response.blob();
			const mimeType = (blob.type || this.getDataUrlMimeType(imageSource)).toLowerCase();
			if (!mimeType.startsWith("image/")) {
				return null;
			}

			const extension = this.getNativeStaticLayoutImageExtension(mimeType);
			if (!extension) {
				return null;
			}

			const tempPath = await this.writeNativeStaticLayoutTempAsset(
				new Uint8Array(await blob.arrayBuffer()),
				extension,
			);
			return tempPath
				? {
						backgroundColor: "#101010",
						backgroundImagePath: tempPath,
						temporaryPath: tempPath,
					}
				: null;
		} catch (error) {
			console.warn("[VideoExporter] Unable to materialize native background image", error);
			return null;
		}
	}

	private async materializeNativeStaticLayoutGradientBackground(
		wallpaper: string,
	): Promise<NativeStaticLayoutBackground | null> {
		if (typeof document === "undefined") {
			return null;
		}

		try {
			const canvas = document.createElement("canvas");
			canvas.width = Math.max(1, Math.round(this.config.width));
			canvas.height = Math.max(1, Math.round(this.config.height));
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				return null;
			}

			const gradient = this.createNativeStaticLayoutGradient(ctx, wallpaper);
			if (!gradient) {
				return null;
			}

			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, "image/png"),
			);
			if (!blob) {
				return null;
			}

			const tempPath = await this.writeNativeStaticLayoutTempAsset(
				new Uint8Array(await blob.arrayBuffer()),
				"png",
			);
			return tempPath
				? {
						backgroundColor: "#101010",
						backgroundImagePath: tempPath,
						temporaryPath: tempPath,
					}
				: null;
		} catch (error) {
			console.warn("[VideoExporter] Unable to materialize native gradient background", error);
			return null;
		}
	}

	private createNativeStaticLayoutGradient(
		ctx: CanvasRenderingContext2D,
		wallpaper: string,
	): CanvasGradient | null {
		const gradientMatch = wallpaper.match(/(linear|radial)-gradient\((.+)\)/);
		if (!gradientMatch) {
			return null;
		}

		const [, type, params] = gradientMatch;
		const parts = this.splitCssGradientArguments(params).map((part) => part.trim());
		const colorStops = parts
			.map(
				(part) =>
					part.match(/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)/i)?.[1],
			)
			.filter((color): color is string => Boolean(color));
		if (colorStops.length === 0) {
			return null;
		}

		const gradient =
			type === "linear"
				? ctx.createLinearGradient(0, 0, 0, this.config.height)
				: ctx.createRadialGradient(
						this.config.width / 2,
						this.config.height / 2,
						0,
						this.config.width / 2,
						this.config.height / 2,
						Math.max(this.config.width, this.config.height) / 2,
					);

		if (colorStops.length === 1) {
			gradient.addColorStop(0, colorStops[0]);
			gradient.addColorStop(1, colorStops[0]);
			return gradient;
		}

		colorStops.forEach((color, index) => {
			gradient.addColorStop(index / (colorStops.length - 1), color);
		});
		return gradient;
	}

	private splitCssGradientArguments(params: string): string[] {
		const parts: string[] = [];
		let current = "";
		let depth = 0;

		for (const char of params) {
			if (char === "(") {
				depth++;
				current += char;
				continue;
			}
			if (char === ")") {
				depth = Math.max(0, depth - 1);
				current += char;
				continue;
			}
			if (char === "," && depth === 0) {
				if (current.trim()) {
					parts.push(current.trim());
				}
				current = "";
				continue;
			}

			current += char;
		}

		if (current.trim()) {
			parts.push(current.trim());
		}

		return parts;
	}

	private async writeNativeStaticLayoutTempAsset(
		bytes: Uint8Array,
		extension: string,
	): Promise<string | null> {
		if (typeof window === "undefined") {
			return null;
		}

		const api = window.electronAPI;
		if (
			!api?.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			bytes.byteLength === 0
		) {
			return null;
		}

		let streamId: string | undefined;
		try {
			const openResult = await api.openExportStream({ extension });
			if (!openResult.success || !openResult.streamId) {
				return null;
			}

			streamId = openResult.streamId;
			const writeResult = await api.writeExportStreamChunk(streamId, 0, bytes);
			if (!writeResult.success) {
				throw new Error(writeResult.error || "Failed to write native background temp file");
			}

			const closeResult = await api.closeExportStream(streamId);
			streamId = undefined;
			return closeResult.success && closeResult.tempPath ? closeResult.tempPath : null;
		} catch (error) {
			console.warn("[VideoExporter] Unable to write native background temp file", error);
			if (streamId) {
				await api.closeExportStream(streamId, { abort: true }).catch(() => undefined);
			}
			return null;
		}
	}

	private async cleanupNativeStaticLayoutBackground(
		background: NativeStaticLayoutBackground | null | undefined,
	) {
		const temporaryPath = background?.temporaryPath;
		if (!temporaryPath || typeof window === "undefined") {
			return;
		}

		try {
			await window.electronAPI?.discardExportedTemp?.(temporaryPath);
		} catch {
			// Best-effort cleanup for temporary materialized background assets.
		}
	}

	private getDataUrlMimeType(dataUrl: string) {
		return dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "";
	}

	private getNativeStaticLayoutImageExtension(mimeType: string): string | null {
		if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
		if (mimeType === "image/png") return "png";
		if (mimeType === "image/bmp") return "bmp";
		return null;
	}

	private async resolveNativeBundledAssetPath(assetPath: string): Promise<string | null> {
		const normalizedAssetPath = assetPath.replace(/^\/+/, "");
		const [assetDirectory, fileName] = normalizedAssetPath.split("/");
		if (!assetDirectory || !fileName) {
			return null;
		}

		try {
			const result = await window.electronAPI?.listAssetDirectory?.(assetDirectory);
			if (
				result?.success &&
				result.files &&
				!result.files.includes(decodeURIComponent(fileName))
			) {
				console.warn("[VideoExporter] Native static layout wallpaper asset is missing", {
					assetPath,
				});
				return null;
			}
		} catch {
			// Keep native export opportunistic when directory probing is unavailable.
		}

		const assetBasePath = await window.electronAPI?.getAssetBasePath?.();
		if (!assetBasePath) {
			return null;
		}

		const assetUrl = new URL(normalizedAssetPath, assetBasePath).toString();
		return getLocalFilePath(assetUrl);
	}

	private async renderEditedAudioForNativeMux(
		description: string,
		onProgress: (progress: number) => void,
		sourceAudioFallbackPaths = this.config.sourceAudioFallbackPaths,
		knownDurationSec?: number,
	) {
		this.audioProcessor = new AudioProcessor();
		this.audioProcessor.setOnProgress(onProgress);
		const audioBlob = await this.measureFinalizationStage("editedAudioRenderMs", async () =>
			this.awaitWithFinalizationTimeout(
				this.audioProcessor!.renderEditedAudioTrack(
					this.config.videoUrl,
					this.config.trimRegions,
					this.config.speedRegions,
					this.config.audioRegions,
					sourceAudioFallbackPaths,
					this.config.sourceAudioFallbackStartDelayMsByPath,
					this.config.sourceAudioTrackSettings,
					this.config.clipRegions,
					knownDurationSec,
				),
				description,
				"audio",
				true,
			),
		);

		return {
			editedAudioData: await audioBlob.arrayBuffer(),
			editedAudioMimeType: audioBlob.type || null,
		};
	}

	/**
	 * Whether the edited-track offline audio render can be deferred behind the
	 * CUDA compositor launch. The deferral requires the export-stream IPC: the
	 * renderer streams the WAV payload into a temp file while the compositor
	 * runs, and main waits for the stream closure at mux time. The filtergraph
	 * fast path never needs a render, so it is never deferred.
	 */
	private canDeferEditedAudioRender(audioPlan: NativeAudioPlan): boolean {
		if (
			audioPlan.audioMode !== "edited-track" ||
			audioPlan.strategy === "filtergraph-fast-path"
		) {
			return false;
		}
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api ||
			!api.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			!api.discardExportedTemp
		) {
			return false;
		}
		return true;
	}

	/**
	 * Starts the deferred edited-track audio render against an export-stream
	 * temp file so the CUDA compositor launches immediately (video-only) while
	 * the render proceeds concurrently. `opened` resolves with the stream id as
	 * soon as the stream exists (the IPC launch needs the id); `promise` settles
	 * when the WAV payload is fully written and the stream closed. The stream
	 * closure is the deterministic handshake main waits on at mux time, so the
	 * payload always reaches main before the final mux. On failure the stream is
	 * aborted (never left open for main's bounded wait to hang) and the rejection
	 * surfaces as a hard, actionable error.
	 */
	private startDeferredEditedAudioRender(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
		knownDurationSec?: number,
	): { opened: Promise<string>; promise: Promise<void> } | null {
		if (
			audioPlan.audioMode !== "edited-track" ||
			audioPlan.strategy !== "offline-render-fallback"
		) {
			return null;
		}
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api ||
			!api.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream
		) {
			return null;
		}
		let streamId: string | null = null;
		let resolveOpened: (streamId: string) => void = () => undefined;
		const opened = new Promise<string>((resolve) => {
			resolveOpened = resolve;
		});
		const promise = (async () => {
			const openedStream = await api.openExportStream({ extension: "wav" });
			if (!openedStream.success || !openedStream.streamId) {
				throw new Error(
					`open-deferred-audio-stream: ${openedStream.error ?? "Edited audio export stream could not be opened"}`,
				);
			}
			streamId = openedStream.streamId;
			this.deferredEditedAudioStreamId = openedStream.streamId;
			resolveOpened(openedStream.streamId);

			const rendered = await this.renderEditedAudioForNativeMux(
				"Native static-layout edited audio rendering",
				(progress) => this.reportProgress(0, totalFrames, "preparing", undefined, progress),
				audioPlan.sourceAudioFallbackPaths,
				knownDurationSec,
			);
			const writeResult = await api.writeExportStreamChunk(
				openedStream.streamId,
				0,
				new Uint8Array(rendered.editedAudioData),
			);
			if (!writeResult.success) {
				throw new Error(writeResult.error ?? "Deferred edited audio stream write failed");
			}
			const closed = await api.closeExportStream(openedStream.streamId);
			streamId = null;
			this.deferredEditedAudioStreamId = null;
			if (!closed.success || !closed.tempPath || (closed.bytesWritten ?? 0) === 0) {
				throw new Error(closed.error ?? "Deferred edited audio stream did not finalize");
			}
		})().catch(async (error: unknown) => {
			// Abort the stream so main's bounded mux wait fails fast instead of
			// waiting the full timeout; the native export then hard-fails with an
			// actionable missing-audio error.
			if (streamId) {
				await api.closeExportStream(streamId, { abort: true }).catch(() => undefined);
			}
			this.deferredEditedAudioStreamId = null;
			throw error instanceof Error ? error : new Error(String(error));
		});
		return { opened, promise };
	}

	/**
	 * Settles the deferred edited-audio render. On success (or when the payload
	 * already reached main) this just awaits the render; on failure paths it
	 * aborts the still-open stream so the renderer never leaves a dangling temp
	 * file or a waiter behind.
	 */
	private async settleDeferredEditedAudio(
		deferredAudio: { opened: Promise<string>; promise: Promise<void> } | null,
		options: { abort: boolean },
	): Promise<void> {
		if (!deferredAudio) {
			return;
		}
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (options.abort && this.deferredEditedAudioStreamId && api?.closeExportStream) {
			const streamId = this.deferredEditedAudioStreamId;
			this.deferredEditedAudioStreamId = null;
			await api.closeExportStream(streamId, { abort: true }).catch(() => undefined);
		}
		await deferredAudio.promise.catch((error) => {
			console.warn("[VideoExporter] Deferred edited audio render failed", error);
		});
	}

	private async getNativeStaticLayoutAudioOptions(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
		deferEditedAudio = false,
		knownDurationSec?: number,
	) {
		switch (audioPlan.audioMode) {
			case "none":
				return { audioMode: "none" as const };
			case "copy-source":
			case "trim-source":
				return {
					audioMode: audioPlan.audioMode,
					audioSourcePath: audioPlan.audioSourcePath,
					audioSourceCodec: audioPlan.audioSourceCodec,
					trimSegments: audioPlan.trimSegments,
				};
			case "edited-track": {
				if (audioPlan.strategy === "filtergraph-fast-path") {
					return {
						audioMode: audioPlan.audioMode,
						audioSourcePath: audioPlan.audioSourcePath,
						audioSourceCodec: audioPlan.audioSourceCodec,
						audioSourceSampleRate: audioPlan.audioSourceSampleRate,
						editedTrackStrategy: audioPlan.strategy,
						editedTrackSegments: audioPlan.editedTrackSegments,
					};
				}

				if (deferEditedAudio) {
					// Deferred descriptor: the WAV payload is rendered concurrently
					// with the compositor and streamed through an export stream; the
					// stream id rides in the IPC options and main waits for the stream
					// closure at mux time. Never blocks the compositor launch.
					return {
						audioMode: audioPlan.audioMode,
						editedTrackStrategy: audioPlan.strategy,
						editedAudioDeferred: true as const,
					};
				}

				const renderedAudio = await this.renderEditedAudioForNativeMux(
					"Native static-layout edited audio rendering",
					(progress) =>
						this.reportProgress(0, totalFrames, "preparing", undefined, progress),
					audioPlan.sourceAudioFallbackPaths,
					knownDurationSec,
				);

				return {
					audioMode: audioPlan.audioMode,
					editedTrackStrategy: audioPlan.strategy,
					...renderedAudio,
				};
			}
		}
	}

	private getNativeStaticLayoutWebcamOverlay(): NativeStaticLayoutWebcamOverlay | null {
		const webcam = this.config.webcam;
		if (!webcam?.enabled) {
			return null;
		}

		const inputPath = this.getNativeWebcamSourcePath();
		if (!inputPath) {
			return null;
		}

		const margin = webcam.margin ?? 24;
		const rawSize = getWebcamOverlaySizePx({
			containerWidth: this.config.width,
			containerHeight: this.config.height,
			sizePercent: webcam.width ?? webcam.size ?? 40,
			margin,
			zoomScale: 1,
			reactToZoom: webcam.reactToZoom ?? true,
		});
		const size = Math.max(2, Math.round(rawSize / 2) * 2);
		const position = getWebcamOverlayPosition({
			containerWidth: this.config.width,
			containerHeight: this.config.height,
			size,
			margin,
			positionPreset: webcam.positionPreset ?? webcam.corner,
			positionX: webcam.positionX ?? 1,
			positionY: webcam.positionY ?? 1,
			legacyCorner: webcam.corner,
		});

		return {
			inputPath,
			left: Math.round(position.x),
			top: Math.round(position.y),
			size,
			radius: Math.max(0, webcam.cornerRadius ?? 18),
			shadowIntensity: Math.min(1, Math.max(0, webcam.shadow ?? 0)),
			mirror: webcam.mirror !== false,
			timeOffsetMs: Number.isFinite(webcam.timeOffsetMs) ? webcam.timeOffsetMs : 0,
		};
	}

	private getNativeStaticLayoutCursorTelemetry():
		| Array<{
				timeMs: number;
				cx: number;
				cy: number;
				cursorType?: CursorTelemetryPoint["cursorType"];
				cursorTypeIndex?: number;
				bounceScale?: number;
		  }>
		| undefined {
		const telemetry = this.config.cursorTelemetry ?? [];
		if (this.config.showCursor !== true || telemetry.length === 0) {
			return undefined;
		}

		return buildNativeStaticLayoutCursorTelemetry(telemetry, {
			frameRate: this.config.frameRate,
			durationSec: this.effectiveDurationSec || 0,
			clickBounce: this.config.cursorClickBounce,
			clickBounceDurationMs: this.config.cursorClickBounceDuration,
			sourceCrop: this.config.cropRegion,
		});
	}

	private getNativeStaticLayoutCursorSize(contentWidth: number) {
		const cursorStyle = this.config.cursorStyle ?? "tahoe";
		const viewportScale = Math.max(0.55, contentWidth / 1920);
		return (
			28 *
			(this.config.cursorSize ?? 3) *
			viewportScale *
			getCursorStyleSizeMultiplier(cursorStyle)
		);
	}

	private getNativeStaticLayoutZoomTelemetry(
		layout: ReturnType<typeof computePaddedLayout>,
		totalFrames: number,
		cursorTelemetry:
			| Array<{
					timeMs: number;
					cx: number;
					cy: number;
					cursorType?: CursorTelemetryPoint["cursorType"];
					cursorTypeIndex?: number;
					bounceScale?: number;
			  }>
			| undefined,
	): NativeStaticLayoutZoomSample[] | undefined {
		const zoomRegions = this.config.zoomRegions ?? [];
		if (zoomRegions.length === 0 || totalFrames <= 0) {
			return undefined;
		}

		const stageSize = { width: this.config.width, height: this.config.height };
		const baseMask = {
			x: layout.centerOffsetX,
			y: layout.centerOffsetY,
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
			sourceCrop: this.config.cropRegion,
		};
		const cursorFollowCamera = createCursorFollowCameraState();
		const springScale = createSpringState(1);
		const springX = createSpringState(0);
		const springY = createSpringState(0);
		const zoomSpringConfig = getZoomSpringConfig(this.config.zoomSmoothness);
		const frameDurationMs = 1000 / Math.max(1, this.config.frameRate);
		const zoomBlurAmount = this.config.zoomMotionBlur ?? 0;
		const zoomBlurTuning = this.config.zoomMotionBlurTuning;
		const samples: NativeStaticLayoutZoomSample[] = [];
		let lastContentTimeMs: number | null = null;
		let appliedScale = 1;
		let appliedX = 0;
		let appliedY = 0;
		let previousAppliedTransform: { scale: number; x: number; y: number } | null = null;

		for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
			const timeMs = frameIndex * frameDurationMs;
			const { region, strength, blendedScale } = findDominantRegion(zoomRegions, timeMs, {
				connectZooms: this.config.connectZooms,
			});

			let targetScale = 1;
			let targetFocus = DEFAULT_FOCUS;
			let targetProgress = 0;

			if (region && strength > 0) {
				const zoomScale = blendedScale ?? ZOOM_DEPTH_SCALES[region.depth];
				let regionFocus = region.focus;
				if (
					!this.config.zoomClassicMode &&
					region.mode !== "manual" &&
					(cursorTelemetry?.length ?? 0) > 0
				) {
					regionFocus = computeCursorFollowFocus(
						cursorFollowCamera,
						cursorTelemetry ?? [],
						timeMs,
						zoomScale,
						strength,
						region.focus,
						{ snapToEdgesRatio: SNAP_TO_EDGES_RATIO_AUTO },
					);
				}

				targetScale = zoomScale;
				targetFocus = regionFocus;
				targetProgress = strength;
			}

			const projectedTransform = computeZoomTransform({
				stageSize,
				baseMask,
				zoomScale: targetScale,
				zoomProgress: targetProgress,
				focusX: targetFocus.cx,
				focusY: targetFocus.cy,
			});
			const deltaMs =
				lastContentTimeMs !== null ? timeMs - lastContentTimeMs : frameDurationMs;
			lastContentTimeMs = timeMs;

			if (this.config.zoomClassicMode) {
				appliedScale = projectedTransform.scale;
				appliedX = projectedTransform.x;
				appliedY = projectedTransform.y;
				resetSpringState(springScale, appliedScale);
				resetSpringState(springX, appliedX);
				resetSpringState(springY, appliedY);
			} else {
				appliedScale = stepSpringValue(
					springScale,
					projectedTransform.scale,
					deltaMs,
					zoomSpringConfig,
				);
				appliedX = stepSpringValue(
					springX,
					projectedTransform.x,
					deltaMs,
					zoomSpringConfig,
				);
				appliedY = stepSpringValue(
					springY,
					projectedTransform.y,
					deltaMs,
					zoomSpringConfig,
				);
			}

			const currentAppliedTransform = { scale: appliedScale, x: appliedX, y: appliedY };
			const blurStep =
				zoomBlurAmount > 0 && previousAppliedTransform
					? analyzeZoomMotionBlurStep({
							previousTransform: previousAppliedTransform,
							currentTransform: currentAppliedTransform,
							baseMask,
							stageSize,
							motionBlurAmount: zoomBlurAmount,
							motionBlurTuning: zoomBlurTuning,
							deltaSeconds: Math.min(80, Math.max(1, deltaMs)) / 1000,
						})
					: null;
			previousAppliedTransform = currentAppliedTransform;

			samples.push({
				timeMs,
				scale: appliedScale,
				x: appliedX,
				y: appliedY,
				blurStrength: blurStep?.strength ?? 0,
				blurCenterX: blurStep?.centerX ?? stageSize.width / 2,
				blurCenterY: blurStep?.centerY ?? stageSize.height / 2,
			});
		}

		return samples;
	}

	/**
	 * The generalized NVIDIA CUDA compositor can reproduce the cursor from the
	 * native atlas (sprite, position, type, click bounce, visibility) on top of
	 * the composed video. When eligible, cursor pixels are excluded from the
	 * transparent overlay sidecar and rendered natively instead, which keeps the
	 * cursor sharp and avoids baking it into the RGBA stream. Browser-only
	 * cursor effects (motion blur, sway, click effect rings), extension cursor
	 * visuals, or an unavailable atlas keep the baked-sidecar fallback.
	 */
	private canUseNativeCursorAtlasOwnership(): boolean {
		if (this.config.showCursor !== true || (this.config.cursorTelemetry?.length ?? 0) === 0) {
			return false;
		}
		if ((this.config.cursorMotionBlur ?? 0) > 0.0005) {
			return false;
		}
		if ((this.config.cursorSway ?? 0) > 0.0005) {
			return false;
		}
		const clickEffect = this.config.cursorClickEffect;
		if (clickEffect !== undefined && clickEffect !== "none") {
			return false;
		}
		if (this.hasNativeStaticLayoutExtensionCursorVisuals()) {
			return false;
		}
		// Only the generalized NVIDIA CUDA compositor draws the atlas on top of
		// the overlay sidecars; the FFmpeg overlay route and the D3D11 helper
		// cannot, so native ownership requires the CUDA-opt-in Windows route.
		return (
			this.getRuntimePlatform() === "win32" &&
			this.config.experimentalNativeExport === true &&
			this.config.experimentalNvidiaCudaExport === true
		);
	}

	/**
	 * Whether the generalized NVIDIA CUDA compositor is an eligible consumer of
	 * the native `cursor-sprite` overlay contract.
	 *
	 * The cursor-sprite contract captures only the small cursor ROI strip
	 * instead of baking the cursor into a full transparent 4K canvas per frame.
	 * It is consumed solely by the generalized NVIDIA CUDA compositor, which is
	 * independent of the output codec: native-video.ts runs the same CUDA
	 * compositor for H.264 and HEVC overlay exports whenever the user opts into
	 * the CUDA route. This predicate therefore gates on the CUDA route, not on
	 * the (HEVC-only) canUseNativeGpuStaticLayout(). Gating the cheap ROI path
	 * on the codec wrongly forced H.264 CUDA exports with a cursor-only overlay
	 * to bake the full-canvas sidecar frame-by-frame (~1 min for 192 frames)
	 * instead of capturing the tiny cursor ROI.
	 *
	 * CPU encoder preference never reaches the CUDA compositor (it is the
	 * software-encoder route), so it must never attempt a sprite here.
	 */
	private canUseNativeCursorSpriteContract(): boolean {
		if (this.config.exportEncoderPreference === "cpu") {
			return false;
		}
		return (
			this.config.experimentalNativeExport === true &&
			this.config.experimentalNvidiaCudaExport === true
		);
	}

	/**
	 * Whether extension cursor visuals / render hooks are active. Extension
	 * hooks draw into the full composite canvas outside the cursor container, so
	 * any path that captures only the cursor container (cursor-sprite ROI) would
	 * silently drop them. The baked full-canvas sidecar is required instead.
	 */
	private hasNativeStaticLayoutExtensionCursorVisuals(): boolean {
		const extensionHookPhases = [
			"background",
			"post-video",
			"post-zoom",
			"post-cursor",
			"post-webcam",
			"post-annotations",
			"final",
		] as const;
		return (
			extensionHost.hasCursorEffects() ||
			extensionHookPhases.some((phase) => extensionHost.hasRenderHooks(phase))
		);
	}

	private hasNativeStaticLayoutOverlayContent(): boolean {
		return Boolean(
			((this.config.cursorTelemetry?.length ?? 0) > 0 && this.config.showCursor !== false) ||
				(this.config.annotationRegions?.length ?? 0) > 0 ||
				(this.config.autoCaptions?.length ?? 0) > 0 ||
				this.config.frame ||
				this.config.webcam?.enabled,
		);
	}

	// Browser-rendered overlay pixels (everything the renderer draws into the
	// transparent sidecar). When the native CUDA compositor owns the cursor atlas
	// and none of these are present, the sidecar would be entirely transparent,
	// so it can be skipped entirely without rendering/capturing a canvas per frame.
	// When the webcam is owned natively by the CUDA compositor (webcamNativeOwned)
	// the renderer must NOT bake it into the sidecar, so it is excluded from the
	// browser-pixel check exactly like an atlas-owned cursor.
	private hasNativeStaticLayoutBrowserOverlayPixels(webcamNativeOwned = false): boolean {
		return Boolean(
			(this.config.annotationRegions?.length ?? 0) > 0 ||
				(this.config.autoCaptions?.length ?? 0) > 0 ||
				Boolean(this.config.frame) ||
				(Boolean(this.config.webcam?.enabled) && !webcamNativeOwned),
		);
	}

	/**
	 * Whether the webcam itself is fully representable by the generalized NVIDIA
	 * CUDA compositor. Captions, annotations, and frame chrome may coexist: the
	 * compositor draws the webcam first and then blends their sidecar above it,
	 * matching the renderer layer order without sending webcam RGBA frames back
	 * through the browser. A configured webcam shadow is still browser-owned
	 * until its blur profile has a pixel-parity native implementation.
	 */
	private canUseNativeStaticLayoutWebcamPixels(): boolean {
		const webcamOverlay = this.getNativeStaticLayoutWebcamOverlay();
		return (
			this.config.webcam?.enabled === true &&
			webcamOverlay !== null &&
			(webcamOverlay.shadowIntensity ?? 0) <= 0 &&
			!this.hasNativeStaticLayoutExtensionCursorVisuals()
		);
	}

	/**
	 * Whether the generalized NVIDIA CUDA compositor owns the webcam overlay
	 * natively for this export.
	 *
	 * Safe only on the strict HEVC Hardware CUDA route: that route guarantees the
	 * CUDA compositor runs (any fallback hard-fails with noCpuFallback:true), so
	 * excluding webcam pixels from a mixed captions/annotations sidecar can never
	 * silently drop them on an FFmpeg/D3D11 fallback. HEVC Auto and H.264 keep
	 * the existing baked-webcam sidecar path unchanged.
	 */
	private canUseNativeWebcamOwnership(): boolean {
		if (!this.requiresStrictNativeCudaRoute() || !this.canUseNativeGpuStaticLayout()) {
			return false;
		}
		return this.canUseNativeStaticLayoutWebcamPixels();
	}

	private hasUnsupportedNativeStaticLayoutOverlayContent(): string | null {
		if (this.config.annotationRegions?.some((annotation) => annotation.type === "blur")) {
			return "unsupported-blur-annotation-overlay";
		}
		return null;
	}

	private getNativeStaticLayoutFastLaneEligibility(
		audioPlan: NativeAudioPlan,
		cursorAtlasOwnedByNative: boolean,
		webcamNativeOwned: boolean,
	): NativeStaticLayoutFastLaneEligibility {
		const cursorDisabled =
			this.config.showCursor !== true || (this.config.cursorTelemetry?.length ?? 0) === 0;
		// Actual ownership, not eligibility: the empty sidecar fast lane is only
		// safe when the cursor is disabled or the CUDA compositor will genuinely
		// draw it from a successfully built atlas. An eligible-but-unbuilt atlas
		// must not silently drop the cursor, so it keeps the sidecar preparation
		// (cursor-sprite ROI or baked full-canvas) and never selects the fast lane.
		const cursorNativeOwnershipActive = cursorAtlasOwnedByNative;
		return getNativeStaticLayoutFastLaneEligibility({
			canUseNativeGpuStaticLayout: this.canUseNativeGpuStaticLayout(),
			hasBrowserOverlayPixels:
				this.hasNativeStaticLayoutBrowserOverlayPixels(webcamNativeOwned),
			cursorDisabled,
			cursorNativeOwnershipActive,
			// The edited-audio blocker only applies when the render cannot be
			// deferred behind the compositor (export-stream IPC unavailable); a
			// deferred render is genuinely non-blocking, so the fast lane stays
			// eligible.
			requiresEditedAudioRender:
				audioPlan.audioMode === "edited-track" &&
				!this.canDeferEditedAudioRender(audioPlan),
			hasAuthoritativeNativeSource: Boolean(this.getNativeVideoSourcePath()),
		});
	}

	private createNativeStaticLayoutOverlayRenderer(
		videoInfo: DecodedVideoInfo,
		excludeCursorOverlay = false,
		excludeWebcamOverlay = false,
	) {
		return new ModernFrameRenderer({
			width: this.config.width,
			height: this.config.height,
			// Overlay sidecar readback is much faster on WebGL (gl.readPixels)
			// than WebGPU's GenerateTexture canvas-copy path. The export renderer
			// has no visible canvas, so the WebGL backend is the better default here.
			preferredRenderBackend: "webgl",
			wallpaper: DEFAULT_WALLPAPER_PATH,
			zoomRegions: this.config.zoomRegions,
			showShadow: this.config.showShadow,
			shadowIntensity: this.config.shadowIntensity,
			backgroundBlur: 0,
			zoomMotionBlur: 0,
			connectZooms: this.config.connectZooms,
			zoomInDurationMs: this.config.zoomInDurationMs,
			zoomInOverlapMs: this.config.zoomInOverlapMs,
			zoomOutDurationMs: this.config.zoomOutDurationMs,
			connectedZoomGapMs: this.config.connectedZoomGapMs,
			connectedZoomDurationMs: this.config.connectedZoomDurationMs,
			zoomInEasing: this.config.zoomInEasing,
			zoomOutEasing: this.config.zoomOutEasing,
			connectedZoomEasing: this.config.connectedZoomEasing,
			borderRadius: this.config.borderRadius,
			padding: this.config.padding,
			cropRegion: this.config.cropRegion,
			webcam: excludeWebcamOverlay ? undefined : this.config.webcam,
			webcamUrl: excludeWebcamOverlay ? null : this.config.webcamUrl,
			videoWidth: videoInfo.width,
			videoHeight: videoInfo.height,
			annotationRegions: this.config.annotationRegions,
			autoCaptions: this.config.autoCaptions,
			autoCaptionSettings: this.config.autoCaptionSettings,
			speedRegions: this.config.speedRegions,
			previewWidth: this.config.previewWidth,
			previewHeight: this.config.previewHeight,
			cursorTelemetry: this.config.cursorTelemetry,
			showCursor: this.config.showCursor,
			cursorStyle: this.config.cursorStyle,
			cursorSize: this.config.cursorSize,
			cursorSmoothing: this.config.cursorSmoothing,
			cursorSpringStiffnessMultiplier: this.config.cursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier: this.config.cursorSpringDampingMultiplier,
			cursorSpringMassMultiplier: this.config.cursorSpringMassMultiplier,
			cameraSpringStiffnessMultiplier: this.config.cameraSpringStiffnessMultiplier,
			cameraSpringDampingMultiplier: this.config.cameraSpringDampingMultiplier,
			cameraSpringMassMultiplier: this.config.cameraSpringMassMultiplier,
			cursorMotionBlur: this.config.cursorMotionBlur,
			cursorClickEffect: this.config.cursorClickEffect,
			cursorClickEffectColor: this.config.cursorClickEffectColor,
			cursorClickEffectScale: this.config.cursorClickEffectScale,
			cursorClickEffectOpacity: this.config.cursorClickEffectOpacity,
			cursorClickEffectDurationMs: this.config.cursorClickEffectDurationMs,
			cursorClickBounce: this.config.cursorClickBounce,
			cursorClickBounceDuration: this.config.cursorClickBounceDuration,
			cursorSway: this.config.cursorSway,
			zoomSmoothness: this.config.zoomSmoothness,
			zoomClassicMode: this.config.zoomClassicMode,
			frame: this.config.frame,
			excludeCursorOverlay,
		});
	}

	private extractNativeTiledOverlayTileInto(
		target: Uint8Array,
		source: Uint8Array,
		sourceWidth: number,
		sourceHeight: number,
		tileX: number,
		tileY: number,
	): void {
		target.fill(0);
		const startY = tileY * NATIVE_TILED_OVERLAY_TILE_SIZE;
		const startX = tileX * NATIVE_TILED_OVERLAY_TILE_SIZE;
		const endY = Math.min(sourceHeight, startY + NATIVE_TILED_OVERLAY_TILE_SIZE);
		const endX = Math.min(sourceWidth, startX + NATIVE_TILED_OVERLAY_TILE_SIZE);
		const copyRows = Math.max(0, endY - startY);
		const copyCols = Math.max(0, endX - startX);
		for (let row = 0; row < copyRows; row += 1) {
			const sourceRowOffset = ((startY + row) * sourceWidth + startX) * 4;
			const targetRowOffset = row * NATIVE_TILED_OVERLAY_TILE_SIZE * 4;
			const rowBytes = copyCols * 4;
			target.set(
				source.subarray(sourceRowOffset, sourceRowOffset + rowBytes),
				targetRowOffset,
			);
		}
	}

	/**
	 * Whether the cursor should be captured as a cursor-sprite ROI strip instead
	 * of being baked into a full transparent RGBA canvas sidecar.
	 *
	 * A cursor-sprite is only usable on the generalized NVIDIA CUDA compositor
	 * (the sole consumer of the native `cursor-sprite` contract) and only when
	 * the cursor is the entire overlay (no browser pixels) and is NOT actually
	 * owned by the native atlas (cursorExcluded === cursorAtlasOwnedByNative).
	 * When the atlas is eligible but was not successfully built, the sprite path
	 * is the pixel-preserving fallback: it renders the same Pixi cursor into the
	 * ROI instead of the expensive full-canvas tiled sidecar. Browser-only
	 * cursor effects (motion blur/sway/click) also use the sprite. Extension
	 * cursor visuals keep the baked full-canvas sidecar because extension hooks
	 * draw outside the cursor container (the sprite would drop them). When the
	 * sprite cannot be used the baked-cursor full-canvas sidecar path runs
	 * unchanged (the preserved golden path).
	 */
	private shouldUseNativeStaticLayoutCursorSprite(
		cursorExcluded: boolean,
		webcamExcluded = false,
	): boolean {
		return (
			!cursorExcluded &&
			this.canUseNativeCursorSpriteContract() &&
			this.config.showCursor === true &&
			(this.config.cursorTelemetry?.length ?? 0) > 0 &&
			!this.hasNativeStaticLayoutExtensionCursorVisuals() &&
			!this.hasNativeStaticLayoutBrowserOverlayPixels(webcamExcluded)
		);
	}

	/**
	 * Conservative predicate for the streaming raw-overlay path. Streaming is
	 * only safe when the final sidecar is provably a raw RGBA full-frame layer
	 * with frameCount === effectiveFrameCount === totalFrames, so the native
	 * compositor can begin source prep/helper startup while the renderer is
	 * still baking.
	 *
	 * Conditions (all required):
	 * - The CUDA compositor route is eligible (same gate as cursor-sprite).
	 * - There are browser-rendered overlay pixels (the bake would run).
	 * - The cursor is NOT the only overlay (cursor-sprite path handles that).
	 * - No extension hooks/cursor visuals (those need the full baked path).
	 * - No unsupported overlay content (blur annotations, etc.).
	 * - CPU encoder preference never reaches the CUDA compositor.
	 *
	 * The predicate is checked after the fast-lane and cursor-sprite decisions,
	 * so it only applies to the remaining baked full-canvas sidecar path.
	 */
	private canUseStreamingRawOverlay(cursorExcluded: boolean, webcamExcluded: boolean): boolean {
		if (this.config.exportEncoderPreference === "cpu") {
			return false;
		}
		if (
			this.config.experimentalNativeExport !== true ||
			this.config.experimentalNvidiaCudaExport !== true
		) {
			return false;
		}
		if (!this.hasNativeStaticLayoutBrowserOverlayPixels(webcamExcluded)) {
			return false;
		}
		if (this.shouldUseNativeStaticLayoutCursorSprite(cursorExcluded, webcamExcluded)) {
			return false;
		}
		if (this.hasNativeStaticLayoutExtensionCursorVisuals()) {
			return false;
		}
		if (this.hasUnsupportedNativeStaticLayoutOverlayContent()) {
			return false;
		}
		// Captions, authored annotations, and frame chrome occupy only a small
		// part of the output in the normal case.  A full RGBA stream writes and
		// blends every 4K pixel for every frame even though CUDA only needs the
		// few changed tiles.  Prefer the sequential tiled sidecar for those
		// sources; its preparation has a dense-content escape hatch back to the
		// existing raw stream, so this never trades visual correctness for the
		// optimization.
		if (this.shouldPreferNativeTiledOverlay(webcamExcluded)) {
			return false;
		}
		return true;
	}

	/**
	 * Selects the tile-delta transport before the raw streaming transport for
	 * sparse browser pixels. The renderer remains the typography/vector source
	 * of truth, while CUDA receives only the tiles that differ over time and
	 * blends their visible bounds. Live webcam pixels are intentionally excluded
	 * here because they change across a large continuous region; the strict
	 * native-webcam path owns those pixels separately.
	 */
	private shouldPreferNativeTiledOverlay(webcamExcluded: boolean): boolean {
		if (
			this.config.exportEncoderPreference === "cpu" ||
			this.config.experimentalNativeExport !== true ||
			this.config.experimentalNvidiaCudaExport !== true ||
			this.config.experimentalNativeTiledOverlay === false
		) {
			return false;
		}
		if (this.hasNativeStaticLayoutExtensionCursorVisuals()) {
			return false;
		}
		if (this.hasUnsupportedNativeStaticLayoutOverlayContent()) {
			return false;
		}
		if (this.config.webcam?.enabled === true && !webcamExcluded) {
			return false;
		}
		return Boolean(
			(this.config.annotationRegions?.length ?? 0) > 0 ||
				(this.config.autoCaptions?.length ?? 0) > 0 ||
				this.config.frame,
		);
	}

	/**
	 * Captures the cursor ROI as a fixed packed RGBA sprite strip plus per-frame
	 * top-left positions and returns a validated native `cursor-sprite` overlay
	 * layer. Returns null (recording an overlay failure) when the cursor-sprite
	 * contract cannot be prepared, in which case the caller falls back to the
	 * existing baked-cursor full-canvas sidecar path.
	 */
	private async prepareNativeStaticLayoutCursorSprite(
		videoInfo: DecodedVideoInfo,
		durationSec: number,
		totalFrames: number,
		webcamExcluded = false,
		onPreparationProgress?: (renderProgress: number) => void,
	): Promise<NativeCursorSpriteOverlayLayer | null> {
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api?.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			!api.discardExportedTemp
		) {
			this.recordNativeStaticLayoutOverlayFailure(
				"cursor-sprite-api-unavailable",
				"Cursor-sprite export stream IPC is not available",
			);
			return null;
		}
		const renderer = this.createNativeStaticLayoutOverlayRenderer(
			videoInfo,
			false,
			webcamExcluded,
		);
		let spriteStreamId: string | null = null;
		let positionsStreamId: string | null = null;
		try {
			const spriteStream = await api.openExportStream({ extension: "sprite" });
			if (!spriteStream.success || !spriteStream.streamId || !spriteStream.tempPath) {
				this.recordNativeStaticLayoutOverlayFailure(
					"open-cursor-sprite-stream",
					spriteStream.error ?? "Cursor-sprite export stream could not be opened",
				);
				return null;
			}
			spriteStreamId = spriteStream.streamId;

			const positionsStream = await api.openExportStream({ extension: "json" });
			if (
				!positionsStream.success ||
				!positionsStream.streamId ||
				!positionsStream.tempPath
			) {
				this.recordNativeStaticLayoutOverlayFailure(
					"open-cursor-positions-stream",
					positionsStream.error ??
						"Cursor-sprite positions export stream could not be opened",
				);
				return null;
			}
			positionsStreamId = positionsStream.streamId;

			await renderer.initialize();
			const started = renderer.startCursorSpriteCapture();
			if (!started) {
				this.recordNativeStaticLayoutOverlayFailure(
					"cursor-sprite-init",
					"Cursor-sprite capture could not be initialized (no overlay renderer)",
				);
				return null;
			}

			let lastPreparationProgressMs = 0;
			for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
				if (this.cancelled) {
					throw new Error("Export cancelled");
				}
				if (onPreparationProgress) {
					const nowMs = this.getNowMs();
					if (
						nowMs - lastPreparationProgressMs >=
							NATIVE_OVERLAY_PREPARATION_PROGRESS_INTERVAL_MS ||
						frameIndex === totalFrames - 1
					) {
						lastPreparationProgressMs = nowMs;
						onPreparationProgress(
							totalFrames > 0 ? (frameIndex / totalFrames) * 100 : 0,
						);
					}
				}
				const timestampUs = Math.round((frameIndex * 1_000_000) / this.config.frameRate);
				try {
					// The cursor-sprite path captures only the cursor ROI, so skip the
					// full 4K canvas render that the baked full-canvas sidecar needs.
					// All cursor state updates (sway spring, motion-blur velocity,
					// click rings, zoom transform) still run; only the expensive
					// full-canvas rasterization is skipped.
					await renderer.renderOverlayFrame(timestampUs, timestampUs, timestampUs, true);
				} catch (error) {
					throw new Error(
						`overlay-renderer-frame: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				const capture = renderer.captureCursorSpriteFrame();
				if (!capture.captured) {
					this.recordNativeStaticLayoutOverlayFailure(
						"cursor-sprite-frame",
						capture.unavailableReason ?? "Cursor-sprite frame could not be captured",
					);
					return null;
				}
			}

			const strip = renderer.finishCursorSpriteCapture();
			if (!strip || strip.frameCount === 0) {
				this.recordNativeStaticLayoutOverlayFailure(
					"cursor-sprite-finish",
					"Cursor-sprite capture produced no frames",
				);
				return null;
			}

			const spriteWrite = await api.writeExportStreamChunk(spriteStreamId, 0, strip.frames);
			if (!spriteWrite.success) {
				throw new Error(
					`cursor-sprite-stream-write: ${spriteWrite.error ?? "Failed to write cursor-sprite strip"}`,
				);
			}
			const clampedPositions: NativeCursorSpritePosition[] = strip.positions.map((position) =>
				clampNativeCursorSpritePosition(
					position,
					strip.width,
					strip.height,
					this.config.width,
					this.config.height,
				),
			);
			const positionsBytes = new TextEncoder().encode(JSON.stringify(clampedPositions));
			const positionsWrite = await api.writeExportStreamChunk(
				positionsStreamId,
				0,
				positionsBytes,
			);
			if (!positionsWrite.success) {
				throw new Error(
					`cursor-positions-stream-write: ${positionsWrite.error ?? "Failed to write cursor-sprite positions"}`,
				);
			}

			const spriteClosed = await api.closeExportStream(spriteStreamId);
			spriteStreamId = null;
			if (!spriteClosed.success || !spriteClosed.tempPath) {
				throw new Error(
					`cursor-sprite-stream-close: ${spriteClosed.error ?? "Cursor-sprite stream did not finalize"}`,
				);
			}
			const positionsClosed = await api.closeExportStream(positionsStreamId);
			positionsStreamId = null;
			if (!positionsClosed.success || !positionsClosed.tempPath) {
				throw new Error(
					`cursor-positions-stream-close: ${positionsClosed.error ?? "Cursor-sprite positions stream did not finalize"}`,
				);
			}

			const layer: NativeCursorSpriteOverlayLayer = {
				id: "cursor-sprite",
				order: 1,
				kind: NATIVE_CURSOR_SPRITE_LAYER_KIND,
				path: spriteClosed.tempPath,
				positionsPath: positionsClosed.tempPath,
				x: 0,
				y: 0,
				width: strip.width,
				height: strip.height,
				frameRate: this.config.frameRate,
				durationSec,
				frameCount: strip.frameCount,
				positions: clampedPositions,
				pixelFormat: "rgba",
			};
			const validationError = validateNativeCursorSpriteOverlayLayer(layer, {
				outputWidth: this.config.width,
				outputHeight: this.config.height,
				durationSec,
				frameRate: this.config.frameRate,
			});
			if (validationError) {
				throw new Error(`cursor-sprite-layer-invalid: ${validationError}`);
			}
			console.info("[VideoExporter] Native static layout cursor-sprite selected", {
				route: "nvidia-cuda-compositor",
				cursorStyle: this.config.cursorStyle ?? "tahoe",
				spriteWidth: strip.width,
				spriteHeight: strip.height,
				frameCount: strip.frameCount,
			});
			return layer;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stage = message.startsWith("cursor-")
				? message.split(":", 1)[0]
				: "cursor-sprite-preparation";
			this.recordNativeStaticLayoutOverlayFailure(stage, message);
			console.warn(
				"[VideoExporter] Cursor-sprite preparation failed; falling back to baked cursor overlay sidecar",
				{ stage, message, totalFrames, cancelled: this.cancelled },
			);
			return null;
		} finally {
			// Abort any export streams still open on both the thrown-error path and
			// the early-return-null paths (a finalized stream already nulls its id).
			if (spriteStreamId) {
				try {
					await api.closeExportStream(spriteStreamId, { abort: true });
				} catch {
					// Best-effort cleanup.
				}
			}
			if (positionsStreamId) {
				try {
					await api.closeExportStream(positionsStreamId, { abort: true });
				} catch {
					// Best-effort cleanup.
				}
			}
			try {
				renderer.cancelCursorSpriteCapture();
			} catch {
				// Best-effort cleanup.
			}
			try {
				renderer.destroy();
			} catch {
				// Cleanup is best-effort after a failed cursor-sprite attempt.
			}
		}
	}

	/**
	 * Whether the concurrent cursor-sprite streaming path is available. It
	 * requires the export-stream IPC plus the concurrent native IPC. The actual
	 * telemetry-derived precompute happens inside streamCursorSpriteAndExport,
	 * so an empty/malformed telemetry plan falls back to the sequential sprite
	 * bake instead of hard-failing here.
	 */
	private canStreamCursorSprite(): boolean {
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api ||
			!api.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			!api.discardExportedTemp ||
			!api.nativeStaticLayoutExport ||
			!api.nativeStaticLayoutExportCancel
		) {
			return false;
		}
		return true;
	}

	/**
	 * Precomputes the fixed cursor-sprite strip geometry from cursor telemetry
	 * BEFORE the bake so the native IPC can launch concurrently with the ROI
	 * render/write loop. The strip is a fixed square sized to the renderer's
	 * cursor sprite extent (dotRadius 28 * cursorSize * viewportScale *
	 * styleMultiplier, doubled to cover aspect ratios up to 2:1 and anchor
	 * extremes) plus the full effect/filter expansion padding, clamped to the
	 * output canvas. Every frame's ROI is that same fixed rect placed at the
	 * telemetry-interpolated (viewport-projected) position and clamped so the
	 * strip stays in-canvas; the recorded position equals that clamped origin.
	 * The smoothed renderer cursor lags the raw interpolation by only a few
	 * pixels, far inside the padding, so the rendered content always lands
	 * inside the strip while the compositor draws the strip exactly at the
	 * recorded position (self-consistent even when the smoothed position
	 * differs).
	 */
	private precomputeNativeCursorSpritePlan(ctx: {
		contentWidth: number;
		contentHeight: number;
		offsetX: number;
		offsetY: number;
		totalFrames: number;
	}): NativeCursorSpriteStreamPlan | null {
		const telemetry = this.config.cursorTelemetry ?? [];
		if (
			telemetry.length === 0 ||
			!Number.isFinite(this.config.frameRate) ||
			this.config.frameRate <= 0
		) {
			return null;
		}
		const outputWidth = this.config.width;
		const outputHeight = this.config.height;
		const viewportScale = Math.max(0.55, ctx.contentWidth / 1920);
		const stripSize = computeCursorSpriteStripSize({
			dotRadius: DEFAULT_CURSOR_CONFIG.dotRadius,
			cursorSize: this.config.cursorSize,
			viewportScale,
			styleSizeMultiplier: getCursorStyleSizeMultiplier(this.config.cursorStyle ?? "tahoe"),
			outputWidth: outputWidth,
			outputHeight: outputHeight,
			cursorMotionBlur: this.config.cursorMotionBlur,
			cursorSway: this.config.cursorSway,
			cursorClickEffect: this.config.cursorClickEffect,
		});
		const stripWidth = stripSize.width;
		const stripHeight = stripSize.height;
		const maxX = Math.max(0, outputWidth - stripWidth);
		const maxY = Math.max(0, outputHeight - stripHeight);
		const positions: NativeCursorSpritePosition[] = [];
		const rois: CursorRect[] = [];
		for (let frameIndex = 0; frameIndex < ctx.totalFrames; frameIndex += 1) {
			const timeMs = (frameIndex * 1000) / this.config.frameRate;
			const target = interpolateCursorPosition(telemetry, timeMs);
			if (!target) {
				return null;
			}
			const projected = projectCursorPositionToViewport(target, this.config.cropRegion);
			const centerX = ctx.offsetX + projected.cx * ctx.contentWidth;
			const centerY = ctx.offsetY + projected.cy * ctx.contentHeight;
			const positionX = Math.max(0, Math.min(maxX, Math.round(centerX - stripWidth / 2)));
			const positionY = Math.max(0, Math.min(maxY, Math.round(centerY - stripHeight / 2)));
			positions.push({ x: positionX, y: positionY });
			rois.push({
				x: positionX,
				y: positionY,
				width: stripWidth,
				height: stripHeight,
			});
		}
		return { stripWidth, stripHeight, positions, rois };
	}

	/**
	 * Concurrent streaming cursor-sprite bake + native IPC. Precomputes the
	 * fixed strip geometry and per-frame positions from telemetry, writes and
	 * closes the positions sidecar FIRST (the compositor parses it at startup),
	 * launches `nativeStaticLayoutExport` with `streamingCursorSprite: true` so
	 * CUDA source prep/helper startup overlaps the ROI bake, then renders each
	 * frame's cursor ROI into the precomputed strip rect and writes the RGBA
	 * frame at its fixed offset (frameIndex * stripW * stripH * 4). The strip
	 * stream stays open while the compositor's bounded growing-file reader
	 * polls for it. Both the bake and the native result are settled before
	 * returning.
	 *
	 * On bake error/cancellation: aborts both streams, cancels the native
	 * session, and returns a null overlay preparation. On early native failure
	 * the bake loop checks a shared flag and stops.
	 */
	private async streamCursorSpriteAndExport(ctx: {
		videoInfo: DecodedVideoInfo;
		durationSec: number;
		totalFrames: number;
		webcamExcluded: boolean;
		sessionId: string;
		contentWidth: number;
		contentHeight: number;
		offsetX: number;
		offsetY: number;
		nativeStaticLayoutOptions: Record<string, unknown>;
		onPreparationProgress?: (renderProgress: number) => void;
	}): Promise<StreamingCursorSpriteResult | null> {
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api?.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			!api.discardExportedTemp ||
			!api.nativeStaticLayoutExport ||
			!api.nativeStaticLayoutExportCancel
		) {
			this.recordNativeStaticLayoutOverlayFailure(
				"cursor-sprite-stream-api-unavailable",
				"Cursor-sprite streaming IPC is not available",
			);
			return null;
		}

		const plan = this.precomputeNativeCursorSpritePlan({
			contentWidth: ctx.contentWidth,
			contentHeight: ctx.contentHeight,
			offsetX: ctx.offsetX,
			offsetY: ctx.offsetY,
			totalFrames: ctx.totalFrames,
		});
		if (!plan) {
			this.recordNativeStaticLayoutOverlayFailure(
				"cursor-sprite-plan",
				"Cursor-sprite streaming plan could not be derived from cursor telemetry",
			);
			return null;
		}

		let spriteStreamId: string | null = null;
		let positionsStreamId: string | null = null;
		try {
			const spriteStream = await api.openExportStream({ extension: "sprite" });
			if (!spriteStream.success || !spriteStream.streamId || !spriteStream.tempPath) {
				this.recordNativeStaticLayoutOverlayFailure(
					"open-cursor-sprite-stream",
					spriteStream.error ?? "Cursor-sprite export stream could not be opened",
				);
				return null;
			}
			spriteStreamId = spriteStream.streamId;

			const positionsStream = await api.openExportStream({ extension: "json" });
			if (
				!positionsStream.success ||
				!positionsStream.streamId ||
				!positionsStream.tempPath
			) {
				this.recordNativeStaticLayoutOverlayFailure(
					"open-cursor-positions-stream",
					positionsStream.error ??
						"Cursor-sprite positions export stream could not be opened",
				);
				return null;
			}
			positionsStreamId = positionsStream.streamId;

			// The compositor parses the positions sidecar at startup (exactly
			// frameCount entries), so write + close it BEFORE launching the IPC.
			// The strip stays open and grows as the bake proceeds.
			const positionsBytes = new TextEncoder().encode(JSON.stringify(plan.positions));
			const positionsWrite = await api.writeExportStreamChunk(
				positionsStreamId,
				0,
				positionsBytes,
			);
			if (!positionsWrite.success) {
				throw new Error(
					`cursor-positions-stream-write: ${positionsWrite.error ?? "Failed to write cursor-sprite positions"}`,
				);
			}
			const finalizedPositionsStreamId = positionsStreamId;
			const positionsClosed = await api.closeExportStream(positionsStreamId);
			positionsStreamId = null;
			if (!positionsClosed.success || !positionsClosed.tempPath) {
				throw new Error(
					`cursor-positions-stream-close: ${positionsClosed.error ?? "Cursor-sprite positions stream did not finalize"}`,
				);
			}

			const layer: NativeCursorSpriteOverlayLayer = {
				id: "cursor-sprite",
				order: 1,
				kind: NATIVE_CURSOR_SPRITE_LAYER_KIND,
				path: spriteStream.tempPath,
				positionsPath: positionsClosed.tempPath,
				x: 0,
				y: 0,
				width: plan.stripWidth,
				height: plan.stripHeight,
				frameRate: this.config.frameRate,
				durationSec: ctx.durationSec,
				frameCount: ctx.totalFrames,
				positions: plan.positions,
				pixelFormat: "rgba",
			};
			const validationError = validateNativeCursorSpriteOverlayLayer(layer, {
				outputWidth: this.config.width,
				outputHeight: this.config.height,
				durationSec: ctx.durationSec,
				frameRate: this.config.frameRate,
			});
			if (validationError) {
				throw new Error(`cursor-sprite-layer-invalid: ${validationError}`);
			}

			const streamingOptions = {
				...ctx.nativeStaticLayoutOptions,
				streamingCursorSprite: true,
				spriteStreamId: spriteStream.streamId,
				spritePositionsStreamId: finalizedPositionsStreamId,
				overlayLayers: [layer],
				tiledOverlayLayers: undefined,
			} as unknown as Parameters<typeof window.electronAPI.nativeStaticLayoutExport>[0];

			console.info(
				formatLogTs(),
				"[VideoExporter] Native static layout streaming cursor-sprite selected",
				{
					route: "nvidia-cuda-compositor",
					streamingCursorSprite: true,
					cursorStyle: this.config.cursorStyle ?? "tahoe",
					stripWidth: plan.stripWidth,
					stripHeight: plan.stripHeight,
					frameCount: ctx.totalFrames,
					frameByteSize: plan.stripWidth * plan.stripHeight * 4,
					spritePath: spriteStream.tempPath,
					positionsPath: positionsClosed.tempPath,
				},
			);

			const nativePromise = api.nativeStaticLayoutExport(streamingOptions).catch(
				(error: unknown): NativeStaticLayoutExportIpcResult => ({
					success: false as const,
					error: error instanceof Error ? error.message : String(error),
				}),
			);

			// Shared flag: if the native export fails early, stop the bake loop.
			let nativeFailed = false;
			void nativePromise.then((result) => {
				if (!result.success) {
					nativeFailed = true;
				}
			});

			const renderer = this.createNativeStaticLayoutOverlayRenderer(
				ctx.videoInfo,
				false,
				ctx.webcamExcluded,
			);
			let renderedFrameCount = 0;
			let bakeError: Error | null = null;
			let lastPreparationProgressMs = 0;
			const frameByteSize = plan.stripWidth * plan.stripHeight * 4;
			try {
				await renderer.initialize();
				const started = renderer.startCursorSpriteCapture(
					plan.stripWidth,
					plan.stripHeight,
				);
				if (!started) {
					throw new Error(
						"cursor-sprite-init: Cursor-sprite capture could not be initialized",
					);
				}
				for (let frameIndex = 0; frameIndex < ctx.totalFrames; frameIndex += 1) {
					if (this.cancelled) {
						throw new Error("Export cancelled");
					}
					if (nativeFailed) {
						throw new Error(
							"cursor-sprite-streaming-native-failed: native export failed during sprite bake",
						);
					}
					if (ctx.onPreparationProgress) {
						const nowMs = this.getNowMs();
						if (
							nowMs - lastPreparationProgressMs >=
								NATIVE_OVERLAY_PREPARATION_PROGRESS_INTERVAL_MS ||
							frameIndex === ctx.totalFrames - 1
						) {
							lastPreparationProgressMs = nowMs;
							ctx.onPreparationProgress(
								ctx.totalFrames > 0 ? (frameIndex / ctx.totalFrames) * 100 : 0,
							);
						}
					}
					const timestampUs = Math.round(
						(frameIndex * 1_000_000) / this.config.frameRate,
					);
					try {
						await renderer.renderOverlayFrame(
							timestampUs,
							timestampUs,
							timestampUs,
							true,
						);
					} catch (error) {
						throw new Error(
							`overlay-renderer-frame: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					const roi = plan.rois[frameIndex]!;
					const capture = renderer.captureCursorSpriteFrame(roi);
					if (!capture.captured) {
						throw new Error(
							`cursor-sprite-frame: ${capture.unavailableReason ?? "Cursor-sprite frame could not be captured"}`,
						);
					}
					const frame = renderer.getLastCursorSpriteFrameBuffer();
					if (!frame || frame.byteLength !== frameByteSize) {
						throw new Error(
							`cursor-sprite-frame-size: expected ${frameByteSize} bytes, received ${frame?.byteLength ?? 0}`,
						);
					}
					try {
						const writeResult = await api.writeExportStreamChunk(
							spriteStreamId!,
							frameIndex * frameByteSize,
							frame,
						);
						if (!writeResult.success) {
							throw new Error(
								writeResult.error ??
									"Failed to write streaming cursor-sprite frame",
							);
						}
					} catch (error) {
						throw new Error(
							`cursor-sprite-stream-write: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					renderedFrameCount += 1;
				}

				const spriteClosed = await api.closeExportStream(spriteStreamId!);
				spriteStreamId = null;
				if (!spriteClosed.success || !spriteClosed.tempPath) {
					throw new Error(
						`cursor-sprite-stream-close: ${spriteClosed.error ?? "Cursor-sprite stream did not finalize"}`,
					);
				}
				const expectedBytes = frameByteSize * renderedFrameCount;
				if (spriteClosed.bytesWritten !== expectedBytes) {
					throw new Error(
						`cursor-sprite-stream-truncated: expected ${expectedBytes} bytes, stream wrote ${spriteClosed.bytesWritten}`,
					);
				}
			} catch (error) {
				bakeError = error instanceof Error ? error : new Error(String(error));
			} finally {
				try {
					renderer.destroy();
				} catch {
					// Cleanup is best-effort.
				}
			}

			if (bakeError) {
				if (spriteStreamId) {
					await api
						.closeExportStream(spriteStreamId, { abort: true })
						.catch(() => undefined);
					spriteStreamId = null;
				}
				await Promise.resolve(api.nativeStaticLayoutExportCancel?.(ctx.sessionId)).catch(
					() => undefined,
				);
				await nativePromise.catch(() => undefined);
				if (positionsClosed.tempPath) {
					await api.discardExportedTemp(positionsClosed.tempPath).catch(() => undefined);
				}
				const message = bakeError.message;
				const stage = message.startsWith("cursor-")
					? message.split(":", 1)[0]
					: "cursor-sprite-streaming-preparation";
				this.recordNativeStaticLayoutOverlayFailure(stage, message);
				console.warn("[VideoExporter] Native streaming cursor-sprite bake failed", {
					stage,
					message,
					totalFrames: ctx.totalFrames,
					renderedFrameCount,
					cancelled: this.cancelled,
				});
				return null;
			}

			const nativeResult = await nativePromise;

			const overlayPreparation: NativeStaticLayoutOverlayPreparationResult = {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([layer]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason: null,
				renderedFrames: renderedFrameCount,
			};
			return {
				overlayPreparation,
				nativeResult,
				streamingCursorSprite: true,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordNativeStaticLayoutOverlayFailure("cursor-sprite-streaming-setup", message);
			if (spriteStreamId) {
				await api.closeExportStream(spriteStreamId, { abort: true }).catch(() => undefined);
			}
			if (positionsStreamId) {
				await api
					.closeExportStream(positionsStreamId, { abort: true })
					.catch(() => undefined);
			}
			return null;
		}
	}

	/**
	 * Concurrent streaming raw-overlay bake + native IPC. Opens the raw RGBA
	 * export stream, builds the raw layer descriptor with
	 * frameCount === effectiveFrameCount === totalFrames (no RLE coalescing,
	 * no tiled deltas), launches `nativeStaticLayoutExport` with
	 * `streamingRawOverlay: true` so CUDA source prep/helper startup overlaps
	 * the per-frame bake, then writes each full RGBA frame sequentially to the
	 * raw file. Both the bake and the native result are settled before
	 * returning.
	 *
	 * On bake error/cancellation: aborts the raw stream, cancels the native
	 * session, and returns a null overlay preparation so the caller falls
	 * through to the existing skip/fallback logic. On early native failure:
	 * the bake loop checks a shared flag and stops further rendering.
	 */
	private async streamRawOverlayAndExport(ctx: {
		videoInfo: DecodedVideoInfo;
		durationSec: number;
		totalFrames: number;
		cursorExcluded: boolean;
		webcamExcluded: boolean;
		sessionId: string;
		nativeStaticLayoutOptions: Record<string, unknown>;
		onPreparationProgress?: (renderProgress: number) => void;
	}): Promise<StreamingRawOverlayResult | null> {
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api?.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			!api.discardExportedTemp ||
			!api.nativeStaticLayoutExport ||
			!api.nativeStaticLayoutExportCancel
		) {
			this.recordNativeStaticLayoutOverlayFailure(
				"export-stream-api-unavailable",
				"Export stream IPC is not available for the streaming overlay sidecar",
			);
			return null;
		}

		const frameByteSize = getNativeStaticLayoutOverlayFrameByteSize(
			this.config.width,
			this.config.height,
		);

		let rawStreamId: string | null = null;
		let rawTempPath: string | null = null;
		try {
			const rawStream = await api.openExportStream({ extension: "rgba" });
			if (!rawStream.success || !rawStream.streamId || !rawStream.tempPath) {
				this.recordNativeStaticLayoutOverlayFailure(
					"open-export-stream",
					rawStream.error ?? "Native overlay export stream could not be opened",
				);
				return null;
			}
			rawStreamId = rawStream.streamId;
			rawTempPath = rawStream.tempPath;
		} catch (error) {
			this.recordNativeStaticLayoutOverlayFailure(
				"open-export-stream",
				error instanceof Error ? error.message : String(error),
			);
			return null;
		}

		try {
			const activeRawStreamId: string = rawStreamId;

			// Build the raw layer descriptor with exact frame counts so the native
			// streaming validation passes. No effectiveFrameCount dedup: every
			// frame is written sequentially to the raw file.
			const rawLayer: NativeStaticLayoutOverlayLayer = {
				id: "native-effects",
				order: 0,
				path: rawTempPath,
				x: 0,
				y: 0,
				width: this.config.width,
				height: this.config.height,
				frameRate: this.config.frameRate,
				durationSec: ctx.durationSec,
				frameCount: ctx.totalFrames,
				// The pinned native streaming validator requires
				// frameCount === effectiveFrameCount === total output frame
				// count. Every frame is written sequentially (no RLE dedup),
				// so the physical frame count equals the logical one.
				effectiveFrameCount: ctx.totalFrames,
				pixelFormat: "rgba",
			};

			const streamingOptions = {
				...ctx.nativeStaticLayoutOptions,
				streamingRawOverlay: true,
				overlayLayers: [rawLayer],
				tiledOverlayLayers: undefined,
			} as Parameters<typeof window.electronAPI.nativeStaticLayoutExport>[0];

			console.info(
				formatLogTs(),
				"[VideoExporter] Native static layout streaming raw overlay selected",
				{
					route: "nvidia-cuda-compositor",
					streamingRawOverlay: true,
					totalFrames: ctx.totalFrames,
					frameByteSize,
					rawOverlayPath: rawTempPath,
				},
			);

			// Launch the native export concurrently. The native compositor begins
			// source prep/helper startup while the renderer bakes overlay frames.
			// It waits boundedly for frames to appear in the raw file.
			const nativePromise = api.nativeStaticLayoutExport(streamingOptions).catch(
				(error: unknown): NativeStaticLayoutExportIpcResult => ({
					success: false as const,
					error: error instanceof Error ? error.message : String(error),
				}),
			);

			// Shared flag: if the native export fails early, stop the bake loop.
			let nativeFailed = false;
			void nativePromise.then((result) => {
				if (!result.success) {
					nativeFailed = true;
				}
			});

			const renderer = this.createNativeStaticLayoutOverlayRenderer(
				ctx.videoInfo,
				ctx.cursorExcluded,
				ctx.webcamExcluded,
			);
			let renderedFrameCount = 0;
			let bakeError: Error | null = null;
			let lastPreparationProgressMs = 0;
			try {
				await renderer.initialize();
				for (let frameIndex = 0; frameIndex < ctx.totalFrames; frameIndex += 1) {
					if (this.cancelled) {
						throw new Error("Export cancelled");
					}
					if (nativeFailed) {
						throw new Error(
							"overlay-streaming-native-failed: native export failed during bake",
						);
					}
					if (ctx.onPreparationProgress) {
						const nowMs = this.getNowMs();
						if (
							nowMs - lastPreparationProgressMs >=
								NATIVE_OVERLAY_PREPARATION_PROGRESS_INTERVAL_MS ||
							frameIndex === ctx.totalFrames - 1
						) {
							lastPreparationProgressMs = nowMs;
							ctx.onPreparationProgress(
								ctx.totalFrames > 0 ? (frameIndex / ctx.totalFrames) * 100 : 0,
							);
						}
					}
					const timestampUs = Math.round(
						(frameIndex * 1_000_000) / this.config.frameRate,
					);
					try {
						await renderer.renderOverlayFrame(timestampUs);
					} catch (error) {
						throw new Error(
							`overlay-renderer-frame: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					let frame: Uint8Array;
					try {
						frame = await captureCanvasFrameForNativeExport(
							renderer.getCanvas(),
							timestampUs,
						);
					} catch (error) {
						throw new Error(
							`overlay-canvas-capture: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
					if (frame.byteLength !== frameByteSize) {
						throw new Error(
							`overlay-invalid-frame-size: expected ${frameByteSize} bytes, received ${frame.byteLength}`,
						);
					}
					renderedFrameCount += 1;
					// Write each full RGBA frame sequentially — no RLE coalescing,
					// no tiled deltas. The native compositor reads frames from the
					// growing raw file in order.
					try {
						const writeResult = await api.writeExportStreamChunk(
							activeRawStreamId,
							frameIndex * frameByteSize,
							frame,
						);
						if (!writeResult.success) {
							throw new Error(
								writeResult.error ?? "Failed to write streaming overlay frame",
							);
						}
					} catch (error) {
						throw new Error(
							`overlay-stream-write: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}

				// Close the raw stream after all frames are written.
				let rawClosed: Awaited<ReturnType<typeof api.closeExportStream>>;
				try {
					rawClosed = await api.closeExportStream(activeRawStreamId);
				} catch (error) {
					throw new Error(
						`overlay-stream-close: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				rawStreamId = null;
				if (!rawClosed.success || !rawClosed.tempPath) {
					throw new Error(
						`overlay-stream-close: ${rawClosed.error ?? "Native overlay export stream did not finalize"}`,
					);
				}
				const rawExpectedBytes = frameByteSize * renderedFrameCount;
				if (rawClosed.bytesWritten !== rawExpectedBytes) {
					throw new Error(
						`overlay-stream-truncated: expected ${rawExpectedBytes} bytes, stream wrote ${rawClosed.bytesWritten}`,
					);
				}
			} catch (error) {
				bakeError = error instanceof Error ? error : new Error(String(error));
			} finally {
				try {
					renderer.destroy();
				} catch {
					// Cleanup is best-effort.
				}
			}

			// If the bake failed, abort the raw stream and cancel the native session.
			if (bakeError) {
				if (rawStreamId) {
					await api
						.closeExportStream(rawStreamId, { abort: true })
						.catch(() => undefined);
					rawStreamId = null;
				}
				await api.nativeStaticLayoutExportCancel(ctx.sessionId).catch(() => undefined);
				// Wait for the native promise to settle after cancellation.
				await nativePromise.catch(() => undefined);
				if (rawTempPath) {
					await api.discardExportedTemp(rawTempPath).catch(() => undefined);
				}
				const message = bakeError.message;
				const stage = message.startsWith("overlay-")
					? message.split(":", 1)[0]
					: "overlay-preparation";
				this.recordNativeStaticLayoutOverlayFailure(stage, message);
				console.warn("[VideoExporter] Native streaming overlay bake failed", {
					stage,
					message,
					totalFrames: ctx.totalFrames,
					renderedFrameCount,
					cancelled: this.cancelled,
				});
				return null;
			}

			// Both the bake and the native export are in flight. Await the native
			// result now (the bake already completed and the stream is closed).
			const nativeResult = await nativePromise;

			const overlayPreparation: NativeStaticLayoutOverlayPreparationResult = {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([rawLayer]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason: null,
				renderedFrames: renderedFrameCount,
			};
			return {
				overlayPreparation,
				nativeResult,
				streamingRawOverlay: true,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.recordNativeStaticLayoutOverlayFailure("streaming-overlay-setup", message);
			if (rawStreamId) {
				await api.closeExportStream(rawStreamId, { abort: true }).catch(() => undefined);
			}
			if (rawTempPath) {
				await api.discardExportedTemp(rawTempPath).catch(() => undefined);
			}
			return null;
		}
	}

	private async prepareNativeStaticLayoutOverlay(
		videoInfo: DecodedVideoInfo,
		durationSec: number,
		totalFrames: number,
		cursorExcluded = false,
		webcamExcluded = false,
		onPreparationProgress?: (renderProgress: number) => void,
		tiledOnly = false,
		allowTiledOnlyAttempt = true,
	): Promise<NativeStaticLayoutOverlayPreparationResult | null> {
		this.nativeStaticLayoutOverlayFailure = null;
		if (!this.hasNativeStaticLayoutOverlayContent()) {
			return {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason: null,
				renderedFrames: 0,
			};
		}
		if (this.hasUnsupportedNativeStaticLayoutOverlayContent()) {
			this.recordNativeStaticLayoutOverlayFailure(
				"unsupported-overlay-content",
				this.hasUnsupportedNativeStaticLayoutOverlayContent() ??
					"unsupported overlay content",
			);
			return null;
		}
		// Safe empty-work fast path: the native CUDA compositor owns the cursor
		// atlas and there are no browser-rendered overlay pixels (captions,
		// annotations, webcam, frame, or other). Rendering/capturing a full
		// transparent canvas for every output frame would be pure waste, so return
		// the validated empty overlay representation instead of a sidecar. Zoom and
		// temporal motion-blur effects are preserved natively on the GPU and are
		// unaffected by omitting an empty sidecar.
		if (cursorExcluded && !this.hasNativeStaticLayoutBrowserOverlayPixels(webcamExcluded)) {
			console.info("[VideoExporter] Native overlay route decision", {
				route: "nvidia-cuda-compositor",
				cursorOnly: true,
				cursorAtlasOwned: true,
				spriteEligible: false,
				spritePrepared: false,
				bakeFrames: 0,
				reason: "native-atlas-owns-cursor",
			});
			return {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason: null,
				renderedFrames: 0,
			};
		}
		// Cursor-sprite path: when the cursor is the only overlay content (no
		// browser pixels) and it cannot be owned by the native atlas, capture the
		// cursor ROI as a packed RGBA strip + per-frame positions instead of
		// writing a full transparent canvas sidecar for every output frame. Only
		// the generalized NVIDIA CUDA compositor consumes the cursor-sprite
		// contract. When the sprite cannot be prepared the existing baked-cursor
		// full-canvas sidecar path below runs unchanged (the preserved golden
		// path) and carries a clear diagnostic note.
		const cursorSpriteEligible = this.shouldUseNativeStaticLayoutCursorSprite(
			cursorExcluded,
			webcamExcluded,
		);
		const cursorSpriteLayer = cursorSpriteEligible
			? await this.prepareNativeStaticLayoutCursorSprite(
					videoInfo,
					durationSec,
					totalFrames,
					webcamExcluded,
					onPreparationProgress,
				)
			: null;
		if (cursorSpriteLayer) {
			return {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([cursorSpriteLayer]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason: null,
				renderedFrames: totalFrames,
			};
		}
		// Surface why the cursor-sprite path was not taken. When the path was
		// eligible but preparation failed, prepareNativeStaticLayoutCursorSprite
		// already logged the stage/message; only the eligibility miss needs an
		// explicit note here (the baked sidecar is the preserved golden path).
		if (!cursorSpriteEligible) {
			const hasBrowserPixels = this.hasNativeStaticLayoutBrowserOverlayPixels(webcamExcluded);
			const browserPixelSources: string[] = [];
			if ((this.config.annotationRegions?.length ?? 0) > 0) {
				browserPixelSources.push("annotations");
			}
			if ((this.config.autoCaptions?.length ?? 0) > 0) {
				browserPixelSources.push("captions");
			}
			if (this.config.frame) {
				browserPixelSources.push("frame");
			}
			if (this.config.webcam?.enabled === true && !webcamExcluded) {
				browserPixelSources.push("webcam");
			}
			const spriteAvailable =
				this.canUseNativeCursorSpriteContract() &&
				this.config.showCursor === true &&
				(this.config.cursorTelemetry?.length ?? 0) > 0;
			const reason = hasBrowserPixels
				? "browser-overlay-pixels"
				: this.hasNativeStaticLayoutExtensionCursorVisuals()
					? "extension-cursor-visuals"
					: !spriteAvailable
						? "cursor-sprite-contract-unavailable"
						: "cursor-excluded-by-native-atlas";
			console.info("[VideoExporter] Cursor-sprite overlay path skipped", {
				route: "nvidia-cuda-compositor",
				reason,
				bakedSidecarRequired: reason !== "cursor-excluded-by-native-atlas",
				browserPixelSources,
				hasExtensionCursorVisuals: this.hasNativeStaticLayoutExtensionCursorVisuals(),
				cursorExcluded,
				showCursor: this.config.showCursor === true,
				cursorTelemetrySamples: this.config.cursorTelemetry?.length ?? 0,
				cursorAtlasOwnershipEligible: this.canUseNativeCursorAtlasOwnership(),
				hasBrowserOverlayPixels: hasBrowserPixels,
				annotationRegions: this.config.annotationRegions?.length ?? 0,
				autoCaptions: this.config.autoCaptions?.length ?? 0,
				frame: Boolean(this.config.frame),
				webcamEnabled: this.config.webcam?.enabled === true,
			});
		}
		// Deterministic cursor-only guard: when the cursor is the ONLY overlay
		// content (no browser pixels, no extension hooks), the baked full-canvas
		// sidecar can only ever capture the same cursor pixels the ROI sprite
		// captures, at ~40-90ms/frame instead of a few ms. A cursor-only export
		// therefore NEVER runs the full-canvas bake: the native atlas owns the
		// cursor when eligible (early return above), the cursor-sprite ROI path
		// owns it otherwise, and a failed sprite preparation is a visible,
		// deterministic failure that skips the native attempt (the renderer
		// raw-frame route or the strict HEVC Hardware hard error take over
		// downstream). The baked sidecar remains the golden path only for
		// browser-pixel content (captions/annotations/frame/webcam) and
		// extension hooks, where the sprite ROI cannot represent the pixels.
		const hasBrowserOverlayPixels =
			this.hasNativeStaticLayoutBrowserOverlayPixels(webcamExcluded);
		const hasCursorOverlayContent =
			this.config.showCursor === true && (this.config.cursorTelemetry?.length ?? 0) > 0;
		const cursorOnlyOverlay =
			hasCursorOverlayContent &&
			!hasBrowserOverlayPixels &&
			!this.hasNativeStaticLayoutExtensionCursorVisuals();
		if (cursorOnlyOverlay) {
			console.info("[VideoExporter] Native overlay route decision", {
				route: "nvidia-cuda-compositor",
				cursorOnly: true,
				cursorAtlasOwned: cursorExcluded,
				spriteEligible: cursorSpriteEligible,
				spritePrepared: Boolean(cursorSpriteLayer),
				bakeFrames: 0,
				overlayFailure: this.nativeStaticLayoutOverlayFailure,
			});
			if (!cursorSpriteLayer) {
				return null;
			}
		}
		// Tiled preparation avoids creating the raw sidecar at all for sparse
		// captions/annotations/frame pixels. If the actual content turns out to
		// be dense, rerender once through the established raw path. That fallback
		// is deliberately explicit rather than retaining every 4K frame in RAM
		// while we decide, which would turn a long export into an unbounded cache.
		if (
			!tiledOnly &&
			allowTiledOnlyAttempt &&
			this.shouldPreferNativeTiledOverlay(webcamExcluded)
		) {
			const tiledResult = await this.prepareNativeStaticLayoutOverlay(
				videoInfo,
				durationSec,
				totalFrames,
				cursorExcluded,
				webcamExcluded,
				onPreparationProgress,
				true,
				false,
			);
			if (tiledResult) {
				return tiledResult;
			}
			const tiledOnlyFailure = this.getNativeStaticLayoutOverlayFailure();
			if (tiledOnlyFailure?.stage !== "tiled-overlay-not-beneficial") {
				return null;
			}
			console.info("[VideoExporter] Native tiled overlay fell back to raw sidecar", {
				reason: tiledOnlyFailure.message,
				annotationRegions: this.config.annotationRegions?.length ?? 0,
				autoCaptions: this.config.autoCaptions?.length ?? 0,
				frame: Boolean(this.config.frame),
			});
			this.nativeStaticLayoutOverlayFailure = null;
			return this.prepareNativeStaticLayoutOverlay(
				videoInfo,
				durationSec,
				totalFrames,
				cursorExcluded,
				webcamExcluded,
				onPreparationProgress,
				false,
				false,
			);
		}
		// Falling back to the baked-cursor full-canvas sidecar; clear any
		// cursor-sprite preparation failure so a successful sidecar is not
		// misreported as an overlay failure.
		this.nativeStaticLayoutOverlayFailure = null;
		const api = typeof window === "undefined" ? null : window.electronAPI;
		if (
			!api?.openExportStream ||
			!api.writeExportStreamChunk ||
			!api.closeExportStream ||
			!api.discardExportedTemp
		) {
			this.recordNativeStaticLayoutOverlayFailure(
				"export-stream-api-unavailable",
				"Export stream IPC is not available for the native overlay sidecar",
			);
			return null;
		}

		let rawStream: Awaited<ReturnType<typeof api.openExportStream>> | null = null;
		let rawStreamId: string | null = null;
		if (!tiledOnly) {
			try {
				rawStream = await api.openExportStream({ extension: "rgba" });
				if (!rawStream.success || !rawStream.streamId || !rawStream.tempPath) {
					this.recordNativeStaticLayoutOverlayFailure(
						"open-export-stream",
						rawStream.error ?? "Native overlay export stream could not be opened",
					);
					return null;
				}
				rawStreamId = rawStream.streamId;
			} catch (error) {
				this.recordNativeStaticLayoutOverlayFailure(
					"open-export-stream",
					error instanceof Error ? error.message : String(error),
				);
				return null;
			}
		}

		const renderer = this.createNativeStaticLayoutOverlayRenderer(
			videoInfo,
			cursorExcluded,
			webcamExcluded,
		);
		const frameByteSize = getNativeStaticLayoutOverlayFrameByteSize(
			this.config.width,
			this.config.height,
		);
		const tileColumns = getNativeTiledOverlayTileColumns(this.config.width);
		const tileRows = getNativeTiledOverlayTileRows(this.config.height);
		const tileCount = getNativeTiledOverlayTileCount(this.config.width, this.config.height);

		const scratchTile = new Uint8Array(NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE);
		const previousTiles: (Uint8Array | null)[] = new Array(tileCount).fill(null);
		const staticTiles: NativeTiledOverlayStaticTileRecord[] = [];
		const frameDeltas: NativeTiledOverlayFrameDelta[] = [];
		const tiledPayloadBuffers: Uint8Array[] = [];
		let tiledPayloadOffset = 0;
		let tiledAbandoned = false;
		let rawFallbackReason: NativeTiledOverlayRawFallbackReason | null = null;
		const rawPhysicalBytes = this.config.width * this.config.height * 4 * totalFrames;
		const maxTiledPayloadBytes =
			rawPhysicalBytes * NATIVE_TILED_OVERLAY_MAX_PAYLOAD_BYTES_FRACTION;

		let rawWrittenFrameCount = 0;
		let runStartFrameIndex = 0;
		let runFrame: Uint8Array | null = null;
		if (!tiledOnly && rawStreamId === null) {
			this.recordNativeStaticLayoutOverlayFailure(
				"open-export-stream",
				"Native overlay export stream id was not set",
			);
			return null;
		}
		const activeRawStreamId = rawStreamId;
		const writeRawOverlayChunk = async (
			frameIndex: number,
			frameCount: number,
			chunk: Uint8Array,
		): Promise<void> => {
			if (!activeRawStreamId) {
				throw new Error("overlay-stream-write: native raw overlay stream was not opened");
			}
			try {
				const result = await api.writeExportStreamChunk(
					activeRawStreamId,
					frameIndex * frameByteSize,
					chunk,
				);
				if (!result.success) {
					throw new Error(result.error ?? "Failed to write native overlay frame");
				}
			} catch (error) {
				throw new Error(
					`overlay-stream-write: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			rawWrittenFrameCount += frameCount;
		};
		const flushRawIdenticalRun = async (untilFrameIndex: number): Promise<void> => {
			if (runFrame === null || untilFrameIndex <= runStartFrameIndex) {
				return;
			}
			const runLength = untilFrameIndex - runStartFrameIndex;
			const framesPerBatch = Math.max(
				1,
				Math.floor(NATIVE_RAW_OVERLAY_RUN_BATCH_MAX_BYTES / frameByteSize),
			);
			let batchStartFrameIndex = runStartFrameIndex;
			while (batchStartFrameIndex < untilFrameIndex) {
				const batchFrameCount = Math.min(
					runLength - (batchStartFrameIndex - runStartFrameIndex),
					framesPerBatch,
				);
				if (batchFrameCount === 1) {
					await writeRawOverlayChunk(batchStartFrameIndex, 1, runFrame);
				} else {
					const batchBytes = batchFrameCount * frameByteSize;
					const batch = new Uint8Array(batchBytes);
					for (let i = 0; i < batchFrameCount; i += 1) {
						batch.set(runFrame, i * frameByteSize);
					}
					await writeRawOverlayChunk(batchStartFrameIndex, batchFrameCount, batch);
				}
				batchStartFrameIndex += batchFrameCount;
			}
		};

		let rawTempPath: string | null = null;
		let lastPreparationProgressMs = 0;
		let renderedFrameCount = 0;
		try {
			await renderer.initialize();
			for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
				if (this.cancelled) {
					throw new Error("Export cancelled");
				}
				// Coalesced preparation heartbeat: report at most once per throttle
				// interval (plus a final report on the last frame) so the UI stays
				// responsive during long sidecar generation without one React update
				// per frame. This is preparation progress only; render FPS is never
				// faked here (currentFrame stays 0 in the preparing phase).
				if (onPreparationProgress) {
					const nowMs = this.getNowMs();
					if (
						nowMs - lastPreparationProgressMs >=
							NATIVE_OVERLAY_PREPARATION_PROGRESS_INTERVAL_MS ||
						frameIndex === totalFrames - 1
					) {
						lastPreparationProgressMs = nowMs;
						onPreparationProgress(
							totalFrames > 0 ? (frameIndex / totalFrames) * 100 : 0,
						);
					}
				}
				const timestampUs = Math.round((frameIndex * 1_000_000) / this.config.frameRate);
				try {
					await renderer.renderOverlayFrame(timestampUs);
				} catch (error) {
					throw new Error(
						`overlay-renderer-frame: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				let frame: Uint8Array;
				try {
					frame = await captureCanvasFrameForNativeExport(
						renderer.getCanvas(),
						timestampUs,
					);
				} catch (error) {
					throw new Error(
						`overlay-canvas-capture: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (frame.byteLength !== frameByteSize) {
					throw new Error(
						`overlay-invalid-frame-size: expected ${frameByteSize} bytes, received ${frame.byteLength}`,
					);
				}
				renderedFrameCount += 1;

				if (!tiledOnly) {
					if (runFrame === null) {
						runFrame = frame;
						runStartFrameIndex = frameIndex;
					} else if (!areNativeStaticLayoutOverlayFramesEqual(frame, runFrame)) {
						await flushRawIdenticalRun(frameIndex);
						runFrame = frame;
						runStartFrameIndex = frameIndex;
					}
				}

				if (tiledAbandoned) {
					continue;
				}

				const changedTiles: NativeTiledOverlayTileRecord[] = [];
				for (let tileY = 0; tileY < tileRows; tileY += 1) {
					for (let tileX = 0; tileX < tileColumns; tileX += 1) {
						const tileIndex = getNativeTiledOverlayTileIndex(tileX, tileY, tileColumns);
						this.extractNativeTiledOverlayTileInto(
							scratchTile,
							frame,
							this.config.width,
							this.config.height,
							tileX,
							tileY,
						);
						const previous = previousTiles[tileIndex];
						if (
							previous !== null &&
							areNativeStaticLayoutOverlayFramesEqual(previous, scratchTile)
						) {
							continue;
						}
						if (
							tiledPayloadOffset + NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE >=
							maxTiledPayloadBytes
						) {
							tiledAbandoned = true;
							rawFallbackReason = "payload-bytes-exceed-raw";
							tiledPayloadBuffers.length = 0;
							staticTiles.length = 0;
							frameDeltas.length = 0;
							previousTiles.length = 0;
							break;
						}
						const tileCopy = scratchTile.slice();
						const record: NativeTiledOverlayTileRecord = {
							tileIndex,
							byteOffset: tiledPayloadOffset,
							byteLength: NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE,
						};
						tiledPayloadBuffers.push(tileCopy);
						tiledPayloadOffset += NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE;
						previousTiles[tileIndex] = tileCopy;
						if (frameIndex === 0) {
							staticTiles.push(record);
						} else {
							changedTiles.push(record);
						}
					}
					if (tiledAbandoned) {
						break;
					}
				}
				if (tiledAbandoned) {
					continue;
				}
				if (frameIndex > 0 && changedTiles.length > 0) {
					if (
						changedTiles.length >
						tileCount * NATIVE_TILED_OVERLAY_MAX_CHANGED_TILE_FRACTION
					) {
						tiledAbandoned = true;
						rawFallbackReason = "dense-frame-delta";
						tiledPayloadBuffers.length = 0;
						staticTiles.length = 0;
						frameDeltas.length = 0;
						previousTiles.length = 0;
						continue;
					}
					frameDeltas.push({ frameIndex, changedTiles });
				}
			}

			if (!tiledOnly) {
				if (runFrame !== null) {
					await writeRawOverlayChunk(runStartFrameIndex, 1, runFrame);
				}

				if (!activeRawStreamId) {
					throw new Error(
						"overlay-stream-close: native raw overlay stream was not opened",
					);
				}
				let rawClosed: Awaited<ReturnType<typeof api.closeExportStream>>;
				try {
					rawClosed = await api.closeExportStream(activeRawStreamId);
				} catch (error) {
					throw new Error(
						`overlay-stream-close: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (!rawClosed.success || !rawClosed.tempPath) {
					throw new Error(
						`overlay-stream-close: ${rawClosed.error ?? "Native overlay export stream did not finalize"}`,
					);
				}
				rawTempPath = rawClosed.tempPath;
				const rawExpectedBytes = frameByteSize * rawWrittenFrameCount;
				if (rawClosed.bytesWritten !== rawExpectedBytes) {
					throw new Error(
						`overlay-stream-truncated: expected ${rawExpectedBytes} bytes, stream wrote ${rawClosed.bytesWritten}`,
					);
				}
			}

			if (!tiledAbandoned) {
				const tileLayer: NativeTiledOverlayLayerDescriptor = {
					id: "native-effects",
					order: 0,
					x: 0,
					y: 0,
					width: this.config.width,
					height: this.config.height,
					frameRate: this.config.frameRate,
					durationSec,
					frameCount: totalFrames,
					tileSize: NATIVE_TILED_OVERLAY_TILE_SIZE,
					pixelFormat: NATIVE_TILED_OVERLAY_PIXEL_FORMAT,
					payloadPath: "",
					payloadByteLength: tiledPayloadOffset,
					staticTiles,
					frameDeltas,
				};
				const finalFallbackReason = resolveNativeTiledOverlayRawFallbackReason(tileLayer);
				if (finalFallbackReason) {
					tiledAbandoned = true;
					rawFallbackReason = finalFallbackReason;
					tiledPayloadBuffers.length = 0;
					staticTiles.length = 0;
					frameDeltas.length = 0;
					previousTiles.length = 0;
				} else {
					let tiledStream: Awaited<ReturnType<typeof api.openExportStream>> | null = null;
					try {
						tiledStream = await api.openExportStream({ extension: "tiledrgba" });
						if (
							!tiledStream.success ||
							!tiledStream.streamId ||
							!tiledStream.tempPath
						) {
							throw new Error(
								tiledStream.error ??
									"Tiled overlay export stream could not be opened",
							);
						}
						const activeTiledStreamId = tiledStream.streamId;
						for (
							let bufferIndex = 0;
							bufferIndex < tiledPayloadBuffers.length;
							bufferIndex += 1
						) {
							const offset = bufferIndex * NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE;
							const result = await api.writeExportStreamChunk(
								activeTiledStreamId,
								offset,
								tiledPayloadBuffers[bufferIndex]!,
							);
							if (!result.success) {
								throw new Error(
									result.error ?? "Failed to write tiled overlay tile",
								);
							}
						}
						const tiledClosed = await api.closeExportStream(activeTiledStreamId);
						if (!tiledClosed.success || !tiledClosed.tempPath) {
							throw new Error(
								tiledClosed.error ?? "Tiled overlay export stream did not finalize",
							);
						}
						const tiledExpectedBytes =
							tiledPayloadBuffers.length * NATIVE_TILED_OVERLAY_TILE_BYTE_SIZE;
						if (tiledClosed.bytesWritten !== tiledExpectedBytes) {
							throw new Error(
								`tiled-overlay-stream-truncated: expected ${tiledExpectedBytes} bytes, stream wrote ${tiledClosed.bytesWritten}`,
							);
						}
						tileLayer.payloadPath = tiledClosed.tempPath;
						if (rawTempPath) {
							await api.discardExportedTemp(rawTempPath).catch(() => undefined);
						}
						return {
							overlayLayers: sortNativeStaticLayoutOverlayLayers([]),
							tiledOverlayLayers: sortNativeTiledOverlayLayers([tileLayer]),
							rawFallbackReason: null,
							renderedFrames: renderedFrameCount,
						};
					} catch (error) {
						if (tiledStream?.streamId) {
							await api
								.closeExportStream(tiledStream.streamId, { abort: true })
								.catch(() => undefined);
						}
						throw error;
					}
				}
			}
			if (tiledOnly) {
				throw new Error(
					`tiled-overlay-not-beneficial:${rawFallbackReason ?? "tiled sidecar did not satisfy the native transport heuristic"}`,
				);
			}
			if (!rawTempPath) {
				throw new Error("overlay-stream-close: native raw overlay path was not finalized");
			}

			const rawLayer: NativeStaticLayoutOverlayLayer = {
				id: "native-effects",
				order: 0,
				path: rawTempPath,
				x: 0,
				y: 0,
				width: this.config.width,
				height: this.config.height,
				frameRate: this.config.frameRate,
				durationSec,
				frameCount: totalFrames,
				...(rawWrittenFrameCount < totalFrames
					? { effectiveFrameCount: rawWrittenFrameCount }
					: {}),
				pixelFormat: "rgba",
			};
			return {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([rawLayer]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason,
				renderedFrames: renderedFrameCount,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stage =
				message.startsWith("overlay-") || message.startsWith("tiled-overlay-")
					? message.split(":", 1)[0]
					: "overlay-preparation";
			this.recordNativeStaticLayoutOverlayFailure(stage, message);
			if (rawStreamId) {
				try {
					await api.closeExportStream(rawStreamId, { abort: true });
				} catch {
					// best-effort cleanup
				}
			}
			if (rawTempPath) {
				try {
					await api.discardExportedTemp(rawTempPath);
				} catch {
					// best-effort cleanup
				}
			}
			console.warn("[VideoExporter] Native overlay preparation failed", {
				stage,
				message,
				durationSec,
				totalFrames,
				frameByteSize,
				rawWrittenFrameCount,
				tiledPayloadOffset,
				cancelled: this.cancelled,
			});
			return null;
		} finally {
			try {
				renderer.destroy();
			} catch {
				// Cleanup is best-effort after the native overlay stream closes.
			}
		}
	}

	private logNativeStaticLayoutPreparationStage(
		stage: string,
		startedAtMs: number,
		extra: Record<string, unknown> = {},
	): void {
		const elapsedMs = Math.round(this.getNowMs() - startedAtMs);
		console.info(formatLogTs(), "[VideoExporter] Native static layout preparation stage", {
			stage,
			elapsedMs,
			exportVideoCodec: this.config.exportVideoCodec ?? "h264",
			exportEncoderPreference: this.config.exportEncoderPreference ?? "auto",
			route: this.canUseNativeGpuStaticLayout() ? "nvidia-cuda-compositor" : "static-layout",
			...extra,
		});
	}

	private recordNativeStaticLayoutOverlayFailure(stage: string, message: string): void {
		this.nativeStaticLayoutOverlayFailure = { stage, message };
	}

	private getNativeStaticLayoutOverlayFailure(): { stage: string; message: string } | null {
		return this.nativeStaticLayoutOverlayFailure;
	}

	/**
	 * Config-only predicate for whether the native cursor atlas may be needed:
	 * the cursor is enabled, has telemetry, and is either the only overlay
	 * content or is eligible for native CUDA ownership. Mirrors the derived-
	 * telemetry gate used in tryExportNativeStaticLayout; because it never needs
	 * videoInfo/audioPlan it can start the atlas build before the metadata probe.
	 */
	private getNativeStaticLayoutCursorAtlasNeeded(): boolean {
		if (this.config.showCursor !== true || (this.config.cursorTelemetry?.length ?? 0) === 0) {
			return false;
		}
		const wantsNativeCursorOwnership = this.canUseNativeCursorAtlasOwnership();
		return wantsNativeCursorOwnership;
	}

	/**
	 * Starts the config-only native static-layout preparation (background
	 * materialization + cursor atlas asset preload) as early as possible, before
	 * loadNativeStaticLayoutVideoInfo() probes the source. Neither task needs
	 * videoInfo/audioPlan, so their wall time overlaps the probe instead of
	 * serializing after it; audio options still start in parallel later once the
	 * audioPlan is known.
	 */
	private startNativeStaticLayoutConfigPrep(): NativeStaticLayoutConfigPrep {
		return {
			background: this.resolveNativeStaticLayoutBackground(),
			cursorAtlas: this.getNativeStaticLayoutCursorAtlasNeeded()
				? buildNativeCursorAtlas(this.config.cursorStyle ?? "tahoe").catch((error) => {
						console.warn("[VideoExporter] Native cursor atlas unavailable", error);
						return null;
					})
				: null,
		};
	}

	/**
	 * Releases any temporary assets produced by a config-only prep that was never
	 * consumed by tryExportNativeStaticLayout (skip before resolution, or the
	 * metadata probe failed so the attempt never ran). Idempotent: tryExport's
	 * own finally already cleans the background when it was consumed.
	 */
	private async settleNativeStaticLayoutConfigPrep(
		configPrep: NativeStaticLayoutConfigPrep | null | undefined,
	): Promise<void> {
		if (!configPrep) {
			return;
		}
		const background = await configPrep.background.catch(() => null);
		await this.cleanupNativeStaticLayoutBackground(background);
	}

	private async tryExportNativeStaticLayout(
		videoInfo: DecodedVideoInfo,
		audioPlan: NativeAudioPlan,
		effectiveDuration: number,
		totalFrames: number,
		configPrep?: NativeStaticLayoutConfigPrep,
	): Promise<ExportResult | null> {
		const skipReason = this.getNativeStaticLayoutSkipReason(
			audioPlan,
			videoInfo,
			effectiveDuration,
		);
		const skipReasons = skipReason
			? this.getNativeStaticLayoutSkipReasons(audioPlan, videoInfo, effectiveDuration)
			: [];
		if (skipReason) {
			this.nativeStaticLayoutSkipReason = skipReason;
			this.nativeStaticLayoutSkipReasons = skipReasons;
			console.info(formatLogTs(), "[VideoExporter] Native static layout skipped", {
				route: "native-static-layout",
				fallbackRoute: "breeze-stream-or-raw-frame",
				reason: skipReason,
				reasons: skipReasons,
				exportVideoCodec: this.config.exportVideoCodec ?? "h264",
				exportEncoderPreference: this.config.exportEncoderPreference ?? "auto",
				canUseNativeGpuStaticLayout: this.canUseNativeGpuStaticLayout(),
				experimentalNativeExport: this.config.experimentalNativeExport === true,
				experimentalNvidiaCudaExport: this.config.experimentalNvidiaCudaExport === true,
				audioMode: audioPlan.audioMode,
				zoomRegions: this.config.zoomRegions?.length ?? 0,
				speedRegions: this.config.speedRegions?.length ?? 0,
				audioRegions: this.config.audioRegions?.length ?? 0,
				annotationRegions: this.config.annotationRegions?.length ?? 0,
				hasFrame: Boolean(this.config.frame),
				backgroundBlur: this.config.backgroundBlur,
				hasCursorOverlay:
					this.config.showCursor === true &&
					(this.config.cursorTelemetry?.length ?? 0) > 0,
			});
			// Any config-only prep started before the metadata probe (background
			// materialization, cursor atlas) is not consumed on the skip path;
			// release its temporary assets so a rejected attempt never leaks them.
			await this.settleNativeStaticLayoutConfigPrep(configPrep);
			return null;
		}

		// Emit the initial "preparing" signal before the potentially long
		// audio/background/cursor/overlay preparation begins, and identify the
		// NVIDIA CUDA compositor as the selected route when it is eligible so the
		// first progress never shows a stale WebGPU/Breeze/libx264 backend during
		// CUDA preparation.
		this.encodeBackend = "ffmpeg";
		this.encoderName = this.canUseNativeGpuStaticLayout()
			? "nvidia-cuda-compositor"
			: this.config.experimentalNativeExport === true && this.getRuntimePlatform() === "win32"
				? "windows-native-compositor"
				: "static-layout-h264-nvenc";
		this.exportStartTimeMs = this.getNowMs();
		this.lastProgressSampleTimeMs = this.exportStartTimeMs;
		this.lastProgressSampleFrame = 0;
		this.reportProgress(0, totalFrames, "preparing");

		let preparationStageStartedAt = this.getNowMs();
		const sourcePath = this.getNativeVideoSourcePath();
		// Decide whether the cursor atlas is needed before starting the parallel
		// prep: the decision depends only on sync-derived cursor telemetry, overlay
		// content, and native cursor-ownership eligibility (no IPC needed).
		const cursorTelemetry = this.getNativeStaticLayoutCursorTelemetry();
		const needsOverlayLayers = this.hasNativeStaticLayoutOverlayContent();
		const wantsNativeCursorOwnership = this.canUseNativeCursorAtlasOwnership();
		const wantsCursorAtlas =
			Boolean(cursorTelemetry && cursorTelemetry.length > 0) && wantsNativeCursorOwnership;

		// Run the independent preparation stages (audio options / offline audio
		// render, background resolution, cursor atlas build) in parallel. The
		// background and cursor atlas are config-only and never need videoInfo, so
		// a prep started before the metadata probe is reused here instead of being
		// re-run. The edited-track audio render is deferred to an export stream
		// when possible so the compositor launches immediately (video-only) while
		// the WAV render proceeds concurrently; the stream id reaches main with
		// the IPC options and main waits for the stream closure at mux time.
		const audioOptionsStartedAt = this.getNowMs();
		const deferEditedAudio = this.canDeferEditedAudioRender(audioPlan);
		const deferredEditedAudio = deferEditedAudio
			? this.startDeferredEditedAudioRender(audioPlan, totalFrames, videoInfo.duration)
			: null;
		const audioOptionsPromise = this.getNativeStaticLayoutAudioOptions(
			audioPlan,
			totalFrames,
			deferEditedAudio,
			videoInfo.duration,
		);
		const backgroundStartedAt = this.getNowMs();
		const backgroundPromise =
			configPrep?.background ?? this.resolveNativeStaticLayoutBackground();
		const cursorAtlasStartedAt = this.getNowMs();
		const cursorAtlasPromise = wantsCursorAtlas
			? (configPrep?.cursorAtlas ??
				buildNativeCursorAtlas(this.config.cursorStyle ?? "tahoe").catch((error) => {
					console.warn("[VideoExporter] Native cursor atlas unavailable", error);
					return null;
				}))
			: Promise.resolve(null);

		// Compute the synchronous layout/crop/timeline/webcam/zoom plans while the
		// parallel prep is in flight: the sync loop overlaps with the async
		// IPC/blob work instead of delaying it.
		const layout = computePaddedLayout({
			width: this.config.width,
			height: this.config.height,
			padding: this.config.padding ?? 0,
			cropRegion: this.config.cropRegion,
			videoWidth: videoInfo.width,
			videoHeight: videoInfo.height,
		});
		const contentSize = roundNativeStaticLayoutContentSize({
			width: layout.croppedDisplayWidth,
			height: layout.croppedDisplayHeight,
		});
		const contentWidth = contentSize.width;
		const contentHeight = contentSize.height;
		const offsetX = Math.round(layout.centerOffsetX);
		const offsetY = Math.round(layout.centerOffsetY);
		const sourceCrop = this.isDefaultCropRegion()
			? null
			: this.getNativeStaticLayoutSourceCrop(videoInfo);
		const borderRadius = scalePreviewBorderRadius(
			this.config.width,
			this.config.height,
			this.config.borderRadius ?? 0,
		);
		const shadowIntensity = this.config.showShadow
			? Math.min(1, Math.max(0, this.config.shadowIntensity))
			: 0;
		const webcamOverlay = this.getNativeStaticLayoutWebcamOverlay();
		const webcamNativeOwned = this.canUseNativeWebcamOwnership();
		const zoomTelemetry = this.getNativeStaticLayoutZoomTelemetry(
			layout,
			totalFrames,
			cursorTelemetry,
		);
		const needsTimelineMap = this.shouldUseNativeStaticLayoutTimelineMap(
			videoInfo,
			effectiveDuration,
		);
		const timelineSegments = needsTimelineMap
			? this.buildNativeStaticLayoutVideoTimelineSegments(videoInfo)
			: undefined;

		let audioOptions: Awaited<ReturnType<typeof this.getNativeStaticLayoutAudioOptions>>;
		let background: NativeStaticLayoutBackground | null;
		let cursorAtlas: NativeCursorAtlas | null;
		// The deferred audio stream id must be known before the native IPC launch;
		// the stream open is a single fast IPC roundtrip that overlaps the parallel
		// prep, so awaiting it here is near-free. A failure to open the stream
		// falls back to the inline render contract (no stream id passed).
		const deferredEditedAudioStreamId = deferredEditedAudio
			? await deferredEditedAudio.opened.catch(() => null)
			: null;
		try {
			[audioOptions, background, cursorAtlas] = await Promise.all([
				audioOptionsPromise,
				backgroundPromise,
				cursorAtlasPromise,
			]);
		} catch (error) {
			// One parallel stage rejected (e.g. the inline audio render failed), so
			// the whole attempt aborts before the normal cleanup paths run. Release
			// any background temp file the early-start already materialized and
			// abort the deferred audio stream; the in-memory atlas needs no cleanup.
			const resolvedBackground = await backgroundPromise.catch(() => null);
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			await this.cleanupNativeStaticLayoutBackground(resolvedBackground);
			throw error;
		}
		this.logNativeStaticLayoutPreparationStage("audio", audioOptionsStartedAt, {
			audioMode: audioPlan.audioMode,
			editedTrackStrategy:
				audioPlan.audioMode === "edited-track" ? audioPlan.strategy : undefined,
			editedAudioDeferred: deferEditedAudio || undefined,
			editedAudioStreamId: deferredEditedAudioStreamId ?? undefined,
		});
		this.logNativeStaticLayoutPreparationStage("background", backgroundStartedAt, {
			backgroundColor: background?.backgroundColor ?? null,
			hasBackgroundImage: Boolean(background?.backgroundImagePath),
			backgroundSkipReason: this.nativeStaticLayoutBackgroundSkipReason ?? null,
		});
		this.logNativeStaticLayoutPreparationStage("cursor-atlas", cursorAtlasStartedAt, {
			wantsNativeCursorOwnership,
			cursorAtlasBuilt: Boolean(cursorAtlas),
			atlasEntries: cursorAtlas?.entries.length ?? 0,
		});
		if (!sourcePath || !audioOptions) {
			this.nativeStaticLayoutSkipReason = !sourcePath
				? "missing-source-path"
				: "missing-audio-options";
			this.nativeStaticLayoutSkipReasons = [this.nativeStaticLayoutSkipReason];
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			await this.cleanupNativeStaticLayoutBackground(background);
			return null;
		}
		if (!background) {
			this.nativeStaticLayoutSkipReason =
				this.nativeStaticLayoutBackgroundSkipReason ?? "unsupported-background";
			this.nativeStaticLayoutSkipReasons = [this.nativeStaticLayoutSkipReason];
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			return null;
		}
		if (
			contentWidth > this.config.width ||
			contentHeight > this.config.height ||
			!Number.isFinite(effectiveDuration) ||
			effectiveDuration <= 0
		) {
			this.nativeStaticLayoutSkipReason = "invalid-layout-or-duration";
			this.nativeStaticLayoutSkipReasons = [this.nativeStaticLayoutSkipReason];
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			await this.cleanupNativeStaticLayoutBackground(background);
			return null;
		}
		if (needsTimelineMap && !timelineSegments?.length) {
			this.nativeStaticLayoutSkipReason =
				(this.config.speedRegions ?? []).length > 0
					? "invalid-native-speed-timeline"
					: "invalid-native-trim-timeline";
			this.nativeStaticLayoutSkipReasons = [this.nativeStaticLayoutSkipReason];
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			await this.cleanupNativeStaticLayoutBackground(background);
			return null;
		}
		preparationStageStartedAt = this.getNowMs();
		const cursorAtlasOwnedByNative = wantsNativeCursorOwnership && Boolean(cursorAtlas);
		if (cursorAtlasOwnedByNative) {
			console.info("[VideoExporter] Native cursor atlas owns the overlay cursor", {
				cursorStyle: this.config.cursorStyle ?? "tahoe",
				atlasWidth: cursorAtlas?.width,
				atlasHeight: cursorAtlas?.height,
				atlasEntries: cursorAtlas?.entries.length,
				cursorTelemetrySamples: cursorTelemetry?.length,
			});
		}
		// The native cursor atlas is required when the cursor is NOT baked into
		// the transparent overlay sidecar. Without overlay layers the cursor is
		// always native-owned, so a missing atlas skips the route. With overlay
		// layers the cursor is baked into the sidecar unless the CUDA compositor
		// owns it (cursorAtlasOwnedByNative), so a missing atlas only falls back
		// to the baked sidecar and never skips the route.
		if (
			shouldSkipForMissingCursorAtlas({
				needsOverlayLayers,
				hasCursorTelemetry: Boolean(cursorTelemetry && cursorTelemetry.length > 0),
				hasCursorAtlas: Boolean(cursorAtlas),
			})
		) {
			this.nativeStaticLayoutSkipReason = "cursor-atlas-unavailable";
			this.nativeStaticLayoutSkipReasons = [this.nativeStaticLayoutSkipReason];
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			await this.cleanupNativeStaticLayoutBackground(background);
			return null;
		}
		// Assign the native static-layout session id before the (potentially long)
		// overlay sidecar bake and fast-lane branch. cancel() can then hand the id
		// to nativeStaticLayoutExportCancel as soon as a native session might
		// exist: during the bake there is no main-process session yet, so that IPC
		// cancel is a no-op, and the local `cancelled` flag keeps aborting the bake
		// loops. The try/finally below clears the id when the attempt settles.
		const sessionId = `recordly-static-layout-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
		this.nativeStaticLayoutSessionId = sessionId;
		const fastLaneEligibility = this.getNativeStaticLayoutFastLaneEligibility(
			audioPlan,
			cursorAtlasOwnedByNative,
			webcamNativeOwned,
		);
		const useFastLane = fastLaneEligibility.eligible;
		// Log the fast-lane eligibility decision as its own preparation stage so
		// the gap between parallel-prep completion and the overlay bake start is
		// observable: no blocking work should be inserted here. The elapsed time
		// proves the eligibility check is synchronous and does not delay the bake.
		this.logNativeStaticLayoutPreparationStage(
			"fast-lane-eligibility",
			preparationStageStartedAt,
			{
				eligible: useFastLane,
				skipReasons: fastLaneEligibility.skipReasons,
				cursorAtlasOwnedByNative: Boolean(cursorAtlasOwnedByNative),
				webcamNativeOwned: Boolean(webcamNativeOwned),
				needsOverlayLayers,
			},
		);
		const overlayBakeStartedAt = this.getNowMs();
		let overlayPreparation: NativeStaticLayoutOverlayPreparationResult | null = null;
		let streamingResult: StreamingRawOverlayResult | null = null;
		let streamingCursorSpriteResult: StreamingCursorSpriteResult | null = null;
		if (useFastLane) {
			// Deterministic no-browser-overlay fast lane: with no captions,
			// annotations, or frame pixels (and the webcam owned natively by the CUDA
			// compositor when enabled) and the cursor either disabled or owned
			// natively by the CUDA compositor, the sidecar is provably empty, so
			// skip renderer init, per-frame canvas capture, and overlay sidecar
			// creation and start the native export as early as safely allowed.
			overlayPreparation = {
				overlayLayers: sortNativeStaticLayoutOverlayLayers([]),
				tiledOverlayLayers: sortNativeTiledOverlayLayers([]),
				rawFallbackReason: null,
				renderedFrames: 0,
			};
			console.info(formatLogTs(), "[VideoExporter] Native static layout fast lane selected", {
				route: "nvidia-cuda-compositor",
				skipReasons: fastLaneEligibility.skipReasons,
				cursorDisabled:
					this.config.showCursor !== true ||
					(this.config.cursorTelemetry?.length ?? 0) === 0,
				cursorNativeOwnershipActive: Boolean(cursorAtlasOwnedByNative),
				webcamNativeOwned: Boolean(webcamNativeOwned),
				audioMode: audioPlan.audioMode,
				preparedOverlayLayers: overlayPreparation.overlayLayers.length,
				preparedTiledOverlayLayers: overlayPreparation.tiledOverlayLayers.length,
			});
		} else {
			const canStream = this.canUseStreamingRawOverlay(
				cursorAtlasOwnedByNative,
				webcamNativeOwned,
			);
			const canStreamCursorSprite =
				this.canStreamCursorSprite() &&
				this.shouldUseNativeStaticLayoutCursorSprite(
					cursorAtlasOwnedByNative,
					webcamNativeOwned,
				);
			if (canStream || canStreamCursorSprite) {
				// Build the common export options before the bake so the native IPC
				// can launch concurrently with the per-frame overlay render.
				const requestedVideoCodec = this.config.exportVideoCodec ?? "h264";
				const requestedEncoderPreference = this.config.exportEncoderPreference ?? "auto";
				const preBakeNativeOptions = {
					sessionId,
					inputPath: sourcePath,
					width: this.config.width,
					height: this.config.height,
					frameRate: this.config.frameRate,
					bitrate: this.config.bitrate,
					encodingMode: this.config.encodingMode ?? "balanced",
					videoCodec: requestedVideoCodec,
					encoderPreference: requestedEncoderPreference,
					durationSec: effectiveDuration,
					contentWidth,
					contentHeight,
					offsetX,
					offsetY,
					sourceCropX: sourceCrop?.x,
					sourceCropY: sourceCrop?.y,
					sourceCropWidth: sourceCrop?.width,
					sourceCropHeight: sourceCrop?.height,
					backgroundColor: background.backgroundColor,
					backgroundImagePath: background.backgroundImagePath ?? null,
					backgroundBlurPx: Math.max(0, (this.config.backgroundBlur ?? 0) * 3),
					borderRadius,
					shadowIntensity,
					webcamInputPath: webcamNativeOwned ? (webcamOverlay?.inputPath ?? null) : null,
					webcamLeft: webcamOverlay?.left,
					webcamTop: webcamOverlay?.top,
					webcamSize: webcamOverlay?.size,
					webcamRadius: webcamOverlay?.radius,
					webcamShadowIntensity: webcamOverlay?.shadowIntensity,
					webcamMirror: webcamOverlay?.mirror,
					webcamTimeOffsetMs: webcamOverlay?.timeOffsetMs,
					webcamNativeOwned: webcamNativeOwned || undefined,
					cursorTelemetry,
					cursorSize: this.getNativeStaticLayoutCursorSize(contentWidth),
					cursorAtlasPngDataUrl: cursorAtlas?.dataUrl ?? null,
					cursorAtlasEntries: cursorAtlas?.entries,
					cursorAtlasOwned: cursorAtlasOwnedByNative || undefined,
					zoomTelemetry,
					temporalBlur: getTemporalMotionBlurConfig(this.config.zoomTemporalMotionBlur, {
						sampleCount: this.config.zoomMotionBlurSampleCount,
						shutterFraction: this.config.zoomMotionBlurShutterFraction,
					}),
					timelineSegments,
					chunkDurationSec: STATIC_LAYOUT_CHUNK_DURATION_SEC,
					experimentalWindowsGpuCompositor: this.config.experimentalNativeExport === true,
					experimentalNvidiaCudaExport: this.config.experimentalNvidiaCudaExport === true,
					audioOptions: {
						...audioOptions,
						...(deferredEditedAudioStreamId
							? { editedAudioStreamId: deferredEditedAudioStreamId }
							: {}),
						outputDurationSec: effectiveDuration,
					},
				};
				if (canStreamCursorSprite) {
					streamingCursorSpriteResult = await this.streamCursorSpriteAndExport({
						videoInfo,
						durationSec: effectiveDuration,
						totalFrames,
						webcamExcluded: webcamNativeOwned,
						sessionId,
						contentWidth,
						contentHeight,
						offsetX,
						offsetY,
						nativeStaticLayoutOptions: preBakeNativeOptions,
						onPreparationProgress: (renderProgress) => {
							const currentFrame = Math.max(
								0,
								Math.min(
									totalFrames,
									Math.round((renderProgress / 100) * totalFrames),
								),
							);
							this.reportProgress(currentFrame, totalFrames, "extracting");
						},
					});
					overlayPreparation = streamingCursorSpriteResult?.overlayPreparation ?? null;
				} else {
					streamingResult = await this.streamRawOverlayAndExport({
						videoInfo,
						durationSec: effectiveDuration,
						totalFrames,
						cursorExcluded: cursorAtlasOwnedByNative,
						webcamExcluded: webcamNativeOwned,
						sessionId,
						nativeStaticLayoutOptions: preBakeNativeOptions,
						onPreparationProgress: (renderProgress) => {
							const currentFrame = Math.max(
								0,
								Math.min(
									totalFrames,
									Math.round((renderProgress / 100) * totalFrames),
								),
							);
							this.reportProgress(currentFrame, totalFrames, "extracting");
						},
					});
					overlayPreparation = streamingResult?.overlayPreparation ?? null;
				}
			} else {
				overlayPreparation = await this.prepareNativeStaticLayoutOverlay(
					videoInfo,
					effectiveDuration,
					totalFrames,
					cursorAtlasOwnedByNative,
					webcamNativeOwned,
					(renderProgress) => {
						const currentFrame = Math.max(
							0,
							Math.min(totalFrames, Math.round((renderProgress / 100) * totalFrames)),
						);
						this.reportProgress(currentFrame, totalFrames, "extracting");
					},
				);
			}
		}
		const overlayLayers = overlayPreparation?.overlayLayers ?? [];
		const tiledOverlayLayers = overlayPreparation?.tiledOverlayLayers ?? [];
		this.logNativeStaticLayoutPreparationStage("overlay", preparationStageStartedAt, {
			mode: useFastLane
				? "fast-lane"
				: streamingCursorSpriteResult
					? "streaming-cursor-sprite"
					: streamingResult
						? "streaming-raw-overlay"
						: !overlayPreparation
							? "failed"
							: tiledOverlayLayers.length > 0
								? "tiled-sidecar"
								: overlayLayers.some(isCursorSpriteOverlayLayer)
									? "cursor-sprite"
									: overlayLayers.length > 0
										? "raw-sidecar"
										: "empty",
			overlayLayerCount: overlayLayers.length,
			tiledOverlayLayerCount: tiledOverlayLayers.length,
			rawFallbackReason: overlayPreparation?.rawFallbackReason ?? null,
			overlayFailure: this.nativeStaticLayoutOverlayFailure,
			webcamNativeOwned: Boolean(webcamNativeOwned),
			renderedFrames: overlayPreparation?.renderedFrames ?? 0,
			totalFrames,
			streamingRawOverlay: streamingResult?.streamingRawOverlay ?? false,
			streamingCursorSprite: streamingCursorSpriteResult?.streamingCursorSprite ?? false,
		});
		this.nativeStaticLayoutOverlayRenderedFrames = overlayPreparation?.renderedFrames ?? 0;
		this.nativeStaticLayoutOverlayPreparationMs = Math.round(
			this.getNowMs() - overlayBakeStartedAt,
		);
		preparationStageStartedAt = this.getNowMs();
		if (needsOverlayLayers && !overlayPreparation) {
			this.nativeStaticLayoutSkipReason = "native-overlay-preparation-failed";
			const overlayFailure = this.nativeStaticLayoutOverlayFailure;
			this.nativeStaticLayoutSkipReasons = overlayFailure
				? [
						this.nativeStaticLayoutSkipReason,
						`overlay-stage:${overlayFailure.stage}`,
						`overlay-error:${overlayFailure.message}`,
					]
				: [this.nativeStaticLayoutSkipReason];
			console.warn(
				formatLogTs(),
				"[VideoExporter] Native static layout skipped: overlay preparation failed",
				{
					reason: this.nativeStaticLayoutSkipReason,
					reasons: this.nativeStaticLayoutSkipReasons,
					failure: overlayFailure,
					exportVideoCodec: this.config.exportVideoCodec ?? "h264",
					exportEncoderPreference: this.config.exportEncoderPreference ?? "auto",
				},
			);
			// No native session ever started (the bake failed before the IPC handoff),
			// so cancel() must not hold a stale session id for a no-op IPC cancel.
			this.nativeStaticLayoutSessionId = null;
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			await this.cleanupNativeStaticLayoutBackground(background);
			return null;
		}
		const overlayTempPath =
			tiledOverlayLayers[0]?.payloadPath ?? overlayLayers[0]?.path ?? null;
		const startedAt = this.getNowMs();
		const previousEncodeBackend = this.encodeBackend;
		const previousEncoderName = this.encoderName;
		const restoreEncoderState = () => {
			this.encodeBackend = previousEncodeBackend;
			this.encoderName = previousEncoderName;
		};

		this.exportStartTimeMs = startedAt;
		this.lastThroughputLogTimeMs = startedAt;
		this.lastProgressSampleTimeMs = startedAt;
		this.lastProgressSampleFrame = 0;
		this.nativeStaticLayoutSkipReason = null;
		this.nativeStaticLayoutSkipReasons = [];
		this.nativeStaticLayoutAverageFps = null;
		this.nativeStaticLayoutFpsSource = null;
		this.encodeBackend = "ffmpeg";
		const runtimePlatform =
			typeof navigator !== "undefined"
				? normalizeLightningRuntimePlatform(navigator.userAgent)
				: "unknown";
		this.encoderName = this.canUseNativeGpuStaticLayout()
			? "nvidia-cuda-compositor"
			: this.config.experimentalNativeExport === true && runtimePlatform === "win32"
				? "windows-native-compositor"
				: "static-layout-h264-nvenc";
		this.reportProgress(0, totalFrames, "preparing");
		let unsubscribeNativeProgress: (() => void) | undefined;
		unsubscribeNativeProgress = window.electronAPI.onNativeStaticLayoutExportProgress?.(
			(progress) => {
				if (progress.sessionId && progress.sessionId !== sessionId) {
					return;
				}
				if (
					!Number.isFinite(progress.currentFrame) ||
					!Number.isFinite(progress.totalFrames)
				) {
					return;
				}

				const nativeTotalFrames = Math.max(1, Math.floor(progress.totalFrames));
				const rawNativeCurrentFrame = Math.max(0, Math.floor(progress.currentFrame));
				const rawNativePercentage = Number.isFinite(progress.percentage)
					? Math.max(0, progress.percentage)
					: 0;
				if (
					progress.backend === "nvidia-cuda-compositor" ||
					progress.backend === "windows-d3d11-compositor"
				) {
					this.encoderName = progress.backend;
				}
				if (
					progress.stage === "preparing" ||
					(progress.stage !== "finalizing" &&
						rawNativeCurrentFrame === 0 &&
						rawNativePercentage <= 3)
				) {
					this.nativeStaticLayoutAverageFps = null;
					this.nativeStaticLayoutFpsSource = null;
					this.processedFrameCount = 0;
					// Forward the additive CUDA preparation sub-stage (encoder probe,
					// source validation, wrapper launch, CUDA/NVENC init, first frame) so
					// the UI can show what the native side is doing during "preparing".
					// The label is display-only and never fabricates encode FPS.
					this.reportProgress(
						0,
						totalFrames,
						"preparing",
						undefined,
						undefined,
						progress.substate,
						progress.substateLabel,
					);
					return;
				}
				const progressPercentFrame = Number.isFinite(progress.percentage)
					? Math.floor((nativeTotalFrames * progress.percentage) / 100)
					: 0;
				const nativeCurrentFrame = Math.max(rawNativeCurrentFrame, progressPercentFrame);
				const nativeFramesComplete = nativeCurrentFrame >= nativeTotalFrames;
				const nativeFinalizingProgress =
					progress.stage === "finalizing" && Number.isFinite(progress.percentage)
						? Math.max(
								NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS,
								Math.min(99, progress.percentage),
							)
						: NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS;
				const maxExtractingFrame = Math.max(
					0,
					Math.min(
						totalFrames - 1,
						Math.floor(
							totalFrames * (NATIVE_STATIC_LAYOUT_MAX_EXTRACTING_PROGRESS / 100),
						),
					),
				);
				const currentFrame = Math.min(
					maxExtractingFrame,
					Math.max(this.processedFrameCount, nativeCurrentFrame),
				);
				const nativeMeasuredFps =
					progress.stage === "finalizing"
						? null
						: typeof progress.instantFps === "number" &&
								Number.isFinite(progress.instantFps) &&
								progress.instantFps > 0
							? progress.instantFps
							: typeof progress.averageFps === "number" &&
									Number.isFinite(progress.averageFps) &&
									progress.averageFps > 0
								? progress.averageFps
								: null;
				const estimatedFps =
					progress.stage === "finalizing" || nativeMeasuredFps !== null
						? null
						: typeof progress.estimatedFps === "number" &&
								Number.isFinite(progress.estimatedFps) &&
								progress.estimatedFps > 0
							? progress.estimatedFps
							: null;
				if (estimatedFps !== null) {
					// Preparation-inclusive estimate; never presented as measured encode speed.
					this.nativeStaticLayoutFpsSource = "estimated";
					console.warn(
						formatLogTs(),
						"[VideoExporter] Native encode FPS not reported yet; using preparation-inclusive estimate",
						{ backend: progress.backend, estimatedFps },
					);
				} else if (nativeMeasuredFps !== null) {
					this.nativeStaticLayoutFpsSource = "native";
				}
				this.nativeStaticLayoutAverageFps = nativeMeasuredFps;
				this.processedFrameCount = currentFrame;
				if (progress.stage === "finalizing" || nativeFramesComplete) {
					this.reportFinalizingProgress(totalFrames, nativeFinalizingProgress);
				} else {
					this.reportProgress(currentFrame, totalFrames, "extracting");
				}
			},
		);

		const requestedVideoCodec = this.config.exportVideoCodec ?? "h264";
		const requestedEncoderPreference = this.config.exportEncoderPreference ?? "auto";
		try {
			// The IPC surface type predates native cursor ownership; the extra
			// cursorAtlasOwned field rides through the structured clone into the
			// main-process NativeStaticLayoutExportOptions where it is consumed.
			const nativeStaticLayoutOptions = {
				sessionId,
				inputPath: sourcePath,
				width: this.config.width,
				height: this.config.height,
				frameRate: this.config.frameRate,
				bitrate: this.config.bitrate,
				encodingMode: this.config.encodingMode ?? "balanced",
				videoCodec: requestedVideoCodec,
				encoderPreference: requestedEncoderPreference,
				durationSec: effectiveDuration,
				contentWidth,
				contentHeight,
				offsetX,
				offsetY,
				sourceCropX: sourceCrop?.x,
				sourceCropY: sourceCrop?.y,
				sourceCropWidth: sourceCrop?.width,
				sourceCropHeight: sourceCrop?.height,
				backgroundColor: background.backgroundColor,
				backgroundImagePath: background.backgroundImagePath ?? null,
				backgroundBlurPx: Math.max(0, (this.config.backgroundBlur ?? 0) * 3),
				borderRadius,
				shadowIntensity,
				// When the webcam is native-owned the renderer excluded it from the
				// overlay sidecar, so webcamInputPath must reach the CUDA compositor
				// even when a cursor-sprite (or baked-cursor) overlay layer is present.
				// Mixed baked content (captions/annotations/frame) never sets
				// webcamNativeOwned, so the existing baked-webcam contract (no
				// webcamInputPath alongside sidecar pixels) is preserved.
				webcamInputPath: webcamNativeOwned
					? (webcamOverlay?.inputPath ?? null)
					: overlayLayers.length || tiledOverlayLayers.length
						? null
						: (webcamOverlay?.inputPath ?? null),
				webcamLeft: webcamOverlay?.left,
				webcamTop: webcamOverlay?.top,
				webcamSize: webcamOverlay?.size,
				webcamRadius: webcamOverlay?.radius,
				webcamShadowIntensity: webcamOverlay?.shadowIntensity,
				webcamMirror: webcamOverlay?.mirror,
				webcamTimeOffsetMs: webcamOverlay?.timeOffsetMs,
				// True only when the CUDA compositor owns the webcam: the overlay
				// sidecar excluded webcam pixels and the native webcam overlay must
				// draw them (never double-render a baked webcam).
				webcamNativeOwned: webcamNativeOwned || undefined,
				cursorTelemetry,
				cursorSize: this.getNativeStaticLayoutCursorSize(contentWidth),
				cursorAtlasPngDataUrl: cursorAtlas?.dataUrl ?? null,
				cursorAtlasEntries: cursorAtlas?.entries,
				// True only when the CUDA compositor owns the cursor: the overlay
				// sidecar excluded cursor pixels and the native atlas must draw them.
				cursorAtlasOwned: cursorAtlasOwnedByNative || undefined,
				overlayLayers: overlayLayers.length ? overlayLayers : undefined,
				tiledOverlayLayers: tiledOverlayLayers.length ? tiledOverlayLayers : undefined,
				zoomTelemetry,
				temporalBlur: getTemporalMotionBlurConfig(this.config.zoomTemporalMotionBlur, {
					sampleCount: this.config.zoomMotionBlurSampleCount,
					shutterFraction: this.config.zoomMotionBlurShutterFraction,
				}),
				timelineSegments,
				chunkDurationSec: STATIC_LAYOUT_CHUNK_DURATION_SEC,
				experimentalWindowsGpuCompositor: this.config.experimentalNativeExport === true,
				experimentalNvidiaCudaExport: this.config.experimentalNvidiaCudaExport === true,
				audioOptions: {
					...audioOptions,
					...(deferredEditedAudioStreamId
						? { editedAudioStreamId: deferredEditedAudioStreamId }
						: {}),
					outputDurationSec: effectiveDuration,
				},
			};
			const ipcHandoffStartedAt = this.getNowMs();
			// When the streaming raw-overlay path was used, the native IPC was
			// launched concurrently with the bake and its result is already
			// available. Do not call nativeStaticLayoutExport again.
			const result: NativeStaticLayoutExportIpcResult = streamingResult
				? (streamingResult.nativeResult ?? {
						success: false,
						error: "streaming overlay produced no native result",
					})
				: streamingCursorSpriteResult
					? (streamingCursorSpriteResult.nativeResult ?? {
							success: false,
							error: "streaming cursor-sprite produced no native result",
						})
					: await window.electronAPI.nativeStaticLayoutExport(nativeStaticLayoutOptions);
			this.logNativeStaticLayoutPreparationStage("ipc-handoff", ipcHandoffStartedAt, {
				route: result.route ?? null,
				success: result.success,
				requestedVideoCodec,
				requestedEncoderPreference,
				requestedRoute: this.canUseNativeGpuStaticLayout()
					? "nvidia-cuda-compositor"
					: "static-layout",
			});
			if (this.cancelled) {
				await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
				return {
					success: false,
					error: "Export cancelled",
					metrics: this.buildExportMetrics(),
				};
			}

			if (!result.success || !result.tempPath) {
				const exportError =
					typeof result.error === "string" && result.error.trim()
						? result.error.trim()
						: "unknown-native-static-layout-export-error";
				console.warn(
					formatLogTs(),
					"[VideoExporter] Native static layout export unavailable",
					{
						error: exportError,
					},
				);
				// Surface the real IPC/helper failure instead of a generic
				// "route unavailable" when strict HEVC Hardware later refuses the
				// renderer raw fallback. The strict error carries this detail so CUDA
				// export failures stay diagnosable end-to-end.
				this.lastNativeExportError = exportError;
				this.nativeStaticLayoutSkipReasons = [
					"native-ipc-export-failed",
					`native-error:${exportError}`,
				];
				await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
				restoreEncoderState();
				return null;
			}

			const isStrictHevcHardware = this.requiresStrictNativeCudaRoute();
			const acceptedHevcNativeRoute = isStrictHevcHardware
				? result.route === "nvidia-cuda-compositor"
				: HEVC_NATIVE_STATIC_LAYOUT_ROUTES.has(result.route ?? "");
			if (requestedVideoCodec === "hevc" && !acceptedHevcNativeRoute) {
				const routeSkipReason = "unsupported-native-hevc-route";
				console.warn(
					"[VideoExporter] Rejecting HEVC native static-layout result from a non-CUDA route",
					{ route: result.route, isStrictHevcHardware },
				);
				this.nativeStaticLayoutSkipReason = routeSkipReason;
				this.nativeStaticLayoutSkipReasons = [routeSkipReason];
				// The native export already produced a temp video (potentially GBs for
				// HEVC); discard it before falling back so it is not left on disk for
				// the whole session. Best-effort: cleanup must never override the
				// intended skip reason or the null return.
				await window.electronAPI
					?.discardExportedTemp?.(result.tempPath)
					.catch(() => undefined);
				await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
				restoreEncoderState();
				return null;
			}

			const hasSpatialZoomMotionBlur = (this.config.zoomMotionBlur ?? 0) > 0.0005;
			const hasTemporalZoomMotionBlur = (this.config.zoomTemporalMotionBlur ?? 0) > 0.0005;
			if (
				shouldRejectNativeStaticLayoutResultForEffectPreservation({
					hasSpatialZoomMotionBlur,
					hasTemporalMotionBlur: hasTemporalZoomMotionBlur,
					hasOverlayContent: this.hasNativeStaticLayoutOverlayContent(),
					route: result.route,
				})
			) {
				// The generalized CUDA compositor applies spatial zoom blur before
				// alpha-compositing the transparent overlay sidecars and implements
				// temporal zoom motion blur from the resolved sample plan. The FFmpeg
				// effectful overlay route and the D3D11 helper cannot preserve these
				// effects; reject so the renderer raw-frame fallback keeps them instead
				// of silently dropping them.
				const routeSkipReason = "unsupported-motion-blur-on-overlay-route";
				console.warn(
					"[VideoExporter] Rejecting native static-layout result that cannot preserve zoom motion blur",
					{ route: result.route },
				);
				this.nativeStaticLayoutSkipReason = routeSkipReason;
				this.nativeStaticLayoutSkipReasons = [routeSkipReason];
				// The native export already produced a temp video (potentially GBs for
				// HEVC); discard it before falling back so it is not left on disk for
				// the whole session. Best-effort: cleanup must never override the
				// intended skip reason or the null return.
				await window.electronAPI
					?.discardExportedTemp?.(result.tempPath)
					.catch(() => undefined);
				await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
				restoreEncoderState();
				return null;
			}
			// A cursor-sprite layer is only composited by the generalized NVIDIA
			// CUDA compositor. If the actual route is anything else (FFmpeg effectful
			// overlay or D3D11 helper) it would silently drop the cursor, so reject
			// and let the renderer raw-frame fallback keep it.
			const hasCursorSpriteLayer = overlayLayers.some((layer) =>
				isCursorSpriteOverlayLayer(layer),
			);
			if (hasCursorSpriteLayer && result.route !== "nvidia-cuda-compositor") {
				const routeSkipReason = "unsupported-cursor-sprite-route";
				console.warn(
					"[VideoExporter] Rejecting native static-layout result that cannot compose the cursor sprite",
					{ route: result.route, layerCount: overlayLayers.length },
				);
				this.nativeStaticLayoutSkipReason = routeSkipReason;
				this.nativeStaticLayoutSkipReasons = [routeSkipReason];
				// The native export already produced a temp video (potentially GBs);
				// discard it before falling back so it is not left on disk for the
				// whole session. Best-effort: cleanup must never override the intended
				// skip reason or the null return.
				await window.electronAPI
					?.discardExportedTemp?.(result.tempPath)
					.catch(() => undefined);
				await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
				restoreEncoderState();
				return null;
			}
			// A native-owned webcam is only drawn by the generalized NVIDIA CUDA
			// compositor (the sidecar excluded webcam pixels). Any other route would
			// silently drop the webcam, so reject and let the renderer raw-frame
			// fallback keep it instead. Strict HEVC Hardware already refuses non-CUDA
			// routes; this guard is the explicit observable invariant for webcam
			// ownership on every codec/preference combination.
			if (webcamNativeOwned && result.route !== "nvidia-cuda-compositor") {
				const routeSkipReason = "unsupported-native-webcam-route";
				console.warn(
					"[VideoExporter] Rejecting native static-layout result that cannot draw the native-owned webcam",
					{ route: result.route, webcamNativeOwned },
				);
				this.nativeStaticLayoutSkipReason = routeSkipReason;
				this.nativeStaticLayoutSkipReasons = [routeSkipReason];
				// The native export already produced a temp video (potentially GBs);
				// discard it before falling back so it is not left on disk for the
				// whole session. Best-effort: cleanup must never override the intended
				// skip reason or the null return.
				await window.electronAPI
					?.discardExportedTemp?.(result.tempPath)
					.catch(() => undefined);
				await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
				restoreEncoderState();
				return null;
			}
			console.info(formatLogTs(), "[VideoExporter] Native static layout selected", {
				route: result.route,
				encoderName: result.encoderName,
				exportVideoCodec: requestedVideoCodec,
				exportEncoderPreference: requestedEncoderPreference,
				canUseNativeGpuStaticLayout: this.canUseNativeGpuStaticLayout(),
				experimentalNativeExport: this.config.experimentalNativeExport === true,
				experimentalNvidiaCudaExport: this.config.experimentalNvidiaCudaExport === true,
				hasOverlayLayers: this.hasNativeStaticLayoutOverlayContent(),
				webcamNativeOwned: Boolean(webcamNativeOwned),
				temporalBlurSamples:
					getTemporalMotionBlurConfig(this.config.zoomTemporalMotionBlur, {
						sampleCount: this.config.zoomMotionBlurSampleCount,
						shutterFraction: this.config.zoomMotionBlurShutterFraction,
					})?.sampleCount ?? null,
				overlayRenderedFrames: this.nativeStaticLayoutOverlayRenderedFrames,
				overlayPreparationMs: this.nativeStaticLayoutOverlayPreparationMs,
				streamingRawOverlay: streamingResult?.streamingRawOverlay ?? false,
				streamingCursorSprite: streamingCursorSpriteResult?.streamingCursorSprite ?? false,
			});
			if (result.route === "cuda-overlay" && this.hasNativeStaticLayoutOverlayContent()) {
				// Effectful overlay composition runs after a CUDA hwdownload and is
				// performed by FFmpeg's CPU alpha overlay filters. This is required to
				// alpha-compose RGBA sidecars, but it is the expected throughput
				// bottleneck on this route and should not be misreported as GPU encode
				// speed in the FPS diagnostics.
				console.info(
					"[VideoExporter] Native overlay route uses CPU alpha overlay composition",
					{
						route: result.route,
						note: "encode FPS reflects CPU-overlay-limited throughput, not raw NVENC speed",
					},
				);
			}

			const elapsedMs = this.getNowMs() - startedAt;
			this.encoderName =
				result.encoderName ??
				(result.route && requestedVideoCodec === "hevc"
					? result.route
					: requestedVideoCodec === "hevc"
						? "static-layout-hevc"
						: "static-layout-h264-nvenc");
			this.nativeStaticLayoutAverageFps = null;
			this.nativeStaticLayoutFpsSource = null;
			this.processedFrameCount = totalFrames;
			this.decodeLoopTimeMs = result.metrics?.chunkExecMs ?? elapsedMs;
			this.finalizationTimeMs = Math.max(0, elapsedMs - this.decodeLoopTimeMs);
			this.finalizationStageMs.nativeExportFinalizeMs = elapsedMs;
			if (result.metrics) {
				const metrics: ExportFfmpegAudioMuxBreakdown = {
					tempVideoWriteMs: result.metrics.tempVideoWriteMs,
					tempEditedAudioWriteMs: result.metrics.tempEditedAudioWriteMs,
					ffmpegExecMs: result.metrics.ffmpegExecMs,
					muxedVideoReadMs: result.metrics.muxedVideoReadMs,
					tempVideoBytes: result.metrics.tempVideoBytes,
					tempEditedAudioBytes: result.metrics.tempEditedAudioBytes,
					muxedVideoBytes: result.metrics.muxedVideoBytes,
					chunkCount: result.metrics.chunkCount,
					chunkDurationSec: result.metrics.chunkDurationSec,
					chunkExecMs: result.metrics.chunkExecMs,
					concatExecMs: result.metrics.concatExecMs,
					staticAssetExecMs: result.metrics.staticAssetExecMs,
					fallbackChunkCount: result.metrics.fallbackChunkCount,
					videoOnlyBytes: result.metrics.videoOnlyBytes,
					chunks: result.metrics.chunks,
				};
				this.finalizationStageMs.ffmpegAudioMuxBreakdown = metrics;
			}
			this.reportFinalizingProgress(totalFrames, 99);

			// The native IPC resolved, which means main's mux already waited for the
			// deferred edited-audio stream closure (or there was no deferred audio).
			// The deferred promise is already resolved at this point; awaiting it
			// would only block the success return (and the save dialog) for no
			// benefit. Attach a late-rejection logger instead of blocking.
			if (deferredEditedAudio) {
				const settleStartedAt = this.getNowMs();
				this.settleDeferredEditedAudio(deferredEditedAudio, { abort: false }).then(
					() => {
						const elapsedMs = Math.round(this.getNowMs() - settleStartedAt);
						console.info(
							formatLogTs(),
							"[VideoExporter] [PERF] Deferred edited-audio settlement completed (non-blocking)",
							{ elapsedMs, resolvedLate: elapsedMs > 100 },
						);
					},
					(error: unknown) => {
						console.warn(
							formatLogTs(),
							"[VideoExporter] Deferred edited-audio settlement failed after success return",
							error,
						);
					},
				);
			}

			return {
				success: true,
				tempFilePath: result.tempPath,
				metrics: this.buildExportMetrics(),
			};
		} catch (error) {
			if (this.cancelled) {
				return {
					success: false,
					error: "Export cancelled",
					metrics: this.buildExportMetrics(),
				};
			}

			console.warn(
				formatLogTs(),
				"[VideoExporter] Native static layout export failed; falling back",
				error,
			);
			const failureMessage = error instanceof Error ? error.message : String(error);
			this.lastNativeExportError = failureMessage;
			this.nativeStaticLayoutSkipReason = "native-static-runtime-failed";
			this.nativeStaticLayoutSkipReasons = [this.nativeStaticLayoutSkipReason];
			await this.settleDeferredEditedAudio(deferredEditedAudio, { abort: true });
			restoreEncoderState();
			return null;
		} finally {
			unsubscribeNativeProgress?.();
			// The static-layout attempt is over (success, skip, or runtime failure).
			// Clear native-measured FPS so a raw renderer fallback can never present
			// stale native encode speed as its own throughput.
			this.nativeStaticLayoutAverageFps = null;
			this.nativeStaticLayoutFpsSource = null;
			// Fire-and-forget temp-file cleanup so the success return (and save
			// dialog) is not blocked by multi-GB file deletions.
			if (overlayTempPath && typeof window !== "undefined") {
				const cleanupStartedAt = this.getNowMs();
				window.electronAPI?.discardExportedTemp?.(overlayTempPath).then(
					() => {
						const elapsedMs = Math.round(this.getNowMs() - cleanupStartedAt);
						console.info(
							formatLogTs(),
							"[VideoExporter] [PERF] Overlay temp cleanup completed (non-blocking)",
							{ elapsedMs },
						);
					},
					(error: unknown) => {
						console.warn(
							formatLogTs(),
							"[VideoExporter] Overlay temp cleanup failed (non-blocking)",
							error,
						);
					},
				);
			}
			{
				const cleanupStartedAt = this.getNowMs();
				this.cleanupNativeStaticLayoutBackground(background).then(
					() => {
						const elapsedMs = Math.round(this.getNowMs() - cleanupStartedAt);
						console.info(
							formatLogTs(),
							"[VideoExporter] [PERF] Background cleanup completed (non-blocking)",
							{ elapsedMs },
						);
					},
					(error: unknown) => {
						console.warn(
							formatLogTs(),
							"[VideoExporter] Background cleanup failed (non-blocking)",
							error,
						);
					},
				);
			}
			if (this.nativeStaticLayoutSessionId === sessionId) {
				this.nativeStaticLayoutSessionId = null;
			}
		}
	}

	private async tryStartNativeVideoExport(): Promise<boolean> {
		this.lastNativeExportError = null;

		if (typeof window === "undefined" || !window.electronAPI?.nativeVideoExportStart) {
			this.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export is not available in this build.`;
			return false;
		}

		if (this.config.width % 2 !== 0 || this.config.height % 2 !== 0) {
			this.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions (${this.config.width}x${this.config.height}).`;
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions, falling back to WebCodecs (${this.config.width}x${this.config.height})`,
			);
			return false;
		}

		if (
			typeof VideoEncoder === "undefined" ||
			typeof VideoEncoder.isConfigSupported !== "function"
		) {
			this.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export requires WebCodecs VideoEncoder support.`;
			return false;
		}

		const encoderConfig: VideoEncoderConfig = {
			codec: "avc1.640034",
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			hardwareAcceleration: "prefer-hardware",
			avc: { format: "annexb" },
		};

		try {
			const support = await VideoEncoder.isConfigSupported(encoderConfig);
			if (!support.supported) {
				this.lastNativeExportError = `H.264 Annex B encoding is not supported at ${this.config.width}x${this.config.height}.`;
				return false;
			}
		} catch (error) {
			this.lastNativeExportError = error instanceof Error ? error.message : String(error);
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} encoder support check failed`,
				error,
			);
			return false;
		}

		const result = await window.electronAPI.nativeVideoExportStart({
			width: this.config.width,
			height: this.config.height,
			frameRate: this.config.frameRate,
			bitrate: this.config.bitrate,
			encodingMode: this.config.encodingMode ?? "balanced",
			inputMode: "h264-stream",
		});

		if (!result.success || !result.sessionId) {
			this.lastNativeExportError =
				result.error ||
				`${NATIVE_EXPORT_ENGINE_NAME} export could not be started on this system.`;
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} export unavailable`,
				result.error,
			);
			return false;
		}

		this.nativeExportSessionId = result.sessionId;
		this.nativeRawFrameMode = false;
		this.lastNativeExportError = null;
		this.encodeBackend = "ffmpeg";
		this.encoderName = "h264-stream-copy";
		this.pendingNativeWriteChunks = [];
		this.pendingNativeWriteBytes = 0;

		const sessionId = result.sessionId;
		const encoder = new VideoEncoder({
			output: (chunk) => {
				if (this.cancelled || !this.nativeExportSessionId) {
					return;
				}

				const buffer = new ArrayBuffer(chunk.byteLength);
				chunk.copyTo(buffer);
				this.queueNativeWriteChunk(sessionId, new Uint8Array(buffer));
			},
			error: (error) => {
				this.nativeEncoderError = error;
				this.notifyEncodeCapacityAvailable();
			},
		});

		try {
			encoder.configure(encoderConfig);
		} catch (error) {
			this.lastNativeExportError = error instanceof Error ? error.message : String(error);
			try {
				encoder.close();
			} catch (closeError) {
				console.debug(
					"[VideoExporter] Ignoring error closing native H.264 encoder after startup failure:",
					closeError,
				);
			}
			this.nativeExportSessionId = null;
			await window.electronAPI.nativeVideoExportCancel?.(sessionId);
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} encoder configure failed`,
				error,
			);
			return false;
		}

		this.nativeH264Encoder = encoder;

		console.log(`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} session ready (H264-stream)`, {
			sessionId: result.sessionId,
		});
		return true;
	}

	private canUseNativeGpuStaticLayout(): boolean {
		return (
			this.config.exportVideoCodec === "hevc" &&
			this.config.exportEncoderPreference !== "cpu" &&
			this.config.experimentalNativeExport === true &&
			this.config.experimentalNvidiaCudaExport === true
		);
	}

	// Strict HEVC Hardware policy: the generalized NVIDIA CUDA compositor is the
	// ONLY acceptable route. The export must never silently fall back to the
	// renderer raw frame path (WebGPU/WebGL -> FFmpeg hevc_nvenc), Breeze, or CPU
	// when the CUDA route cannot run; it hard-fails with an actionable error.
	private requiresStrictNativeCudaRoute(): boolean {
		return (
			this.config.exportVideoCodec === "hevc" &&
			this.config.exportEncoderPreference === "hardware"
		);
	}

	private buildStrictNativeCudaHardwareError(reason: string): Error {
		const overlayDetail = this.nativeStaticLayoutOverlayFailure
			? ` (${this.nativeStaticLayoutOverlayFailure.stage}: ${this.nativeStaticLayoutOverlayFailure.message})`
			: "";
		const message = [
			"HEVC Hardware export requires the NVIDIA CUDA compositor.",
			`Native CUDA route did not run: ${reason}${overlayDetail}.`,
			"The export was stopped instead of falling back to renderer raw frames (WebGPU/Breeze) or CPU.",
			"The NVIDIA CUDA compositor backend is mandatory for H.265 + Hardware. Make sure the CUDA compositor is available (NVIDIA GPU with current drivers and the bundled compositor helper), or switch the encoder preference to Auto.",
			"noCpuFallback:true",
		].join(" ");
		const error = new Error(message);
		(error as Error & { noCpuFallback?: boolean }).noCpuFallback = true;
		return error;
	}

	private requiresNativeRawFrame(): boolean {
		return (
			this.config.exportVideoCodec === "hevc" ||
			(this.config.exportEncoderPreference !== undefined &&
				this.config.exportEncoderPreference !== "auto")
		);
	}

	private shouldForceNativeRawFrame(): boolean {
		// Strict HEVC Hardware forbids the renderer raw frame path entirely; the
		// native static-layout CUDA compositor is mandatory and any failure must
		// hard-fail instead of falling back.
		if (this.requiresStrictNativeCudaRoute()) {
			return false;
		}
		// HEVC Auto/Hardware gets one native CUDA static-layout attempt when the
		// renderer was given an eligible GPU route. CPU and explicit H.264 encoder
		// preferences remain direct rawvideo paths; H.264 + Auto is unchanged.
		return this.requiresNativeRawFrame() && !this.canUseNativeGpuStaticLayout();
	}

	private async tryStartNativeVideoExportRawFrame(): Promise<boolean> {
		this.lastNativeExportError = null;

		if (typeof window === "undefined" || !window.electronAPI?.nativeVideoExportStart) {
			this.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export is not available in this build.`;
			return false;
		}

		if (this.config.width % 2 !== 0 || this.config.height % 2 !== 0) {
			this.lastNativeExportError = `${NATIVE_EXPORT_ENGINE_NAME} export requires even output dimensions (${this.config.width}x${this.config.height}).`;
			return false;
		}

		const videoCodec = this.config.exportVideoCodec ?? "h264";
		const encoderPreference = this.config.exportEncoderPreference ?? "auto";
		const result = await window.electronAPI.nativeVideoExportStart({
			width: this.config.width,
			height: this.config.height,
			frameRate: this.config.frameRate,
			bitrate: this.config.bitrate,
			encodingMode: this.config.encodingMode ?? "balanced",
			inputMode: "rawvideo",
			videoCodec,
			encoderPreference,
		});

		if (!result.success || !result.sessionId) {
			this.lastNativeExportError =
				result.error ??
				`${NATIVE_EXPORT_ENGINE_NAME} ${videoCodec.toUpperCase()} raw-frame export could not be started on this system.`;
			console.warn(
				`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} raw-frame export unavailable`,
				result.error,
			);
			return false;
		}

		this.nativeExportSessionId = result.sessionId;
		this.nativeRawFrameMode = true;
		this.lastNativeExportError = null;
		await this.negotiateNativeRawFrameTransport(result.sessionId);
		this.encodeBackend = "ffmpeg";
		this.encoderName =
			result.encoderName ??
			(encoderPreference === "hardware"
				? `${videoCodec.toUpperCase()} hardware`
				: encoderPreference === "cpu"
					? videoCodec === "hevc"
						? "libx265"
						: "libx264"
					: videoCodec === "hevc"
						? "hevc-auto"
						: "h264-auto");
		this.pendingNativeWriteChunks = [];
		this.pendingNativeWriteBytes = 0;

		console.log(`[VideoExporter] ${NATIVE_EXPORT_ENGINE_NAME} raw-frame session ready`, {
			sessionId: result.sessionId,
			videoCodec,
			encoderPreference,
			encoderName: this.encoderName,
		});
		return true;
	}

	private async negotiateNativeRawFrameTransport(sessionId: string): Promise<void> {
		this.nativeTransportMode = "cloned-ipc";
		this.nativeTransportFallbackReason = null;
		if (
			typeof window === "undefined" ||
			typeof window.electronAPI?.nativeVideoExportOpenFrameChannel !== "function" ||
			typeof window.electronAPI?.nativeVideoExportWriteFrameViaChannel !== "function"
		) {
			this.nativeTransportFallbackReason =
				"Transferable native frame channel API is unavailable";
			return;
		}

		try {
			const result = await window.electronAPI.nativeVideoExportOpenFrameChannel(sessionId);
			if (result.success) {
				this.nativeTransportMode = "transferable-stream";
				return;
			}
			this.nativeTransportFallbackReason =
				result.error ?? "Transferable native frame channel negotiation failed";
		} catch (error) {
			this.nativeTransportFallbackReason =
				error instanceof Error ? error.message : String(error);
		}
		console.warn(
			`[VideoExporter] Falling back to cloned native raw-frame IPC transport: ${this.nativeTransportFallbackReason}`,
		);
	}

	private configureNativeRawFrameBackpressure(): void {
		if (!this.nativeRawFrameMode || !this.backpressureProfile) {
			return;
		}

		const rawLimits = getNativeRawFrameBackpressureLimits({
			width: this.config.width,
			height: this.config.height,
			profile: this.backpressureProfile,
			transportMode: this.nativeTransportMode ?? "cloned-ipc",
			maxInFlightFrames: this.config.maxInFlightNativeRawFrames,
			maxInFlightBytes: this.config.maxInFlightNativeRawBytes,
		});
		this.maxNativeRawWriteFrames = rawLimits.maxInFlightFrames;
		this.maxNativeRawWriteBytes = rawLimits.maxInFlightBytes;
		this.nativeRawBackpressure = new NativeRawFrameBackpressureQueue(
			rawLimits.maxInFlightBytes,
			rawLimits.maxInFlightFrames,
		);
	}

	private recordNativeWriteError(error: Error): void {
		if (!this.nativeWriteError) {
			this.nativeWriteError = error;
		}
		if (!this.cancelled && !this.nativeEncoderError) {
			this.nativeEncoderError = error;
		}
		this.nativeRawBackpressure?.fail(error);
		this.notifyEncodeCapacityAvailable();
	}

	private async encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void> {
		if (this.nativeRawFrameMode) {
			await this.encodeRenderedFrameNativeRaw(timestamp);
			return;
		}
		if (!this.nativeH264Encoder || !this.nativeExportSessionId) {
			if (this.cancelled) return;
			throw new Error(`${NATIVE_EXPORT_ENGINE_NAME} export session is not active`);
		}
		if (this.nativeEncoderError) throw this.nativeEncoderError;
		while (this.nativeWritePromises.size >= this.maxNativeWriteInFlight) {
			await this.awaitOldestNativeWrite();
			if (this.cancelled) return;
			if (this.nativeEncoderError) throw this.nativeEncoderError;
		}
		while (
			this.nativeH264Encoder.encodeQueueSize >= ModernVideoExporter.NATIVE_ENCODER_QUEUE_LIMIT
		) {
			await this.waitForEncodeCapacity();
			if (this.cancelled) return;
			if (this.nativeEncoderError) throw this.nativeEncoderError;
		}
		const canvas = this.renderer!.getCanvas();
		const frame = new VideoFrame(canvas, {
			timestamp,
			duration: frameDuration,
		});
		this.nativeH264Encoder.encode(frame, { keyFrame: frameIndex % 300 === 0 });
		frame.close();
	}

	private async encodeRenderedFrameNativeRaw(timestamp: number): Promise<void> {
		const sessionId = this.nativeExportSessionId;
		if (!sessionId) {
			if (this.cancelled) return;
			throw new Error(`${NATIVE_EXPORT_ENGINE_NAME} export session is not active`);
		}
		if (this.nativeEncoderError) throw this.nativeEncoderError;
		const frameByteSize = getNativeRawFrameByteSize(this.config.width, this.config.height);
		const rawBackpressure = this.nativeRawBackpressure;
		if (!rawBackpressure) {
			throw new Error(
				`${NATIVE_EXPORT_ENGINE_NAME} raw-frame backpressure is not configured`,
			);
		}
		try {
			await rawBackpressure.waitForCapacity(frameByteSize);
		} catch (error) {
			if (this.cancelled) return;
			throw error;
		}
		if (this.cancelled) return;

		const canvas = this.renderer!.getCanvas();
		const captureStartedAt = this.getNowMs();
		// Flip rows vertically: buildNativeVideoExportArgs applies an FFmpeg vflip for
		// rawvideo input, so we counter-rotate before writing the RGBA frame.
		const rawFrame = await captureCanvasFrameForNativeExport(canvas, timestamp, true);
		this.nativeCaptureTimeMs += this.getNowMs() - captureStartedAt;
		if (this.cancelled) return;

		rawBackpressure.reserve(rawFrame.byteLength);
		this.peakNativeWriteInFlightBytes = Math.max(
			this.peakNativeWriteInFlightBytes,
			rawBackpressure.currentInFlightBytes,
		);
		const writeStartedAt = this.getNowMs();
		let latencyRecorded = false;
		const recordAckLatency = () => {
			if (latencyRecorded) {
				return;
			}
			latencyRecorded = true;
			const latencyMs = Math.max(0, this.getNowMs() - writeStartedAt);
			this.nativeWriteTimeMs += latencyMs;
			this.nativeWriteAckTimeMs += latencyMs;
			this.nativeFrameTransportTimeMs += latencyMs;
		};
		let writeRequest: Promise<{ success: boolean; error?: string }>;
		try {
			writeRequest =
				this.nativeTransportMode === "transferable-stream"
					? window.electronAPI.nativeVideoExportWriteFrameViaChannel(sessionId, rawFrame)
					: window.electronAPI.nativeVideoExportWriteFrame(sessionId, rawFrame);
		} catch (error) {
			recordAckLatency();
			rawBackpressure.release(rawFrame.byteLength);
			const resolvedError = error instanceof Error ? error : new Error(String(error));
			this.recordNativeWriteError(resolvedError);
			throw resolvedError;
		}
		this.nativeRawBytesSubmitted += rawFrame.byteLength;
		this.nativeRawFramesSubmitted += 1;

		const writePromise = writeRequest
			.then((writeResult) => {
				recordAckLatency();
				if (!writeResult.success) {
					throw new Error(
						writeResult.error ||
							"Failed to write a raw video frame to the native encoder",
					);
				}
			})
			.catch((error: unknown) => {
				recordAckLatency();
				const resolvedError = error instanceof Error ? error : new Error(String(error));
				this.recordNativeWriteError(resolvedError);
			});
		this.trackNativeRawWritePromise(writePromise, rawFrame.byteLength);
	}

	private async finishNativeVideoExport(audioPlan: NativeAudioPlan): Promise<ExportResult> {
		if (!this.nativeExportSessionId) {
			return {
				success: false,
				error: `${NATIVE_EXPORT_ENGINE_NAME} export session is not active`,
			};
		}

		let editedAudioBuffer: ArrayBuffer | undefined;
		let editedAudioMimeType: string | null = null;

		if (
			audioPlan.audioMode === "edited-track" &&
			audioPlan.strategy === "offline-render-fallback"
		) {
			const renderedAudio = await this.renderEditedAudioForNativeMux(
				`${NATIVE_EXPORT_ENGINE_NAME} edited audio rendering`,
				(progress) => this.reportFinalizingProgress(this.processedFrameCount, 99, progress),
				audioPlan.sourceAudioFallbackPaths,
			);
			editedAudioBuffer = renderedAudio.editedAudioData;
			editedAudioMimeType = renderedAudio.editedAudioMimeType;
		}

		const sessionId = this.nativeExportSessionId;
		console.log(`[VideoExporter] Finalizing ${NATIVE_EXPORT_ENGINE_NAME} export`, {
			sessionId,
			audioMode: audioPlan.audioMode,
			editedTrackStrategy:
				audioPlan.audioMode === "edited-track" ? audioPlan.strategy : undefined,
			encoderName: this.encoderName ?? "unknown",
		});

		this.flushPendingNativeWriteBatch(sessionId);
		await this.awaitPendingNativeWrites();

		const result = await this.measureFinalizationStage("nativeExportFinalizeMs", async () =>
			this.awaitWithFinalizationTimeout(
				window.electronAPI.nativeVideoExportFinish(sessionId, {
					audioMode: audioPlan.audioMode,
					audioSourcePath:
						audioPlan.audioMode === "copy-source" ||
						audioPlan.audioMode === "trim-source" ||
						(audioPlan.audioMode === "edited-track" &&
							audioPlan.strategy === "filtergraph-fast-path")
							? audioPlan.audioSourcePath
							: null,
					trimSegments:
						audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
					editedTrackStrategy:
						audioPlan.audioMode === "edited-track" ? audioPlan.strategy : undefined,
					editedTrackSegments:
						audioPlan.audioMode === "edited-track" &&
						audioPlan.strategy === "filtergraph-fast-path"
							? audioPlan.editedTrackSegments
							: undefined,
					outputDurationSec: this.effectiveDurationSec,
					audioSourceSampleRate:
						audioPlan.audioMode === "edited-track" &&
						audioPlan.strategy === "filtergraph-fast-path"
							? audioPlan.audioSourceSampleRate
							: undefined,
					editedAudioData: editedAudioBuffer,
					editedAudioMimeType,
				}),
				`${NATIVE_EXPORT_ENGINE_NAME} export finalization`,
				audioPlan.audioMode === "none" ? "default" : "audio",
			),
		);
		if (result.metrics) {
			this.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
		}
		this.nativeExportSessionId = null;

		if (!result.success) {
			return {
				success: false,
				error: result.error || `Failed to finalize ${NATIVE_EXPORT_ENGINE_NAME} export`,
			};
		}

		this.encoderName = result.encoderName ?? this.encoderName;
		if (!result.tempPath) {
			return {
				success: false,
				error: `${NATIVE_EXPORT_ENGINE_NAME} export did not return a temp path`,
			};
		}

		return {
			success: true,
			tempFilePath: result.tempPath,
		};
	}

	private async finalizeExportWithFfmpegAudio(
		videoSource: import("./muxer").MuxerFinalizeResult,
		audioPlan: NativeAudioPlan,
	): Promise<ExportResult> {
		if (typeof window === "undefined") {
			return {
				success: false,
				error: "FFmpeg audio fallback is unavailable in this environment.",
			};
		}

		let editedAudioBuffer: ArrayBuffer | undefined;
		let editedAudioMimeType: string | null = null;

		if (
			audioPlan.audioMode === "edited-track" &&
			audioPlan.strategy === "offline-render-fallback"
		) {
			const renderedAudio = await this.renderEditedAudioForNativeMux(
				"FFmpeg edited audio rendering",
				(progress) => this.reportFinalizingProgress(this.processedFrameCount, 99, progress),
				audioPlan.sourceAudioFallbackPaths,
			);
			editedAudioBuffer = renderedAudio.editedAudioData;
			editedAudioMimeType = renderedAudio.editedAudioMimeType;
		}

		const muxOptions = {
			audioMode: audioPlan.audioMode,
			audioSourcePath:
				audioPlan.audioMode === "copy-source" ||
				audioPlan.audioMode === "trim-source" ||
				(audioPlan.audioMode === "edited-track" &&
					audioPlan.strategy === "filtergraph-fast-path")
					? audioPlan.audioSourcePath
					: null,
			trimSegments:
				audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
			editedTrackStrategy:
				audioPlan.audioMode === "edited-track" ? audioPlan.strategy : undefined,
			editedTrackSegments:
				audioPlan.audioMode === "edited-track" &&
				audioPlan.strategy === "filtergraph-fast-path"
					? audioPlan.editedTrackSegments
					: undefined,
			audioSourceSampleRate:
				audioPlan.audioMode === "edited-track" &&
				audioPlan.strategy === "filtergraph-fast-path"
					? audioPlan.audioSourceSampleRate
					: undefined,
			outputDurationSec: this.effectiveDurationSec,
			editedAudioData: editedAudioBuffer,
			editedAudioMimeType,
		};

		if (videoSource.mode === "stream") {
			if (!window.electronAPI?.muxExportedVideoAudioFromPath) {
				return {
					success: false,
					error: "FFmpeg audio fallback via temp path is unavailable in this environment.",
				};
			}
			const result = await this.measureFinalizationStage("ffmpegAudioMuxMs", async () =>
				this.awaitWithFinalizationTimeout(
					window.electronAPI.muxExportedVideoAudioFromPath(
						videoSource.tempFilePath,
						muxOptions,
					),
					"FFmpeg audio muxing",
					"audio",
				),
			);
			if (result.metrics) {
				this.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
			}
			if (!result.success || !result.tempPath) {
				return {
					success: false,
					error: result.error || "Failed to mux exported audio with FFmpeg",
				};
			}
			return { success: true, tempFilePath: result.tempPath };
		}

		if (!window.electronAPI?.muxExportedVideoAudio) {
			return {
				success: false,
				error: "FFmpeg audio fallback is unavailable in this environment.",
			};
		}
		const videoBuffer = await videoSource.blob.arrayBuffer();
		const result = await this.measureFinalizationStage("ffmpegAudioMuxMs", async () =>
			this.awaitWithFinalizationTimeout(
				window.electronAPI.muxExportedVideoAudio(videoBuffer, muxOptions),
				"FFmpeg audio muxing",
				"audio",
			),
		);
		if (result.metrics) {
			this.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
		}

		if (!result.success || !result.tempPath) {
			return {
				success: false,
				error: result.error || "Failed to mux exported audio with FFmpeg",
			};
		}

		// Returning a temp path (instead of buffering the muxed bytes back into
		// the renderer) is what keeps >2 GiB exports off Node's fs.readFile cap.
		return {
			success: true,
			tempFilePath: result.tempPath,
		};
	}

	private async encodeRenderedFrame(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	) {
		const canvas = this.renderer!.getCanvas();

		// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
		const exportFrame = new VideoFrame(canvas, {
			timestamp,
			duration: frameDuration,
			colorSpace: {
				primaries: "bt709",
				transfer: "iec61966-2-1",
				matrix: "rgb",
				fullRange: true,
			},
		});

		while (
			this.encoder &&
			this.getCurrentEncodeBacklog() >= this.webCodecsEncodeQueueLimit &&
			!this.cancelled
		) {
			const encodeWaitStartedAt = this.getNowMs();
			this.encodeWaitEvents++;
			await this.waitForEncodeCapacity();
			this.encodeWaitTimeMs += this.getNowMs() - encodeWaitStartedAt;
		}

		try {
			if (this.encoder && this.encoder.state === "configured") {
				this.peakEncodeQueueSize = Math.max(
					this.peakEncodeQueueSize,
					this.encoder.encodeQueueSize,
					this.encodeQueue,
				);
				this.encodeQueue++;
				this.encoder.encode(exportFrame, {
					keyFrame: frameIndex % Math.max(this.keyFrameInterval, 1) === 0,
				});
				this.peakEncodeQueueSize = Math.max(
					this.peakEncodeQueueSize,
					this.encoder.encodeQueueSize,
					this.encodeQueue,
				);
			} else {
				console.warn(
					`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`,
				);
			}
		} finally {
			exportFrame.close();
		}
	}

	private reportFinalizingProgress(
		totalFrames: number,
		renderProgress: number,
		audioProgress?: number,
	) {
		const nextProgress = advanceFinalizationProgress({
			renderProgress,
			audioProgress,
			state: {
				lastRenderProgress: this.lastFinalizationRenderProgress,
				lastAudioProgress: this.lastFinalizationAudioProgress,
			},
		});
		if (nextProgress.progressed) {
			this.activeFinalizationProgressWatchdog?.refreshProgress();
		}
		this.lastFinalizationRenderProgress = nextProgress.lastRenderProgress;
		this.lastFinalizationAudioProgress = nextProgress.lastAudioProgress;
		this.reportProgress(
			totalFrames,
			totalFrames,
			"finalizing",
			nextProgress.lastRenderProgress,
			typeof audioProgress === "number" && Number.isFinite(audioProgress)
				? nextProgress.lastAudioProgress
				: undefined,
		);
	}

	private queueNativeWriteChunk(sessionId: string, chunk: Uint8Array): void {
		this.pendingNativeWriteChunks.push(chunk);
		this.pendingNativeWriteBytes += chunk.byteLength;

		if (
			this.pendingNativeWriteChunks.length >=
				ModernVideoExporter.NATIVE_WRITE_BATCH_MAX_CHUNKS ||
			this.pendingNativeWriteBytes >= ModernVideoExporter.NATIVE_WRITE_BATCH_MAX_BYTES
		) {
			this.flushPendingNativeWriteBatch(sessionId);
		}
	}

	private flushPendingNativeWriteBatch(sessionId: string): void {
		if (this.pendingNativeWriteChunks.length === 0) {
			return;
		}

		const chunks = this.pendingNativeWriteChunks;
		this.pendingNativeWriteChunks = [];
		this.pendingNativeWriteBytes = 0;
		const writeStartedAt = this.getNowMs();
		let latencyRecorded = false;
		const recordAckLatency = () => {
			if (latencyRecorded) {
				return;
			}
			latencyRecorded = true;
			const latencyMs = Math.max(0, this.getNowMs() - writeStartedAt);
			this.nativeWriteTimeMs += latencyMs;
			this.nativeWriteAckTimeMs += latencyMs;
		};
		const writePromise = window.electronAPI
			.nativeVideoExportWriteFrames(sessionId, chunks)
			.then((writeResult) => {
				recordAckLatency();
				if (!writeResult.success && !this.cancelled) {
					throw new Error(
						writeResult.error || "Failed to write H.264 chunks to native encoder",
					);
				}
			})
			.catch((error) => {
				recordAckLatency();
				const resolvedError = error instanceof Error ? error : new Error(String(error));
				this.recordNativeWriteError(resolvedError);
				throw error;
			});

		this.trackNativeWritePromise(writePromise);
		this.notifyEncodeCapacityAvailable();
	}

	private waitForEncodeCapacity(): Promise<void> {
		return new Promise((resolve) => {
			this.encodeCapacityWaiters.add(resolve);
		});
	}

	private notifyEncodeCapacityAvailable(): void {
		if (this.encodeCapacityWaiters.size === 0) {
			return;
		}

		const waiters = [...this.encodeCapacityWaiters];
		this.encodeCapacityWaiters.clear();
		for (const resolve of waiters) {
			resolve();
		}
	}

	private reportProgress(
		currentFrame: number,
		totalFrames: number,
		phase: ExportProgress["phase"] = "extracting",
		renderProgress?: number,
		audioProgress?: number,
		preparingSubstate?: string,
		preparingSubstateLabel?: string,
	) {
		// Suppress repeated identical "preparing" start signals (0 frames, no render
		// or audio progress, same prepare substage) during a single export so the
		// renderer/UI is not spammed with identical progress resets. The first
		// signal per total frame count and every distinct prepare substage are still
		// delivered; progress semantics are unchanged.
		const isPlainPreparingSignal =
			phase === "preparing" &&
			currentFrame === 0 &&
			renderProgress === undefined &&
			audioProgress === undefined;
		const isIdenticalPreparingSignal =
			isPlainPreparingSignal &&
			this.lastPreparingTotalFrames === totalFrames &&
			this.lastPreparingSubstate === (preparingSubstate ?? null) &&
			this.lastPreparingSubstateLabel === (preparingSubstateLabel ?? null);
		if (isIdenticalPreparingSignal) {
			return;
		}
		if (isPlainPreparingSignal) {
			this.lastPreparingTotalFrames = totalFrames;
			this.lastPreparingSubstate = preparingSubstate ?? null;
			this.lastPreparingSubstateLabel = preparingSubstateLabel ?? null;
		}
		if (phase !== "preparing") {
			// A non-preparing progress event ends the current preparing phase; reset
			// the watermarks so a later preparing phase that reuses the same total
			// frame count or substage still delivers its first signal instead of
			// being suppressed against a stale watermark.
			this.lastPreparingTotalFrames = null;
			this.lastPreparingSubstate = null;
			this.lastPreparingSubstateLabel = null;
		}

		const nowMs = this.getNowMs();
		const elapsedSeconds = Math.max((nowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.lastProgressSampleTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.lastProgressSampleFrame, 0);
		const sampleRenderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		if (this.nativeStaticLayoutAverageFps !== null) {
			this.displayedRenderFps = this.nativeStaticLayoutAverageFps;
		} else if (sampleElapsedMs >= 500 || currentFrame === totalFrames) {
			this.displayedRenderFps =
				this.displayedRenderFps > 0
					? this.displayedRenderFps * 0.35 + sampleRenderFps * 0.65
					: sampleRenderFps;
		} else if (this.displayedRenderFps <= 0) {
			this.displayedRenderFps = averageRenderFps;
		}
		const displayedRenderFps =
			this.displayedRenderFps > 0 ? this.displayedRenderFps : sampleRenderFps;
		const remainingFrames = Math.max(totalFrames - currentFrame, 0);
		const estimatedTimeRemaining =
			averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
		const safeRenderProgress =
			phase === "finalizing" ? Math.max(0, Math.min(renderProgress ?? 100, 100)) : undefined;
		const percentage =
			phase === "preparing"
				? 0
				: phase === "finalizing"
					? (safeRenderProgress ?? 100)
					: totalFrames > 0
						? (currentFrame / totalFrames) * 100
						: 100;

		if (nowMs - this.lastThroughputLogTimeMs >= 1000 || currentFrame === totalFrames) {
			const safeFrameCount = Math.max(this.processedFrameCount, 1);
			this.peakEncodeQueueSize = Math.max(
				this.peakEncodeQueueSize,
				this.getCurrentEncodeBacklog(),
			);
			console.log(
				`[VideoExporter] Progress ${JSON.stringify({
					phase,
					currentFrame,
					totalFrames,
					elapsedSec: Number(elapsedSeconds.toFixed(2)),
					averageRenderFps: Number(averageRenderFps.toFixed(1)),
					sampleRenderFps: Number(sampleRenderFps.toFixed(1)),
					displayedRenderFps: Number(displayedRenderFps.toFixed(1)),
					fpsSource: this.nativeStaticLayoutFpsSource ?? undefined,
					renderBackend: this.renderBackend ?? undefined,
					encodeBackend: this.encodeBackend ?? undefined,
					encoderName: this.encoderName ?? undefined,
					encoderQueueSize: this.encoder?.encodeQueueSize ?? 0,
					pendingEncodeQueue: this.encodeQueue,
					encodeBacklog: this.getCurrentEncodeBacklog(),
					peakEncodeQueueSize: this.peakEncodeQueueSize,
					nativeWriteInFlight:
						this.nativeWritePromises.size + this.nativeRawWritePromises.size,
					peakNativeWriteInFlight: this.peakNativeWriteInFlight,
					averageFrameCallbackMs: Number(
						(this.frameCallbackTimeMs / safeFrameCount).toFixed(3),
					),
					averageRenderFrameMs: Number(
						(this.renderFrameTimeMs / safeFrameCount).toFixed(3),
					),
					averageEncodeWaitMs: Number(
						(this.encodeWaitTimeMs / safeFrameCount).toFixed(3),
					),
					averageNativeCaptureMs:
						this.nativeCaptureTimeMs > 0
							? Number((this.nativeCaptureTimeMs / safeFrameCount).toFixed(3))
							: undefined,
					averageNativeWriteMs:
						this.nativeWriteTimeMs > 0
							? Number((this.nativeWriteTimeMs / safeFrameCount).toFixed(3))
							: undefined,
				})}`,
			);
			this.lastThroughputLogTimeMs = nowMs;
			this.lastProgressSampleTimeMs = nowMs;
			this.lastProgressSampleFrame = currentFrame;
		}

		if (this.config.onProgress) {
			this.config.onProgress({
				currentFrame,
				totalFrames,
				percentage,
				estimatedTimeRemaining,
				renderFps: displayedRenderFps,
				fpsSource: this.nativeStaticLayoutFpsSource ?? undefined,
				renderBackend: this.renderBackend ?? undefined,
				encodeBackend: this.encodeBackend ?? undefined,
				encoderName: this.encoderName ?? undefined,
				nativeStaticLayoutSkipReason: this.nativeStaticLayoutSkipReason ?? undefined,
				nativeStaticLayoutSkipReasons:
					this.nativeStaticLayoutSkipReasons.length > 0
						? this.nativeStaticLayoutSkipReasons
						: undefined,
				phase,
				renderProgress: safeRenderProgress,
				audioProgress,
				preparingSubstate,
				preparingSubstateLabel,
			});
		}
	}

	private buildExportMetrics(): ExportMetrics {
		const totalElapsedMs =
			this.totalExportStartTimeMs > 0 ? this.getNowMs() - this.totalExportStartTimeMs : 0;
		const safeFrameCount = Math.max(this.processedFrameCount, 1);
		const hasFinalizationStageMetrics = Object.keys(this.finalizationStageMs).length > 0;

		return {
			totalElapsedMs,
			metadataLoadMs: this.metadataLoadTimeMs,
			rendererInitMs: this.rendererInitTimeMs,
			nativeSessionStartMs: this.nativeSessionStartTimeMs,
			decodeLoopMs: this.decodeLoopTimeMs,
			frameCallbackMs: this.frameCallbackTimeMs,
			renderFrameMs: this.renderFrameTimeMs,
			encodeWaitMs: this.encodeWaitTimeMs,
			encodeWaitEvents: this.encodeWaitEvents,
			peakEncodeQueueSize: this.peakEncodeQueueSize,
			peakNativeWriteInFlight: this.peakNativeWriteInFlight,
			nativeCaptureMs: this.nativeCaptureTimeMs,
			nativeWriteMs: this.nativeWriteTimeMs,
			nativeWriteAckMs: this.nativeWriteAckTimeMs,
			nativeRawBytesSubmitted:
				this.nativeRawFramesSubmitted > 0 ? this.nativeRawBytesSubmitted : undefined,
			nativeTransportMode: this.nativeTransportMode ?? undefined,
			nativeTransportFallbackReason: this.nativeTransportFallbackReason ?? undefined,
			averageNativeFrameTransportMs:
				this.nativeRawFramesSubmitted > 0
					? this.nativeFrameTransportTimeMs / this.nativeRawFramesSubmitted
					: undefined,
			averageNativeWriteAckMs:
				this.nativeRawFramesSubmitted > 0
					? this.nativeWriteAckTimeMs / this.nativeRawFramesSubmitted
					: undefined,
			peakNativeWriteInFlightBytes:
				this.nativeRawFramesSubmitted > 0 ? this.peakNativeWriteInFlightBytes : undefined,
			finalizationMs: this.finalizationTimeMs,
			frameCount: this.processedFrameCount,
			renderBackend: this.renderBackend ?? undefined,
			encodeBackend: this.encodeBackend ?? undefined,
			encoderName: this.encoderName ?? undefined,
			backpressureProfile: this.backpressureProfile?.name,
			nativeStaticLayoutSkipReason: this.nativeStaticLayoutSkipReason ?? undefined,
			nativeStaticLayoutSkipReasons:
				this.nativeStaticLayoutSkipReasons.length > 0
					? this.nativeStaticLayoutSkipReasons
					: undefined,
			effectiveDurationSec: this.effectiveDurationSec || undefined,
			finalizationStageMs: hasFinalizationStageMetrics ? this.finalizationStageMs : undefined,
			averageFrameCallbackMs:
				this.processedFrameCount > 0
					? this.frameCallbackTimeMs / safeFrameCount
					: undefined,
			averageRenderFrameMs:
				this.processedFrameCount > 0 ? this.renderFrameTimeMs / safeFrameCount : undefined,
			averageEncodeWaitMs:
				this.processedFrameCount > 0 ? this.encodeWaitTimeMs / safeFrameCount : undefined,
			averageNativeCaptureMs:
				this.processedFrameCount > 0
					? this.nativeCaptureTimeMs / safeFrameCount
					: undefined,
			averageNativeWriteMs:
				this.processedFrameCount > 0 ? this.nativeWriteTimeMs / safeFrameCount : undefined,
		};
	}

	private getCurrentEncodeBacklog(): number {
		return Math.max(this.encoder?.encodeQueueSize ?? 0, this.encodeQueue);
	}

	private trackNativeWritePromise(writePromise: Promise<void>): void {
		this.nativeWritePromises.add(writePromise);
		this.peakNativeWriteInFlight = Math.max(
			this.peakNativeWriteInFlight,
			this.nativeWritePromises.size + this.nativeRawWritePromises.size,
		);

		void writePromise.then(
			() => this.nativeWritePromises.delete(writePromise),
			() => this.nativeWritePromises.delete(writePromise),
		);
	}

	private trackNativeRawWritePromise(writePromise: Promise<void>, frameByteSize: number): void {
		const rawBackpressure = this.nativeRawBackpressure;
		if (!rawBackpressure) {
			return;
		}
		this.nativeRawWritePromises.add(writePromise);
		this.peakNativeWriteInFlight = Math.max(
			this.peakNativeWriteInFlight,
			this.nativeWritePromises.size + this.nativeRawWritePromises.size,
		);
		this.peakNativeWriteInFlightBytes = Math.max(
			this.peakNativeWriteInFlightBytes,
			rawBackpressure.currentInFlightBytes,
		);

		const settle = () => {
			this.nativeRawWritePromises.delete(writePromise);
			rawBackpressure.release(frameByteSize);
			this.notifyEncodeCapacityAvailable();
		};
		void writePromise.then(settle, settle);
	}

	private async awaitOldestNativeWrite(): Promise<void> {
		const oldestWritePromise = this.nativeWritePromises.values().next().value;
		if (!oldestWritePromise) {
			return;
		}

		await oldestWritePromise;

		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}

	private async awaitOldestNativeRawWrite(): Promise<void> {
		const oldestWritePromise = this.nativeRawWritePromises.values().next().value;
		if (!oldestWritePromise) {
			return;
		}

		await oldestWritePromise;
		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}

	private async awaitPendingNativeWrites(): Promise<void> {
		while (this.nativeWritePromises.size > 0 || this.nativeRawWritePromises.size > 0) {
			if (this.nativeWritePromises.size > 0) {
				await this.awaitOldestNativeWrite();
			} else {
				await this.awaitOldestNativeRawWrite();
			}
		}

		if (this.nativeWriteError) {
			throw this.nativeWriteError;
		}
	}

	private disposeNativeH264Encoder(): void {
		if (!this.nativeH264Encoder) {
			return;
		}

		try {
			this.nativeH264Encoder.close();
		} catch (error) {
			console.debug("[VideoExporter] Ignoring error closing native H.264 encoder:", error);
		}

		this.nativeH264Encoder = null;
	}

	private getNowMs(): number {
		if (typeof performance !== "undefined" && typeof performance.now === "function") {
			return performance.now();
		}

		return Date.now();
	}

	private async measureFinalizationStage<T>(
		stage: keyof ExportFinalizationStageMetrics,
		task: () => Promise<T>,
	): Promise<T> {
		const startedAt = this.getNowMs();
		try {
			return await task();
		} finally {
			this.finalizationStageMs[stage] = this.getNowMs() - startedAt;
		}
	}

	private async initializeEncoder(): Promise<SupportedMp4EncoderPath> {
		this.encodeQueue = 0;
		this.webCodecsEncodeQueueLimit =
			this.config.maxEncodeQueue ??
			this.backpressureProfile?.maxEncodeQueue ??
			getWebCodecsEncodeQueueLimit(this.config.frameRate, this.config.encodingMode);
		this.keyFrameInterval = getWebCodecsKeyFrameInterval(
			this.config.frameRate,
			this.config.encodingMode,
		);
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		let videoDescription: Uint8Array | undefined;

		const encoderCandidates = this.getEncoderCandidates();
		const latencyModePreferences = getPreferredWebCodecsLatencyModes(this.config.encodingMode);

		let resolvedCodec: string | null = null;

		console.log("[VideoExporter] WebCodecs tuning", {
			encodingMode: this.config.encodingMode ?? "balanced",
			keyFrameInterval: this.keyFrameInterval,
			latencyModes: latencyModePreferences,
			queueLimit: this.webCodecsEncodeQueueLimit,
		});

		this.encoder = new VideoEncoder({
			output: (chunk, meta) => {
				// Capture decoder config metadata from encoder output
				if (meta?.decoderConfig?.description && !videoDescription) {
					const desc = meta.decoderConfig.description;
					videoDescription = ArrayBuffer.isView(desc)
						? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
						: new Uint8Array(desc);
					this.videoDescription = videoDescription;
				}
				// Capture colorSpace from encoder metadata if provided
				if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
					this.videoColorSpace = meta.decoderConfig.colorSpace;
				}

				// Stream chunks to muxer in order without retaining an ever-growing promise array
				const isFirstChunk = this.chunkCount === 0;
				this.chunkCount++;

				this.pendingMuxing = this.pendingMuxing.then(async () => {
					try {
						if (isFirstChunk && this.videoDescription) {
							// Add decoder config for the first chunk
							const colorSpace = this.videoColorSpace || {
								primaries: "bt709",
								transfer: "iec61966-2-1",
								matrix: "rgb",
								fullRange: true,
							};

							const metadata: EncodedVideoChunkMetadata = {
								decoderConfig: {
									codec: resolvedCodec ?? (this.config.codec || "avc1.640033"),
									codedWidth: this.config.width,
									codedHeight: this.config.height,
									description: this.videoDescription,
									colorSpace,
								},
							};

							await this.muxer!.addVideoChunk(chunk, metadata);
						} else {
							await this.muxer!.addVideoChunk(chunk, meta);
						}
					} catch (error) {
						console.error("Muxing error:", error);
						const muxingError =
							error instanceof Error ? error : new Error(String(error));
						if (!this.encoderError) {
							this.encoderError = muxingError;
						}
						this.cancelled = true;
					}
				});
				this.encodeQueue--;
				this.notifyEncodeCapacityAvailable();
			},
			error: (error) => {
				console.error(
					`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${this.config.width}x${this.config.height}):`,
					error,
				);
				this.encoderError = error instanceof Error ? error : new Error(String(error));
				this.cancelled = true;
				this.notifyEncodeCapacityAvailable();
			},
		});

		const baseConfig: Omit<
			VideoEncoderConfig,
			"codec" | "hardwareAcceleration" | "latencyMode"
		> = {
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			bitrateMode: "variable",
		};

		for (const candidate of encoderCandidates) {
			for (const latencyMode of latencyModePreferences) {
				const config: VideoEncoderConfig = {
					...baseConfig,
					codec: candidate.codec,
					hardwareAcceleration: candidate.hardwareAcceleration,
					latencyMode,
				};
				const support = await VideoEncoder.isConfigSupported(config);
				if (support.supported) {
					resolvedCodec = candidate.codec;
					this.encodeBackend = "webcodecs";
					this.encoderName = `${candidate.codec}/${candidate.hardwareAcceleration}/${latencyMode}`;
					console.log(
						`[VideoExporter] Using ${candidate.hardwareAcceleration} ${latencyMode} encoder path with codec ${candidate.codec}`,
					);
					this.encoder.configure(config);
					return candidate;
				}

				console.warn(
					`[VideoExporter] Encoder path ${candidate.codec}/${candidate.hardwareAcceleration}/${latencyMode} is not supported (${this.config.width}x${this.config.height}), trying next...`,
				);
			}
		}

		throw new Error(
			`Video encoding not supported on this system. ` +
				`Tried encoder paths: ${encoderCandidates
					.map((candidate) => `${candidate.codec}/${candidate.hardwareAcceleration}`)
					.join(", ")} at ${this.config.width}x${this.config.height}. ` +
				`Your browser or hardware may not support H.264 encoding at this resolution. ` +
				`Try exporting at a lower quality setting.`,
		);
	}

	private getEncoderCandidates(): SupportedMp4EncoderPath[] {
		return getOrderedSupportedMp4EncoderCandidates({
			codec: this.config.codec,
			preferredEncoderPath: this.config.preferredEncoderPath,
		});
	}

	private disposeEncoder(): void {
		if (!this.encoder) {
			return;
		}

		try {
			if (this.encoder.state !== "closed") {
				this.encoder.close();
			}
		} catch (error) {
			console.warn("Error closing encoder:", error);
		}

		this.encoder = null;
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
		this.webCodecsEncodeQueueLimit = 0;
		this.keyFrameInterval = 0;
		this.encodeBackend = null;
		this.encoderName = null;
	}

	cancel(): void {
		this.cancelled = true;
		this.nativeRawBackpressure?.fail(new Error("Native raw-frame export was cancelled"));
		this.notifyEncodeCapacityAvailable();
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.audioProcessor) {
			this.audioProcessor.cancel();
		}
		this.disposeNativeH264Encoder();

		const nativeExportSessionId = this.nativeExportSessionId;
		this.nativeExportSessionId = null;
		if (nativeExportSessionId && typeof window !== "undefined") {
			void window.electronAPI?.nativeVideoExportCancel?.(nativeExportSessionId);
		}

		const nativeStaticLayoutSessionId = this.nativeStaticLayoutSessionId;
		this.nativeStaticLayoutSessionId = null;
		if (nativeStaticLayoutSessionId && typeof window !== "undefined") {
			void window.electronAPI?.nativeStaticLayoutExportCancel?.(nativeStaticLayoutSessionId);
		}

		const deferredEditedAudioStreamId = this.deferredEditedAudioStreamId;
		this.deferredEditedAudioStreamId = null;
		if (deferredEditedAudioStreamId && typeof window !== "undefined") {
			// Abort the renderer-streamed audio payload so main's bounded mux wait
			// cannot hang on a cancelled export; the audio render itself is stopped
			// via audioProcessor.cancel() above.
			void window.electronAPI?.closeExportStream?.(deferredEditedAudioStreamId, {
				abort: true,
			});
		}
	}

	private cleanup(): void {
		this.disposeEncoder();

		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		if (this.muxer) {
			try {
				this.muxer.destroy();
			} catch (e) {
				console.warn("Error destroying muxer:", e);
			}
		}

		this.muxer = null;
		this.audioProcessor?.cancel();
		this.audioProcessor = null;
		this.disposeNativeH264Encoder();
		const nativeExportSessionId = this.nativeExportSessionId;
		this.nativeExportSessionId = null;
		if (nativeExportSessionId && typeof window !== "undefined") {
			void window.electronAPI?.nativeVideoExportCancel?.(nativeExportSessionId);
		}
		const deferredEditedAudioStreamId = this.deferredEditedAudioStreamId;
		this.deferredEditedAudioStreamId = null;
		if (deferredEditedAudioStreamId && typeof window !== "undefined") {
			void window.electronAPI?.closeExportStream?.(deferredEditedAudioStreamId, {
				abort: true,
			});
		}
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		this.exportStartTimeMs = 0;
		this.lastThroughputLogTimeMs = 0;
		this.totalExportStartTimeMs = 0;
		this.metadataLoadTimeMs = 0;
		this.rendererInitTimeMs = 0;
		this.nativeSessionStartTimeMs = 0;
		this.decodeLoopTimeMs = 0;
		this.frameCallbackTimeMs = 0;
		this.renderFrameTimeMs = 0;
		this.encodeWaitTimeMs = 0;
		this.encodeWaitEvents = 0;
		this.encoderError = null;
		this.peakEncodeQueueSize = 0;
		this.peakNativeWriteInFlight = 0;
		this.nativeCaptureTimeMs = 0;
		this.nativeWriteTimeMs = 0;
		this.nativeWriteAckTimeMs = 0;
		this.nativeFrameTransportTimeMs = 0;
		this.nativeRawBytesSubmitted = 0;
		this.nativeRawFramesSubmitted = 0;
		this.peakNativeWriteInFlightBytes = 0;
		this.finalizationTimeMs = 0;
		this.finalizationStageMs = {};
		this.effectiveDurationSec = 0;
		this.processedFrameCount = 0;
		this.activeFinalizationProgressWatchdog = null;
		this.lastFinalizationRenderProgress =
			INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
		this.lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
		this.lastProgressSampleTimeMs = 0;
		this.lastProgressSampleFrame = 0;
		this.displayedRenderFps = 0;
		this.lastPreparingTotalFrames = null;
		this.nativeWritePromises = new Set();
		this.nativeRawWritePromises = new Set();
		this.nativeRawBackpressure = null;
		this.maxNativeRawWriteFrames = 1;
		this.maxNativeRawWriteBytes = 0;
		this.nativeTransportMode = null;
		this.nativeTransportFallbackReason = null;
		this.nativeWriteError = null;
		this.pendingNativeWriteChunks = [];
		this.pendingNativeWriteBytes = 0;
		this.maxNativeWriteInFlight = 1;
		this.notifyEncodeCapacityAvailable();
		this.encodeCapacityWaiters.clear();
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
		this.renderBackend = null;
		this.encodeBackend = null;
		this.encoderName = null;
		this.nativeStaticLayoutAverageFps = null;
		this.nativeStaticLayoutFpsSource = null;
		this.backpressureProfile = null;
		this.nativeRawFrameMode = false;
		this.lastNativeExportError = null;
	}
}
