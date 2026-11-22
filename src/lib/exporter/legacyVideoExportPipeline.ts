import { AudioProcessor, isAacAudioEncodingSupported } from "./audioEncoder";
import { requiresClipTimelineRendering } from "./clipTimeline";
import { FrameRenderer } from "./frameRenderer";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import { VideoMuxer } from "./muxer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import type { ExportResult } from "./types";

export async function runLegacyVideoExport(
	context: Pick<
		LegacyVideoExporterContext,
		| "cleanup"
		| "cancelled"
		| "encoderError"
		| "nativeEncoderError"
		| "nativePendingWrite"
		| "nativeWritePromises"
		| "nativeWriteError"
		| "maxNativeWriteInFlight"
		| "config"
		| "exportStartTimeMs"
		| "getNowMs"
		| "progressSampleStartTimeMs"
		| "progressSampleStartFrame"
		| "streamingDecoder"
		| "shouldUseExperimentalNativeExport"
		| "buildNativeAudioPlan"
		| "tryStartNativeVideoExport"
		| "initializeEncoder"
		| "renderer"
		| "muxer"
		| "effectiveDurationSec"
		| "encodeRenderedFrameNative"
		| "encodeRenderedFrame"
		| "processedFrameCount"
		| "reportProgress"
		| "buildExportMetrics"
		| "reportFinalizingProgress"
		| "nativeH264Encoder"
		| "measureFinalizationStage"
		| "awaitPendingNativeWrites"
		| "finishNativeVideoExport"
		| "finalizationTimeMs"
		| "encoder"
		| "awaitWithFinalizationTimeout"
		| "pendingMuxing"
		| "audioProcessor"
		| "finalizeExportWithFfmpegAudio"
	>,
): Promise<ExportResult> {
	try {
		context.cleanup();
		context.cancelled = false;
		context.encoderError = null;
		context.nativeEncoderError = null;
		context.nativePendingWrite = Promise.resolve();
		context.nativeWritePromises = new Set();
		context.nativeWriteError = null;
		context.maxNativeWriteInFlight = Math.max(
			1,
			Math.floor(context.config.maxInFlightNativeWrites ?? 1),
		);
		context.exportStartTimeMs = context.getNowMs();
		context.progressSampleStartTimeMs = context.exportStartTimeMs;
		context.progressSampleStartFrame = 0;

		// Initialize streaming decoder and load video metadata
		context.streamingDecoder = new StreamingVideoDecoder({
			maxDecodeQueue: context.config.maxDecodeQueue,
			maxPendingFrames: context.config.maxPendingFrames,
		});
		const videoInfo = await context.streamingDecoder.loadMetadata(context.config.videoUrl);
		const shouldUseExperimentalNativeExport = context.shouldUseExperimentalNativeExport();
		const audioPlan = context.buildNativeAudioPlan(videoInfo);
		const nativeAudioPlan = shouldUseExperimentalNativeExport ? audioPlan : null;
		let useNativeEncoder = shouldUseExperimentalNativeExport
			? await context.tryStartNativeVideoExport()
			: false;
		const shouldUsePitchPreservingFfmpegAudio =
			audioPlan.audioMode === "edited-track" &&
			audioPlan.strategy === "filtergraph-fast-path";
		const shouldUseFfmpegAudioFallback =
			!useNativeEncoder &&
			audioPlan.audioMode !== "none" &&
			(requiresClipTimelineRendering(context.config.clipRegions) ||
				shouldUsePitchPreservingFfmpegAudio ||
				!(await isAacAudioEncodingSupported()));

		if (!useNativeEncoder) {
			await context.initializeEncoder();
		}

		// Initialize frame renderer
		context.renderer = new FrameRenderer({
			timelineEffects: context.config.clipRegions !== undefined,
			width: context.config.width,
			height: context.config.height,
			preferredRenderBackend: context.config.preferredRenderBackend,
			wallpaper: context.config.wallpaper,
			zoomRegions: context.config.zoomRegions,
			showShadow: context.config.showShadow,
			shadowIntensity: context.config.shadowIntensity,
			backgroundBlur: context.config.backgroundBlur,
			zoomMotionBlur: context.config.zoomMotionBlur,
			zoomMotionBlurTuning: context.config.zoomMotionBlurTuning,
			connectZooms: context.config.connectZooms,
			zoomInDurationMs: context.config.zoomInDurationMs,
			zoomInOverlapMs: context.config.zoomInOverlapMs,
			zoomOutDurationMs: context.config.zoomOutDurationMs,
			connectedZoomGapMs: context.config.connectedZoomGapMs,
			connectedZoomDurationMs: context.config.connectedZoomDurationMs,
			zoomInEasing: context.config.zoomInEasing,
			zoomOutEasing: context.config.zoomOutEasing,
			connectedZoomEasing: context.config.connectedZoomEasing,
			borderRadius: context.config.borderRadius,
			padding: context.config.padding,
			cropRegion: context.config.cropRegion,
			webcam: context.config.webcam,
			webcamUrl: context.config.webcamUrl,
			videoWidth: videoInfo.width,
			videoHeight: videoInfo.height,
			annotationRegions: context.config.annotationRegions,
			autoCaptions: context.config.autoCaptions,
			autoCaptionSettings: context.config.autoCaptionSettings,
			speedRegions: context.config.speedRegions,
			previewWidth: context.config.previewWidth,
			previewHeight: context.config.previewHeight,
			cursorTelemetry: context.config.cursorTelemetry,
			showCursor: context.config.showCursor,
			cursorStyle: context.config.cursorStyle,
			cursorSize: context.config.cursorSize,
			cursorSmoothing: context.config.cursorSmoothing,
			cursorSpringStiffnessMultiplier: context.config.cursorSpringStiffnessMultiplier,
			cursorSpringDampingMultiplier: context.config.cursorSpringDampingMultiplier,
			cursorSpringMassMultiplier: context.config.cursorSpringMassMultiplier,
			cameraSpringStiffnessMultiplier: context.config.cameraSpringStiffnessMultiplier,
			cameraSpringDampingMultiplier: context.config.cameraSpringDampingMultiplier,
			cameraSpringMassMultiplier: context.config.cameraSpringMassMultiplier,
			cursorMotionBlur: context.config.cursorMotionBlur,
			cursorClickEffect: context.config.cursorClickEffect,
			cursorClickEffectColor: context.config.cursorClickEffectColor,
			cursorClickEffectScale: context.config.cursorClickEffectScale,
			cursorClickEffectOpacity: context.config.cursorClickEffectOpacity,
			cursorClickEffectDurationMs: context.config.cursorClickEffectDurationMs,
			cursorClickBounce: context.config.cursorClickBounce,
			cursorClickBounceDuration: context.config.cursorClickBounceDuration,
			cursorSway: context.config.cursorSway,
			cursorIdleHide: context.config.cursorIdleHide,
			zoomSmoothness: context.config.zoomSmoothness,
			zoomClassicMode: context.config.zoomClassicMode,
		});
		await context.renderer.initialize();

		const hasAudioRegions = (context.config.audioRegions ?? []).length > 0;
		const hasSourceAudioFallback = (context.config.sourceAudioFallbackPaths ?? []).length > 0;
		const hasAudio = videoInfo.hasAudio || hasAudioRegions || hasSourceAudioFallback;

		if (!useNativeEncoder) {
			context.muxer = new VideoMuxer(
				context.config,
				hasAudio && !shouldUseFfmpegAudioFallback,
			);
			await context.muxer.initialize();
		}

		// Calculate effective duration and frame count (excluding trim regions)
		const effectiveDuration = context.streamingDecoder.getEffectiveDuration(
			context.config.trimRegions,
			context.config.speedRegions,
			context.config.clipRegions,
		);
		context.effectiveDurationSec = effectiveDuration;
		const totalFrames = Math.ceil(effectiveDuration * context.config.frameRate);

		console.log("[VideoExporter] Original duration:", videoInfo.duration, "s");
		console.log("[VideoExporter] Effective duration:", effectiveDuration, "s");
		console.log("[VideoExporter] Total frames to export:", totalFrames);
		console.log("[VideoExporter] Using streaming decode (web-demuxer + VideoDecoder)");
		console.log(
			`[VideoExporter] Using ${useNativeEncoder ? "native ffmpeg" : "WebCodecs"} encode path`,
		);

		const frameDuration = 1_000_000 / context.config.frameRate; // in microseconds
		let frameIndex = 0;

		// Stream decode and process frames — no seeking!
		await context.streamingDecoder.decodeAll(
			context.config.frameRate,
			context.config.trimRegions,
			context.config.speedRegions,
			async (videoFrame, _exportTimestampUs, sourceTimestampMs, cursorTimestampMs) => {
				if (context.cancelled) {
					return;
				}

				const timestamp = frameIndex * frameDuration;
				const sourceTimestampUs = sourceTimestampMs * 1000;
				const cursorTimestampUs = cursorTimestampMs * 1000;
				await context.renderer!.renderFrame(
					videoFrame,
					sourceTimestampUs,
					cursorTimestampUs,
					frameDuration,
					timestamp,
				);

				if (useNativeEncoder) {
					await context.encodeRenderedFrameNative(timestamp, frameDuration, frameIndex);
				} else {
					await context.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
				}
				frameIndex++;
				context.processedFrameCount = frameIndex;
				context.reportProgress(frameIndex, totalFrames);
			},
			context.config.clipRegions,
		);

		if (context.cancelled) {
			const encoderError = context.encoderError as Error | null;
			if (encoderError) {
				return {
					success: false,
					error: encoderError.message,
					metrics: context.buildExportMetrics(),
				};
			}

			return {
				success: false,
				error: "Export cancelled",
				metrics: context.buildExportMetrics(),
			};
		}

		context.reportFinalizingProgress(totalFrames, 96);
		const finalizationStartedAt = context.getNowMs();

		if (useNativeEncoder && nativeAudioPlan) {
			if (context.nativeH264Encoder) {
				await context.measureFinalizationStage("nativeEncoderFlushMs", async () => {
					await context.nativeH264Encoder!.flush();
					await context.awaitPendingNativeWrites();
					if (context.nativeEncoderError) {
						throw context.nativeEncoderError;
					}
				});
				context.nativeH264Encoder.close();
				context.nativeH264Encoder = null;
			}
			context.reportFinalizingProgress(totalFrames, 99, 0);
			const result = await context.finishNativeVideoExport(nativeAudioPlan, totalFrames);
			context.finalizationTimeMs = context.getNowMs() - finalizationStartedAt;
			return {
				...result,
				metrics: context.buildExportMetrics(),
			};
		}

		// Finalize encoding
		if (context.encoder && context.encoder.state === "configured") {
			context.reportFinalizingProgress(totalFrames, 97);
			await context.measureFinalizationStage("encoderFlushMs", async () => {
				await context.awaitWithFinalizationTimeout(
					context.encoder!.flush(),
					"encoder flush",
				);
			});
		}

		// Wait for queued muxing operations to complete
		context.reportFinalizingProgress(totalFrames, 98);
		await context.measureFinalizationStage("queuedMuxingMs", async () => {
			await context.awaitWithFinalizationTimeout(
				context.pendingMuxing,
				"muxing queued video chunks",
			);
		});

		// Surface muxing errors before proceeding with finalization
		if (context.encoderError) {
			throw context.encoderError;
		}

		if (hasAudio && !shouldUseFfmpegAudioFallback && !context.cancelled) {
			const demuxer = context.streamingDecoder.getDemuxer();
			if (demuxer || hasAudioRegions || hasSourceAudioFallback) {
				context.audioProcessor = new AudioProcessor();
				context.audioProcessor.setOnProgress((progress) => {
					context.reportFinalizingProgress(totalFrames, 99, progress);
				});
				context.reportFinalizingProgress(totalFrames, 99, 0);
				await context.measureFinalizationStage("audioProcessingMs", async () => {
					await context.awaitWithFinalizationTimeout(
						context.audioProcessor!.process(
							demuxer,
							context.muxer!,
							context.config.videoUrl,
							context.config.trimRegions,
							context.config.speedRegions,
							undefined,
							context.config.audioRegions,
							context.config.sourceAudioFallbackPaths,
							context.config.sourceAudioFallbackStartDelayMsByPath,
							context.config.sourceAudioTrackSettings,
							context.config.clipRegions,
							context.config.sourceAudioTrackSettingsByClip,
						),
						"audio processing",
						"audio",
						true,
					);
				});
			}
		}

		// Finalize muxer and get output (temp path for streaming, blob for legacy)
		context.reportFinalizingProgress(totalFrames, 99);
		const muxerResult = await context.measureFinalizationStage("muxerFinalizeMs", async () =>
			context.awaitWithFinalizationTimeout(
				context.muxer!.finalize(),
				"muxer finalization",
				hasAudio && !shouldUseFfmpegAudioFallback ? "audio" : "default",
			),
		);

		if (shouldUseFfmpegAudioFallback) {
			console.warn(
				shouldUsePitchPreservingFfmpegAudio
					? "[VideoExporter] Using FFmpeg audio muxing for pitch-preserving speed edits."
					: "[VideoExporter] Browser AAC encoding is unavailable; falling back to FFmpeg audio muxing.",
			);
			const result = await context.finalizeExportWithFfmpegAudio(
				muxerResult,
				audioPlan,
				totalFrames,
			);
			context.finalizationTimeMs = context.getNowMs() - finalizationStartedAt;
			return {
				...result,
				metrics: context.buildExportMetrics(),
			};
		}

		context.finalizationTimeMs = context.getNowMs() - finalizationStartedAt;
		if (muxerResult.mode === "stream") {
			return {
				success: true,
				tempFilePath: muxerResult.tempFilePath,
				metrics: context.buildExportMetrics(),
			};
		}
		return { success: true, blob: muxerResult.blob, metrics: context.buildExportMetrics() };
	} catch (error) {
		if (context.cancelled && !context.encoderError) {
			return {
				success: false,
				error: "Export cancelled",
				metrics: context.buildExportMetrics(),
			};
		}

		const resolvedError = context.encoderError ?? error;
		console.error("Export error:", error);
		return {
			success: false,
			error: resolvedError instanceof Error ? resolvedError.message : String(resolvedError),
			metrics: context.buildExportMetrics(),
		};
	} finally {
		context.cleanup();
	}
}
