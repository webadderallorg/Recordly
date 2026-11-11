import type { LibraryExportIdentity } from "../dashboard/libraryExportHistory";
import { translate } from "@/i18n/runtime";
import { type RefObject, useCallback } from "react";
import { useOptionalBilling } from "@/components/billing/BillingProvider";
import { canExportCaptionFiles } from "@/components/billing/captionFileAccess";
import { toast } from "@/components/ui/toast";
import { recordExportDiagnostic } from "@/lib/feedback/exportDiagnostics";
import type { ExportFormat, ExportSettings } from "@/lib/exporter";
import { resolveExportStartSettings, resolveShareExportSettings } from "../exportStartSettings";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";
import { showCaptionSidecarWarning } from "./exportRunnerSupport";

type ExportSession = ReturnType<typeof useExportSession>;
type ExportSettingsState = ReturnType<typeof useExportSettings>;

type UseExportDialogActionsInput = {
	videoPath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	hasCaptionsForSidecar: boolean;
	settings: ExportSettingsState;
	session: ExportSession;
	handleExport: (
		settings: ExportSettings,
		options?: { destination?: "download" | "share" },
	) => Promise<string | undefined>;
	recordSuccessfulExport: (identity?: LibraryExportIdentity) => void;
};

export function useExportDialogActions({
	videoPath,
	videoPlaybackRef,
	hasCaptionsForSidecar,
	settings,
	session,
	handleExport,
	recordSuccessfulExport,
}: UseExportDialogActionsInput) {
	const billing = useOptionalBilling();
	const handleOpenExportDropdown = useCallback(() => {
		if (!videoPath) {
			toast.error(translate("notifications.noVideo", "No video loaded"));
			return;
		}
		if (session.isExporting) {
			session.setShowExportDropdown(true);
			return;
		}

		if (session.hasPendingExportSave) {
			session.setShowExportDropdown(true);
			session.setExportError(
				translate(
					"notifications.saveDialogCanceled",
					"Save dialog canceled. Click Save Again to save without re-rendering.",
				),
			);
			return;
		}
		session.setShowExportDropdown(true);
		session.setExportProgress(null);
		session.setGifOptimization(null);
		session.setExportError(null);
		session.setExportedFilePath(undefined);
	}, [videoPath, session]);

	const resolveCurrentSettings = useCallback(
		(exportFormat: ExportFormat = settings.exportFormat) => {
			const video = videoPlaybackRef.current?.video;
			if (!videoPath) {
				toast.error(translate("notifications.noVideo", "No video loaded"));
				return null;
			}
			if (!video) {
				toast.error(translate("notifications.videoNotReady", "Video not ready"));
				return null;
			}
			if (video.videoWidth <= 0 || video.videoHeight <= 0) {
				toast.error(
					translate("notifications.metadataLoading", "Video metadata is still loading"),
				);
				return null;
			}

			return resolveExportStartSettings({
				sourceWidth: video.videoWidth,
				sourceHeight: video.videoHeight,
				exportFormat,
				includeCaptionSidecar:
					hasCaptionsForSidecar &&
					settings.includeCaptionSidecar &&
					canExportCaptionFiles(billing),
				exportEncodingMode: settings.exportEncodingMode,
				exportQuality: settings.exportQuality,
				mp4FrameRate: settings.mp4FrameRate,
				exportBackendPreference: settings.exportBackendPreference,
				exportPipelineModel: settings.exportPipelineModel,
				gifFrameRate: settings.gifFrameRate,
				gifLoop: settings.gifLoop,
				gifOptimizeSize: settings.gifOptimizeSize,
				gifSizePreset: settings.gifSizePreset,
			});
		},
		[videoPath, videoPlaybackRef, hasCaptionsForSidecar, settings, billing],
	);

	const handleStartExportFromDropdown = useCallback(() => {
		const resolvedSettings = resolveCurrentSettings();
		if (!resolvedSettings) return;
		session.setExportError(null);
		session.setExportedFilePath(undefined);
		session.setShowExportDropdown(false);
		void handleExport(resolvedSettings, { destination: "download" });
	}, [resolveCurrentSettings, session, handleExport]);

	const prepareExportForShare = useCallback(async () => {
		const resolvedSettings = resolveCurrentSettings("mp4");
		if (!resolvedSettings) return undefined;
		session.setExportError(null);
		return handleExport(resolveShareExportSettings(resolvedSettings), { destination: "share" });
	}, [resolveCurrentSettings, session, handleExport]);

	const handleCancelExport = useCallback(() => {
		if (!session.isExporting) return;
		session.cancelledExportRunIdRef.current = session.exportRunIdRef.current;
		session.exportRunIdRef.current += 1;
		session.exporterRef.current?.cancel();
		session.exporterRef.current = null;
		toast.info(translate("notifications.exportCanceled", "Export canceled"));
		session.clearPendingExportSave();
		session.setShowExportDropdown(false);
		session.setIsExporting(false);
		session.setIsOptimizingGif(false);
		session.setExportProgress(null);
		session.setExportError(null);
		session.setExportedFilePath(undefined);
	}, [session]);

	const handleExportDropdownClose = useCallback(() => {
		session.clearPendingExportSave();
		session.setShowExportDropdown(false);
		session.setExportProgress(null);
		session.setExportError(null);
		session.setExportedFilePath(undefined);
	}, [session]);

	const handleRetrySaveExport = useCallback(async () => {
		const pendingSave = session.pendingExportSaveRef.current;
		if (!pendingSave) return;
		const exportIdentity = { ...session.exportIdentityRef?.current };
		const captionSidecar = canExportCaptionFiles(billing)
			? pendingSave.captionSidecar
			: undefined;

		recordExportDiagnostic("save-retry");
		const saveResult = pendingSave.tempFilePath
			? await window.electronAPI.finalizeExportedVideo({
					tempPath: pendingSave.tempFilePath,
					fileName: pendingSave.fileName,
					outputPath: null,
					captionSidecar,
				})
			: pendingSave.arrayBuffer
				? await window.electronAPI.saveExportedVideo(
						pendingSave.arrayBuffer,
						pendingSave.fileName,
						captionSidecar,
					)
				: {
						success: false,
						message: translate(
							"notifications.noPendingExport",
							"No pending export to save",
						),
					};

		if (saveResult.canceled) {
			recordExportDiagnostic("save-canceled");
			session.setExportError(
				translate(
					"notifications.saveDialogCanceled",
					"Save dialog canceled. Click Save Again to save without re-rendering.",
				),
			);
			toast.info(
				translate("notifications.saveCanceled", "Save canceled. You can try again."),
			);
			return;
		}
		if (saveResult.success && saveResult.path) {
			recordExportDiagnostic("saved");
			session.pendingExportSaveRef.current = null;
			session.setHasPendingExportSave(false);
			session.setExportError(null);
			session.setExportedFilePath(saveResult.path);
			recordSuccessfulExport(exportIdentity);
			showCaptionSidecarWarning(saveResult);
			return;
		}

		const errorMessage =
			(pendingSave.fileName.toLowerCase().endsWith(".gif")
				? translate("notifications.saveGifFailed", "Failed to save GIF")
				: translate("notifications.saveVideoFailed", "Failed to save video")) +
			(saveResult.message ? `: ${saveResult.message}` : "");
		recordExportDiagnostic("save-failed", { error: errorMessage });
		session.setExportError(errorMessage);
		toast.error(errorMessage);
	}, [session, recordSuccessfulExport, billing]);

	const revealExportedFile = useCallback(async () => {
		if (!session.exportedFilePath) return;
		try {
			const result = await window.electronAPI.revealInFolder(session.exportedFilePath);
			if (!result.success) {
				toast.error(
					translate("notifications.revealFailed", "Failed to reveal item in folder."),
					{ description: result.error || result.message },
				);
			}
		} catch (error) {
			toast.error(
				translate(
					"notifications.revealError",
					"Failed to reveal item in folder: {{error}}",
					{ error: String(error) },
				),
			);
		}
	}, [session.exportedFilePath]);

	return {
		handleOpenExportDropdown,
		handleStartExportFromDropdown,
		prepareExportForShare,
		handleCancelExport,
		handleExportDropdownClose,
		handleRetrySaveExport,
		revealExportedFile,
	};
}
