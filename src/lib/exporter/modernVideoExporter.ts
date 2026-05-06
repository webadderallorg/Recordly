import type {
	AnnotationRegion,
	AudioRegion,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	CursorTelemetryPoint,
	Padding,
	SpeedRegion,
	TrimRegion,
	WebcamOverlaySettings,
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
import { buildNativeCursorAtlas } from "@/components/video-editor/videoPlayback/cursorRenderer";
import { computePaddedLayout } from "@/components/video-editor/videoPlayback/layoutUtils";
import {
	createSpringState,
	getZoomSpringConfig,
	resetSpringState,
	stepSpringValue,
} from "@/components/video-editor/videoPlayback/motionSmoothing";
import { getCursorStyleSizeMultiplier } from "@/components/video-editor/videoPlayback/uploadedCursorAssets";
import { findDominantRegion } from "@/components/video-editor/videoPlayback/zoomRegionUtils";
import {
	computeFocusFromTransform,
	computeZoomTransform,
} from "@/components/video-editor/videoPlayback/zoomTransform";
import {
	getWebcamOverlayPosition,
	getWebcamOverlaySizePx,
} from "@/components/video-editor/webcamOverlay";
import { extensionHost } from "@/lib/extensions";
import { getEffectiveVideoStreamDurationSeconds } from "@/lib/mediaTiming";
import { DEFAULT_WALLPAPER_RELATIVE_PATH, isVideoWallpaperSource } from "@/lib/wallpapers";
import { AudioProcessor, isAacAudioEncodingSupported } from "./audioEncoder";
import {
	getDefaultLightningRenderBackend,
	normalizeLightningRuntimePlatform,
} from "./backendPolicy";
import { buildEditedTrackSourceSegments, classifyEditedTrackStrategy } from "./editedTrackStrategy";
import {
	type ExportBackpressureProfile,
	getExportBackpressureProfile,
	getPreferredWebCodecsLatencyModes,
	getWebCodecsEncodeQueueLimit,
	getWebCodecsKeyFrameInterval,
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
import { roundNativeStaticLayoutContentSize } from "./nativeStaticLayoutGeometry";
import { buildNativeStaticLayoutCursorTelemetry } from "./nativeStaticLayoutTelemetry";
import { type DecodedVideoInfo, StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportConfig,
	ExportEncodeBackend,
	ExportFfmpegAudioMuxBreakdown,
	ExportFinalizationStageMetrics,
	ExportMetrics,
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
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorClickBounceDuration?: number;
	cursorSway?: number;
	zoomSmoothness?: number;
	zoomClassicMode?: boolean;
	frame?: string | null;
	audioRegions?: AudioRegion[];
	sourceAudioFallbackPaths?: string[];
	sourceAudioFallbackStartDelayMsByPath?: Record<string, number>;
	previewWidth?: number;
	previewHeight?: number;
	onProgress?: (progress: ExportProgress) => void;
	preferredEncoderPath?: SupportedMp4EncoderPath | null;
}

type NativeAudioPlan =
	| {
			audioMode: "none";
	  }
	| {
			audioMode: "copy-source" | "trim-source";
			audioSourcePath: string;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
	  }
	| {
			audioMode: "edited-track";
			strategy: "offline-render-fallback";
	  }
	| {
			audioMode: "edited-track";
			strategy: "filtergraph-fast-path";
			audioSourcePath: string;
			audioSourceSampleRate: number;
			editedTrackSegments: Array<{ startMs: number; endMs: number; speed: number }>;
	  };

const FILTERGRAPH_FALLBACK_AUDIO_SAMPLE_RATE = 48_000;

type NativeStaticLayoutTimelineSegment = {
	sourceStartMs: number;
	sourceEndMs: number;
	outputStartMs: number;
	outputEndMs: number;
	speed: number;
};

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
	  }
	| {
			backgroundColor: string;
			backgroundImagePath: string;
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
};

const NATIVE_EXPORT_ENGINE_NAME = "Breeze";
const LIGHTNING_PIPELINE_NAME = "Lightning (Beta)";
const STATIC_LAYOUT_CHUNK_DURATION_SEC = 120;
const MISSING_NATIVE_WALLPAPER_FALLBACK_COLOR = "#ffffff";
const NATIVE_STATIC_LAYOUT_MAX_EXTRACTING_PROGRESS = 95;
const NATIVE_STATIC_LAYOUT_FRAME_COMPLETE_PROGRESS = 96;

export class ModernVideoExporter {
	private static readonly NATIVE_ENCODER_QUEUE_LIMIT = 32;

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
	private nativePendingWrite: Promise<void> = Promise.resolve();
	private nativeWritePromises = new Set<Promise<void>>();
	private nativeWriteError: Error | null = null;
	private maxNativeWriteInFlight = 1;
	private lastNativeExportError: string | null = null;
	private nativeStaticLayoutSkipReason: string | null = null;
	private nativeH264Encoder: VideoEncoder | null = null;
	private nativeEncoderError: Error | null = null;
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
	private finalizationTimeMs = 0;
	private finalizationStageMs: ExportFinalizationStageMetrics = {};
	private processedFrameCount = 0;
	private activeFinalizationProgressWatchdog: FinalizationProgressWatchdog | null = null;
	private lastFinalizationRenderProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
	private lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
	private lastProgressSampleTimeMs = 0;
	private lastProgressSampleFrame = 0;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;
			this.encoderError = null;
			this.nativeEncoderError = null;
			this.nativeStaticLayoutSkipReason = null;
			this.totalExportStartTimeMs = this.getNowMs();
			const backendPreference = this.config.backendPreference ?? "auto";
			let useNativeEncoder = false;
			let triedNativeStaticLayoutWithProbe = false;
			const shouldDeferNativeEncoderStart = backendPreference === "breeze";
			this.lastNativeExportError = null;

			let stageStartedAt = this.getNowMs();
			if (backendPreference === "breeze") {
				// Defer the streaming native encoder until after metadata is known.
				// Static-layout exports can then use the faster Windows D3D compositor
				// instead of unnecessarily rendering every frame through JS first.
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
			this.maxNativeWriteInFlight = useNativeEncoder
				? Math.max(
						1,
						Math.floor(
							this.config.maxInFlightNativeWrites ??
								this.backpressureProfile.maxInFlightNativeWrites,
						),
					)
				: 1;

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
			});

			if (
				(backendPreference === "auto" || backendPreference === "breeze") &&
				!useNativeEncoder
			) {
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
					);
					if (staticLayoutResult) {
						this.disposeEncoder();
						return staticLayoutResult;
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
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
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
				(backendPreference === "auto" || backendPreference === "breeze") &&
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
				stageStartedAt = this.getNowMs();
				useNativeEncoder = await this.tryStartNativeVideoExport();
				this.nativeSessionStartTimeMs = this.getNowMs() - stageStartedAt;
				if (!useNativeEncoder) {
					throw new Error(
						this.lastNativeExportError ??
							`${NATIVE_EXPORT_ENGINE_NAME} export is unavailable for this output profile on this system.`,
					);
				}
			}

			stageStartedAt = this.getNowMs();
			this.renderer = new ModernFrameRenderer({
				width: this.config.width,
				height: this.config.height,
				// WebGPU + direct VideoFrame textures can flicker during raw-recording startup
				// on some machines. Keep default Lightning renders on stable WebGL unless a
				// caller opts into an explicit experimental renderer.
				preferredRenderBackend:
					this.config.preferredRenderBackend ?? getDefaultLightningRenderBackend(),
				wallpaper: this.config.wallpaper,
				zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow,
				shadowIntensity: this.config.shadowIntensity,
				backgroundBlur: this.config.backgroundBlur,
				zoomMotionBlur: this.config.zoomMotionBlur,
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
				cursorMotionBlur: this.config.cursorMotionBlur,
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
				this.muxer = new VideoMuxer(this.config, hasAudio && !shouldUseFfmpegAudioFallback);
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
			const decodeLoopStartedAt = this.getNowMs();

			await this.streamingDecoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
					const callbackStartedAt = this.getNowMs();
					if (this.cancelled) {
						videoFrame.close();
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
					videoFrame.close();

					if (this.cancelled) {
						return;
					}

					if (useNativeEncoder) {
						await this.encodeRenderedFrameNative(timestamp, frameDuration, frameIndex);
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
				if (this.nativeH264Encoder) {
					await this.measureFinalizationStage("nativeEncoderFlushMs", async () => {
						await this.nativeH264Encoder!.flush();
					});
				}
				const finishResult = await this.finishNativeVideoExport(nativeAudioPlan);
				this.finalizationTimeMs = this.getNowMs() - stageStartedAt;
				if (!finishResult.success || (!finishResult.tempFilePath && !finishResult.blob)) {
					return {
						success: false,
						error: finishResult.error || `${NATIVE_EXPORT_ENGINE_NAME} export failed`,
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
					await this.awaitWithFinalizationTimeout(this.encoder!.flush(), "encoder flush");
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
							),
							"audio processing",
							"audio",
							true,
						);
					});
				}
			}

			this.reportFinalizingProgress(totalFrames, 99);
			const muxerResult = await this.measureFinalizationStage("muxerFinalizeMs", async () =>
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
		} finally {
			if (this.totalExportStartTimeMs > 0) {
				console.log(
					`[VideoExporter] Final metrics ${JSON.stringify(this.buildExportMetrics())}`,
				);
			}
			this.cleanup();
		}
	}

	private getPlatformLabel(): string {
		if (typeof navigator === "undefined") {
			return "Unknown";
		}

		const platformHint = navigator.platform || navigator.userAgent || "";
		switch (normalizeLightningRuntimePlatform(platformHint)) {
			case "win32":
				return "Windows";
			case "linux":
				return "Linux";
			case "darwin":
				return "macOS";
			default:
				return platformHint || "Unknown";
		}
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
			`Requested backend mode: ${this.config.backendPreference ?? "auto"}`,
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
		return buildEditedTrackSourceSegments(
			sourceDurationMs,
			this.config.trimRegions ?? [],
			this.config.speedRegions ?? [],
		);
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

	private buildNativeAudioPlan(videoInfo: DecodedVideoInfo): NativeAudioPlan {
		const speedRegions = this.config.speedRegions ?? [];
		const audioRegions = this.config.audioRegions ?? [];
		const sourceAudioFallbackPaths = (this.config.sourceAudioFallbackPaths ?? []).filter(
			(audioPath) => typeof audioPath === "string" && audioPath.trim().length > 0,
		);
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
			hasTimedSourceAudioFallback
		) {
			const sourceDurationMs = Math.max(
				0,
				Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
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
			const strategy = canUsePrimaryAudioFiltergraph
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
						audioSourceSampleRate,
						editedTrackSegments,
					};
				}
			}

			return {
				audioMode: "edited-track",
				strategy: "offline-render-fallback",
			};
		}

		if (!primaryAudioSourcePath) {
			return {
				audioMode: "edited-track",
				strategy: "offline-render-fallback",
			};
		}

		if ((this.config.trimRegions ?? []).length > 0) {
			const sourceDurationMs = Math.max(
				0,
				Math.round((videoInfo.streamDuration ?? videoInfo.duration) * 1000),
			);
			const trimSegments = this.buildNativeTrimSegments(sourceDurationMs);
			if (trimSegments.length === 0) {
				return { audioMode: "none" };
			}

			return {
				audioMode: "trim-source",
				audioSourcePath: primaryAudioSourcePath,
				trimSegments,
			};
		}

		return {
			audioMode: "copy-source",
			audioSourcePath: primaryAudioSourcePath,
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

	private canUseNativeStaticLayoutAudioPlan(
		audioPlan: NativeAudioPlan,
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): boolean {
		switch (audioPlan.audioMode) {
			case "none":
			case "copy-source":
				return true;
			case "trim-source":
				return this.canUseNativeStaticTailTrim(videoInfo, effectiveDurationSec);
			case "edited-track":
				return (
					audioPlan.strategy === "offline-render-fallback" ||
					audioPlan.strategy === "filtergraph-fast-path"
				);
		}
	}

	private getNativeStaticLayoutSkipReason(
		audioPlan: NativeAudioPlan,
		videoInfo: DecodedVideoInfo,
		effectiveDurationSec: number,
	): string | null {
		if (
			typeof window === "undefined" ||
			!window.electronAPI?.nativeStaticLayoutExport ||
			!window.electronAPI?.nativeStaticLayoutExportCancel
		) {
			return "native-static-api-unavailable";
		}

		if (this.config.width % 2 !== 0 || this.config.height % 2 !== 0) {
			return "odd-output-dimensions";
		}

		if (!this.canUseNativeStaticLayoutAudioPlan(audioPlan, videoInfo, effectiveDurationSec)) {
			return `unsupported-audio-mode:${audioPlan.audioMode}`;
		}

		const trimRegions = this.config.trimRegions ?? [];
		const speedRegions = this.config.speedRegions ?? [];
		const hasZoomRegions = (this.config.zoomRegions ?? []).length > 0;
		if (
			speedRegions.length > 0 &&
			this.buildNativeStaticLayoutVideoTimelineSegments(videoInfo).length === 0
		) {
			return "unsupported-native-speed-timeline";
		}
		if (
			(trimRegions.length > 0 &&
				!this.canUseNativeStaticTailTrim(videoInfo, effectiveDurationSec)) ||
			(hasZoomRegions && this.config.experimentalNativeExport !== true) ||
			(this.config.annotationRegions ?? []).length > 0 ||
			(this.config.autoCaptions ?? []).length > 0
		) {
			return "timeline-edits-present";
		}

		if (this.config.webcam?.enabled && !this.getNativeWebcamSourcePath()) {
			return "unsupported-webcam-source";
		}

		if (this.config.frame) {
			return "unsupported-frame-overlay";
		}

		if (this.config.backgroundBlur > 0) {
			return "unsupported-background-blur";
		}

		return this.isDefaultCropRegion() ? null : "non-default-crop";
	}

	private async resolveNativeStaticLayoutBackground(): Promise<NativeStaticLayoutBackground | null> {
		const wallpaper = this.config.wallpaper?.trim() ?? "";
		if (/^#?[0-9a-f]{6}$/i.test(wallpaper)) {
			return {
				backgroundColor: wallpaper.startsWith("#") ? wallpaper : `#${wallpaper}`,
				backgroundImagePath: null,
			};
		}

		if (
			!wallpaper ||
			isVideoWallpaperSource(wallpaper) ||
			wallpaper.startsWith("data:") ||
			wallpaper.startsWith("blob:") ||
			wallpaper.startsWith("http") ||
			wallpaper.startsWith("linear-gradient") ||
			wallpaper.startsWith("radial-gradient")
		) {
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
		return localPath ? { backgroundColor: "#101010", backgroundImagePath: localPath } : null;
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
					this.config.sourceAudioFallbackPaths,
					this.config.sourceAudioFallbackStartDelayMsByPath,
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

	private async getNativeStaticLayoutAudioOptions(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	) {
		switch (audioPlan.audioMode) {
			case "none":
				return { audioMode: "none" as const };
			case "copy-source":
			case "trim-source":
				return {
					audioMode: audioPlan.audioMode,
					audioSourcePath: audioPlan.audioSourcePath,
					trimSegments: audioPlan.trimSegments,
				};
			case "edited-track": {
				if (audioPlan.strategy === "filtergraph-fast-path") {
					return {
						audioMode: audioPlan.audioMode,
						audioSourcePath: audioPlan.audioSourcePath,
						audioSourceSampleRate: audioPlan.audioSourceSampleRate,
						editedTrackStrategy: audioPlan.strategy,
						editedTrackSegments: audioPlan.editedTrackSegments,
					};
				}

				const renderedAudio = await this.renderEditedAudioForNativeMux(
					"Native static-layout edited audio rendering",
					(progress) =>
						this.reportProgress(0, totalFrames, "preparing", undefined, progress),
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
			sizePercent: webcam.size ?? 40,
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
		const samples: NativeStaticLayoutZoomSample[] = [];
		let lastContentTimeMs: number | null = null;
		let appliedScale = 1;
		let appliedX = 0;
		let appliedY = 0;

		for (let frameIndex = 0; frameIndex < totalFrames; frameIndex += 1) {
			const timeMs = frameIndex * frameDurationMs;
			const { region, strength, blendedScale, transition } = findDominantRegion(
				zoomRegions,
				timeMs,
				{
					connectZooms: this.config.connectZooms,
				},
			);

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

				if (transition) {
					const startTransform = computeZoomTransform({
						stageSize,
						baseMask,
						zoomScale: transition.startScale,
						zoomProgress: 1,
						focusX: transition.startFocus.cx,
						focusY: transition.startFocus.cy,
					});
					const endTransform = computeZoomTransform({
						stageSize,
						baseMask,
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

					targetScale = interpolatedTransform.scale;
					targetFocus = computeFocusFromTransform({
						stageSize,
						baseMask,
						zoomScale: interpolatedTransform.scale,
						x: interpolatedTransform.x,
						y: interpolatedTransform.y,
					});
					targetProgress = 1;
				}
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

			samples.push({
				timeMs,
				scale: appliedScale,
				x: appliedX,
				y: appliedY,
			});
		}

		return samples;
	}

	private async tryExportNativeStaticLayout(
		videoInfo: DecodedVideoInfo,
		audioPlan: NativeAudioPlan,
		effectiveDuration: number,
		totalFrames: number,
	): Promise<ExportResult | null> {
		const skipReason = this.getNativeStaticLayoutSkipReason(
			audioPlan,
			videoInfo,
			effectiveDuration,
		);
		if (skipReason) {
			this.nativeStaticLayoutSkipReason = skipReason;
			console.info("[VideoExporter] Native static layout skipped", {
				reason: skipReason,
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
				experimentalNativeExport: this.config.experimentalNativeExport === true,
			});
			return null;
		}

		const sourcePath = this.getNativeVideoSourcePath();
		const audioOptions = await this.getNativeStaticLayoutAudioOptions(audioPlan, totalFrames);
		if (!sourcePath || !audioOptions) {
			this.nativeStaticLayoutSkipReason = !sourcePath
				? "missing-source-path"
				: "missing-audio-options";
			return null;
		}
		const background = await this.resolveNativeStaticLayoutBackground();
		if (!background) {
			this.nativeStaticLayoutSkipReason = "unsupported-background";
			return null;
		}

		const layout = computePaddedLayout({
			width: this.config.width,
			height: this.config.height,
			padding: this.config.padding ?? 0,
			cropRegion: this.config.cropRegion,
			videoWidth: videoInfo.width,
			videoHeight: videoInfo.height,
		});
		const contentSize = roundNativeStaticLayoutContentSize({
			width: layout.fullVideoDisplayWidth,
			height: layout.fullVideoDisplayHeight,
		});
		const contentWidth = contentSize.width;
		const contentHeight = contentSize.height;
		if (
			contentWidth > this.config.width ||
			contentHeight > this.config.height ||
			!Number.isFinite(effectiveDuration) ||
			effectiveDuration <= 0
		) {
			this.nativeStaticLayoutSkipReason = "invalid-layout-or-duration";
			return null;
		}

		const offsetX = Math.round(
			layout.centerOffsetX + layout.croppedDisplayWidth / 2 - contentWidth / 2,
		);
		const offsetY = Math.round(
			layout.centerOffsetY + layout.croppedDisplayHeight / 2 - contentHeight / 2,
		);
		const previewWidth = this.config.previewWidth || 1920;
		const previewHeight = this.config.previewHeight || 1080;
		const canvasScaleFactor = Math.min(
			this.config.width / previewWidth,
			this.config.height / previewHeight,
		);
		const borderRadius = Math.max(0, (this.config.borderRadius ?? 0) * canvasScaleFactor);
		const shadowIntensity = this.config.showShadow
			? Math.min(1, Math.max(0, this.config.shadowIntensity))
			: 0;
		const webcamOverlay = this.getNativeStaticLayoutWebcamOverlay();
		const cursorTelemetry = this.getNativeStaticLayoutCursorTelemetry();
		const zoomTelemetry = this.getNativeStaticLayoutZoomTelemetry(
			layout,
			totalFrames,
			cursorTelemetry,
		);
		const timelineSegments =
			(this.config.speedRegions ?? []).length > 0
				? this.buildNativeStaticLayoutVideoTimelineSegments(videoInfo)
				: undefined;
		if ((this.config.speedRegions ?? []).length > 0 && !timelineSegments?.length) {
			this.nativeStaticLayoutSkipReason = "invalid-native-speed-timeline";
			return null;
		}
		const cursorAtlas =
			cursorTelemetry && cursorTelemetry.length > 0
				? await buildNativeCursorAtlas(this.config.cursorStyle ?? "tahoe").catch(
						(error) => {
							console.warn("[VideoExporter] Native cursor atlas unavailable", error);
							return null;
						},
					)
				: null;
		if (cursorTelemetry && cursorTelemetry.length > 0 && !cursorAtlas) {
			this.nativeStaticLayoutSkipReason = "cursor-atlas-unavailable";
			return null;
		}
		const startedAt = this.getNowMs();
		const sessionId = `recordly-static-layout-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;
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
		this.nativeStaticLayoutSessionId = sessionId;
		this.nativeStaticLayoutSkipReason = null;
		this.nativeStaticLayoutAverageFps = null;
		this.encodeBackend = "ffmpeg";
		const runtimePlatform =
			typeof navigator !== "undefined"
				? normalizeLightningRuntimePlatform(navigator.userAgent)
				: "unknown";
		this.encoderName =
			this.config.experimentalNativeExport === true && runtimePlatform === "win32"
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
					this.processedFrameCount = 0;
					this.reportProgress(0, totalFrames, "preparing");
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
				this.nativeStaticLayoutAverageFps =
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
				this.processedFrameCount = currentFrame;
				if (progress.stage === "finalizing" || nativeFramesComplete) {
					this.reportFinalizingProgress(totalFrames, nativeFinalizingProgress);
				} else {
					this.reportProgress(currentFrame, totalFrames, "extracting");
				}
			},
		);

		try {
			const result = await window.electronAPI.nativeStaticLayoutExport({
				sessionId,
				inputPath: sourcePath,
				width: this.config.width,
				height: this.config.height,
				frameRate: this.config.frameRate,
				bitrate: this.config.bitrate,
				encodingMode: this.config.encodingMode ?? "balanced",
				durationSec: effectiveDuration,
				contentWidth,
				contentHeight,
				offsetX,
				offsetY,
				backgroundColor: background.backgroundColor,
				backgroundImagePath: background.backgroundImagePath ?? null,
				borderRadius,
				shadowIntensity,
				webcamInputPath: webcamOverlay?.inputPath ?? null,
				webcamLeft: webcamOverlay?.left,
				webcamTop: webcamOverlay?.top,
				webcamSize: webcamOverlay?.size,
				webcamRadius: webcamOverlay?.radius,
				webcamShadowIntensity: webcamOverlay?.shadowIntensity,
				webcamMirror: webcamOverlay?.mirror,
				webcamTimeOffsetMs: webcamOverlay?.timeOffsetMs,
				cursorTelemetry,
				cursorSize: this.getNativeStaticLayoutCursorSize(contentWidth),
				cursorAtlasPngDataUrl: cursorAtlas?.dataUrl ?? null,
				cursorAtlasEntries: cursorAtlas?.entries,
				zoomTelemetry,
				timelineSegments,
				chunkDurationSec: STATIC_LAYOUT_CHUNK_DURATION_SEC,
				experimentalWindowsGpuCompositor: this.config.experimentalNativeExport === true,
				audioOptions: {
					...audioOptions,
					outputDurationSec: effectiveDuration,
				},
			});

			if (this.cancelled) {
				return {
					success: false,
					error: "Export cancelled",
					metrics: this.buildExportMetrics(),
				};
			}

			if (!result.success || !result.tempPath) {
				console.warn("[VideoExporter] Native static layout export unavailable", {
					error: result.error,
				});
				restoreEncoderState();
				return null;
			}

			const elapsedMs = this.getNowMs() - startedAt;
			this.encoderName = result.encoderName ?? "static-layout-h264-nvenc";
			this.nativeStaticLayoutAverageFps = null;
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

			console.warn("[VideoExporter] Native static layout export failed; falling back", error);
			this.nativeStaticLayoutSkipReason = "native-static-runtime-failed";
			restoreEncoderState();
			return null;
		} finally {
			unsubscribeNativeProgress?.();
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
		this.lastNativeExportError = null;
		this.encodeBackend = "ffmpeg";
		this.encoderName = "h264-stream-copy";
		this.nativePendingWrite = Promise.resolve();

		const sessionId = result.sessionId;
		const encoder = new VideoEncoder({
			output: (chunk) => {
				if (this.cancelled || !this.nativeExportSessionId) {
					return;
				}

				const buffer = new ArrayBuffer(chunk.byteLength);
				chunk.copyTo(buffer);
				const writePromise = this.nativePendingWrite
					.then(() =>
						window.electronAPI.nativeVideoExportWriteFrame(
							sessionId,
							new Uint8Array(buffer),
						),
					)
					.then((writeResult) => {
						if (!writeResult.success && !this.cancelled) {
							throw new Error(
								writeResult.error ||
									"Failed to write H.264 chunk to native encoder",
							);
						}
					})
					.catch((error) => {
						if (!this.cancelled) {
							const resolvedError =
								error instanceof Error ? error : new Error(String(error));
							if (!this.nativeEncoderError) {
								this.nativeEncoderError = resolvedError;
							}
							if (!this.nativeWriteError) {
								this.nativeWriteError = resolvedError;
							}
						}
						throw error;
					});
				this.nativePendingWrite = writePromise;

				this.trackNativeWritePromise(writePromise);
			},
			error: (error) => {
				this.nativeEncoderError = error;
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

	private async encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void> {
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
			await new Promise<void>((r) => setTimeout(r, 2));
			if (this.cancelled) return;
			if (this.nativeEncoderError) throw this.nativeEncoderError;
		}
		const canvas = this.renderer!.getCanvas();
		const frame = new VideoFrame(canvas, { timestamp, duration: frameDuration });
		this.nativeH264Encoder.encode(frame, { keyFrame: frameIndex % 300 === 0 });
		frame.close();
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
		this.nativePendingWrite = Promise.resolve();

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
			await new Promise((resolve) => setTimeout(resolve, 2));
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

	private reportProgress(
		currentFrame: number,
		totalFrames: number,
		phase: ExportProgress["phase"] = "extracting",
		renderProgress?: number,
		audioProgress?: number,
	) {
		const nowMs = this.getNowMs();
		const elapsedSeconds = Math.max((nowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.lastProgressSampleTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.lastProgressSampleFrame, 0);
		const sampleRenderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		const displayedRenderFps = this.nativeStaticLayoutAverageFps ?? sampleRenderFps;
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
					renderBackend: this.renderBackend ?? undefined,
					encodeBackend: this.encodeBackend ?? undefined,
					encoderName: this.encoderName ?? undefined,
					encoderQueueSize: this.encoder?.encodeQueueSize ?? 0,
					pendingEncodeQueue: this.encodeQueue,
					encodeBacklog: this.getCurrentEncodeBacklog(),
					peakEncodeQueueSize: this.peakEncodeQueueSize,
					nativeWriteInFlight: this.nativeWritePromises.size,
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
				renderBackend: this.renderBackend ?? undefined,
				encodeBackend: this.encodeBackend ?? undefined,
				encoderName: this.encoderName ?? undefined,
				nativeStaticLayoutSkipReason: this.nativeStaticLayoutSkipReason ?? undefined,
				phase,
				renderProgress: safeRenderProgress,
				audioProgress,
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
			finalizationMs: this.finalizationTimeMs,
			frameCount: this.processedFrameCount,
			renderBackend: this.renderBackend ?? undefined,
			encodeBackend: this.encodeBackend ?? undefined,
			encoderName: this.encoderName ?? undefined,
			backpressureProfile: this.backpressureProfile?.name,
			nativeStaticLayoutSkipReason: this.nativeStaticLayoutSkipReason ?? undefined,
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
			this.nativeWritePromises.size,
		);

		void writePromise.finally(() => {
			this.nativeWritePromises.delete(writePromise);
		});
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

	private async awaitPendingNativeWrites(): Promise<void> {
		while (this.nativeWritePromises.size > 0) {
			await this.awaitOldestNativeWrite();
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
			},
			error: (error) => {
				console.error(
					`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${this.config.width}x${this.config.height}):`,
					error,
				);
				this.encoderError = error instanceof Error ? error : new Error(String(error));
				this.cancelled = true;
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
		this.nativeWritePromises = new Set();
		this.nativePendingWrite = Promise.resolve();
		this.nativeWriteError = null;
		this.maxNativeWriteInFlight = 1;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
		this.renderBackend = null;
		this.encodeBackend = null;
		this.encoderName = null;
		this.nativeStaticLayoutAverageFps = null;
		this.backpressureProfile = null;
		this.lastNativeExportError = null;
	}
}
