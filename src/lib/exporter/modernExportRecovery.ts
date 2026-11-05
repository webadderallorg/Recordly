import type { VideoExporterConfig } from "./modernVideoExporterConfig";
import type { ExportPipelineModel, ExportResult } from "./types";

export interface Mp4Exporter {
	export(): Promise<ExportResult>;
	cancel(): void;
}

export type Mp4ExportRoute = "modern" | "legacy" | "software" | "compatibility";
export type Mp4ExporterFactory = (
	route: Mp4ExportRoute,
	config: VideoExporterConfig,
) => Promise<Mp4Exporter>;

export interface Mp4RecoveryAttempt {
	route: "software" | "compatibility";
	initialError: string;
}

function failureReason(result: ExportResult): string {
	const error = result.error ?? "Unknown export failure";
	return error.match(/^Reason: (.*)$/m)?.[1] ?? error.split("\n")[0];
}

/** Select a different viable path, never repeat an input or user-cancellation failure. */
export function selectMp4Recovery(result: ExportResult): Mp4RecoveryAttempt | null {
	if (result.success) return null;
	const reason = failureReason(result);
	if (
		/\b(cancelled|canceled|AbortError|SecurityError|IndexSizeError|ENOENT|ENOSPC|EACCES)\b|permission denied|not allowed|not found|failed to fetch|failed to load|invalid (?:input|dimension|crop|configuration)|tainted|redact|empty source frame|canvas is unavailable|failed to (?:get|create).*context|seek(?:ing)? (?:failed|timed out)|\[VIDEO_/i.test(
			reason,
		)
	)
		return null;

	if (result.failureStage === "renderer") {
		// Both compositors still need a GPU renderer; rebuilding cannot add one.
		if (
			/no (?:supported|available) (?:Pixi |modern )?renderer|no supported Pixi modern renderer|CanvasRenderer is not yet implemented/i.test(
				reason,
			)
		)
			return null;
		return { route: "compatibility", initialError: result.error ?? reason };
	}
	if (result.failureStage === "encoder" && result.metrics?.encodeBackend === "webcodecs") {
		const encoder = result.metrics.diagnostics?.encoder;
		const usedHardware =
			encoder?.api === "webcodecs"
				? encoder.hardwareAcceleration === "prefer-hardware"
				: result.metrics.encoderName?.includes("/prefer-hardware/");
		if (usedHardware) return { route: "software", initialError: result.error ?? reason };
	}
	return null;
}

export const createMp4Exporter: Mp4ExporterFactory = async (route, config) => {
	if (route === "modern" || route === "software") {
		const { ModernVideoExporter } = await import("./modernVideoExporter");
		return new ModernVideoExporter(config);
	}
	const { VideoExporter } = await import("./videoExporter");
	if (route === "legacy") return new VideoExporter(config);
	// Use the legacy compositor with browser encoding rather than re-entering the
	// native Annex B bridge that Lightning may already have exhausted.
	class CompatibilityExporter extends VideoExporter {
		protected override shouldUseExperimentalNativeExport(): boolean {
			return false;
		}
	}
	return new CompatibilityExporter(config);
};

export async function exportMp4WithRecovery(options: {
	pipelineModel: ExportPipelineModel;
	config: VideoExporterConfig;
	isCancelled: () => boolean;
	setActiveExporter: (exporter: Mp4Exporter) => void;
	onAttemptResult?: (route: Mp4ExportRoute, result: ExportResult) => void;
	onRecovery?: (recovery: Mp4RecoveryAttempt) => void;
	discardTempFile?: (path: string) => Promise<void>;
	createExporter?: Mp4ExporterFactory;
}): Promise<{
	result: ExportResult;
	pipelineModel: ExportPipelineModel;
	recovery: Mp4RecoveryAttempt | null;
}> {
	const create = options.createExporter ?? createMp4Exporter;
	const cancelled = (): ExportResult => ({ success: false, error: "Export cancelled" });
	const discard = async (result: ExportResult) => {
		if (result.tempFilePath) await options.discardTempFile?.(result.tempFilePath);
	};
	const attempt = async (route: Mp4ExportRoute, config: VideoExporterConfig) => {
		if (options.isCancelled()) return cancelled();
		const exporter = await create(route, config);
		if (options.isCancelled()) {
			exporter.cancel();
			return cancelled();
		}
		options.setActiveExporter(exporter);
		if (options.isCancelled()) {
			exporter.cancel();
			return cancelled();
		}
		let result: ExportResult;
		try {
			result = await exporter.export();
		} catch (error) {
			// Exporters normally return failures after their finally cleanup. Preserve
			// an unexpected rejection without guessing that it is safe to replay.
			exporter.cancel();
			result = {
				success: false,
				error: error instanceof Error ? error.message : String(error),
				failureStage: "pipeline",
			};
		}
		options.onAttemptResult?.(route, result);
		return result;
	};

	const primary = await attempt(options.pipelineModel, options.config);
	if (options.isCancelled()) {
		await discard(primary);
		return { result: cancelled(), pipelineModel: options.pipelineModel, recovery: null };
	}
	const recovery = options.pipelineModel === "modern" ? selectMp4Recovery(primary) : null;
	if (!recovery) return { result: primary, pipelineModel: options.pipelineModel, recovery: null };
	await discard(primary);
	if (options.isCancelled()) {
		return { result: cancelled(), pipelineModel: options.pipelineModel, recovery: null };
	}
	options.onRecovery?.(recovery);
	// Rendering, edits and output settings stay in the original snapshot. Only
	// implementation choices change, and this outer recovery is attempted once.
	const config: VideoExporterConfig = {
		...options.config,
		experimentalNativeExport: false,
		experimentalNvidiaCudaExport: false,
		backendPreference: "webcodecs",
		...(recovery.route === "software"
			? { forceSoftwareEncoding: true, preferredEncoderPath: null }
			: { preferredRenderBackend: "webgl" }),
	};
	const result = await attempt(recovery.route, config);
	const pipelineModel = recovery.route === "compatibility" ? "legacy" : "modern";
	if (options.isCancelled()) {
		await discard(result);
		return { result: cancelled(), pipelineModel, recovery };
	}
	if (!result.success) {
		await discard(result);
		return {
			result: {
				...result,
				error: `Lightning export failed:\n${recovery.initialError}\n\n${recovery.route === "software" ? "Software encoding" : "Compatibility pipeline"} retry failed:\n${result.error ?? "Unknown export failure"}`,
			},
			pipelineModel,
			recovery,
		};
	}
	return { result, pipelineModel, recovery };
}
