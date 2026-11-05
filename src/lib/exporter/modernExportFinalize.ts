import { AudioProcessor } from "./audioEncoder";
import type { ModernExportAttempt, ModernExportFramePlan } from "./modernExportAttemptTypes";
import { getNowMs, NATIVE_EXPORT_ENGINE_NAME } from "./modernExportConstants";
import {
	isWebCodecsEncoderFailure,
	markWebCodecsEncoderFailure,
} from "./modernExportEncoderFailure";
import type { ModernExportHooks } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";
import type { ExportResult } from "./types";

type Hooks = Pick<
	ModernExportHooks,
	"buildLightningExportError" | "finalizeExportWithFfmpegAudio" | "finishNativeVideoExport"
>;

type Session = Pick<
	ModernExportSession,
	"browser" | "cancelled" | "config" | "flow" | "metrics" | "native" | "progress"
>;

export async function finalizeExportAttempt(
	session: Session,
	hooks: Hooks,
	control: ModernExportAttempt,
	plan: ModernExportFramePlan,
): Promise<ExportResult> {
	const {
		useNativeEncoder,
		nativeAudioPlan,
		totalFrames,
		shouldUseFfmpegAudioFallback,
		shouldUsePitchPreservingFfmpegAudio,
	} = plan;
	let stageStartedAt = 0;

	if (session.cancelled) {
		if (session.browser.encoderError) {
			return {
				success: false,
				error: hooks.buildLightningExportError(session.browser.encoderError),
				failureStage: isWebCodecsEncoderFailure(session.browser.encoderError)
					? "encoder"
					: "pipeline",
				metrics: session.metrics.buildExportMetrics(),
			};
		}

		return {
			success: false,
			error: "Export cancelled",
			metrics: session.metrics.buildExportMetrics(),
		};
	}

	session.progress.reportFinalizingProgress(totalFrames, 96);

	if (useNativeEncoder) {
		control.inNativeStage = true;
		stageStartedAt = getNowMs();
		session.progress.reportFinalizingProgress(totalFrames, 99);
		if (session.native.nativeH264Encoder) {
			await session.progress.measureFinalizationStage("nativeEncoderFlushMs", async () => {
				await session.progress.awaitWithFinalizationTimeout(
					session.native.nativeH264Encoder!.flush(),
					"native encoder flush",
				);
			});
		}
		const finishResult = await hooks.finishNativeVideoExport(nativeAudioPlan);
		session.metrics.finalizationTimeMs = getNowMs() - stageStartedAt;
		if (!finishResult.success || (!finishResult.tempFilePath && !finishResult.blob)) {
			throw new Error(finishResult.error || `${NATIVE_EXPORT_ENGINE_NAME} export failed`);
		}

		return {
			success: true,
			tempFilePath: finishResult.tempFilePath,
			blob: finishResult.blob,
			metrics: session.metrics.buildExportMetrics(),
		};
	}

	stageStartedAt = getNowMs();
	if (session.browser.encoder && session.browser.encoder.state === "configured") {
		session.progress.reportFinalizingProgress(totalFrames, 97);
		await session.progress.measureFinalizationStage("encoderFlushMs", async () => {
			try {
				await session.progress.awaitWithFinalizationTimeout(
					session.browser.encoder!.flush(),
					"encoder flush",
				);
			} catch (error) {
				throw markWebCodecsEncoderFailure(error);
			}
		});
	}

	session.progress.reportFinalizingProgress(totalFrames, 98);
	await session.progress.measureFinalizationStage("queuedMuxingMs", async () => {
		await session.progress.awaitWithFinalizationTimeout(
			session.flow.pendingMuxing,
			"muxing queued video chunks",
		);
	});

	// Surface muxing errors before proceeding with finalization
	if (session.browser.encoderError) {
		throw session.browser.encoderError;
	}

	if (
		nativeAudioPlan.audioMode !== "none" &&
		!shouldUseFfmpegAudioFallback &&
		!session.cancelled
	) {
		const demuxer = session.browser.streamingDecoder!.getDemuxer();
		if (
			demuxer ||
			(session.config.audioRegions ?? []).length > 0 ||
			(session.config.sourceAudioFallbackPaths ?? []).length > 0
		) {
			session.browser.audioProcessor = new AudioProcessor();
			session.browser.audioProcessor.setOnProgress((progress) => {
				session.progress.reportFinalizingProgress(totalFrames, 99, progress);
			});
			session.progress.reportFinalizingProgress(totalFrames, 99);
			await session.progress.measureFinalizationStage("audioProcessingMs", async () => {
				await session.progress.awaitWithFinalizationTimeout(
					session.browser.audioProcessor!.process(
						demuxer,
						session.browser.muxer!,
						session.config.videoUrl,
						session.config.trimRegions,
						session.config.speedRegions,
						undefined,
						session.config.audioRegions,
						session.config.sourceAudioFallbackPaths,
						session.config.sourceAudioFallbackStartDelayMsByPath,
						session.config.sourceAudioTrackSettings,
						session.config.clipRegions,
						session.config.sourceAudioTrackSettingsByClip,
					),
					"audio processing",
					"audio",
					true,
				);
			});
		}
	}

	session.progress.reportFinalizingProgress(totalFrames, 99);
	const muxerResult = await session.progress.measureFinalizationStage(
		"muxerFinalizeMs",
		async () =>
			session.progress.awaitWithFinalizationTimeout(
				session.browser.muxer!.finalize(),
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
		const muxedResult = await hooks.finalizeExportWithFfmpegAudio(muxerResult, nativeAudioPlan);
		session.metrics.finalizationTimeMs = getNowMs() - stageStartedAt;
		if (!muxedResult.success || (!muxedResult.blob && !muxedResult.tempFilePath)) {
			return {
				success: false,
				error: muxedResult.error || "Failed to mux audio with FFmpeg",
				metrics: session.metrics.buildExportMetrics(),
			};
		}

		return {
			success: true,
			blob: muxedResult.blob,
			tempFilePath: muxedResult.tempFilePath,
			metrics: muxedResult.metrics ?? session.metrics.buildExportMetrics(),
		};
	}

	session.metrics.finalizationTimeMs = getNowMs() - stageStartedAt;
	if (muxerResult.mode === "stream") {
		return {
			success: true,
			tempFilePath: muxerResult.tempFilePath,
			metrics: session.metrics.buildExportMetrics(),
		};
	}
	return {
		success: true,
		blob: muxerResult.blob,
		metrics: session.metrics.buildExportMetrics(),
	};
}
