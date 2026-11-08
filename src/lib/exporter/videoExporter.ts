import { AudioProcessor } from "./audioEncoder";
import {
	type FinalizationProgressWatchdog,
	type FinalizationTimeoutWorkload,
	INITIAL_FINALIZATION_PROGRESS_STATE,
} from "./finalizationTimeout";
import { FrameRenderer } from "./frameRenderer";
import {
	buildNativeAudioPlan as buildNativeAudioPlanOperation,
	buildNativeTrimSegments as buildNativeTrimSegmentsOperation,
	getNativeVideoSourcePath as getNativeVideoSourcePathOperation,
} from "./legacyVideoAudioPlan";
import {
	encodeRenderedFrame as encodeRenderedFrameOperation,
	initializeEncoder as initializeEncoderOperation,
} from "./legacyVideoEncoding";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import { NativeAudioPlan, VideoExporterConfig } from "./legacyVideoExporterContext";
import { runLegacyVideoExport as exportOperation } from "./legacyVideoExportPipeline";
import {
	finalizeExportWithFfmpegAudio as finalizeExportWithFfmpegAudioOperation,
	finishNativeVideoExport as finishNativeVideoExportOperation,
} from "./legacyVideoFinalization";
import { cancel as cancelOperation, cleanup as cleanupOperation } from "./legacyVideoLifecycle";
import {
	awaitOldestNativeWrite as awaitOldestNativeWriteOperation,
	awaitPendingNativeWrites as awaitPendingNativeWritesOperation,
	encodeRenderedFrameNative as encodeRenderedFrameNativeOperation,
	shouldUseExperimentalNativeExport as shouldUseExperimentalNativeExportOperation,
	trackNativeWritePromise as trackNativeWritePromiseOperation,
	tryStartNativeVideoExport as tryStartNativeVideoExportOperation,
} from "./legacyVideoNativeEncoder";
import {
	awaitWithFinalizationTimeout as awaitWithFinalizationTimeoutOperation,
	buildExportMetrics as buildExportMetricsOperation,
	getNowMs as getNowMsOperation,
	measureFinalizationStage as measureFinalizationStageOperation,
	reportFinalizingProgress as reportFinalizingProgressOperation,
	reportProgress as reportProgressOperation,
} from "./legacyVideoProgress";
import { VideoMuxer } from "./muxer";
import { type DecodedVideoInfo, StreamingVideoDecoder } from "./streamingDecoder";
import type {
	ExportFinalizationStageMetrics,
	ExportMetrics,
	ExportProgress,
	ExportResult,
} from "./types";

export class VideoExporter {
	private get context(): LegacyVideoExporterContext {
		// Preserve one shared resource owner across the focused rendering/export operations.
		return this as unknown as LegacyVideoExporterContext;
	}

	protected config: VideoExporterConfig;

	protected streamingDecoder: StreamingVideoDecoder | null = null;

	protected renderer: FrameRenderer | null = null;

	protected encoder: VideoEncoder | null = null;

	protected muxer: VideoMuxer | null = null;

	protected audioProcessor: AudioProcessor | null = null;

	protected cancelled = false;

	protected encodeQueue = 0;

	protected videoDescription: Uint8Array | undefined;

	protected videoColorSpace: VideoColorSpaceInit | undefined;

	protected pendingMuxing: Promise<void> = Promise.resolve();

	protected chunkCount = 0;

	protected effectiveDurationSec = 0;

	protected exportStartTimeMs = 0;

	protected progressSampleStartTimeMs = 0;

	protected progressSampleStartFrame = 0;

	protected encoderError: Error | null = null;

	protected nativeExportSessionId: string | null = null;

	protected nativeH264Encoder: VideoEncoder | null = null;

	protected nativePendingWrite: Promise<void> = Promise.resolve();

	protected nativeWritePromises = new Set<Promise<void>>();

	protected nativeWriteError: Error | null = null;

	protected maxNativeWriteInFlight = 1;

	protected nativeEncoderError: Error | null = null;

	protected activeFinalizationProgressWatchdog: FinalizationProgressWatchdog | null = null;

	protected lastFinalizationRenderProgress =
		INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;

	protected lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;

	protected finalizationTimeMs = 0;

	protected finalizationStageMs: ExportFinalizationStageMetrics = {};

	protected processedFrameCount = 0;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		return exportOperation(this.context);
	}

	protected shouldUseExperimentalNativeExport(): boolean {
		return shouldUseExperimentalNativeExportOperation(this.context);
	}

	protected async awaitWithFinalizationTimeout<T>(
		promise: Promise<T>,
		stage: string,
		workload: FinalizationTimeoutWorkload = "default",
		progressAware = false,
	): Promise<T> {
		return awaitWithFinalizationTimeoutOperation(
			this.context,
			promise,
			stage,
			workload,
			progressAware,
		);
	}

	protected getNativeVideoSourcePath(): string | null {
		return getNativeVideoSourcePathOperation(this.context);
	}

	protected buildNativeTrimSegments(
		durationMs: number,
	): Array<{ startMs: number; endMs: number }> {
		return buildNativeTrimSegmentsOperation(this.context, durationMs);
	}

	protected buildNativeAudioPlan(videoInfo: DecodedVideoInfo): NativeAudioPlan {
		return buildNativeAudioPlanOperation(this.context, videoInfo);
	}

	protected async tryStartNativeVideoExport(): Promise<boolean> {
		return tryStartNativeVideoExportOperation(this.context);
	}

	protected async encodeRenderedFrameNative(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	): Promise<void> {
		return encodeRenderedFrameNativeOperation(
			this.context,
			timestamp,
			frameDuration,
			frameIndex,
		);
	}

	protected async finishNativeVideoExport(
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<ExportResult> {
		return finishNativeVideoExportOperation(this.context, audioPlan, totalFrames);
	}

	protected async finalizeExportWithFfmpegAudio(
		videoSource: import("./muxer").MuxerFinalizeResult,
		audioPlan: NativeAudioPlan,
		totalFrames: number,
	): Promise<ExportResult> {
		return finalizeExportWithFfmpegAudioOperation(
			this.context,
			videoSource,
			audioPlan,
			totalFrames,
		);
	}

	protected async encodeRenderedFrame(
		timestamp: number,
		frameDuration: number,
		frameIndex: number,
	) {
		return encodeRenderedFrameOperation(this.context, timestamp, frameDuration, frameIndex);
	}

	protected trackNativeWritePromise(writePromise: Promise<void>): void {
		return trackNativeWritePromiseOperation(this.context, writePromise);
	}

	protected async awaitOldestNativeWrite(): Promise<void> {
		return awaitOldestNativeWriteOperation(this.context);
	}

	protected async awaitPendingNativeWrites(): Promise<void> {
		return awaitPendingNativeWritesOperation(this.context);
	}

	protected reportFinalizingProgress(
		totalFrames: number,
		renderProgress: number,
		audioProgress?: number,
	) {
		return reportFinalizingProgressOperation(
			this.context,
			totalFrames,
			renderProgress,
			audioProgress,
		);
	}

	protected reportProgress(
		currentFrame: number,
		totalFrames: number,
		phase: ExportProgress["phase"] = "extracting",
		renderProgress?: number,
		audioProgress?: number,
	) {
		return reportProgressOperation(
			this.context,
			currentFrame,
			totalFrames,
			phase,
			renderProgress,
			audioProgress,
		);
	}

	protected getNowMs(): number {
		return getNowMsOperation(this.context);
	}

	protected async measureFinalizationStage<T>(
		stage: keyof ExportFinalizationStageMetrics,
		task: () => Promise<T>,
	): Promise<T> {
		return measureFinalizationStageOperation(this.context, stage, task);
	}

	protected buildExportMetrics(): ExportMetrics {
		return buildExportMetricsOperation(this.context);
	}

	protected async initializeEncoder(): Promise<void> {
		return initializeEncoderOperation(this.context);
	}

	cancel(): void {
		return cancelOperation(this.context);
	}

	protected cleanup(): void {
		return cleanupOperation(this.context);
	}
}
