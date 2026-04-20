import type { ExportMetrics, ExportProgress } from "../types";
import {
	type ExporterHost,
	FINALIZATION_TIMEOUT_MS,
} from "./exporterTypes";

export function getNowMs(): number {
	if (typeof performance !== "undefined" && typeof performance.now === "function") {
		return performance.now();
	}
	return Date.now();
}

export function getCurrentEncodeBacklog(host: ExporterHost): number {
	return Math.max(host.encoder?.encodeQueueSize ?? 0, host.encodeQueue);
}

export async function awaitWithFinalizationTimeout<T>(
	promise: Promise<T>,
	stage: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutId = setTimeout(() => {
					reject(
						new Error(
							`Export timed out during ${stage} after ${Math.round(FINALIZATION_TIMEOUT_MS / 60_000)} minutes`,
						),
					);
				}, FINALIZATION_TIMEOUT_MS);
			}),
		]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

export function reportFinalizingProgress(
	host: ExporterHost,
	totalFrames: number,
	renderProgress: number,
	audioProgress?: number,
): void {
	reportProgress(host, totalFrames, totalFrames, "finalizing", renderProgress, audioProgress);
}

export function reportProgress(
	host: ExporterHost,
	currentFrame: number,
	totalFrames: number,
	phase: ExportProgress["phase"] = "extracting",
	renderProgress?: number,
	audioProgress?: number,
): void {
	const nowMs = getNowMs();
	const elapsedSeconds = Math.max((nowMs - host.exportStartTimeMs) / 1000, 0.001);
	const averageRenderFps = currentFrame / elapsedSeconds;
	const sampleElapsedMs = Math.max(nowMs - host.lastProgressSampleTimeMs, 1);
	const sampleFrameDelta = Math.max(currentFrame - host.lastProgressSampleFrame, 0);
	const sampleRenderFps = (sampleFrameDelta * 1000) / sampleElapsedMs;
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

	if (nowMs - host.lastThroughputLogTimeMs >= 1000 || currentFrame === totalFrames) {
		const safeFrameCount = Math.max(host.processedFrameCount, 1);
		host.peakEncodeQueueSize = Math.max(
			host.peakEncodeQueueSize,
			getCurrentEncodeBacklog(host),
		);
		console.log(
			`[VideoExporter] Progress ${JSON.stringify({
				phase,
				currentFrame,
				totalFrames,
				elapsedSec: Number(elapsedSeconds.toFixed(2)),
				averageRenderFps: Number(averageRenderFps.toFixed(1)),
				sampleRenderFps: Number(sampleRenderFps.toFixed(1)),
				renderBackend: host.renderBackend ?? undefined,
				encodeBackend: host.encodeBackend ?? undefined,
				encoderName: host.encoderName ?? undefined,
				encoderQueueSize: host.encoder?.encodeQueueSize ?? 0,
				pendingEncodeQueue: host.encodeQueue,
				encodeBacklog: getCurrentEncodeBacklog(host),
				peakEncodeQueueSize: host.peakEncodeQueueSize,
				nativeWriteInFlight: host.nativeWritePromises.size,
				peakNativeWriteInFlight: host.peakNativeWriteInFlight,
				averageFrameCallbackMs: Number(
					(host.frameCallbackTimeMs / safeFrameCount).toFixed(3),
				),
				averageRenderFrameMs: Number(
					(host.renderFrameTimeMs / safeFrameCount).toFixed(3),
				),
				averageEncodeWaitMs: Number(
					(host.encodeWaitTimeMs / safeFrameCount).toFixed(3),
				),
				averageNativeCaptureMs:
					host.nativeCaptureTimeMs > 0
						? Number((host.nativeCaptureTimeMs / safeFrameCount).toFixed(3))
						: undefined,
				averageNativeWriteMs:
					host.nativeWriteTimeMs > 0
						? Number((host.nativeWriteTimeMs / safeFrameCount).toFixed(3))
						: undefined,
			})}`,
		);
		host.lastThroughputLogTimeMs = nowMs;
		host.lastProgressSampleTimeMs = nowMs;
		host.lastProgressSampleFrame = currentFrame;
	}

	if (host.config.onProgress) {
		host.config.onProgress({
			currentFrame,
			totalFrames,
			percentage,
			estimatedTimeRemaining,
			renderFps: sampleRenderFps,
			renderBackend: host.renderBackend ?? undefined,
			encodeBackend: host.encodeBackend ?? undefined,
			encoderName: host.encoderName ?? undefined,
			phase,
			renderProgress: safeRenderProgress,
			audioProgress,
		});
	}
}

export function buildExportMetrics(host: ExporterHost): ExportMetrics {
	const totalElapsedMs =
		host.totalExportStartTimeMs > 0 ? getNowMs() - host.totalExportStartTimeMs : 0;
	const safeFrameCount = Math.max(host.processedFrameCount, 1);

	return {
		totalElapsedMs,
		metadataLoadMs: host.metadataLoadTimeMs,
		rendererInitMs: host.rendererInitTimeMs,
		nativeSessionStartMs: host.nativeSessionStartTimeMs,
		decodeLoopMs: host.decodeLoopTimeMs,
		frameCallbackMs: host.frameCallbackTimeMs,
		renderFrameMs: host.renderFrameTimeMs,
		encodeWaitMs: host.encodeWaitTimeMs,
		encodeWaitEvents: host.encodeWaitEvents,
		peakEncodeQueueSize: host.peakEncodeQueueSize,
		peakNativeWriteInFlight: host.peakNativeWriteInFlight,
		nativeCaptureMs: host.nativeCaptureTimeMs,
		nativeWriteMs: host.nativeWriteTimeMs,
		finalizationMs: host.finalizationTimeMs,
		frameCount: host.processedFrameCount,
		renderBackend: host.renderBackend ?? undefined,
		encodeBackend: host.encodeBackend ?? undefined,
		encoderName: host.encoderName ?? undefined,
		backpressureProfile: host.backpressureProfile?.name,
		averageFrameCallbackMs:
			host.processedFrameCount > 0
				? host.frameCallbackTimeMs / safeFrameCount
				: undefined,
		averageRenderFrameMs:
			host.processedFrameCount > 0 ? host.renderFrameTimeMs / safeFrameCount : undefined,
		averageEncodeWaitMs:
			host.processedFrameCount > 0 ? host.encodeWaitTimeMs / safeFrameCount : undefined,
		averageNativeCaptureMs:
			host.processedFrameCount > 0
				? host.nativeCaptureTimeMs / safeFrameCount
				: undefined,
		averageNativeWriteMs:
			host.processedFrameCount > 0 ? host.nativeWriteTimeMs / safeFrameCount : undefined,
	};
}
