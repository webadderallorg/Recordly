import { translate } from "@/i18n/runtime";
import type { ExportSettings } from "@/lib/exporter/types";
import { buildExportRenderOptions } from "./buildExportRenderOptions";
import type { ExportBranchContext, ExportBranchOutcome } from "./exportBranchContext";
import { getExportFileName } from "./exportFileName";
import { saveExportBlob, streamExportBlobToTempFile } from "./exportPersistence";
export async function runGifExport(context: ExportBranchContext): Promise<ExportBranchOutcome> {
	const {
		input,
		exportWasCancelled,
		previewWidth,
		previewHeight,
		effectiveShadowIntensity,
		diagnostics,
		recordSmokeProgress,
		options,
		discardCancelledTemp,
		smokeExportStartedAt,
		recordSuccessfulExport,
	} = context;
	const settings = context.settings as ExportSettings & {
		gifConfig: NonNullable<ExportSettings["gifConfig"]>;
	};
	const {
		videoPath,
		appearance,
		timeline,
		exportSession,
		smokeExportConfig,
		effectiveSpeedRegions,
		effectiveZoomRegions,
		effectiveCursorTelemetry,
		effectiveShowCursor,
	} = input;
	const { padding } = appearance;
	const {
		setExportProgress,
		setExportError,
		setExportedFilePath,
		setHasPendingExportSave,
		exporterRef,
		pendingExportSaveRef,
	} = exportSession;

	// GIF Export
	const { GifExporter } = await import("@/lib/exporter/gifExporter");
	if (exportWasCancelled()) return { exit: true };
	const gifExporter = new GifExporter({
		videoUrl: videoPath,
		width: settings.gifConfig.width,
		height: settings.gifConfig.height,
		frameRate: settings.gifConfig.frameRate,
		loop: settings.gifConfig.loop,
		sizePreset: settings.gifConfig.sizePreset,
		...buildExportRenderOptions({
			appearance,
			timeline,
			effectiveSpeedRegions,
			effectiveZoomRegions,
			effectiveCursorTelemetry,
			effectiveShowCursor,
			previewWidth,
			previewHeight,
			shadowIntensity: effectiveShadowIntensity,
			onProgress: (progress) => {
				if (exportWasCancelled()) return;
				diagnostics.progress(progress);
				recordSmokeProgress(progress);
				setExportProgress(progress);
			},
		}),
		videoPadding: padding,
		maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
		maxPendingFrames: smokeExportConfig.maxPendingFrames,
	});

	exporterRef.current = gifExporter;
	const result = await gifExporter.export();
	diagnostics.result(result);
	if (exportWasCancelled()) return { exit: true };

	if (result.success && result.blob) {
		let exportBlob = result.blob;
		if (settings.gifConfig.optimizeSize) {
			const controller = new AbortController();
			exporterRef.current = { cancel: () => controller.abort() };
			setExportProgress({
				currentFrame: 0,
				totalFrames: 0,
				percentage: 95,
				estimatedTimeRemaining: Number.POSITIVE_INFINITY,
				phase: "finalizing",
			});
			const { optimizeGif } = await import("@/lib/exporter/gifOptimization");
			if (exportWasCancelled()) return { exit: true };
			exportSession.setIsOptimizingGif(true);
			const optimized = await optimizeGif(exportBlob, controller.signal);
			if (!exportWasCancelled()) exportSession.setIsOptimizingGif(false);
			if (exportWasCancelled()) return { exit: true };
			const { blob, ...summary } = optimized;
			exportBlob = blob;
			exportSession.setGifOptimization(summary);
			diagnostics.record("gif-optimization", summary);
		}
		const fileName = getExportFileName(input.projectName, "gif");
		setExportProgress((previous) => ({
			currentFrame: previous?.totalFrames ?? 0,
			totalFrames: previous?.totalFrames ?? 0,
			percentage: 95,
			estimatedTimeRemaining: Number.POSITIVE_INFINITY,
			phase: "saving",
		}));
		if (options?.destination === "share") {
			const tempPath = await streamExportBlobToTempFile(exportBlob, "gif");
			if (!tempPath)
				throw new Error(
					translate(
						"notifications.prepareGifFailed",
						"Could not prepare the GIF for sharing.",
					),
				);
			return { exit: true, path: tempPath };
		}
		diagnostics.record("saving");

		const { saveResult, pendingSave } = await saveExportBlob(
			exportBlob,
			fileName,
			smokeExportConfig.enabled ? smokeExportConfig.outputPath : null,
		);
		if (exportWasCancelled()) {
			await discardCancelledTemp(pendingSave);
			return { exit: true };
		}

		if (saveResult.canceled) {
			diagnostics.record("save-canceled");
			pendingExportSaveRef.current = pendingSave;
			setHasPendingExportSave(true);
			setExportError(
				translate(
					"notifications.saveDialogCanceled",
					"Save dialog canceled. Click Save Again to save without re-rendering.",
				),
			);
		} else if (saveResult.success && saveResult.path) {
			diagnostics.record("saved");
			if (smokeExportStartedAt !== null) {
				console.log(
					`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
				);
			}
			recordSuccessfulExport();
			setExportedFilePath(saveResult.path);
			if (smokeExportConfig.enabled) {
				window.close();
				return { exit: true };
			}
		} else {
			diagnostics.record("save-failed", {
				error:
					translate("notifications.saveGifFailed", "Failed to save GIF") +
					(saveResult.message ? `: ${saveResult.message}` : ""),
			});
			setExportError(
				translate("notifications.saveGifFailed", "Failed to save GIF") +
					(saveResult.message ? `: ${saveResult.message}` : ""),
			);
			if (pendingSave.tempFilePath || pendingSave.arrayBuffer) {
				pendingExportSaveRef.current = pendingSave;
				setHasPendingExportSave(true);
			}
			if (smokeExportConfig.enabled) {
				window.close();
				return { exit: true };
			}
		}
	} else {
		setExportError(
			translate("notifications.gifExportFailed", "GIF export failed") +
				(result.error ? `: ${result.error}` : ""),
		);
		if (smokeExportConfig.enabled) {
			window.close();
			return { exit: true };
		}
	}

	return { exit: false };
}
