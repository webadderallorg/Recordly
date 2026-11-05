import { AudioProcessor } from "./audioEncoder";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import { NativeAudioPlan } from "./legacyVideoExporterContext";
import type { ExportResult } from "./types";

export async function finishNativeVideoExport(
	context: Pick<
		LegacyVideoExporterContext,
		| "nativeExportSessionId"
		| "audioProcessor"
		| "reportFinalizingProgress"
		| "measureFinalizationStage"
		| "awaitWithFinalizationTimeout"
		| "config"
		| "finalizationStageMs"
		| "buildExportMetrics"
	>,
	audioPlan: NativeAudioPlan,
	totalFrames: number,
): Promise<ExportResult> {
	if (!context.nativeExportSessionId) {
		return { success: false, error: "Native export session is not active" };
	}

	let editedAudioBuffer: ArrayBuffer | undefined;
	let editedAudioMimeType: string | null = null;

	if (
		audioPlan.audioMode === "edited-track" &&
		audioPlan.strategy === "offline-render-fallback"
	) {
		context.audioProcessor = new AudioProcessor();
		context.audioProcessor.setOnProgress((progress) => {
			context.reportFinalizingProgress(totalFrames, 99, progress);
		});
		const audioBlob = await context.measureFinalizationStage("editedAudioRenderMs", async () =>
			context.awaitWithFinalizationTimeout(
				context.audioProcessor!.renderEditedAudioTrack(
					context.config.videoUrl,
					context.config.trimRegions,
					context.config.speedRegions,
					context.config.audioRegions,
					context.config.sourceAudioFallbackPaths,
					context.config.sourceAudioFallbackStartDelayMsByPath,
					context.config.sourceAudioTrackSettings,
					context.config.clipRegions,
					context.config.sourceAudioTrackSettingsByClip,
				),
				"native edited audio rendering",
				"audio",
				true,
			),
		);
		editedAudioBuffer = await audioBlob.arrayBuffer();
		editedAudioMimeType = audioBlob.type || null;
	}

	const sessionId = context.nativeExportSessionId;
	context.nativeExportSessionId = null;

	const result = await context.measureFinalizationStage("nativeExportFinalizeMs", async () =>
		context.awaitWithFinalizationTimeout(
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
		context.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
	}

	if (!result.success || !result.tempPath) {
		return {
			success: false,
			error: result.error || "Failed to finalize native video export",
			metrics: context.buildExportMetrics(),
		};
	}

	return {
		success: true,
		tempFilePath: result.tempPath,
		metrics: context.buildExportMetrics(),
	};
}

export async function finalizeExportWithFfmpegAudio(
	context: Pick<
		LegacyVideoExporterContext,
		| "audioProcessor"
		| "reportFinalizingProgress"
		| "measureFinalizationStage"
		| "awaitWithFinalizationTimeout"
		| "config"
		| "effectiveDurationSec"
		| "finalizationStageMs"
		| "buildExportMetrics"
	>,
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
		context.audioProcessor = new AudioProcessor();
		context.audioProcessor.setOnProgress((progress) => {
			context.reportFinalizingProgress(totalFrames, 99, progress);
		});
		const audioBlob = await context.measureFinalizationStage("editedAudioRenderMs", async () =>
			context.awaitWithFinalizationTimeout(
				context.audioProcessor!.renderEditedAudioTrack(
					context.config.videoUrl,
					context.config.trimRegions,
					context.config.speedRegions,
					context.config.audioRegions,
					context.config.sourceAudioFallbackPaths,
					context.config.sourceAudioFallbackStartDelayMsByPath,
					context.config.sourceAudioTrackSettings,
					context.config.clipRegions,
					context.config.sourceAudioTrackSettingsByClip,
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
		trimSegments: audioPlan.audioMode === "trim-source" ? audioPlan.trimSegments : undefined,
		editedTrackStrategy:
			audioPlan.audioMode === "edited-track" ? audioPlan.strategy : undefined,
		editedTrackSegments:
			audioPlan.audioMode === "edited-track" && audioPlan.strategy === "filtergraph-fast-path"
				? audioPlan.editedTrackSegments
				: undefined,
		audioSourceSampleRate:
			audioPlan.audioMode === "edited-track" && audioPlan.strategy === "filtergraph-fast-path"
				? audioPlan.audioSourceSampleRate
				: undefined,
		outputDurationSec: context.effectiveDurationSec,
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
		const result = await context.measureFinalizationStage("ffmpegAudioMuxMs", async () =>
			context.awaitWithFinalizationTimeout(
				window.electronAPI.muxExportedVideoAudioFromPath(
					videoSource.tempFilePath,
					muxOptions,
				),
				"ffmpeg audio muxing",
				"audio",
			),
		);
		if (result.metrics) {
			context.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
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
	const result = await context.measureFinalizationStage("ffmpegAudioMuxMs", async () =>
		context.awaitWithFinalizationTimeout(
			window.electronAPI.muxExportedVideoAudio(videoBuffer, muxOptions),
			"ffmpeg audio muxing",
			"audio",
		),
	);
	if (result.metrics) {
		context.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
	}

	if (!result.success || !result.tempPath) {
		return {
			success: false,
			error: result.error || "Failed to mux exported audio with FFmpeg",
			metrics: context.buildExportMetrics(),
		};
	}

	// Returning a temp path (instead of buffering the muxed bytes back into
	// the renderer) is what keeps >2 GiB exports off Node's fs.readFile cap.
	return {
		success: true,
		tempFilePath: result.tempPath,
		metrics: context.buildExportMetrics(),
	};
}
