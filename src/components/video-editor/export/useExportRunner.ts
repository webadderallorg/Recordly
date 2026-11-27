import { useCallback, useRef } from "react";
import { useOptionalBilling } from "@/components/billing/BillingProvider";
import { canExportCaptionFiles } from "@/components/billing/captionFileAccess";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { ExportSettings } from "@/lib/exporter/types";
import { beginAppOperation } from "@/lib/feedback/diagnostics";
import { createExportDiagnostics } from "@/lib/feedback/exportDiagnostics";
import { type LibraryExportIdentity, recordLibraryExport } from "../dashboard/libraryExportHistory";
import { fromFileUrl } from "../projectMediaPaths";
import { createSmokeExportProgressSampler } from "../smokeExportProgress";
import type { ExportBranchContext } from "./exportBranchContext";
import { getExportFileName } from "./exportFileName";
import { type PendingExportSave, writeSmokeExportReport } from "./exportPersistence";
import { type ExportRunnerInput, showExportErrorToast } from "./exportRunnerSupport";
import { stopGifSizeEstimates } from "./gifEstimateCache";
import { runGifExport } from "./runGifExport";
import { runMp4Export } from "./runMp4Export";
import { useGifSizeEstimate } from "./useGifSizeEstimate";

export function useExportRunner(input: ExportRunnerInput) {
	useGifSizeEstimate(input);
	const billing = useOptionalBilling();
	const billingRef = useRef(billing);
	billingRef.current = billing;
	const inputRef = useRef(input);
	inputRef.current = input;
	const recordSuccessfulExport = useCallback((capturedIdentity?: LibraryExportIdentity) => {
		const identity =
			capturedIdentity ?? inputRef.current.exportSession.exportIdentityRef?.current;
		if (identity && !recordLibraryExport(identity))
			console.warn("Could not save library export history");
	}, []);

	const handleExport = useCallback(
		async (
			settings: ExportSettings,
			options?: { destination?: "download" | "share" },
		): Promise<string | undefined> => {
			const operation = beginAppOperation("export.run");
			const diagnostics = createExportDiagnostics(
				settings,
				options?.destination ?? "download",
				operation,
			);
			const runInput = inputRef.current;
			const exportIdentity = {
				...runInput.exportIdentity,
				sourcePath:
					runInput.exportIdentity?.sourcePath ??
					(runInput.videoPath ? fromFileUrl(runInput.videoPath) : undefined),
			};
			const { videoPath, videoPlaybackRef, appearance, exportSession, smokeExportConfig } =
				runInput;
			const { shadowIntensity } = appearance;
			const {
				setIsExporting,
				setExportProgress,
				setExportError,
				exporterRef,
				clearPendingExportSave,
				exportRunIdRef,
				cancelledExportRunIdRef,
			} = exportSession;
			if (!videoPath) {
				diagnostics.block("missing-media");
				diagnostics.complete(false);
				toast.error(translate("notifications.noVideo", "No video loaded"));
				return;
			}

			const playback = videoPlaybackRef.current;
			const video = playback?.video;
			if (!video) {
				diagnostics.block("preview-not-ready");
				diagnostics.complete(false);
				toast.error(translate("notifications.videoNotReady", "Video not ready"));
				return;
			}

			if (runInput.exportSession.exportIdentityRef)
				runInput.exportSession.exportIdentityRef.current = exportIdentity;

			const exportRunId = exportRunIdRef.current + 1;
			exportRunIdRef.current = exportRunId;
			cancelledExportRunIdRef.current = null;
			const exportWasCancelled = () => exportRunIdRef.current !== exportRunId;
			const exportWasExplicitlyCancelled = () =>
				cancelledExportRunIdRef.current === exportRunId;
			const discardCancelledTemp = async (pending: PendingExportSave) => {
				if (!pending.tempFilePath) return;
				await window.electronAPI
					.discardExportedTemp?.(pending.tempFilePath)
					.catch(() => undefined);
			};

			setIsExporting(true);
			setExportProgress(null);
			exportSession.setGifOptimization(null);
			exportSession.setIsOptimizingGif(false);
			setExportError(null);
			clearPendingExportSave();
			if (options?.destination !== "share") {
				const fileName = getExportFileName(runInput.projectName, settings.format);
				exportSession.setSuggestedFileName(fileName);
				const sidecarFormat =
					settings.format === "mp4" &&
					settings.includeCaptionSidecar &&
					canExportCaptionFiles(billingRef.current)
						? runInput.captionSidecarPayload?.format
						: undefined;
				void window.electronAPI
					.suggestExportFileName?.(fileName, sidecarFormat)
					.then((suggested) => {
						if (suggested && !exportWasCancelled()) {
							exportSession.setSuggestedFileName(suggested);
						}
					})
					.catch(() => undefined);
			}
			const smokeExportStartedAt = smokeExportConfig.enabled ? performance.now() : null;

			try {
				// Drain preview estimates before real exports claim decoder/GPU/encoder resources.
				diagnostics.stage("drain-gif-preview");
				await stopGifSizeEstimates();
				if (exportWasCancelled()) return;

				// Get preview CONTAINER dimensions for scaling
				diagnostics.stage("prepare-preview");
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;
				const effectiveShadowIntensity =
					smokeExportConfig.enabled && smokeExportConfig.shadowIntensity !== undefined
						? smokeExportConfig.shadowIntensity
						: shadowIntensity;
				const smokeProgressSampler = createSmokeExportProgressSampler({
					enabled: smokeExportConfig.enabled,
					startedAtMs: smokeExportStartedAt,
				});
				const smokeProgressSamples = smokeProgressSampler.samples;
				const recordSmokeProgress = smokeProgressSampler.record;

				const branchContext: ExportBranchContext = {
					input: { ...runInput, videoPath },
					settings,
					options,
					billingRef,
					previewWidth,
					previewHeight,
					effectiveShadowIntensity,
					diagnostics,
					smokeExportStartedAt,
					recordSmokeProgress,
					smokeProgressSamples,
					exportWasCancelled,
					discardCancelledTemp,
					recordSuccessfulExport: () => recordSuccessfulExport(exportIdentity),
				};
				const outcome =
					settings.format === "gif" && settings.gifConfig
						? await runGifExport(branchContext)
						: await runMp4Export(branchContext);
				return outcome.exit ? outcome.path : undefined;
			} catch (error) {
				if (exportWasCancelled()) return;
				exportSession.setIsOptimizingGif(false);
				console.error("Export error:", error);
				const errorMessage =
					error instanceof Error
						? error.message
						: translate(
								"notifications.unexpectedError",
								"An unexpected error occurred",
							);
				const cause =
					error instanceof Error
						? (error as Error & { cause?: unknown }).cause
						: undefined;
				diagnostics.record("exception", {
					error: errorMessage,
					errorName: error instanceof Error ? error.name : undefined,
					cause: cause instanceof Error ? cause.message : undefined,
				});
				if (smokeExportConfig.enabled) {
					await writeSmokeExportReport(smokeExportConfig.outputPath, {
						success: false,
						phase: "exception",
						format: settings.format,
						elapsedMs:
							smokeExportStartedAt !== null
								? Math.round(performance.now() - smokeExportStartedAt)
								: undefined,
						error: errorMessage,
					});
				}
				setExportError(errorMessage);
				if (options?.destination === "share")
					showExportErrorToast(`Export failed: ${errorMessage}`);
				if (smokeExportConfig.enabled) {
					window.close();
				}
			} finally {
				const wasCancelled = exportWasExplicitlyCancelled();
				const stillCurrent = !exportWasCancelled();
				diagnostics.complete(
					!stillCurrent,
					stillCurrent ? undefined : wasCancelled ? "user" : "superseded",
				);
				if (stillCurrent) {
					setIsExporting(false);
					exporterRef.current = null;
				}
				// A superseded run must not touch the new run's preview or another recording.
				const currentPreview = videoPlaybackRef.current;
				if (
					(stillCurrent ||
						(wasCancelled && exportRunIdRef.current === exportRunId + 1)) &&
					inputRef.current.videoPath === videoPath &&
					currentPreview?.video === video
				) {
					currentPreview.regenerateFrame();
				}
			}
		},
		[recordSuccessfulExport],
	);

	return { handleExport, recordSuccessfulExport };
}
