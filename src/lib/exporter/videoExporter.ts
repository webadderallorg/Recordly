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
import { AudioProcessor, isAacAudioEncodingSupported } from "./audioEncoder";
import { buildEditedTrackSourceSegments, classifyEditedTrackStrategy } from "./editedTrackStrategy";
import {
	advanceFinalizationProgress,
	type FinalizationProgressWatchdog,
	type FinalizationTimeoutWorkload,
	INITIAL_FINALIZATION_PROGRESS_STATE,
	withFinalizationTimeout,
} from "./finalizationTimeout";
import { FrameRenderer } from "./frameRenderer";
import { getLocalFilePath } from "./localMediaSource";
import type { SupportedMp4EncoderPath } from "./mp4Support";
import { VideoMuxer } from "./muxer";
import { type DecodedVideoInfo, StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportConfig,
	ExportFinalizationStageMetrics,
	ExportMetrics,
	ExportProgress,
	ExportResult,
} from "./types";

const DEFAULT_MAX_ENCODE_QUEUE = 240;
const PROGRESS_SAMPLE_WINDOW_MS = 1_000;

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
	videoPadding?: number;
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

export class VideoExporter {
	private config: VideoExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private encoder: VideoEncoder | null = null;
	private muxer: VideoMuxer | null = null;
	private audioProcessor: AudioProcessor | null = null;
	private cancelled = false;
	private encodeQueue = 0;
	private videoDescription: Uint8Array | undefined;
	private videoColorSpace: VideoColorSpaceInit | undefined;
	private pendingMuxing: Promise<void> = Promise.resolve();
	private chunkCount = 0;
	private effectiveDurationSec = 0;
	private exportStartTimeMs = 0;
	private progressSampleStartTimeMs = 0;
	private progressSampleStartFrame = 0;
	private encoderError: Error | null = null;
	private nativeExportSessionId: string | null = null;
	private nativeH264Encoder: VideoEncoder | null = null;
	private nativePendingWrite: Promise<void> = Promise.resolve();
	private nativeWritePromises = new Set<Promise<void>>();
	private nativeWriteError: Error | null = null;
	private maxNativeWriteInFlight = 1;
	private nativeEncoderError: Error | null = null;
	private activeFinalizationProgressWatchdog: FinalizationProgressWatchdog | null = null;
	private lastFinalizationRenderProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
	private lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
	private finalizationTimeMs = 0;
	private finalizationStageMs: ExportFinalizationStageMetrics = {};
	private processedFrameCount = 0;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;
			this.encoderError = null;
			this.nativeEncoderError = null;
			this.nativePendingWrite = Promise.resolve();
			this.nativeWritePromises = new Set();
			this.nativeWriteError = null;
			this.maxNativeWriteInFlight = Math.max(
				1,
				Math.floor(this.config.maxInFlightNativeWrites ?? 1),
			);
			this.exportStartTimeMs = this.getNowMs();
			this.progressSampleStartTimeMs = this.exportStartTimeMs;
			this.progressSampleStartFrame = 0;

			// Initialize streaming decoder and load video metadata
			this.streamingDecoder = new StreamingVideoDecoder({
				maxDecodeQueue: this.config.maxDecodeQueue,
				maxPendingFrames: this.config.maxPendingFrames,
			});
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
			const shouldUseExperimentalNativeExport = this.shouldUseExperimentalNativeExport();
			const audioPlan = this.buildNativeAudioPlan(videoInfo);
			const nativeAudioPlan = shouldUseExperimentalNativeExport ? audioPlan : null;
			let useNativeEncoder = shouldUseExperimentalNativeExport
				? await this.tryStartNativeVideoExport()
				: false;
			const shouldUseFfmpegAudioFallback =
				!useNativeEncoder &&
				audioPlan.audioMode !== "none" &&
				!(await isAacAudioEncodingSupported());

			if (!useNativeEncoder) {
				await this.initializeEncoder();
			}

			// Initialize frame renderer
			this.renderer = new FrameRenderer({
				width: this.config.width,
				height: this.config.height,
				preferredRenderBackend: undefined,
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
				frame: this.config.frame,
			});
			await this.renderer.initialize();

			const hasAudioRegions = (this.config.audioRegions ?? []).length > 0;
			const hasSourceAudioFallback = (this.config.sourceAudioFallbackPaths ?? []).length > 0;
			const hasAudio = videoInfo.hasAudio || hasAudioRegions || hasSourceAudioFallback;

			if (!useNativeEncoder) {
				this.muxer = new VideoMuxer(this.config, hasAudio && !shouldUseFfmpegAudioFallback);
				await this.muxer.initialize();
			}

			// Calculate effective duration and frame count (excluding trim regions)
			const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
			);
			this.effectiveDurationSec = effectiveDuration;
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

			console.log("[VideoExporter] Original duration:", videoInfo.duration, "s");
			console.log("[VideoExporter] Effective duration:", effectiveDuration, "s");
			console.log("[VideoExporter] Total frames to export:", totalFrames);
			console.log("[VideoExporter] Using streaming decode (web-demuxer + VideoDecoder)");
			console.log(
				`[VideoExporter] Using ${useNativeEncoder ? "native ffmpeg" : "WebCodecs"} encode path`,
			);

			const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
			let frameIndex = 0;

			// Stream decode and process frames — no seeking!
			await this.streamingDecoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
					if (this.cancelled) {
						videoFrame.close();
						return;
					}

					const timestamp = frameIndex * frameDuration;
					const sourceTimestampUs = sourceTimestampMs * 1000;
					const cursorTimestampUs = cursorTimestampMs * 1000;
					await this.renderer!.renderFrame(
						videoFrame,
						sourceTimestampUs,
						cursorTimestampUs,
						frameDuration,
						timestamp,
					);
					videoFrame.close();

					if (useNativeEncoder) {
						await this.encodeRenderedFrameNative(timestamp, frameDuration, frameIndex);
					} else {
						await this.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
					}
					frameIndex++;
					this.processedFrameCount = frameIndex;
					this.reportProgress(frameIndex, totalFrames);
				},
			);

			if (this.cancelled) {
				const encoderError = this.encoderError as Error | null;
				if (encoderError) {
					return {
						success: false,
						error: encoderError.message,
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
			const finalizationStartedAt = this.getNowMs();

			if (useNativeEncoder && nativeAudioPlan) {
				if (this.nativeH264Encoder) {
					await this.measureFinalizationStage("nativeEncoderFlushMs", async () => {
						await this.nativeH264Encoder!.flush();
						await this.awaitPendingNativeWrites();
						if (this.nativeEncoderError) {
							throw this.nativeEncoderError;
						}
					});
					this.nativeH264Encoder.close();
					this.nativeH264Encoder = null;
				}
				this.reportFinalizingProgress(totalFrames, 99, 0);
				const result = await this.finishNativeVideoExport(nativeAudioPlan, totalFrames);
				this.finalizationTimeMs = this.getNowMs() - finalizationStartedAt;
				return {
					...result,
					metrics: this.buildExportMetrics(),
				};
			}

			// Finalize encoding
			if (this.encoder && this.encoder.state === "configured") {
				this.reportFinalizingProgress(totalFrames, 97);
				await this.measureFinalizationStage("encoderFlushMs", async () => {
					await this.awaitWithFinalizationTimeout(this.encoder!.flush(), "encoder flush");
				});
			}

			// Wait for queued muxing operations to complete
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

			if (hasAudio && !shouldUseFfmpegAudioFallback && !this.cancelled) {
				const demuxer = this.streamingDecoder.getDemuxer();
				if (demuxer || hasAudioRegions || hasSourceAudioFallback) {
					this.audioProcessor = new AudioProcessor();
					this.audioProcessor.setOnProgress((progress) => {
						this.reportFinalizingProgress(totalFrames, 99, progress);
					});
					this.reportFinalizingProgress(totalFrames, 99, 0);
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

			// Finalize muxer and get output (temp path for streaming, blob for legacy)
			this.reportFinalizingProgress(totalFrames, 99);
			const muxerResult = await this.measureFinalizationStage("muxerFinalizeMs", async () =>
				this.awaitWithFinalizationTimeout(
					this.muxer!.finalize(),
					"muxer finalization",
					hasAudio && !shouldUseFfmpegAudioFallback ? "audio" : "default",
				),
			);

			if (shouldUseFfmpegAudioFallback) {
				console.warn(
					"[VideoExporter] Browser AAC encoding is unavailable; falling back to FFmpeg audio muxing.",
				);
				const result = await this.finalizeExportWithFfmpegAudio(
					muxerResult,
					audioPlan,
					totalFrames,
				);
				this.finalizationTimeMs = this.getNowMs() - finalizationStartedAt;
				return {
					...result,
					metrics: this.buildExportMetrics(),
				};
			}

			this.finalizationTimeMs = this.getNowMs() - finalizationStartedAt;
			if (muxerResult.mode === "stream") {
				return {
					success: true,
					tempFilePath: muxerResult.tempFilePath,
					metrics: this.buildExportMetrics(),
				};
			}
			return { success: true, blob: muxerResult.blob, metrics: this.buildExportMetrics() };
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
				error:
					resolvedError instanceof Error ? resolvedError.message : String(resolvedError),
				metrics: this.buildExportMetrics(),
			};
		} finally {
			this.cleanup();
		}
	}

	private shouldUseExperimentalNativeExport(): boolean {
		return (
			typeof window !== "undefined" &&
			typeof VideoEncoder !== "undefined" &&
			typeof VideoEncoder.isConfigSupported === "function" &&
			typeof window.electronAPI?.nativeVideoExportStart === "function" &&
			typeof window.electronAPI?.nativeVideoExportWriteFrame === "function" &&
			typeof window.electronAPI?.nativeVideoExportFinish === "function" &&
			typeof window.electronAPI?.nativeVideoExportCancel === "function"
		);
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
			const strategy =
				videoInfo.hasAudio &&
				localVideoSourcePath &&
				sourceAudioFallbackPaths.length === 0 &&
				typeof videoInfo.audioSampleRate === "number" &&
				Number.isFinite(videoInfo.audioSampleRate) &&
				videoInfo.audioSampleRate > 0
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
				const audioSourcePath = localVideoSourcePath;
				const audioSourceSampleRate = videoInfo.audioSampleRate;
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

	private async tryStartNativeVideoExport(): Promise<boolean> {
		if (!this.shouldUseExperimentalNativeExport()) {
			return false;
		}

		if (this.config.width % 2 !== 0 || this.config.height % 2 !== 0) {
			console.warn(
				`[VideoExporter] Native export requires even output dimensions, falling back to WebCodecs (${this.config.width}x${this.config.height})`,
			);
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
				console.warn(
					`[VideoExporter] Native H.264 Annex B encoding is unsupported at ${this.config.width}x${this.config.height}`,
				);
				return false;
			}
		} catch (error) {
			console.warn("[VideoExporter] Native encoder support check failed:", error);
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
			console.warn("[VideoExporter] Native export unavailable", result.error);
			return false;
		}

		this.nativeExportSessionId = result.sessionId;
		this.nativePendingWrite = Promise.resolve();
		this.nativeWritePromises = new Set();
		this.nativeWriteError = null;
		this.maxNativeWriteInFlight = Math.max(
			1,
			Math.floor(this.config.maxInFlightNativeWrites ?? 1),
		);

		// Initialize the browser-side H.264 encoder (hardware-accelerated where available).
		// Encoded Annex B chunks are sent over IPC and FFmpeg stream-copies them into MP4.
		const sessionId = result.sessionId;
		const encoder = new VideoEncoder({
			output: (chunk) => {
				if (this.cancelled || !this.nativeExportSessionId) return;
				const buffer = new ArrayBuffer(chunk.byteLength);
				chunk.copyTo(buffer);
				const writePromise = this.nativePendingWrite
					.then(async () => {
						const writeResult = await window.electronAPI.nativeVideoExportWriteFrame(
							sessionId,
							new Uint8Array(buffer),
						);
						if (!writeResult.success && !this.cancelled) {
							throw new Error(
								writeResult.error ||
									"Failed to write H.264 chunk to native encoder",
							);
						}
					})
					.catch((error) => {
						if (!this.cancelled && !this.nativeEncoderError) {
							this.nativeEncoderError =
								error instanceof Error ? error : new Error(String(error));
						}
						if (!this.cancelled && !this.nativeWriteError) {
							this.nativeWriteError =
								error instanceof Error ? error : new Error(String(error));
						}
					});
				this.nativePendingWrite = writePromise;
				this.trackNativeWritePromise(writePromise);
			},
			error: (e) => {
				this.nativeEncoderError = e;
			},
		});

		try {
			encoder.configure(encoderConfig);
		} catch (error) {
			this.nativeEncoderError = error instanceof Error ? error : new Error(String(error));
			try {
				encoder.close();
			} catch (closeError) {
				console.debug(
					"[VideoExporter] Ignoring error closing native encoder after startup failure:",
					closeError,
				);
			}
			this.nativeExportSessionId = null;
			await window.electronAPI.nativeVideoExportCancel(sessionId);
			return false;
		}

		this.nativeH264Encoder = encoder;
		return true;
	}

	private async encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void> {
		if (!this.nativeH264Encoder || !this.nativeExportSessionId) {
			if (this.cancelled) return;
			throw new Error("Native export session is not active");
		}

		if (this.nativeEncoderError) throw this.nativeEncoderError;
		if (this.nativeWriteError) throw this.nativeWriteError;

		while (this.nativeWritePromises.size >= this.maxNativeWriteInFlight && !this.cancelled) {
			await this.awaitOldestNativeWrite();
			if (this.nativeEncoderError) throw this.nativeEncoderError;
			if (this.nativeWriteError) throw this.nativeWriteError;
		}

		// Apply backpressure: don't queue too far ahead of FFmpeg's stdin pipe
		while (
			this.nativeH264Encoder.encodeQueueSize >=
			Math.max(1, Math.floor(this.config.maxEncodeQueue ?? DEFAULT_MAX_ENCODE_QUEUE))
		) {
			await new Promise<void>((r) => setTimeout(r, 2));
			if (this.cancelled) return;
			if (this.nativeEncoderError) throw this.nativeEncoderError;
			if (this.nativeWriteError) throw this.nativeWriteError;
		}

		const canvas = this.renderer!.getCanvas();
		// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
		const frame = new VideoFrame(canvas, {
			timestamp,
			duration: frameDuration,
			colorSpace: {
				primaries: "bt709",
				transfer: "iec61966-2-1",
				matrix: "rgb",
				fullRange: true,
			},
		});
		this.nativeH264Encoder.encode(frame, { keyFrame: frameIndex % 300 === 0 });
		frame.close();
	}

	private async finishNativeVideoExport(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<ExportResult> {
		if (!this.nativeExportSessionId) {
			return { success: false, error: "Native export session is not active" };
		}

		let editedAudioBuffer: ArrayBuffer | undefined;
		let editedAudioMimeType: string | null = null;

		if (
			audioPlan.audioMode === "edited-track" &&
			audioPlan.strategy === "offline-render-fallback"
		) {
			this.audioProcessor = new AudioProcessor();
			this.audioProcessor.setOnProgress((progress) => {
				this.reportFinalizingProgress(totalFrames, 99, progress);
			});
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
					"native edited audio rendering",
					"audio",
					true,
				),
			);
			editedAudioBuffer = await audioBlob.arrayBuffer();
			editedAudioMimeType = audioBlob.type || null;
		}

		const sessionId = this.nativeExportSessionId;
		this.nativeExportSessionId = null;

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
					audioSourceSampleRate:
						audioPlan.audioMode === "edited-track" &&
						audioPlan.strategy === "filtergraph-fast-path"
							? audioPlan.audioSourceSampleRate
							: undefined,
					editedAudioData: editedAudioBuffer,
					editedAudioMimeType,
				}),
				"native export finalization",
				audioPlan.audioMode === "none" ? "default" : "audio",
			),
		);
		if (result.metrics) {
			this.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
		}

		if (!result.success || !result.tempPath) {
			return {
				success: false,
				error: result.error || "Failed to finalize native video export",
				metrics: this.buildExportMetrics(),
			};
		}

		return {
			success: true,
			tempFilePath: result.tempPath,
			metrics: this.buildExportMetrics(),
		};
	}

	private async finalizeExportWithFfmpegAudio(
		videoSource: import("./muxer").MuxerFinalizeResult,
		audioPlan: NativeAudioPlan,
		totalFrames: number,
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
			this.audioProcessor = new AudioProcessor();
			this.audioProcessor.setOnProgress((progress) => {
				this.reportFinalizingProgress(totalFrames, 99, progress);
			});
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
					"ffmpeg edited audio rendering",
					"audio",
					true,
				),
			);
			editedAudioBuffer = await audioBlob.arrayBuffer();
			editedAudioMimeType = audioBlob.type || null;
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
					"ffmpeg audio muxing",
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
				"ffmpeg audio muxing",
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
				metrics: this.buildExportMetrics(),
			};
		}

		// Returning a temp path (instead of buffering the muxed bytes back into
		// the renderer) is what keeps >2 GiB exports off Node's fs.readFile cap.
		return {
			success: true,
			tempFilePath: result.tempPath,
			metrics: this.buildExportMetrics(),
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
			this.encoder.encodeQueueSize >=
				Math.max(1, Math.floor(this.config.maxEncodeQueue ?? DEFAULT_MAX_ENCODE_QUEUE)) &&
			!this.cancelled
		) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		if (this.encoder && this.encoder.state === "configured") {
			this.encodeQueue++;
			this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
		} else {
			console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
		}

		exportFrame.close();
	}

	private trackNativeWritePromise(writePromise: Promise<void>): void {
		this.nativeWritePromises.add(writePromise);

		void writePromise.finally(() => {
			this.nativeWritePromises.delete(writePromise);
		});
	}

	private async awaitOldestNativeWrite(): Promise<void> {
		const oldestWritePromise = this.nativeWritePromises.values().next().value;
		if (!oldestWritePromise) {
			return;
		}

		await this.awaitWithFinalizationTimeout(oldestWritePromise, "native frame write");

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
		this.reportProgress(totalFrames, totalFrames, "finalizing", renderProgress, audioProgress);
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
		const sampleElapsedMs = Math.max(nowMs - this.progressSampleStartTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.progressSampleStartFrame, 0);
		const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		const remainingFrames = Math.max(totalFrames - currentFrame, 0);
		const estimatedTimeRemaining =
			averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
		const safeRenderProgress =
			phase === "finalizing" ? Math.max(0, Math.min(renderProgress ?? 100, 100)) : undefined;
		const percentage =
			phase === "finalizing"
				? (safeRenderProgress ?? 100)
				: totalFrames > 0
					? (currentFrame / totalFrames) * 100
					: 100;

		if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
			this.progressSampleStartTimeMs = nowMs;
			this.progressSampleStartFrame = currentFrame;
		}

		if (this.config.onProgress) {
			this.config.onProgress({
				currentFrame,
				totalFrames,
				percentage,
				estimatedTimeRemaining,
				renderFps,
				phase,
				renderProgress: safeRenderProgress,
				audioProgress:
					typeof audioProgress === "number"
						? Math.max(0, Math.min(audioProgress, 1))
						: undefined,
			});
		}
	}

	private getNowMs(): number {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
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

	private buildExportMetrics(): ExportMetrics {
		const totalElapsedMs =
			this.exportStartTimeMs > 0 ? this.getNowMs() - this.exportStartTimeMs : 0;
		const hasFinalizationStageMetrics = Object.keys(this.finalizationStageMs).length > 0;

		return {
			totalElapsedMs,
			finalizationMs: this.finalizationTimeMs || undefined,
			frameCount: this.processedFrameCount || undefined,
			effectiveDurationSec: this.effectiveDurationSec || undefined,
			finalizationStageMs: hasFinalizationStageMetrics ? this.finalizationStageMs : undefined,
		};
	}

	private async initializeEncoder(): Promise<void> {
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		let videoDescription: Uint8Array | undefined;

		// Ordered from most capable to most compatible. avc1.PPCCLL where PP=profile, CC=constraints, LL=level.
		// High 5.1 → Main 5.1 → Baseline 5.1 → Main 3.1 → Baseline 3.1
		const CODEC_FALLBACK_LIST = this.config.codec
			? [this.config.codec]
			: ["avc1.640033", "avc1.4d4033", "avc1.420033", "avc1.4d401f", "avc1.42001f"];

		let resolvedCodec: string | null = null;

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

		const baseConfig: Omit<VideoEncoderConfig, "codec" | "hardwareAcceleration"> = {
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			latencyMode: "quality",
			bitrateMode: "variable",
		};

		for (const candidateCodec of CODEC_FALLBACK_LIST) {
			const hwConfig: VideoEncoderConfig = {
				...baseConfig,
				codec: candidateCodec,
				hardwareAcceleration: "prefer-hardware",
			};
			const hwSupport = await VideoEncoder.isConfigSupported(hwConfig);
			if (hwSupport.supported) {
				resolvedCodec = candidateCodec;
				console.log(
					`[VideoExporter] Using hardware acceleration with codec ${candidateCodec}`,
				);
				this.encoder.configure(hwConfig);
				return;
			}

			const swConfig: VideoEncoderConfig = {
				...baseConfig,
				codec: candidateCodec,
				hardwareAcceleration: "prefer-software",
			};
			const swSupport = await VideoEncoder.isConfigSupported(swConfig);
			if (swSupport.supported) {
				resolvedCodec = candidateCodec;
				console.log(`[VideoExporter] Using software encoding with codec ${candidateCodec}`);
				this.encoder.configure(swConfig);
				return;
			}

			console.warn(
				`[VideoExporter] Codec ${candidateCodec} not supported (${this.config.width}x${this.config.height}), trying next...`,
			);
		}

		throw new Error(
			`Video encoding not supported on this system. ` +
				`Tried codecs: ${CODEC_FALLBACK_LIST.join(", ")} at ${this.config.width}x${this.config.height}. ` +
				`Your browser or hardware may not support H.264 encoding at this resolution. ` +
				`Try exporting at a lower quality setting.`,
		);
	}

	cancel(): void {
		this.cancelled = true;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.audioProcessor) {
			this.audioProcessor.cancel();
		}
		this.cleanup();
	}

	private cleanup(): void {
		if (this.nativeH264Encoder) {
			try {
				if (this.nativeH264Encoder.state === "configured") {
					this.nativeH264Encoder.close();
				}
			} catch (e) {
				console.warn("Error closing native H264 encoder:", e);
			}
			this.nativeH264Encoder = null;
		}

		if (this.nativeExportSessionId) {
			if (typeof window !== "undefined") {
				void window.electronAPI?.nativeVideoExportCancel?.(this.nativeExportSessionId);
			}
			this.nativeExportSessionId = null;
		}

		if (this.encoder) {
			try {
				if (this.encoder.state === "configured") {
					this.encoder.close();
				}
			} catch (e) {
				console.warn("Error closing encoder:", e);
			}
			this.encoder = null;
		}

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
		this.activeFinalizationProgressWatchdog = null;
		this.lastFinalizationRenderProgress =
			INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
		this.lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.nativePendingWrite = Promise.resolve();
		this.chunkCount = 0;
		this.effectiveDurationSec = 0;
		this.encoderError = null;
		this.finalizationTimeMs = 0;
		this.finalizationStageMs = {};
		this.effectiveDurationSec = 0;
		this.processedFrameCount = 0;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
	}
}
