import { canExportCaptionFiles } from "@/components/billing/captionFileAccess";
import { toast } from "@/components/ui/toast";
import { translate } from "@/i18n/runtime";
import { exportCloudVideo } from "@/lib/exporter/cloudVideoExporter";
import { getMp4ExportBitrate } from "@/lib/exporter/exportBitrate";
import { exportMp4WithRecovery } from "@/lib/exporter/modernExportRecovery";
import { DEFAULT_MP4_CODEC } from "@/lib/exporter/mp4Support";
import { getCloudShareBitrate } from "../cloud/shareBitrate";
import { getShareResolution } from "../cloud/shareResolution";
import { resolveMp4ExportRouting } from "../mp4ExportRouting";
import { resolveMp4ExportSettings } from "../mp4ExportSettings";
import { buildExportRenderOptions } from "./buildExportRenderOptions";
import type { ExportBranchContext, ExportBranchOutcome } from "./exportBranchContext";
import { getExportFileName } from "./exportFileName";
import {
	type PendingExportSave,
	saveExportBlob,
	streamExportBlobToTempFile,
	writeSmokeExportReport,
} from "./exportPersistence";
import { showCaptionSidecarWarning, showExportErrorToast } from "./exportRunnerSupport";
export async function runMp4Export(context: ExportBranchContext): Promise<ExportBranchOutcome> {
	const {
		input,
		settings,
		options,
		billingRef,
		exportWasCancelled,
		diagnostics,
		previewWidth,
		previewHeight,
		effectiveShadowIntensity,
		recordSmokeProgress,
		smokeExportStartedAt,
		discardCancelledTemp,
		smokeProgressSamples,
		recordSuccessfulExport,
	} = context;
	const {
		videoPath,
		appearance,
		timeline,
		audio,
		smokeExportConfig,
		effectiveSpeedRegions,
		effectiveZoomRegions,
		effectiveCursorTelemetry,
		effectiveShowCursor,
		ensureSupportedMp4SourceDimensions,
		captionSidecarPayload,
		experimentalNvidiaCudaExport,
		nvidiaCudaExportAvailable,
		exportSettings,
		exportSession,
	} = input;
	const { audioRegions, clipRegions } = timeline;
	const {
		exportQuality,
		exportEncodingMode,
		exportBackendPreference,
		exportPipelineModel,
		mp4FrameRate,
	} = exportSettings;
	const {
		setExportProgress,
		setExportError,
		setExportedFilePath,
		setHasPendingExportSave,
		exporterRef,
		pendingExportSaveRef,
		markExportAsSaving,
	} = exportSession;

	// MP4 Export
	const { quality, encodingMode, selectedMp4FrameRate } = resolveMp4ExportSettings({
		smokeExportConfig: {
			enabled: smokeExportConfig.enabled,
			quality: smokeExportConfig.quality,
			encodingMode: smokeExportConfig.encodingMode,
			fps: smokeExportConfig.fps,
		},
		settings,
		exportQuality,
		exportEncodingMode,
		mp4FrameRate,
	});
	const {
		pipelineModel,
		useExperimentalNativeExport,
		useExperimentalNvidiaCudaExport,
		backendPreference,
	} = resolveMp4ExportRouting({
		smokeExportConfig: {
			enabled: smokeExportConfig.enabled,
			pipelineModel: smokeExportConfig.pipelineModel,
			useNativeExport: smokeExportConfig.useNativeExport,
			backendPreference: smokeExportConfig.backendPreference,
		},
		settings,
		exportPipelineModel,
		exportBackendPreference,
		experimentalNvidiaCudaExport,
		nvidiaCudaExportAvailable,
	});
	const sharing = options?.destination === "share";
	const plan = billingRef.current;
	const supportedSourceDimensions = await ensureSupportedMp4SourceDimensions(
		selectedMp4FrameRate,
		sharing ? "source" : quality,
		sharing
			? getShareResolution(plan?.loading ? undefined : plan?.status?.billing.plan)
			: undefined,
		sharing
			? { pipelineModel: "modern", backendPreference: "breeze" }
			: { pipelineModel, backendPreference },
	);
	if (exportWasCancelled()) return { exit: true };
	const { width: exportWidth, height: exportHeight } = supportedSourceDimensions;
	const bitrate = sharing
		? getCloudShareBitrate({
				width: exportWidth,
				height: exportHeight,
				frameRate: selectedMp4FrameRate,
			})
		: getMp4ExportBitrate({
				width: exportWidth,
				height: exportHeight,
				frameRate: selectedMp4FrameRate,
				quality,
				encodingMode,
				useModernNativeStaticLayout: useExperimentalNativeExport,
			});
	diagnostics.record("configured", {
		width: exportWidth,
		height: exportHeight,
		frameRate: selectedMp4FrameRate,
		quality: sharing ? "source" : quality,
		encodingMode: sharing ? "balanced" : encodingMode,
		pipelineModel: sharing ? "modern" : pipelineModel,
		backendPreference: sharing ? "breeze" : backendPreference,
		...(sharing ? { deliveryProfile: "cloud", rateControl: "variable" } : {}),
		bitrate,
	});
	const sourceAudioTrackSettingsForExport = timeline.defaultSourceAudioTrackSettings;

	const exporterConfig = {
		videoUrl: videoPath,
		width: exportWidth,
		height: exportHeight,
		frameRate: selectedMp4FrameRate,
		bitrate,
		codec: DEFAULT_MP4_CODEC,
		encodingMode,
		preferredEncoderPath: supportedSourceDimensions.encoderPath,
		preferredRenderBackend: smokeExportConfig.renderBackend,
		experimentalNativeExport: useExperimentalNativeExport,
		experimentalNvidiaCudaExport: useExperimentalNvidiaCudaExport,
		maxEncodeQueue: smokeExportConfig.maxEncodeQueue,
		maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
		maxPendingFrames: smokeExportConfig.maxPendingFrames,
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
		audioRegions,
		clipRegions,
		sourceAudioFallbackPaths: audio.sourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath: audio.sourceAudioFallbackStartDelayMsByPath,
		sourceAudioTrackSettings: sourceAudioTrackSettingsForExport,
		sourceAudioTrackSettingsByClip: timeline.sourceAudioTrackSettingsByClip,
	};

	const {
		result,
		pipelineModel: actualPipelineModel,
		recovery,
	} = await (sharing ? exportCloudVideo : exportMp4WithRecovery)({
		pipelineModel,
		config: { ...exporterConfig, backendPreference },
		isCancelled: exportWasCancelled,
		setActiveExporter: (exporter) => {
			exporterRef.current = exporter;
		},
		onAttemptResult: (route, attemptResult) => {
			diagnostics.record("pipeline-attempt", { route, success: attemptResult.success });
			diagnostics.result(attemptResult);
		},
		onRecovery: (attempt) => {
			diagnostics.record("recovery-started", {
				route: attempt.route,
				initialError: attempt.initialError,
			});
			setExportProgress((previous) => previous && { ...previous, phase: "preparing" });
		},
		discardTempFile: (tempFilePath) =>
			discardCancelledTemp({ fileName: "export.mp4", tempFilePath }),
	});
	diagnostics.record("pipeline-completed", {
		pipelineModel: actualPipelineModel,
		recovery: recovery?.route,
		success: result.success,
	});
	if (exportWasCancelled()) return { exit: true };
	const smokeExportElapsedMs =
		smokeExportStartedAt !== null
			? Math.round(performance.now() - smokeExportStartedAt)
			: undefined;

	if (result.success && (result.blob || result.tempFilePath)) {
		const fileName = getExportFileName(input.projectName, "mp4");
		if (options?.destination === "share") {
			if (result.tempFilePath) return { exit: true, path: result.tempFilePath };
			if (result.blob) {
				const tempPath = await streamExportBlobToTempFile(result.blob, "mp4");
				if (tempPath) return { exit: true, path: tempPath };
			}
			throw new Error(
				translate(
					"notifications.prepareVideoFailed",
					"Could not prepare the video for sharing.",
				),
			);
		}
		const sidecarForThisExport =
			settings.includeCaptionSidecar &&
			captionSidecarPayload &&
			canExportCaptionFiles(billingRef.current)
				? captionSidecarPayload
				: undefined;
		diagnostics.record("saving");
		markExportAsSaving();

		let saveResult: {
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			captionSidecarFailed?: boolean;
		};
		let pendingOnCancel: PendingExportSave;

		if (result.tempFilePath) {
			// Preferred path: main process already holds the finished MP4 on
			// disk, so we just ask it to move the temp file into place. This
			// avoids ever allocating a multi-GiB ArrayBuffer in the renderer.
			saveResult = await window.electronAPI.finalizeExportedVideo({
				tempPath: result.tempFilePath,
				fileName,
				outputPath:
					smokeExportConfig.enabled && smokeExportConfig.outputPath
						? smokeExportConfig.outputPath
						: null,
				captionSidecar: sidecarForThisExport,
			});
			if (exportWasCancelled()) {
				await discardCancelledTemp({
					fileName,
					tempFilePath: result.tempFilePath,
					captionSidecar: sidecarForThisExport,
				});
				return { exit: true };
			}
			pendingOnCancel = {
				fileName,
				tempFilePath: result.tempFilePath,
				captionSidecar: sidecarForThisExport,
			};
		} else if (result.blob) {
			// Legacy fallback: some export paths still surface a Blob, but in
			// Electron we stream it into a temp file first so save/finalize
			// never requires a giant renderer ArrayBuffer.
			const blobSave = await saveExportBlob(
				result.blob,
				fileName,
				smokeExportConfig.enabled ? smokeExportConfig.outputPath : null,
				sidecarForThisExport,
			);
			if (exportWasCancelled()) {
				await discardCancelledTemp(blobSave.pendingSave);
				return { exit: true };
			}
			saveResult = blobSave.saveResult;
			pendingOnCancel = blobSave.pendingSave;
		} else {
			saveResult = { success: false, message: "Export produced no output" };
			pendingOnCancel = { fileName };
		}

		if (saveResult.canceled) {
			diagnostics.record("save-canceled");
			if (smokeExportConfig.enabled) {
				await writeSmokeExportReport(smokeExportConfig.outputPath, {
					success: false,
					phase: "save",
					format: "mp4",
					pipelineModel: actualPipelineModel,
					recovery,
					backendPreference,
					encodingMode,
					shadowIntensity: effectiveShadowIntensity,
					elapsedMs: smokeExportElapsedMs,
					error: "Save canceled",
					progressSamples: smokeProgressSamples,
					metrics: result.metrics,
				});
			}
			pendingExportSaveRef.current = pendingOnCancel;
			setHasPendingExportSave(true);
			setExportError(
				translate(
					"notifications.saveDialogCanceled",
					"Save dialog canceled. Click Save Again to save without re-rendering.",
				),
			);
			toast.info(
				translate(
					"notifications.saveAgain",
					"Save canceled. You can save again without re-exporting.",
				),
			);
		} else if (saveResult.success && saveResult.path) {
			diagnostics.record("saved");
			if (smokeExportConfig.enabled) {
				await writeSmokeExportReport(smokeExportConfig.outputPath, {
					success: true,
					phase: "saved",
					format: "mp4",
					pipelineModel: actualPipelineModel,
					recovery,
					backendPreference,
					encodingMode,
					shadowIntensity: effectiveShadowIntensity,
					elapsedMs: smokeExportElapsedMs,
					outputPath: saveResult.path,
					progressSamples: smokeProgressSamples,
					metrics: result.metrics,
				});
			}
			if (smokeExportStartedAt !== null) {
				console.log(
					`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
				);
			}
			recordSuccessfulExport();
			showCaptionSidecarWarning(saveResult);
			setExportedFilePath(saveResult.path);
			if (smokeExportConfig.enabled) {
				window.close();
				return { exit: true };
			}
		} else {
			if (smokeExportConfig.enabled) {
				await writeSmokeExportReport(smokeExportConfig.outputPath, {
					success: false,
					phase: "save",
					format: "mp4",
					pipelineModel: actualPipelineModel,
					recovery,
					backendPreference,
					encodingMode,
					shadowIntensity: effectiveShadowIntensity,
					elapsedMs: smokeExportElapsedMs,
					error:
						saveResult.message ||
						translate("notifications.saveVideoFailed", "Failed to save video"),
					progressSamples: smokeProgressSamples,
					metrics: result.metrics,
				});
			}
			diagnostics.record("save-failed", {
				error:
					saveResult.message ||
					translate("notifications.saveVideoFailed", "Failed to save video"),
			});
			setExportError(
				saveResult.message ||
					translate("notifications.saveVideoFailed", "Failed to save video"),
			);
			// Keep the pending-save entry so the user can retry without
			// re-rendering. The temp file is still on disk (the main
			// process only moves/deletes it on success) and the
			// ArrayBuffer fallback still references its in-memory blob.
			if (pendingOnCancel.tempFilePath || pendingOnCancel.arrayBuffer) {
				pendingExportSaveRef.current = pendingOnCancel;
				setHasPendingExportSave(true);
			}
			if (smokeExportConfig.enabled) {
				window.close();
				return { exit: true };
			}
		}
	} else {
		if (smokeExportConfig.enabled) {
			await writeSmokeExportReport(smokeExportConfig.outputPath, {
				success: false,
				phase: "export",
				format: "mp4",
				pipelineModel: actualPipelineModel,
				recovery,
				backendPreference,
				encodingMode,
				shadowIntensity: effectiveShadowIntensity,
				elapsedMs: smokeExportElapsedMs,
				error:
					translate("notifications.exportFailed", "Export failed") +
					(result.error ? `: ${result.error}` : ""),
				progressSamples: smokeProgressSamples,
				metrics: result.metrics,
			});
		}
		setExportError(
			translate("notifications.exportFailed", "Export failed") +
				(result.error ? `: ${result.error}` : ""),
		);
		if (sharing) {
			showExportErrorToast(
				translate("notifications.exportFailed", "Export failed") +
					(result.error ? `: ${result.error}` : ""),
			);
		}
		if (smokeExportConfig.enabled) {
			window.close();
			return { exit: true };
		}
	}

	return { exit: false };
}
