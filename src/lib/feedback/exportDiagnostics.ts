import type { ExportProgress, ExportResult, ExportSettings } from "@/lib/exporter/types";
import { redactDiagnostic } from "./diagnosticRedaction";

const entries: string[] = [];
let writes: Promise<unknown> = Promise.resolve();

/** Keep export details out of the progress UI, but available in support reports. */
export function recordExportDiagnostic(event: string, details: Record<string, unknown> = {}) {
	// Callers must explicitly select diagnostic fields, never pass project/config objects.
	const message = redactDiagnostic(`[export] ${event} ${JSON.stringify(details)}`).slice(0, 1900);
	const entry = `${new Date().toISOString()} info: ${message}`;
	entries.push(entry);
	if (entries.length > 60) entries.shift();
	if (typeof window !== "undefined" && window.electronAPI?.appendExportDiagnostic) {
		writes = writes
			.then(() => window.electronAPI.appendExportDiagnostic(entry))
			.catch(() => undefined);
	}
}

export async function getExportDiagnosticLogs(): Promise<string[]> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const saved = await Promise.race([
			writes.then(() => window.electronAPI?.getExportDiagnostics?.()),
			new Promise<undefined>((resolve) => {
				timeout = setTimeout(() => resolve(undefined), 1500);
			}),
		]);
		if (saved?.success && Array.isArray(saved.logs))
			return [...new Set([...saved.logs, ...entries])].slice(-60);
	} catch {
		// Disk logging and feedback collection must never prevent reporting a problem.
	} finally {
		clearTimeout(timeout);
	}
	return [...entries];
}

export function createExportDiagnostics(
	settings: ExportSettings,
	destination: "download" | "share",
) {
	const started = performance.now();
	const attempt = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const record = (event: string, fields: Record<string, unknown> = {}) =>
		recordExportDiagnostic(event, { attempt, ...fields });
	record("started", {
		format: settings.format,
		destination,
		quality: settings.quality,
		encodingMode: settings.encodingMode,
		frameRate:
			settings.format === "gif" ? settings.gifConfig?.frameRate : settings.mp4FrameRate,
		width: settings.format === "gif" ? settings.gifConfig?.width : undefined,
		height: settings.format === "gif" ? settings.gifConfig?.height : undefined,
		pipelineModel: settings.pipelineModel,
		backendPreference: settings.backendPreference,
	});
	let lastProgressKey = "";
	let lastFrame: number | undefined;
	let frameCounterEpoch = 0;
	return {
		record,
		progress(progress: ExportProgress) {
			if (
				phaseHasFrames(progress) &&
				lastFrame !== undefined &&
				progress.currentFrame < lastFrame
			)
				frameCounterEpoch++;
			if (phaseHasFrames(progress)) lastFrame = progress.currentFrame;
			const key = JSON.stringify([
				progress.phase,
				frameCounterEpoch,
				Math.floor(progress.percentage / 10),
				progress.renderBackend,
				progress.encodeBackend,
				progress.encoderName,
			]);
			if (key === lastProgressKey) return;
			lastProgressKey = key;
			record("progress", {
				phase: progress.phase ?? "rendering",
				frameCounterEpoch,
				percentage: Math.round(progress.percentage),
				currentFrame: progress.currentFrame,
				totalFrames: progress.totalFrames,
				renderFps: progress.renderFps,
				renderBackend: progress.renderBackend,
				encodeBackend: progress.encodeBackend,
				encoderName: progress.encoderName,
				nativeStaticLayoutSkipReason: progress.nativeStaticLayoutSkipReason,
			});
		},
		result(result: ExportResult) {
			const metrics = result.metrics;
			const snapshot = metrics?.diagnostics;
			if (snapshot) {
				record("environment", {
					platform: snapshot.environment.platform,
					hardwareInfoStatus: snapshot.environment.hardwareInfoStatus,
					appVersion: snapshot.environment.appVersion,
					runtimeInfoStatus: snapshot.environment.runtimeInfoStatus,
					runtime: snapshot.environment.runtime,
					arch: snapshot.environment.arch,
					gpus: snapshot.environment.gpus?.slice(0, 4).map((gpu) => ({
						name: gpu.name.slice(0, 120),
						vendor: gpu.vendor?.slice(0, 80),
						active: gpu.active,
					})),
					gpuFeatures: snapshot.environment.gpuFeatures
						? {
								videoDecode: snapshot.environment.gpuFeatures.videoDecode,
								videoEncode: snapshot.environment.gpuFeatures.videoEncode,
								webgl: snapshot.environment.gpuFeatures.webgl,
								webgpu: snapshot.environment.gpuFeatures.webgpu,
							}
						: undefined,
				});
				for (const attempt of snapshot.attempts.slice(0, 24)) {
					record("backend", {
						route: attempt.route,
						status: attempt.status,
						exportElapsedMs: attempt.elapsedMs,
						codec: attempt.codec,
						hardwareAcceleration: attempt.hardwareAcceleration,
						latencyMode: attempt.latencyMode,
						reason: attempt.reason?.slice(0, 300),
					});
				}
				record("encoder", {
					requestedBackend: snapshot.requestedBackend,
					api: snapshot.encoder?.api,
					codec: snapshot.encoder?.codec,
					hardwareAcceleration: snapshot.encoder?.hardwareAcceleration,
					hardwareEncoder: snapshot.encoder?.hardwareEncoder,
					latencyMode: snapshot.encoder?.latencyMode,
					muxer: snapshot.muxer,
				});
			}
			if (metrics)
				record("timings", {
					exportElapsedMs: snapshot?.elapsedMs,
					currentAttemptElapsedMs: metrics.totalElapsedMs,
					metadataLoadMs: metrics.metadataLoadMs,
					rendererInitMs: metrics.rendererInitMs,
					nativeSessionStartMs: metrics.nativeSessionStartMs,
					decodeLoopMs: metrics.decodeLoopMs,
					frameCallbackMs: metrics.frameCallbackMs,
					renderFrameMs: metrics.renderFrameMs,
					encodeWaitMs: metrics.encodeWaitMs,
					encodeWaitEvents: metrics.encodeWaitEvents,
					nativeCaptureMs: metrics.nativeCaptureMs,
					nativeWriteMs: metrics.nativeWriteMs,
					finalizationMs: metrics.finalizationMs,
					encoderFlushMs: metrics.finalizationStageMs?.encoderFlushMs,
					muxerFinalizeMs: metrics.finalizationStageMs?.muxerFinalizeMs,
					ffmpegAudioMuxMs: metrics.finalizationStageMs?.ffmpegAudioMuxMs,
				});
			record(result.success ? "rendered" : "failed", {
				error: result.error ? redactDiagnostic(result.error).slice(0, 500) : undefined,
				elapsedMs: Math.round(performance.now() - started),
				frameCount: result.metrics?.frameCount,
				currentAttemptElapsedMs: result.metrics?.totalElapsedMs,
				renderFrameMs: result.metrics?.renderFrameMs,
				finalizationMs: result.metrics?.finalizationMs,
				peakEncodeQueueSize: result.metrics?.peakEncodeQueueSize,
				renderBackend: result.metrics?.renderBackend,
				encodeBackend: result.metrics?.encodeBackend,
				encoderName: result.metrics?.encoderName,
				nativeStaticLayoutSkipReason: result.metrics?.nativeStaticLayoutSkipReason,
				nativeStaticLayoutSkipReasons: result.metrics?.nativeStaticLayoutSkipReasons?.slice(
					0,
					12,
				),
			});
		},
	};
}

function phaseHasFrames(progress: ExportProgress) {
	return progress.phase === "extracting" && Number.isFinite(progress.currentFrame);
}
