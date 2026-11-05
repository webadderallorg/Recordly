import { redactDiagnostic } from "@/lib/feedback/diagnosticRedaction";
import type { normalizeLightningRuntimePlatform } from "./backendPolicy";
import type { ExportRuntimeDiagnostics, ModernExportSession } from "./modernExportSession";
import type {
	ExportBackendAttempt,
	ExportDiagnosticSnapshot,
	ExportEncodeBackend,
	ExportFinalizationStageMetrics,
	ExportMetrics,
	ExportRenderBackend,
} from "./types";

type Session = Pick<
	ModernExportSession,
	"backpressureProfile" | "config" | "effectiveDurationSec" | "native"
>;

/** Owns attempt measurements and bounded export diagnostics. */
export class ModernExportMetrics {
	renderBackend: ExportRenderBackend | null = null;
	encodeBackend: ExportEncodeBackend | null = null;
	encoderName: string | null = null;
	diagnosticStartedAt = 0;
	backendAttempts: ExportBackendAttempt[] = [];
	diagnosticEncoder: ExportDiagnosticSnapshot["encoder"];
	diagnosticMuxer: ExportDiagnosticSnapshot["muxer"];
	totalExportStartTimeMs = 0;
	metadataLoadTimeMs = 0;
	rendererInitTimeMs = 0;
	nativeSessionStartTimeMs = 0;
	decodeLoopTimeMs = 0;
	frameCallbackTimeMs = 0;
	renderFrameTimeMs = 0;
	encodeWaitTimeMs = 0;
	encodeWaitEvents = 0;
	peakEncodeQueueSize = 0;
	peakNativeWriteInFlight = 0;
	nativeCaptureTimeMs = 0;
	nativeWriteTimeMs = 0;
	finalizationTimeMs = 0;
	finalizationStageMs: ExportFinalizationStageMetrics = {};
	processedFrameCount = 0;
	mediaSourceRetryAttempted = false;
	runtimeDiagnostics: ExportRuntimeDiagnostics = {};
	constructor(
		private readonly session: Session,
		private readonly now: () => number,
		private readonly runtimePlatform: () => ReturnType<
			typeof normalizeLightningRuntimePlatform
		>,
	) {}

	resetAttempt(): void {
		this.totalExportStartTimeMs = 0;
		this.metadataLoadTimeMs = 0;
		this.rendererInitTimeMs = 0;
		this.nativeSessionStartTimeMs = 0;
		this.decodeLoopTimeMs = 0;
		this.frameCallbackTimeMs = 0;
		this.renderFrameTimeMs = 0;
		this.encodeWaitTimeMs = 0;
		this.encodeWaitEvents = 0;
		this.peakEncodeQueueSize = 0;
		this.peakNativeWriteInFlight = 0;
		this.nativeCaptureTimeMs = 0;
		this.nativeWriteTimeMs = 0;
		this.finalizationTimeMs = 0;
		this.finalizationStageMs = {};
		this.processedFrameCount = 0;
		this.renderBackend = null;
		this.encodeBackend = null;
		this.encoderName = null;
		this.diagnosticEncoder = undefined;
		this.diagnosticMuxer = undefined;
	}

	recordBackendAttempt(attempt: Omit<ExportBackendAttempt, "elapsedMs">): void {
		this.backendAttempts.push({
			...attempt,
			elapsedMs: Math.round(Math.max(0, this.now() - this.diagnosticStartedAt)),
			reason: attempt.reason ? redactDiagnostic(attempt.reason).slice(0, 300) : undefined,
		});
		// Retain the initial failure as well as the most recent fallback attempts.
		if (this.backendAttempts.length > 24) this.backendAttempts.splice(8, 1);
	}

	buildDiagnosticSnapshot(): ExportDiagnosticSnapshot {
		const hardware = this.runtimeDiagnostics.hardware;
		const runtime = this.runtimeDiagnostics.runtime;
		return {
			elapsedMs: Math.round(Math.max(0, this.now() - this.diagnosticStartedAt)),
			requestedBackend: this.session.config.backendPreference ?? "auto",
			encoder: this.diagnosticEncoder ? { ...this.diagnosticEncoder } : undefined,
			muxer: this.diagnosticMuxer,
			attempts: this.backendAttempts.map((attempt) => ({ ...attempt })),
			environment: {
				platform: runtime?.platform ?? hardware?.platform ?? this.runtimePlatform(),
				runtimeInfoStatus: this.runtimeDiagnostics.runtimeInfoStatus ?? "unavailable",
				runtime,
				hardwareInfoStatus: this.runtimeDiagnostics.hardwareInfoStatus ?? "unavailable",
				appVersion: runtime?.appVersion ?? this.runtimeDiagnostics.appVersion,
				arch: runtime?.arch ?? hardware?.arch,
				gpus: hardware?.gpus.slice(0, 4).map((gpu) => ({
					name: gpu.name.slice(0, 120),
					vendor: gpu.vendor?.slice(0, 80) ?? null,
					active: gpu.active,
				})),
				gpuFeatures: hardware?.gpuFeatures ? { ...hardware.gpuFeatures } : undefined,
			},
		};
	}

	buildExportMetrics(): ExportMetrics {
		const totalElapsedMs =
			this.totalExportStartTimeMs > 0 ? this.now() - this.totalExportStartTimeMs : 0;
		const safeFrameCount = Math.max(this.processedFrameCount, 1);
		const hasFinalizationStageMetrics = Object.keys(this.finalizationStageMs).length > 0;

		return {
			diagnostics: this.buildDiagnosticSnapshot(),
			totalElapsedMs,
			metadataLoadMs: this.metadataLoadTimeMs,
			rendererInitMs: this.rendererInitTimeMs,
			nativeSessionStartMs: this.nativeSessionStartTimeMs,
			decodeLoopMs: this.decodeLoopTimeMs,
			frameCallbackMs: this.frameCallbackTimeMs,
			renderFrameMs: this.renderFrameTimeMs,
			encodeWaitMs: this.encodeWaitTimeMs,
			encodeWaitEvents: this.encodeWaitEvents,
			peakEncodeQueueSize: this.peakEncodeQueueSize,
			peakNativeWriteInFlight: this.peakNativeWriteInFlight,
			nativeCaptureMs: this.nativeCaptureTimeMs,
			nativeWriteMs: this.nativeWriteTimeMs,
			finalizationMs: this.finalizationTimeMs,
			frameCount: this.processedFrameCount,
			renderBackend: this.renderBackend ?? undefined,
			encodeBackend: this.encodeBackend ?? undefined,
			encoderName: this.encoderName ?? undefined,
			backpressureProfile: this.session.backpressureProfile?.name,
			nativeStaticLayoutSkipReason:
				this.session.native.nativeStaticLayoutSkipReason ?? undefined,
			nativeStaticLayoutSkipReasons:
				this.session.native.nativeStaticLayoutSkipReasons.length > 0
					? this.session.native.nativeStaticLayoutSkipReasons
					: undefined,
			effectiveDurationSec: this.session.effectiveDurationSec || undefined,
			finalizationStageMs: hasFinalizationStageMetrics ? this.finalizationStageMs : undefined,
			averageFrameCallbackMs:
				this.processedFrameCount > 0
					? this.frameCallbackTimeMs / safeFrameCount
					: undefined,
			averageRenderFrameMs:
				this.processedFrameCount > 0 ? this.renderFrameTimeMs / safeFrameCount : undefined,
			averageEncodeWaitMs:
				this.processedFrameCount > 0 ? this.encodeWaitTimeMs / safeFrameCount : undefined,
			averageNativeCaptureMs:
				this.processedFrameCount > 0
					? this.nativeCaptureTimeMs / safeFrameCount
					: undefined,
			averageNativeWriteMs:
				this.processedFrameCount > 0 ? this.nativeWriteTimeMs / safeFrameCount : undefined,
		};
	}
}
