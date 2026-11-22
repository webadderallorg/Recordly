import type { ModernExportAttempt } from "./modernExportAttemptTypes";
import { getNowMs } from "./modernExportConstants";
import { isWebCodecsEncoderFailure } from "./modernExportEncoderFailure";
import { finalizeExportAttempt } from "./modernExportFinalize";
import { renderExportFrames } from "./modernExportFrames";
import type { ModernExportHooks } from "./modernExportHooks";
import { prepareExportAttempt } from "./modernExportPrepare";
import { cleanup } from "./modernExportResources";
import type { ModernExportSession } from "./modernExportSession";
import type { ExportResult } from "./types";

type Session = ModernExportSession;
type Hooks = ModernExportHooks;

export async function runModernExport(session: Session, hooks: Hooks): Promise<ExportResult> {
	session.cancelled = false;
	const control: ModernExportAttempt = {
		useFallbackMediaSource: false,
		retriedWithFallbackMediaSource: false,
		nativeFailure: null,
		retryWithWebgl: false,
		inNativeStage: false,
		inRendererStage: false,
	};
	session.native.forceRawvideoNativeRetry = false;
	session.metrics.mediaSourceRetryAttempted = false;
	session.metrics.diagnosticStartedAt = getNowMs();
	session.metrics.backendAttempts = [];
	session.metrics.runtimeDiagnostics = await hooks.collectRuntimeDiagnostics();
	if (session.cancelled) {
		return { success: false, error: "Export cancelled" };
	}

	while (true) {
		let retryExport = false;
		control.inNativeStage = false;
		control.inRendererStage = false;
		try {
			const prepared = await prepareExportAttempt(session, hooks, control);
			if (prepared.kind === "complete") return prepared.result;
			await renderExportFrames(session, hooks, control, prepared.plan);
			return await finalizeExportAttempt(session, hooks, control, prepared.plan);
		} catch (error) {
			if (
				!session.cancelled &&
				!control.retryWithWebgl &&
				control.inRendererStage &&
				session.metrics.renderBackend === "webgpu"
			) {
				// Renderer initialization can succeed before a bind group fails on the first frame.
				// Rebuild the whole pipeline: frames and GPU resources cannot be reused safely.
				control.retryWithWebgl = true;
				retryExport = true;
				session.metrics.recordBackendAttempt({
					route: "renderer",
					status: "retry",
					reason: `WebGPU failed; restarting with WebGL: ${error instanceof Error ? error.message : String(error)}`,
				});
				console.warn(
					"[VideoExporter] WebGPU rendering failed; restarting with WebGL",
					error,
				);
			} else if (
				!session.cancelled &&
				!session.native.forceRawvideoNativeRetry &&
				session.native.nativeInputMode === "h264-stream" &&
				(control.inNativeStage || session.native.nativeEncoderError)
			) {
				session.native.forceRawvideoNativeRetry = true;
				retryExport = true;
				session.metrics.recordBackendAttempt({
					route: "native-stream",
					status: "retry",
					reason: `Browser H.264 failed; retrying raw FFmpeg: ${error instanceof Error ? error.message : String(error)}`,
				});
				console.warn(
					"[VideoExporter] Browser H.264 encoder failed; retrying with bundled FFmpeg rawvideo",
					error,
				);
			} else if (
				!session.cancelled &&
				!control.nativeFailure &&
				(control.inNativeStage || session.native.nativeEncoderError)
			) {
				control.nativeFailure = hooks.buildLightningExportError(
					session.native.nativeEncoderError ?? error,
				);
				console.error(
					"[VideoExporter] Native export failed; restarting once with WebCodecs.\n" +
						control.nativeFailure,
				);
				session.metrics.recordBackendAttempt({
					route: "native-stream",
					status: "retry",
					reason: control.nativeFailure,
				});
				retryExport = true;
			} else if (
				!session.cancelled &&
				!control.useFallbackMediaSource &&
				!control.retriedWithFallbackMediaSource &&
				hooks.shouldRetryWithFallbackMediaSource(error)
			) {
				control.retriedWithFallbackMediaSource = true;
				session.metrics.recordBackendAttempt({
					route: "media-source",
					status: "retry",
					reason: error instanceof Error ? error.message : String(error),
				});
				session.metrics.mediaSourceRetryAttempted = true;
				control.useFallbackMediaSource = true;
				retryExport = true;
				console.warn(
					"[VideoExporter] Primary decode path failed; retrying export once with a fresh media source.",
					error,
				);
			} else {
				if (session.cancelled && !session.browser.encoderError) {
					return {
						success: false,
						error: "Export cancelled",
						metrics: session.metrics.buildExportMetrics(),
					};
				}

				const resolvedError = session.browser.encoderError ?? error;
				console.error("Export error:", error);
				return {
					success: false,
					error: hooks.buildLightningExportError(resolvedError),
					failureStage: control.inRendererStage
						? "renderer"
						: isWebCodecsEncoderFailure(resolvedError)
							? "encoder"
							: "pipeline",
					metrics: session.metrics.buildExportMetrics(),
				};
			}
		} finally {
			if (!retryExport && session.metrics.totalExportStartTimeMs > 0) {
				console.log(
					`[VideoExporter] Final metrics ${JSON.stringify(session.metrics.buildExportMetrics())}`,
				);
			}
			cleanup(session);
		}

		if (retryExport) {
			continue;
		}
	}
}
