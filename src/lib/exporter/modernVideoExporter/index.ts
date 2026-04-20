import { extensionHost } from "@/lib/extensions";
import { AudioProcessor, isAacAudioEncodingSupported } from "../audioEncoder";
import { FrameRenderer } from "../modernFrameRenderer";
import { VideoMuxer } from "../muxer";
import { StreamingVideoDecoder } from "../streamingDecoder";
import type { ExportResult } from "../types";
import { buildNativeAudioPlan } from "./audioPlan";
import { disposeEncoder, encodeRenderedFrame, getExportBackpressureProfile, initializeEncoder } from "./encoding";
import { buildLightningExportError } from "./errorFormatting";
import {
	type ExporterHost,
	NATIVE_EXPORT_ENGINE_NAME,
	type NativeAudioPlan,
	type VideoExporterConfig,
} from "./exporterTypes";
import {
	disposeNativeH264Encoder,
	encodeRenderedFrameNative,
	finalizeExportWithFfmpegAudio,
	finishNativeVideoExport,
	tryStartNativeVideoExport,
} from "./nativeExport";
import {
	awaitWithFinalizationTimeout,
	buildExportMetrics,
	getNowMs,
	reportFinalizingProgress,
	reportProgress,
} from "./progress";

export type { VideoExporterConfig } from "./exporterTypes";

export class ModernVideoExporter implements ExporterHost {
	config: VideoExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	encoder: VideoEncoder | null = null;
	muxer: VideoMuxer | null = null;
	audioProcessor: AudioProcessor | null = null;
	cancelled = false;
	encodeQueue = 0;
	webCodecsEncodeQueueLimit = 0;
	keyFrameInterval = 0;
	videoDescription: Uint8Array | undefined;
	videoColorSpace: VideoColorSpaceInit | undefined;
	pendingMuxing: Promise<void> = Promise.resolve();
	chunkCount = 0;
	exportStartTimeMs = 0;
	lastThroughputLogTimeMs = 0;
	renderBackend: ExporterHost["renderBackend"] = null;
	encodeBackend: ExporterHost["encodeBackend"] = null;
	encoderName: string | null = null;
	backpressureProfile: ExporterHost["backpressureProfile"] = null;
	nativeExportSessionId: string | null = null;
	nativeWritePromises = new Set<Promise<void>>();
	nativeWriteError: Error | null = null;
	maxNativeWriteInFlight = 1;
	lastNativeExportError: string | null = null;
	nativeH264Encoder: VideoEncoder | null = null;
	nativeEncoderError: Error | null = null;
	encoderError: Error | null = null;
	peakEncodeQueueSize = 0;
	peakNativeWriteInFlight = 0;
	nativeCaptureTimeMs = 0;
	nativeWriteTimeMs = 0;
	finalizationTimeMs = 0;
	processedFrameCount = 0;
	lastProgressSampleTimeMs = 0;
	lastProgressSampleFrame = 0;
	totalExportStartTimeMs = 0;
	metadataLoadTimeMs = 0;
	rendererInitTimeMs = 0;
	nativeSessionStartTimeMs = 0;
	decodeLoopTimeMs = 0;
	frameCallbackTimeMs = 0;
	renderFrameTimeMs = 0;
	encodeWaitTimeMs = 0;
	encodeWaitEvents = 0;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;
			this.encoderError = null;
			this.nativeEncoderError = null;
			this.totalExportStartTimeMs = getNowMs();
			const backendPreference = this.config.backendPreference ?? "auto";
			let useNativeEncoder = false;
			this.lastNativeExportError = null;

			let stageStartedAt = getNowMs();
			if (backendPreference === "breeze") {
				useNativeEncoder = await tryStartNativeVideoExport(this);
				this.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;
				if (!useNativeEncoder) {
					throw new Error(
						this.lastNativeExportError ??
							`${NATIVE_EXPORT_ENGINE_NAME} export is unavailable for this output profile on this system.`,
					);
				}
			} else {
				try {
					const configuredWebCodecsPath = await initializeEncoder(this);
					if (
						backendPreference === "auto" &&
						configuredWebCodecsPath.hardwareAcceleration === "prefer-software"
					) {
						console.warn(
							"[VideoExporter] Auto backend resolved to a software WebCodecs encoder; trying Breeze native export instead.",
						);
						stageStartedAt = getNowMs();
						useNativeEncoder = await tryStartNativeVideoExport(this);
						this.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;
						if (useNativeEncoder) {
							disposeEncoder(this);
						}
					}
				} catch (error) {
					const webCodecsError =
						error instanceof Error ? error : new Error(String(error));
					if (backendPreference === "webcodecs") throw webCodecsError;

					console.warn(
						`[VideoExporter] WebCodecs encoder unavailable, trying ${NATIVE_EXPORT_ENGINE_NAME} native export fallback`,
						webCodecsError,
					);
					disposeEncoder(this);
					stageStartedAt = getNowMs();
					useNativeEncoder = await tryStartNativeVideoExport(this);
					this.nativeSessionStartTimeMs = getNowMs() - stageStartedAt;
					if (!useNativeEncoder) throw webCodecsError;
				}
			}

			this.backpressureProfile = getExportBackpressureProfile({
				encodeBackend: useNativeEncoder ? "ffmpeg" : "webcodecs",
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

			this.streamingDecoder = new StreamingVideoDecoder({
				maxDecodeQueue:
					this.config.maxDecodeQueue ?? this.backpressureProfile.maxDecodeQueue,
				maxPendingFrames:
					this.config.maxPendingFrames ?? this.backpressureProfile.maxPendingFrames,
			});
			stageStartedAt = getNowMs();
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);
			this.metadataLoadTimeMs = getNowMs() - stageStartedAt;
			const nativeAudioPlan = buildNativeAudioPlan(this.config, videoInfo);
			const shouldUseFfmpegAudioFallback =
				!useNativeEncoder &&
				nativeAudioPlan.audioMode !== "none" &&
				!(await isAacAudioEncodingSupported());
			const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
			);
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

			stageStartedAt = getNowMs();
			this.renderer = new FrameRenderer({
				width: this.config.width, height: this.config.height,
				preferredRenderBackend: useNativeEncoder ? "webgl" : undefined,
				wallpaper: this.config.wallpaper, zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow, shadowIntensity: this.config.shadowIntensity,
				backgroundBlur: this.config.backgroundBlur, zoomMotionBlur: this.config.zoomMotionBlur,
				connectZooms: this.config.connectZooms, zoomInDurationMs: this.config.zoomInDurationMs,
				zoomInOverlapMs: this.config.zoomInOverlapMs, zoomOutDurationMs: this.config.zoomOutDurationMs,
				connectedZoomGapMs: this.config.connectedZoomGapMs,
				connectedZoomDurationMs: this.config.connectedZoomDurationMs,
				zoomInEasing: this.config.zoomInEasing, zoomOutEasing: this.config.zoomOutEasing,
				connectedZoomEasing: this.config.connectedZoomEasing,
				borderRadius: this.config.borderRadius, padding: this.config.padding,
				cropRegion: this.config.cropRegion, webcam: this.config.webcam,
				webcamUrl: this.config.webcamUrl, videoWidth: videoInfo.width,
				videoHeight: videoInfo.height, annotationRegions: this.config.annotationRegions,
				autoCaptions: this.config.autoCaptions, autoCaptionSettings: this.config.autoCaptionSettings,
				speedRegions: this.config.speedRegions, previewWidth: this.config.previewWidth,
				previewHeight: this.config.previewHeight, cursorTelemetry: this.config.cursorTelemetry,
				showCursor: this.config.showCursor, cursorStyle: this.config.cursorStyle,
				cursorSize: this.config.cursorSize, cursorSmoothing: this.config.cursorSmoothing,
				cursorMotionBlur: this.config.cursorMotionBlur, cursorClickBounce: this.config.cursorClickBounce,
				cursorClickBounceDuration: this.config.cursorClickBounceDuration,
				cursorSway: this.config.cursorSway, zoomSmoothness: this.config.zoomSmoothness,
				zoomClassicMode: this.config.zoomClassicMode, frame: this.config.frame,
			});
			await this.renderer.initialize();
			this.rendererInitTimeMs = getNowMs() - stageStartedAt;
			this.renderBackend = this.renderer.getRendererBackend();

			if (!useNativeEncoder) {
				const hasAudio = nativeAudioPlan.audioMode !== "none";
				this.muxer = new VideoMuxer(this.config, hasAudio && !shouldUseFfmpegAudioFallback);
				await this.muxer.initialize();
			}

			const frameDuration = 1_000_000 / this.config.frameRate;
			let frameIndex = 0;
			this.exportStartTimeMs = getNowMs();
			this.lastThroughputLogTimeMs = this.exportStartTimeMs;
			this.lastProgressSampleTimeMs = this.exportStartTimeMs;
			this.lastProgressSampleFrame = 0;
			const decodeLoopStartedAt = getNowMs();

			await this.streamingDecoder.decodeAll(
				this.config.frameRate, this.config.trimRegions, this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
					const callbackStartedAt = getNowMs();
					if (this.cancelled) { videoFrame.close(); return; }
					const timestamp = frameIndex * frameDuration;
					const renderStartedAt = getNowMs();
					await this.renderer!.renderFrame(videoFrame, sourceTimestampMs * 1000, cursorTimestampMs * 1000);
					this.renderFrameTimeMs += getNowMs() - renderStartedAt;
					videoFrame.close();
					if (this.cancelled) return;
					const canvas = this.renderer!.getCanvas();
					if (useNativeEncoder) {
						await encodeRenderedFrameNative(this, canvas, timestamp, frameDuration, frameIndex);
					} else {
						await encodeRenderedFrame(this, canvas, timestamp, frameDuration, frameIndex);
					}
					this.frameCallbackTimeMs += getNowMs() - callbackStartedAt;
					frameIndex++;
					this.processedFrameCount = frameIndex;
					reportProgress(this, frameIndex, totalFrames, "extracting");
					extensionHost.emitEvent({ type: "export:frame", data: { frameIndex, totalFrames } });
				},
			);
			this.decodeLoopTimeMs = getNowMs() - decodeLoopStartedAt;

			if (this.cancelled) {
				return {
					success: false,
					error: this.encoderError ? buildLightningExportError(this.encoderError, this) : "Export cancelled",
					metrics: buildExportMetrics(this),
				};
			}

			return await this.finalizeExport(useNativeEncoder, nativeAudioPlan, shouldUseFfmpegAudioFallback, totalFrames);
		} catch (error) {
			if (this.cancelled && !this.encoderError) {
				return { success: false, error: "Export cancelled", metrics: buildExportMetrics(this) };
			}
			const resolvedError = this.encoderError ?? error;
			console.error("Export error:", error);
			return { success: false, error: buildLightningExportError(resolvedError, this), metrics: buildExportMetrics(this) };
		} finally {
			if (this.totalExportStartTimeMs > 0) {
				console.log(`[VideoExporter] Final metrics ${JSON.stringify(buildExportMetrics(this))}`);
			}
			this.cleanup();
		}
	}

	private async finalizeExport(
		useNativeEncoder: boolean,
		nativeAudioPlan: NativeAudioPlan,
		shouldUseFfmpegAudioFallback: boolean,
		totalFrames: number,
	): Promise<ExportResult> {
		reportFinalizingProgress(this, totalFrames, 96);
		let stageStartedAt = getNowMs();

		if (useNativeEncoder) {
			reportFinalizingProgress(this, totalFrames, 99);
			if (this.nativeH264Encoder) await this.nativeH264Encoder.flush();
			const finishResult = await finishNativeVideoExport(this, nativeAudioPlan);
			this.finalizationTimeMs = getNowMs() - stageStartedAt;
			if (!finishResult.success || !finishResult.blob) {
				return { success: false, error: finishResult.error || `${NATIVE_EXPORT_ENGINE_NAME} export failed`, metrics: finishResult.metrics ?? buildExportMetrics(this) };
			}
			return { success: true, blob: finishResult.blob, metrics: finishResult.metrics ?? buildExportMetrics(this) };
		}

		stageStartedAt = getNowMs();
		if (this.encoder && this.encoder.state === "configured") {
			reportFinalizingProgress(this, totalFrames, 97);
			await awaitWithFinalizationTimeout(this.encoder.flush(), "encoder flush");
		}
		reportFinalizingProgress(this, totalFrames, 98);
		await awaitWithFinalizationTimeout(this.pendingMuxing, "muxing queued video chunks");
		if (this.encoderError) throw this.encoderError;

		if (nativeAudioPlan.audioMode !== "none" && !shouldUseFfmpegAudioFallback && !this.cancelled) {
			const demuxer = this.streamingDecoder!.getDemuxer();
			if (demuxer || (this.config.audioRegions ?? []).length > 0 || (this.config.sourceAudioFallbackPaths ?? []).length > 0) {
				this.audioProcessor = new AudioProcessor();
				this.audioProcessor.setOnProgress((progress) => { reportFinalizingProgress(this, totalFrames, 99, progress); });
				reportFinalizingProgress(this, totalFrames, 99);
				await awaitWithFinalizationTimeout(
					this.audioProcessor.process(demuxer, this.muxer!, this.config.videoUrl, this.config.trimRegions, this.config.speedRegions, undefined, this.config.audioRegions, this.config.sourceAudioFallbackPaths),
					"audio processing",
				);
			}
		}

		reportFinalizingProgress(this, totalFrames, 99);
		const blob = await awaitWithFinalizationTimeout(this.muxer!.finalize(), "muxer finalization");
		this.finalizationTimeMs = getNowMs() - stageStartedAt;

		if (shouldUseFfmpegAudioFallback) {
			console.warn("[VideoExporter] Browser AAC encoding is unavailable; falling back to FFmpeg audio muxing.");
			const muxedResult = await finalizeExportWithFfmpegAudio(this, blob, nativeAudioPlan);
			if (!muxedResult.success || !muxedResult.blob) {
				return { success: false, error: muxedResult.error || "Failed to mux audio with FFmpeg", metrics: muxedResult.metrics ?? buildExportMetrics(this) };
			}
			return { success: true, blob: muxedResult.blob, metrics: muxedResult.metrics ?? buildExportMetrics(this) };
		}

		return { success: true, blob, metrics: buildExportMetrics(this) };
	}

	cancel(): void {
		this.cancelled = true;
		this.streamingDecoder?.cancel();
		this.audioProcessor?.cancel();
		disposeNativeH264Encoder(this);
		const nativeExportSessionId = this.nativeExportSessionId;
		this.nativeExportSessionId = null;
		if (nativeExportSessionId && typeof window !== "undefined") {
			void window.electronAPI?.nativeVideoExportCancel?.(nativeExportSessionId);
		}
	}

	private cleanup(): void {
		disposeEncoder(this);
		if (this.streamingDecoder) {
			try { this.streamingDecoder.destroy(); } catch (e) { console.warn("Error destroying streaming decoder:", e); }
			this.streamingDecoder = null;
		}
		if (this.renderer) {
			try { this.renderer.destroy(); } catch (e) { console.warn("Error destroying renderer:", e); }
			this.renderer = null;
		}
		if (this.muxer) {
			try { this.muxer.destroy(); } catch (e) { console.warn("Error destroying muxer:", e); }
		}
		this.muxer = null;
		this.audioProcessor?.cancel();
		this.audioProcessor = null;
		disposeNativeH264Encoder(this);
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
		this.processedFrameCount = 0;
		this.lastProgressSampleTimeMs = 0;
		this.lastProgressSampleFrame = 0;
		this.nativeWritePromises = new Set();
		this.nativeWriteError = null;
		this.maxNativeWriteInFlight = 1;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
		this.renderBackend = null;
		this.encodeBackend = null;
		this.encoderName = null;
		this.backpressureProfile = null;
		this.lastNativeExportError = null;
	}
}
