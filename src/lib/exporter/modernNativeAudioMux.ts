import { AudioProcessor } from "./audioEncoder";
import { NATIVE_EXPORT_ENGINE_NAME } from "./modernExportConstants";
import type { ModernExportHooks, NativeStaticLayoutAudioOptions } from "./modernExportHooks";
import type { ModernExportSession } from "./modernExportSession";
import { type NativeAudioPlan } from "./nativeExportAudioPlan";
import type { ExportResult } from "./types";

type Hooks = Pick<ModernExportHooks, "renderEditedAudioForNativeMux">;

type Session = Pick<
	ModernExportSession,
	| "browser"
	| "config"
	| "effectiveDurationSec"
	| "flow"
	| "metrics"
	| "native"
	| "progress"
	| "throwIfCancelled"
>;

export async function renderEditedAudioForNativeMux(
	session: Session,
	_hooks: Hooks,
	description: string,
	onProgress: (progress: number) => void,
	sourceAudioFallbackPaths: string[] | undefined = session.config.sourceAudioFallbackPaths,
): Promise<{ editedAudioData: ArrayBuffer; editedAudioMimeType: string | null }> {
	session.browser.audioProcessor = new AudioProcessor();
	session.browser.audioProcessor.setOnProgress(onProgress);
	const audioBlob = await session.progress.measureFinalizationStage(
		"editedAudioRenderMs",
		async () =>
			session.progress.awaitWithFinalizationTimeout(
				session.browser.audioProcessor!.renderEditedAudioTrack(
					session.config.videoUrl,
					session.config.trimRegions,
					session.config.speedRegions,
					session.config.audioRegions,
					sourceAudioFallbackPaths,
					session.config.sourceAudioFallbackStartDelayMsByPath,
					session.config.sourceAudioTrackSettings,
					session.config.clipRegions,
					session.config.sourceAudioTrackSettingsByClip,
				),
				description,
				"audio",
				true,
			),
	);

	session.throwIfCancelled();
	const editedAudioData = await audioBlob.arrayBuffer();
	session.throwIfCancelled();
	return {
		editedAudioData,
		editedAudioMimeType: audioBlob.type || null,
	};
}

export async function getNativeStaticLayoutAudioOptions(
	session: Session,
	hooks: Hooks,
	audioPlan: NativeAudioPlan,
	totalFrames: number,
): Promise<NativeStaticLayoutAudioOptions> {
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

			const renderedAudio = await hooks.renderEditedAudioForNativeMux(
				"Native static-layout edited audio rendering",
				(progress) =>
					session.progress.reportProgress(
						0,
						totalFrames,
						"preparing",
						undefined,
						progress,
					),
				audioPlan.sourceAudioFallbackPaths,
			);

			return {
				audioMode: audioPlan.audioMode,
				editedTrackStrategy: audioPlan.strategy,
				...renderedAudio,
			};
		}
	}
}

export async function finishNativeVideoExport(
	session: Session,
	hooks: Hooks,
	audioPlan: NativeAudioPlan,
): Promise<ExportResult> {
	if (!session.native.nativeExportSessionId) {
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
		const renderedAudio = await hooks.renderEditedAudioForNativeMux(
			`${NATIVE_EXPORT_ENGINE_NAME} edited audio rendering`,
			(progress) =>
				session.progress.reportFinalizingProgress(
					session.metrics.processedFrameCount,
					99,
					progress,
				),
			audioPlan.sourceAudioFallbackPaths,
		);
		editedAudioBuffer = renderedAudio.editedAudioData;
		editedAudioMimeType = renderedAudio.editedAudioMimeType;
	}

	const sessionId = session.native.nativeExportSessionId;
	console.log(`[VideoExporter] Finalizing ${NATIVE_EXPORT_ENGINE_NAME} export`, {
		sessionId,
		audioMode: audioPlan.audioMode,
		editedTrackStrategy:
			audioPlan.audioMode === "edited-track" ? audioPlan.strategy : undefined,
		encoderName: session.metrics.encoderName ?? "unknown",
	});

	session.flow.flushPendingNativeWriteBatch(sessionId);
	await session.flow.awaitPendingNativeWrites();
	session.throwIfCancelled();

	const result = await session.progress.measureFinalizationStage(
		"nativeExportFinalizeMs",
		async () =>
			session.progress.awaitWithFinalizationTimeout(
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
					outputDurationSec: session.effectiveDurationSec,
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
		session.metrics.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
	}
	session.native.nativeExportSessionId = null;

	if (!result.success) {
		return {
			success: false,
			error: result.error || `Failed to finalize ${NATIVE_EXPORT_ENGINE_NAME} export`,
		};
	}

	session.metrics.encoderName = result.encoderName ?? session.metrics.encoderName;
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

export async function finalizeExportWithFfmpegAudio(
	session: Session,
	hooks: Hooks,
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
		const renderedAudio = await hooks.renderEditedAudioForNativeMux(
			"FFmpeg edited audio rendering",
			(progress) =>
				session.progress.reportFinalizingProgress(
					session.metrics.processedFrameCount,
					99,
					progress,
				),
			audioPlan.sourceAudioFallbackPaths,
		);
		editedAudioBuffer = renderedAudio.editedAudioData;
		editedAudioMimeType = renderedAudio.editedAudioMimeType;
	}

	session.throwIfCancelled();
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
		outputDurationSec: session.effectiveDurationSec,
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
		const result = await session.progress.measureFinalizationStage(
			"ffmpegAudioMuxMs",
			async () =>
				session.progress.awaitWithFinalizationTimeout(
					window.electronAPI.muxExportedVideoAudioFromPath(
						videoSource.tempFilePath,
						muxOptions,
					),
					"FFmpeg audio muxing",
					"audio",
				),
		);
		if (result.metrics) {
			session.metrics.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
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
	session.throwIfCancelled();
	const result = await session.progress.measureFinalizationStage("ffmpegAudioMuxMs", async () =>
		session.progress.awaitWithFinalizationTimeout(
			window.electronAPI.muxExportedVideoAudio(videoBuffer, muxOptions),
			"FFmpeg audio muxing",
			"audio",
		),
	);
	if (result.metrics) {
		session.metrics.finalizationStageMs.ffmpegAudioMuxBreakdown = result.metrics;
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
