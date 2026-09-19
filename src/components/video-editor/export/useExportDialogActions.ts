import { type RefObject, useCallback } from "react";
import { toast } from "sonner";
import type { useI18n } from "@/contexts/I18nContext";
import type { ExportSettings } from "@/lib/exporter";
import { resolveExportStartSettings } from "../exportStartSettings";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { useExportSession } from "./useExportSession";
import type { useExportSettings } from "./useExportSettings";

type ExportSession = ReturnType<typeof useExportSession>;
type ExportSettingsState = ReturnType<typeof useExportSettings>;

type UseExportDialogActionsInput = {
	t: ReturnType<typeof useI18n>["t"];
	videoPath: string | null;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	hasCaptionsForSidecar: boolean;
	settings: ExportSettingsState;
	session: ExportSession;
	handleExport: (settings: ExportSettings) => void;
	showExportSuccessToast: (filePath: string) => void;
};

export function useExportDialogActions({
	t,
	videoPath,
	videoPlaybackRef,
	hasCaptionsForSidecar,
	settings,
	session,
	handleExport,
	showExportSuccessToast,
}: UseExportDialogActionsInput) {
	const handleOpenExportDropdown = useCallback(() => {
		if (!videoPath) {
			toast.error(t("editor.exportStatus.noVideoLoaded", "No video loaded"));
			return;
		}

		if (session.hasPendingExportSave) {
			session.setShowExportDropdown(true);
			session.setExportError(
				t(
					"editor.exportStatus.saveDialogCanceled",
					"Save dialog canceled. Click Save Again to save without re-rendering.",
				),
			);
			return;
		}
		session.setShowExportDropdown(true);
		session.setExportProgress(null);
		session.setExportError(null);
	}, [t, videoPath, session]);

	const handleStartExportFromDropdown = useCallback(() => {
		const video = videoPlaybackRef.current?.video;
		if (!videoPath) {
			toast.error(t("editor.exportStatus.noVideoLoaded", "No video loaded"));
			return;
		}
		if (!video) {
			toast.error(t("editor.exportStatus.videoNotReady", "Video not ready"));
			return;
		}
		if (video.videoWidth <= 0 || video.videoHeight <= 0) {
			toast.error(
				t("editor.exportStatus.metadataLoading", "Video metadata is still loading"),
			);
			return;
		}

		const resolvedSettings = resolveExportStartSettings({
			sourceWidth: video.videoWidth,
			sourceHeight: video.videoHeight,
			exportFormat: settings.exportFormat,
			includeCaptionSidecar: hasCaptionsForSidecar && settings.includeCaptionSidecar,
			exportEncodingMode: settings.exportEncodingMode,
			exportQuality: settings.exportQuality,
			mp4FrameRate: settings.mp4FrameRate,
			exportBackendPreference: settings.exportBackendPreference,
			exportPipelineModel: settings.exportPipelineModel,
			gifFrameRate: settings.gifFrameRate,
			gifLoop: settings.gifLoop,
			gifSizePreset: settings.gifSizePreset,
		});

		session.setExportError(null);
		session.setExportedFilePath(undefined);
		session.setShowExportDropdown(true);
		handleExport(resolvedSettings);
	}, [t, videoPath, videoPlaybackRef, hasCaptionsForSidecar, settings, session, handleExport]);

	const handleCancelExport = useCallback(() => {
		if (!session.isExporting) return;
		session.cancelledExportRunIdRef.current = session.exportRunIdRef.current;
		session.exportRunIdRef.current += 1;
		session.exporterRef.current?.cancel();
		session.exporterRef.current = null;
		toast.info(t("editor.exportStatus.exportCanceled", "Export canceled"));
		session.clearPendingExportSave();
		session.setShowExportDropdown(false);
		session.setIsExporting(false);
		session.setExportProgress(null);
		session.setExportError(null);
		session.setExportedFilePath(undefined);
	}, [t, session]);

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

		const saveResult = pendingSave.tempFilePath
			? await window.electronAPI.finalizeExportedVideo({
					tempPath: pendingSave.tempFilePath,
					fileName: pendingSave.fileName,
					outputPath: null,
					captionSidecar: pendingSave.captionSidecar,
				})
			: pendingSave.arrayBuffer
				? await window.electronAPI.saveExportedVideo(
						pendingSave.arrayBuffer,
						pendingSave.fileName,
						pendingSave.captionSidecar,
					)
				: {
						success: false,
						message: t(
							"editor.exportStatus.noPendingExport",
							"No pending export to save",
						),
					};

		if (saveResult.canceled) {
			session.setExportError(
				t(
					"editor.exportStatus.saveDialogCanceled",
					"Save dialog canceled. Click Save Again to save without re-rendering.",
				),
			);
			toast.info(
				t("editor.exportStatus.saveCanceledTryAgain", "Save canceled. You can try again."),
			);
			return;
		}
		if (saveResult.success && saveResult.path) {
			session.pendingExportSaveRef.current = null;
			session.setHasPendingExportSave(false);
			session.setExportError(null);
			session.setExportedFilePath(saveResult.path);
			showExportSuccessToast(saveResult.path);
			session.setShowExportDropdown(true);
			return;
		}

		const errorMessage =
			saveResult.message ||
			t("editor.exportStatus.failedToSaveVideo", "Failed to save video");
		session.setExportError(errorMessage);
		toast.error(errorMessage);
	}, [t, session, showExportSuccessToast]);

	const revealExportedFile = useCallback(async () => {
		if (!session.exportedFilePath) return;
		try {
			const result = await window.electronAPI.revealInFolder(session.exportedFilePath);
			if (!result.success) {
				toast.error(
					result.error ||
						result.message ||
						t("editor.exportStatus.revealFailed", "Failed to reveal item in folder."),
				);
			}
		} catch (error) {
			toast.error(
				t("editor.exportStatus.revealError", "Error revealing in folder: {{error}}", {
					error: String(error),
				}),
			);
		}
	}, [t, session.exportedFilePath]);

	return {
		handleOpenExportDropdown,
		handleStartExportFromDropdown,
		handleCancelExport,
		handleExportDropdownClose,
		handleRetrySaveExport,
		revealExportedFile,
	};
}
