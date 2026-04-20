import type { ExportProgress } from "../types";
import type { VideoExporterConfig } from "./shared";
import { PROGRESS_SAMPLE_WINDOW_MS } from "./shared";

export abstract class VideoExporterProgressBase {
	protected readonly FINALIZATION_TIMEOUT_MS = 600_000;
	protected exportStartTimeMs = 0;
	protected progressSampleStartTimeMs = 0;
	protected progressSampleStartFrame = 0;

	constructor(protected config: VideoExporterConfig) {}

	protected async awaitWithFinalizationTimeout<T>(promise: Promise<T>, stage: string): Promise<T> {
		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timeoutId = setTimeout(() => {
						reject(
							new Error(
								`Export timed out during ${stage} after ${Math.round(this.FINALIZATION_TIMEOUT_MS / 60_000)} minutes`,
							),
						);
					}, this.FINALIZATION_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
	}

	protected reportFinalizingProgress(
		totalFrames: number,
		renderProgress: number,
		audioProgress?: number,
	) {
		this.reportProgress(totalFrames, totalFrames, "finalizing", renderProgress, audioProgress);
	}

	protected reportProgress(
		currentFrame: number,
		totalFrames: number,
		phase: ExportProgress["phase"] = "extracting",
		renderProgress?: number,
		audioProgress?: number,
	) {
		const nowMs = this.getNowMs();
		const elapsedSeconds = Math.max((nowMs - this.exportStartTimeMs) / 1000, 0.001);
		const averageRenderFps = currentFrame / elapsedSeconds;
		const sampleElapsedMs = Math.max(nowMs - this.progressSampleStartTimeMs, 1);
		const sampleFrameDelta = Math.max(currentFrame - this.progressSampleStartFrame, 0);
		const renderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
		const remainingFrames = Math.max(totalFrames - currentFrame, 0);
		const estimatedTimeRemaining =
			averageRenderFps > 0 ? remainingFrames / averageRenderFps : 0;
		const safeRenderProgress =
			phase === "finalizing" ? Math.max(0, Math.min(renderProgress ?? 100, 100)) : undefined;
		const percentage =
			phase === "finalizing"
				? (safeRenderProgress ?? 100)
				: totalFrames > 0
					? (currentFrame / totalFrames) * 100
					: 100;

		if (sampleElapsedMs >= PROGRESS_SAMPLE_WINDOW_MS) {
			this.progressSampleStartTimeMs = nowMs;
			this.progressSampleStartFrame = currentFrame;
		}

		this.config.onProgress?.({
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

	protected getNowMs(): number {
		return typeof performance !== "undefined" ? performance.now() : Date.now();
	}
}