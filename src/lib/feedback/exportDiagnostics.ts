import type { DecodedVideoInfo } from "@/lib/exporter/streamingDecoderSupport";
import type {
	ExportBackendAttempt,
	ExportProgress,
	ExportResult,
	ExportSettings,
} from "@/lib/exporter/types";
import { newDiagnosticId, type startDiagnosticOperation } from "../../shared/operationDiagnostics";
import { redactDiagnostic, redactDiagnosticLogEntry } from "./diagnosticRedaction";

const entries: string[] = [];
let writes: Promise<unknown> = Promise.resolve();
const CHECKPOINT_INTERVAL_MS = 5_000;
const STALL_THRESHOLD_MS = 15_000;

function failureDetails(message: string) {
	const reason = message.match(/^Reason: (.*)$/m)?.[1] ?? message.trim().split("\n")[0];
	const code =
		reason.match(/\[([A-Z][A-Z0-9_]+)\]/)?.[1] ??
		message.match(
			/\b(EACCES|EPERM|ENOENT|ENOSPC|EDQUOT|EIO|EPIPE|ENOMEM|EMFILE|ETIMEDOUT|TimeoutError|QuotaExceededError|NotSupportedError|AbortError)\b/,
		)?.[1];
	return { reason: redactDiagnostic(reason).slice(0, 400), code: code?.slice(0, 64) };
}

/** Keep export details out of the progress UI, but available in support reports. */
export function recordExportDiagnostic(event: string, details: Record<string, unknown> = {}) {
	// Callers must explicitly select diagnostic fields, never pass project/config objects.
	const entry = redactDiagnosticLogEntry(
		`${new Date().toISOString()} info: [export] ${event} ${JSON.stringify(details)}`,
	);
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
	operation?: ReturnType<typeof startDiagnosticOperation>,
) {
	const started = performance.now();
	const attempt = operation?.id ?? newDiagnosticId();
	let exportOutcome: "succeeded" | "failed" | "cancelled" | "blocked" = "failed";
	let currentStage = "starting";
	let currentFrame: number | undefined;
	let lastCompletedFrame: number | undefined;
	let lastActivityAt = started;
	let lastCheckpointAt = started;
	let lastStallAt: number | undefined;
	let stageStartedAt = started;
	let route: string | undefined;
	let resultError: ReturnType<typeof failureDetails> | undefined;
	let recoveryCount = 0;
	let lastRecovery: { route: string; reason?: string } | undefined;
	let lastMediaFailure:
		| { asset: string; mediaStage: string; code: string; reason?: string }
		| undefined;
	let source: Pick<DecodedVideoInfo, "codec" | "duration" | "width" | "height"> | undefined;
	const reportedBackends = new Set<string>();
	let finished = false;
	let configuration: { width?: number; height?: number; frameRate?: number } = {
		width: settings.gifConfig?.width,
		height: settings.gifConfig?.height,
		frameRate: settings.gifConfig?.frameRate ?? settings.mp4FrameRate,
	};
	const state = () => ({
		stage: currentStage,
		route,
		frame: currentFrame,
		lastCompletedFrame,
		stageElapsedMs: Math.round(performance.now() - stageStartedAt),
	});
	const telemetry = (event: string, fields: Record<string, unknown> = {}) => {
		recordExportDiagnostic(event, { attempt, ...fields });
	};
	const activity = (now: number) => {
		lastActivityAt = now;
		if (lastStallAt !== undefined) {
			telemetry("activity-resumed", state());
			lastStallAt = undefined;
		}
	};
	const stage = (nextStage: string, frame?: number) => {
		if (finished || (nextStage === currentStage && frame === currentFrame)) return;
		const now = performance.now();
		currentStage = nextStage;
		currentFrame = frame;
		stageStartedAt = now;
		activity(now);
		// Persist the initial frame and blocking awaits. Sample later frames to avoid IPC per frame.
		if (
			frame === undefined ||
			frame === 0 ||
			now - lastCheckpointAt >= CHECKPOINT_INTERVAL_MS
		) {
			lastCheckpointAt = now;
			if (frame === undefined || frame === 0) operation?.step(nextStage);
			telemetry("stage", state());
		}
	};
	const watchdog = () => {
		const now = performance.now();
		const idleMs = Math.round(now - lastActivityAt);
		if (
			idleMs < STALL_THRESHOLD_MS ||
			(lastStallAt !== undefined && now - lastStallAt < 60_000)
		)
			return;
		lastStallAt = now;
		telemetry("no-progress", { ...state(), idleMs, elapsedMs: Math.round(now - started) });
	};
	const timer =
		typeof window !== "undefined"
			? window.setInterval?.(watchdog, CHECKPOINT_INTERVAL_MS)
			: undefined;
	const rememberRecovery = (retryRoute: string, reason?: string) => {
		recoveryCount++;
		lastRecovery = {
			route: retryRoute,
			reason: reason && failureDetails(reason).reason.slice(0, 250),
		};
	};
	const backend = (decision: ExportBackendAttempt) => {
		const { route: backendRoute, reason, ...details } = decision;
		const key = JSON.stringify({ ...decision, pipeline: route });
		if (finished || reportedBackends.has(key)) return;
		reportedBackends.add(key);
		if (decision.status === "retry") rememberRecovery(backendRoute, reason);
		telemetry("backend", {
			...details,
			backendRoute,
			route,
			stage: currentStage,
			reason: reason && failureDetails(reason).reason,
		});
	};
	const record = (event: string, fields: Record<string, unknown> = {}) => {
		if (finished) return;
		if (
			[
				"configured",
				"recovery-started",
				"saving",
				"saved",
				"save-canceled",
				"save-failed",
				"exception",
			].includes(event)
		)
			operation?.step(event);
		if (event === "save-canceled") exportOutcome = "cancelled";
		if (event === "save-failed" || event === "exception") {
			exportOutcome = "failed";
			const cause = fields.cause ?? fields.error;
			if (typeof cause === "string") resultError = failureDetails(cause);
		}
		if (event === "saved") exportOutcome = "succeeded";
		if (event === "recovery-started") {
			rememberRecovery(
				typeof fields.route === "string" ? fields.route : "pipeline",
				typeof fields.initialError === "string" ? fields.initialError : undefined,
			);
		}
		if (event === "video-reader-retry")
			rememberRecovery(
				"video-reader",
				typeof fields.reason === "string" ? fields.reason : undefined,
			);
		if (event === "source-metadata") {
			const { codec, duration, width, height } = fields;
			if (
				typeof codec === "string" &&
				typeof duration === "number" &&
				typeof width === "number" &&
				typeof height === "number"
			) {
				source = { codec: redactDiagnostic(codec).slice(0, 64), duration, width, height };
			}
		}
		if (event === "renderer-media-failure") {
			const { asset, mediaStage, code, reason } = fields;
			if (
				typeof asset === "string" &&
				typeof mediaStage === "string" &&
				typeof code === "string"
			) {
				lastMediaFailure = {
					asset: asset.slice(0, 40),
					mediaStage: mediaStage.slice(0, 40),
					code: code.slice(0, 64),
					reason:
						typeof reason === "string"
							? redactDiagnostic(reason).slice(0, 160)
							: undefined,
				};
			}
		}
		if (event === "configured") {
			configuration = {
				width: typeof fields.width === "number" ? fields.width : configuration.width,
				height: typeof fields.height === "number" ? fields.height : configuration.height,
				frameRate:
					typeof fields.frameRate === "number"
						? fields.frameRate
						: configuration.frameRate,
			};
		}
		const safeFields = { ...fields };
		for (const key of ["error", "cause", "initialError", "reason"]) {
			const value = safeFields[key];
			if (typeof value === "string") safeFields[key] = redactDiagnostic(value).slice(0, 500);
		}
		telemetry(event, { ...(event.startsWith("video-reader-") && state()), ...safeFields });
	};
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
		stage,
		beginAttempt(nextRoute: string) {
			route = nextRoute;
			lastFrame = undefined;
			lastCompletedFrame = undefined;
			lastProgressKey = "";
			reportedBackends.clear();
			telemetry("attempt-start", { route });
			stage("create-exporter");
		},
		backend,
		block(reason: string) {
			exportOutcome = "blocked";
			stage(reason);
		},
		complete(cancelled: boolean, cancellation?: "user" | "superseded") {
			if (finished) return;
			finished = true;
			clearInterval(timer);
			const outcome = cancelled ? "cancelled" : exportOutcome;
			telemetry("complete", {
				...state(),
				...configuration,
				format: settings.format,
				destination,
				outcome,
				elapsedMs: Math.round(performance.now() - started),
				recoveryCount,
				lastRecovery,
				lastMediaFailure,
				source,
				cancellation,
				...(outcome === "failed" && resultError),
			});
			operation?.finish(outcome);
		},
		progress(progress: ExportProgress) {
			if (finished) return;
			if (
				phaseHasFrames(progress) &&
				lastFrame !== undefined &&
				progress.currentFrame < lastFrame
			)
				frameCounterEpoch++;
			if (phaseHasFrames(progress) && progress.currentFrame !== lastFrame) {
				lastFrame = progress.currentFrame;
				lastCompletedFrame = progress.currentFrame;
				activity(performance.now());
			}
			const key = JSON.stringify([
				progress.phase,
				frameCounterEpoch,
				Math.floor(progress.percentage / 10),
				progress.renderBackend,
				progress.encodeBackend,
				progress.encoderName,
				Math.floor((progress.audioProgress ?? 0) * 10),
			]);
			if (key === lastProgressKey) return;
			lastProgressKey = key;
			activity(performance.now());
			record("progress", {
				phase: progress.phase ?? "rendering",
				audioProgress: progress.audioProgress,
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
			if (finished) return;
			exportOutcome = result.success ? "succeeded" : "failed";
			resultError = result.success
				? undefined
				: failureDetails(result.error ?? "Exporter returned no failure reason");
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
				for (const decision of snapshot.attempts.slice(-6)) backend(decision);
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
				...state(),
				failureStage: result.failureStage,
				...resultError,
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
