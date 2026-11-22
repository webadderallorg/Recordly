import {
	advanceFinalizationProgress,
	type FinalizationTimeoutWorkload,
	withFinalizationTimeout,
} from "./finalizationTimeout";
import type { LegacyVideoExporterContext } from "./legacyVideoExporterContext";
import { PROGRESS_SAMPLE_WINDOW_MS } from "./legacyVideoExporterContext";
import type { ExportFinalizationStageMetrics, ExportMetrics, ExportProgress } from "./types";

export async function awaitWithFinalizationTimeout<T>(
	context: Pick<
		LegacyVideoExporterContext,
		"effectiveDurationSec" | "activeFinalizationProgressWatchdog"
	>,
	promise: Promise<T>,
	stage: string,
	workload: FinalizationTimeoutWorkload = "default",
	progressAware: boolean = false,
): Promise<T> {
	return withFinalizationTimeout({
		promise,
		stage,
		effectiveDurationSec: context.effectiveDurationSec,
		workload,
		progressAware,
		onWatchdogChanged: (watchdog) => {
			context.activeFinalizationProgressWatchdog = watchdog;
		},
	});
}

export function reportFinalizingProgress(
	context: Pick<
		LegacyVideoExporterContext,
		| "lastFinalizationRenderProgress"
		| "lastFinalizationAudioProgress"
		| "activeFinalizationProgressWatchdog"
		| "reportProgress"
	>,
	totalFrames: number,
	renderProgress: number,
	audioProgress?: number,
): void {
	const nextProgress = advanceFinalizationProgress({
		renderProgress,
		audioProgress,
		state: {
			lastRenderProgress: context.lastFinalizationRenderProgress,
			lastAudioProgress: context.lastFinalizationAudioProgress,
		},
	});
	if (nextProgress.progressed) {
		context.activeFinalizationProgressWatchdog?.refreshProgress();
	}
	context.lastFinalizationRenderProgress = nextProgress.lastRenderProgress;
	context.lastFinalizationAudioProgress = nextProgress.lastAudioProgress;
	context.reportProgress(totalFrames, totalFrames, "finalizing", renderProgress, audioProgress);
}

export function reportProgress(
	context: Pick<
		LegacyVideoExporterContext,
		| "getNowMs"
		| "exportStartTimeMs"
		| "progressSampleStartTimeMs"
		| "progressSampleStartFrame"
		| "config"
	>,
	currentFrame: number,
	totalFrames: number,
	phase: ExportProgress["phase"] = "extracting",
	renderProgress?: number,
	audioProgress?: number,
): void {
	const nowMs = context.getNowMs();
	const elapsedSeconds = Math.max((nowMs - context.exportStartTimeMs) / 1000, 0.001);
	const averageRenderFps = currentFrame / elapsedSeconds;
	const sampleElapsedMs = Math.max(nowMs - context.progressSampleStartTimeMs, 1);
	const sampleFrameDelta = Math.max(currentFrame - context.progressSampleStartFrame, 0);
	const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
	const remainingFrames = Math.max(totalFrames - currentFrame, 0);
	const estimatedTimeRemaining = averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
	const safeRenderProgress =
		phase === "finalizing" ? Math.max(0, Math.min(renderProgress ?? 100, 100)) : undefined;
	const percentage =
		phase === "finalizing"
			? (safeRenderProgress ?? 100)
			: totalFrames > 0
				? (currentFrame / totalFrames) * 100
				: 100;

	if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
		context.progressSampleStartTimeMs = nowMs;
		context.progressSampleStartFrame = currentFrame;
	}

	if (context.config.onProgress) {
		context.config.onProgress({
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

export function getNowMs(_context: Pick<LegacyVideoExporterContext, never>): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function measureFinalizationStage<T>(
	context: Pick<LegacyVideoExporterContext, "getNowMs" | "finalizationStageMs">,
	stage: keyof ExportFinalizationStageMetrics,
	task: () => Promise<T>,
): Promise<T> {
	const startedAt = context.getNowMs();
	try {
		return await task();
	} finally {
		context.finalizationStageMs[stage] = context.getNowMs() - startedAt;
	}
}

export function buildExportMetrics(
	context: Pick<
		LegacyVideoExporterContext,
		| "exportStartTimeMs"
		| "getNowMs"
		| "finalizationStageMs"
		| "finalizationTimeMs"
		| "processedFrameCount"
		| "effectiveDurationSec"
	>,
): ExportMetrics {
	const totalElapsedMs =
		context.exportStartTimeMs > 0 ? context.getNowMs() - context.exportStartTimeMs : 0;
	const hasFinalizationStageMetrics = Object.keys(context.finalizationStageMs).length > 0;

	return {
		totalElapsedMs,
		finalizationMs: context.finalizationTimeMs || undefined,
		frameCount: context.processedFrameCount || undefined,
		effectiveDurationSec: context.effectiveDurationSec || undefined,
		finalizationStageMs: hasFinalizationStageMetrics ? context.finalizationStageMs : undefined,
	};
}
