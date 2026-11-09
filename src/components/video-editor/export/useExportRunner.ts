import { useCallback, useRef } from "react";
import { recordLibraryExport, type LibraryExportIdentity } from "../dashboard/libraryExportHistory";
import { fromFileUrl } from "../projectMediaPaths";
import { useOptionalBilling } from "@/components/billing/BillingProvider";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import type { ExportSettings } from "@/lib/exporter/types";
import { createExportDiagnostics } from "@/lib/feedback/exportDiagnostics";
import { createSmokeExportProgressSampler } from "../smokeExportProgress";
import type { ExportBranchContext } from "./exportBranchContext";
import { type PendingExportSave, writeSmokeExportReport } from "./exportPersistence";
import {
	type ExportRunnerInput,
	showExportErrorToast,
	useExportSuccessToast,
} from "./exportRunnerSupport";
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
	const notifyExportSuccess = useExportSuccessToast();
	const showExportSuccessToast = useCallback(
		(filePath: string, capturedIdentity?: LibraryExportIdentity) => {
			const identity =
				capturedIdentity ?? inputRef.current.exportSession.exportIdentityRef?.current;
			if (identity && !recordLibraryExport(identity))
				console.warn("Could not save library export history");
			notifyExportSuccess(filePath);
		},
		[notifyExportSuccess],
	);

	const handleExport = useCallback(
		async (
			settings: ExportSettings,
			options?: { destination?: "download" | "share" },
		): Promise<string | undefined> => {
			const runInput = inputRef.current;
			const exportIdentity = {
				...runInput.exportIdentity,
				sourcePath:
					runInput.exportIdentity?.sourcePath ??
					(runInput.videoPath ? fromFileUrl(runInput.videoPath) : undefined),
			};
			const {
				videoPath,
				videoPlaybackRef,
				isPlaying,
				appearance,
				exportSession,
				smokeExportConfig,
				remountPreview,
			} = runInput;
			const { shadowIntensity } = appearance;
			const {
				setIsExporting,
				setExportProgress,
				setExportError,
				setShowExportDropdown,
				exporterRef,
				clearPendingExportSave,
				exportRunIdRef,
				cancelledExportRunIdRef,
			} = exportSession;
			if (!videoPath) {
				toast.error(translate("notifications.noVideo", "No video loaded"));
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
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

			const diagnostics = createExportDiagnostics(
				settings,
				options?.destination ?? "download",
			);
			setIsExporting(true);
			setExportProgress(null);
			exportSession.setGifOptimization(null);
			exportSession.setIsOptimizingGif(false);
			setExportError(null);
			clearPendingExportSave();
			const smokeExportStartedAt = smokeExportConfig.enabled ? performance.now() : null;

			let keepExportDialogOpen = false;
			const wasPlaying = isPlaying;
			const restoreTime = video.currentTime;

			try {
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				// Drain preview estimates before real exports claim decoder/GPU/encoder resources.
				await stopGifSizeEstimates();
				if (exportWasCancelled()) return;

				// Get preview CONTAINER dimensions for scaling
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
					showExportSuccessToast: (filePath) => {
						if (!recordLibraryExport(exportIdentity))
							console.warn("Could not save library export history");
						notifyExportSuccess(filePath);
					},
					setKeepExportDialogOpen: (open) => {
						keepExportDialogOpen = open;
					},
				};
				const outcome =
					settings.format === "gif" && settings.gifConfig
						? await runGifExport(branchContext)
						: await runMp4Export(branchContext);
				if (outcome.exit) return outcome.path;

				if (wasPlaying) {
					await videoPlaybackRef.current?.play().catch(() => undefined);
				} else {
					video.currentTime = restoreTime;
				}
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
				diagnostics.record("exception", { error: errorMessage });
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
				showExportErrorToast(`Export failed: ${errorMessage}`);
				keepExportDialogOpen = options?.destination !== "share";
				if (smokeExportConfig.enabled) {
					window.close();
				}
			} finally {
				if (exportWasExplicitlyCancelled()) diagnostics.record("canceled");
				if (exportWasExplicitlyCancelled() && exportRunIdRef.current === exportRunId + 1) {
					video.currentTime = restoreTime;
					if (wasPlaying) {
						await videoPlaybackRef.current?.play().catch(() => undefined);
					}
				} else if (!exportWasCancelled()) {
					setIsExporting(false);
					exporterRef.current = null;
					if (options?.destination !== "share")
						setShowExportDropdown(keepExportDialogOpen);
					remountPreview();
				}
			}
		},
		[notifyExportSuccess],
	);

	return { handleExport, showExportSuccessToast };
}
