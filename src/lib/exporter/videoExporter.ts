import { AudioProcessor, isAacAudioEncodingSupported } from "./audioEncoder";
import { FrameRenderer } from "./frameRenderer";
import { VideoMuxer } from "./muxer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import type { ExportResult } from "./types";
import { VideoExporterAudioBase } from "./video-exporter/audioBase";
import type { VideoExporterConfig } from "./video-exporter/shared";

export class VideoExporter extends VideoExporterAudioBase {
	private streamingDecoder: StreamingVideoDecoder | null = null;

	constructor(config: VideoExporterConfig) {
		super(config);
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
				!useNativeEncoder
				&& audioPlan.audioMode !== "none"
				&& !(await isAacAudioEncodingSupported());

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
					);
					videoFrame.close();

					if (useNativeEncoder) {
						await this.encodeRenderedFrameNative(timestamp, frameDuration, frameIndex);
					} else {
						await this.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
					}
					frameIndex++;
					this.reportProgress(frameIndex, totalFrames);
				},
			);

			if (this.cancelled) {
				const encoderError = this.encoderError as Error | null;
				if (encoderError) {
					return { success: false, error: encoderError.message };
				}

				return { success: false, error: "Export cancelled" };
			}

			this.reportFinalizingProgress(totalFrames, 96);

			if (useNativeEncoder && nativeAudioPlan) {
				if (this.nativeH264Encoder) {
					await this.nativeH264Encoder.flush();
					await this.awaitPendingNativeWrites();
					if (this.nativeEncoderError) {
						throw this.nativeEncoderError;
					}
					this.nativeH264Encoder.close();
					this.nativeH264Encoder = null;
				}
				this.reportFinalizingProgress(totalFrames, 99, 0);
				return await this.finishNativeVideoExport(nativeAudioPlan, totalFrames);
			}

			// Finalize encoding
			if (this.encoder && this.encoder.state === "configured") {
				this.reportFinalizingProgress(totalFrames, 97);
				await this.awaitWithFinalizationTimeout(this.encoder.flush(), "encoder flush");
			}

			// Wait for queued muxing operations to complete
			this.reportFinalizingProgress(totalFrames, 98);
			await this.awaitWithFinalizationTimeout(
				this.pendingMuxing,
				"muxing queued video chunks",
			);

			// Surface muxing errors before proceeding with finalization
			if (this.encoderError) {
				throw this.encoderError;
			}

			if (hasAudio && !shouldUseFfmpegAudioFallback && !this.cancelled) {
				const demuxer = this.streamingDecoder.getDemuxer();
				if (demuxer || hasAudioRegions || hasSourceAudioFallback) {
					const audioProcessor = new AudioProcessor();
					this.audioProcessor = audioProcessor;
					audioProcessor.setOnProgress((progress) => {
						this.reportFinalizingProgress(totalFrames, 99, progress);
					});
					this.reportFinalizingProgress(totalFrames, 99, 0);
					await this.awaitWithFinalizationTimeout(
						audioProcessor.process(
							demuxer,
							this.muxer!,
							this.config.videoUrl,
							this.config.trimRegions,
							this.config.speedRegions,
							undefined,
							this.config.audioRegions,
							this.config.sourceAudioFallbackPaths,
						),
						"audio processing",
					);
				}
			}

			// Finalize muxer and get output blob
			this.reportFinalizingProgress(totalFrames, 99);
			const blob = await this.awaitWithFinalizationTimeout(
				this.muxer!.finalize(),
				"muxer finalization",
			);

			if (shouldUseFfmpegAudioFallback) {
				console.warn(
					"[VideoExporter] Browser AAC encoding is unavailable; falling back to FFmpeg audio muxing.",
				);
				return await this.finalizeExportWithFfmpegAudio(blob, audioPlan, totalFrames);
			}

			return { success: true, blob };
		} catch (error) {
			if (this.cancelled && !this.encoderError) {
				return { success: false, error: "Export cancelled" };
			}

			const resolvedError = this.encoderError ?? error;
			console.error("Export error:", error);
			return {
				success: false,
				error:
					resolvedError instanceof Error ? resolvedError.message : String(resolvedError),
			};
		} finally {
			this.cleanup();
		}
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
		this.audioProcessor = null;
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.nativePendingWrite = Promise.resolve();
		this.chunkCount = 0;
		this.encoderError = null;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
	}
}
