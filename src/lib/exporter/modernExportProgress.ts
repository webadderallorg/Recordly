import {
	advanceFinalizationProgress,
	type FinalizationProgressWatchdog,
	type FinalizationTimeoutWorkload,
	INITIAL_FINALIZATION_PROGRESS_STATE,
	withFinalizationTimeout,
} from "./finalizationTimeout";
import type { ModernExportSession } from "./modernExportSession";
import type { ExportFinalizationStageMetrics, ExportProgress } from "./types";

/** Owns progress sampling and finalization watchdog state. */
type Session = Pick<
	ModernExportSession,
	"browser" | "config" | "effectiveDurationSec" | "flow" | "metrics" | "native"
>;

export class ModernExportProgress {
	exportStartTimeMs = 0;
	lastThroughputLogTimeMs = 0;
	nativeStaticLayoutAverageFps: number | null = null;
	activeFinalizationProgressWatchdog: FinalizationProgressWatchdog | null = null;
	lastFinalizationRenderProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
	lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
	lastProgressSampleTimeMs = 0;
	lastProgressSampleFrame = 0;
	displayedRenderFps = 0;
	renderCompletedAtMs: number | null = null;
	constructor(
		private readonly session: Session,
		private readonly now: () => number,
	) {}

	reset(): void {
		this.exportStartTimeMs = 0;
		this.lastThroughputLogTimeMs = 0;
		this.activeFinalizationProgressWatchdog = null;
		this.lastFinalizationRenderProgress =
			INITIAL_FINALIZATION_PROGRESS_STATE.lastRenderProgress;
		this.lastFinalizationAudioProgress = INITIAL_FINALIZATION_PROGRESS_STATE.lastAudioProgress;
		this.lastProgressSampleTimeMs = 0;
		this.lastProgressSampleFrame = 0;
		this.displayedRenderFps = 0;
		this.renderCompletedAtMs = null;
		this.nativeStaticLayoutAverageFps = null;
	}

	async awaitWithFinalizationTimeout<T>(
		promise: Promise<T>,
		stage: string,
		workload: FinalizationTimeoutWorkload = "default",
		progressAware: boolean = false,
	): Promise<T> {
		return withFinalizationTimeout({
			promise,
			stage,
			effectiveDurationSec: this.session.effectiveDurationSec,
			workload,
			progressAware,
			onWatchdogChanged: (watchdog) => {
				this.activeFinalizationProgressWatchdog = watchdog;
			},
		});
	}

	reportFinalizingProgress(
		totalFrames: number,
		renderProgress: number,
		audioProgress?: number,
	): void {
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

	reportProgress(
		currentFrame: number,
		totalFrames: number,
		phase: ExportProgress["phase"] = "extracting",
		renderProgress?: number,
		audioProgress?: number,
	): void {
		const nowMs = this.now();
		if (phase === "finalizing" && this.renderCompletedAtMs === null)
			this.renderCompletedAtMs = nowMs;
		const renderNowMs = this.renderCompletedAtMs ?? nowMs;
		const elapsedSeconds = Math.max((renderNowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.lastProgressSampleTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.lastProgressSampleFrame, 0);
		const sampleRenderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		if (this.nativeStaticLayoutAverageFps !== null) {
			this.displayedRenderFps = this.nativeStaticLayoutAverageFps;
		} else if (
			phase === "extracting" &&
			sampleFrameDelta > 0 &&
			(sampleElapsedMs >= 500 || currentFrame === totalFrames)
		) {
			this.displayedRenderFps =
				this.displayedRenderFps > 0
					? this.displayedRenderFps * 0.35 + sampleRenderFps * 0.65
					: sampleRenderFps;
		} else if (phase === "extracting" && this.displayedRenderFps <= 0) {
			this.displayedRenderFps = averageRenderFps;
		}
		const displayedRenderFps =
			this.displayedRenderFps > 0 ? this.displayedRenderFps : undefined;
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
			const safeFrameCount = Math.max(this.session.metrics.processedFrameCount, 1);
			this.session.metrics.peakEncodeQueueSize = Math.max(
				this.session.metrics.peakEncodeQueueSize,
				this.session.flow.getCurrentEncodeBacklog(),
			);
			console.log(
				`[VideoExporter] Progress ${JSON.stringify({
					phase,
					currentFrame,
					totalFrames,
					renderElapsedSec:
						phase === "preparing" ? undefined : Number(elapsedSeconds.toFixed(2)),
					attemptElapsedSec:
						this.session.metrics.totalExportStartTimeMs > 0
							? Number(
									(
										(nowMs - this.session.metrics.totalExportStartTimeMs) /
										1000
									).toFixed(2),
								)
							: undefined,
					averageRenderFps:
						phase === "preparing" ? undefined : Number(averageRenderFps.toFixed(1)),
					sampleRenderFps:
						phase === "extracting" ? Number(sampleRenderFps.toFixed(1)) : undefined,
					displayedRenderFps:
						displayedRenderFps === undefined
							? undefined
							: Number(displayedRenderFps.toFixed(1)),
					renderBackend: this.session.metrics.renderBackend ?? undefined,
					encodeBackend: this.session.metrics.encodeBackend ?? undefined,
					encoderName: this.session.metrics.encoderName ?? undefined,
					encoderQueueSize:
						this.session.native.nativeH264Encoder?.encodeQueueSize ??
						this.session.browser.encoder?.encodeQueueSize,
					pendingEncodeQueue: this.session.flow.encodeQueue,
					encodeBacklog: this.session.flow.getCurrentEncodeBacklog(),
					peakEncodeQueueSize: this.session.metrics.peakEncodeQueueSize,
					nativeWriteInFlight: this.session.flow.nativeWritePromises.size,
					peakNativeWriteInFlight: this.session.metrics.peakNativeWriteInFlight,
					averageFrameCallbackMs: Number(
						(this.session.metrics.frameCallbackTimeMs / safeFrameCount).toFixed(3),
					),
					averageRenderFrameMs: Number(
						(this.session.metrics.renderFrameTimeMs / safeFrameCount).toFixed(3),
					),
					averageEncodeWaitMs: Number(
						(this.session.metrics.encodeWaitTimeMs / safeFrameCount).toFixed(3),
					),
					averageNativeCaptureMs:
						this.session.metrics.nativeCaptureTimeMs > 0
							? Number(
									(
										this.session.metrics.nativeCaptureTimeMs / safeFrameCount
									).toFixed(3),
								)
							: undefined,
					averageNativeWriteMs:
						this.session.metrics.nativeWriteTimeMs > 0
							? Number(
									(
										this.session.metrics.nativeWriteTimeMs / safeFrameCount
									).toFixed(3),
								)
							: undefined,
				})}`,
			);
			this.lastThroughputLogTimeMs = nowMs;
			if (phase === "extracting") {
				this.lastProgressSampleTimeMs = nowMs;
				this.lastProgressSampleFrame = currentFrame;
			}
		}

		if (this.session.config.onProgress) {
			this.session.config.onProgress({
				currentFrame,
				totalFrames,
				percentage,
				estimatedTimeRemaining,
				renderFps: displayedRenderFps,
				renderBackend: this.session.metrics.renderBackend ?? undefined,
				encodeBackend: this.session.metrics.encodeBackend ?? undefined,
				encoderName: this.session.metrics.encoderName ?? undefined,
				nativeStaticLayoutSkipReason:
					this.session.native.nativeStaticLayoutSkipReason ?? undefined,
				nativeStaticLayoutSkipReasons:
					this.session.native.nativeStaticLayoutSkipReasons.length > 0
						? this.session.native.nativeStaticLayoutSkipReasons
						: undefined,
				phase,
				renderProgress: safeRenderProgress,
				audioProgress,
			});
		}
	}

	async measureFinalizationStage<T>(
		stage: keyof ExportFinalizationStageMetrics,
		task: () => Promise<T>,
	): Promise<T> {
		const startedAt = this.now();
		try {
			return await task();
		} finally {
			this.session.metrics.finalizationStageMs[stage] = this.now() - startedAt;
		}
	}
}
