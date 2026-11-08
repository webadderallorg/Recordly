import { INITIAL_FINALIZATION_PROGRESS_STATE } from "./finalizationTimeout";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";

export function cancel(
	context: Pick<
		LegacyVideoExporterContext,
		"cancelled" | "streamingDecoder" | "audioProcessor" | "cleanup"
	>,
): void {
	context.cancelled = true;
	if (context.streamingDecoder) {
		context.streamingDecoder.cancel();
	}
	if (context.audioProcessor) {
		context.audioProcessor.cancel();
	}
	context.cleanup();
}

export function cleanup(
	context: Pick<
		LegacyVideoExporterContext,
		| "nativeH264Encoder"
		| "nativeExportSessionId"
		| "encoder"
		| "streamingDecoder"
		| "renderer"
		| "muxer"
		| "audioProcessor"
		| "activeFinalizationProgressWatchdog"
		| "lastFinalizationRenderProgress"
		| "lastFinalizationAudioProgress"
		| "encodeQueue"
		| "pendingMuxing"
		| "nativePendingWrite"
		| "chunkCount"
		| "effectiveDurationSec"
		| "encoderError"
		| "finalizationTimeMs"
		| "finalizationStageMs"
		| "processedFrameCount"
		| "videoDescription"
		| "videoColorSpace"
	>,
): void {
	if (context.nativeH264Encoder) {
		try {
			if (context.nativeH264Encoder.state === "configured") {
				context.nativeH264Encoder.close();
			}
		} catch (e) {
			console.warn("Error closing native H264 encoder:", e);
		}
		context.nativeH264Encoder = null;
	}

	if (context.nativeExportSessionId) {
		if (typeof window !== "undefined") {
			void window.electronAPI?.nativeVideoExportCancel?.(context.nativeExportSessionId);
		}
		context.nativeExportSessionId = null;
	}

	if (context.encoder) {
		try {
			if (context.encoder.state === "configured") {
				context.encoder.close();
			}
		} catch (e) {
			console.warn("Error closing encoder:", e);
		}
		context.encoder = null;
	}

	if (context.streamingDecoder) {
		try {
			context.streamingDecoder.destroy();
		} catch (e) {
			console.warn("Error destroying streaming decoder:", e);
		}
		context.streamingDecoder = null;
	}

	if (context.renderer) {
		try {
			context.renderer.destroy();
		} catch (e) {
			console.warn("Error destroying renderer:", e);
		}
		context.renderer = null;
	}

	if (context.muxer) {
		try {
			context.muxer.destroy();
		} catch (e) {
			console.warn("Error destroying muxer:", e);
		}
	}

	context.muxer = null;
	context.audioProcessor?.cancel();
	context.audioProcessor = null;
	context.activeFinalizationProgressWatchdog = null;
	context.lastFinalizationRenderProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
	context.lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
	context.encodeQueue = 0;
	context.pendingMuxing = Promise.resolve();
	context.nativePendingWrite = Promise.resolve();
	context.chunkCount = 0;
	context.effectiveDurationSec = 0;
	context.encoderError = null;
	context.finalizationTimeMs = 0;
	context.finalizationStageMs = {};
	context.effectiveDurationSec = 0;
	context.processedFrameCount = 0;
	context.videoDescription = undefined;
	context.videoColorSpace = undefined;
}
