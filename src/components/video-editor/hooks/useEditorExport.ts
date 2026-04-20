/**
 * useEditorExport – all export state and the handleExport workflow.
 *
 * The caller provides `getRenderConfig()` which is called at export-start
 * time; this avoids tracking 40+ reactive deps in this hook.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	ExportMp4FrameRate,
	ExportProgress,
	ExportSettings,
	SupportedMp4Dimensions,
} from "@/lib/exporter";
import { calculateOutputDimensions, GIF_SIZE_PRESETS } from "@/lib/exporter";
import type { VideoPlaybackRef } from "../VideoPlayback";
import type { SmokeExportConfig } from "../videoEditorUtils";
import type {
	CancelableExporter,
	PendingExportSave,
	RenderConfig,
} from "./editorExportShared";
import {
	runEditorExport,
} from "./editorExportWorkflow";

export type { RenderConfig } from "./editorExportShared";

interface UseEditorExportParams {
	videoPlaybackRef: React.RefObject<VideoPlaybackRef | null>;
	smokeExportConfig: SmokeExportConfig;
	getRenderConfig: () => RenderConfig;
	ensureSupportedMp4SourceDimensions: (
		frameRate: ExportMp4FrameRate,
	) => Promise<SupportedMp4Dimensions>;
	remountPreview: () => void;
}

export function useEditorExport({
	videoPlaybackRef,
	smokeExportConfig,
	getRenderConfig,
	ensureSupportedMp4SourceDimensions,
	remountPreview,
}: UseEditorExportParams) {
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [exportedFilePath, setExportedFilePath] = useState<string | undefined>(undefined);
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const exporterRef = useRef<CancelableExporter | null>(null);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);
	const smokeExportStartedRef = useRef(false);

	const clearPendingExportSave = useCallback(() => {
		pendingExportSaveRef.current = null;
		setHasPendingExportSave(false);
	}, []);

	const setPendingExportSave = useCallback((pendingSave: PendingExportSave) => {
		pendingExportSaveRef.current = pendingSave;
		setHasPendingExportSave(true);
	}, []);

	const markExportAsSaving = useCallback(() => {
		setExportProgress((prev) => (prev ? { ...prev, phase: "saving" } : null));
	}, []);

	const showExportSuccessToast = useCallback((filePath: string) => {
		toast.success(`Exported successfully to ${filePath}`, {
			action: {
				label: "Show in Folder",
				onClick: async () => {
					try {
						const result = await window.electronAPI.revealInFolder(filePath);
						if (!result.success) {
							toast.error(
								result.error || result.message || "Failed to reveal item in folder.",
							);
						}
					} catch (error) {
						toast.error(`Error revealing in folder: ${String(error)}`);
					}
				},
			},
		});
	}, []);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			await runEditorExport({
				settings,
				videoPlaybackRef,
				smokeExportConfig,
				getRenderConfig,
				ensureSupportedMp4SourceDimensions,
				remountPreview,
				clearPendingExportSave,
				setPendingExportSave,
				markExportAsSaving,
				showExportSuccessToast,
				setIsExporting,
				setExportProgress,
				setExportError,
				setShowExportDropdown,
				setExportedFilePath,
				exporterRef,
			});
		},
		[
			getRenderConfig,
			videoPlaybackRef,
			smokeExportConfig,
			ensureSupportedMp4SourceDimensions,
			remountPreview,
			clearPendingExportSave,
			setPendingExportSave,
			markExportAsSaving,
			showExportSuccessToast,
			setExportedFilePath,
			setExportError,
			setExportProgress,
			setIsExporting,
			setShowExportDropdown,
		],
	);

	const handleOpenExportDropdown = useCallback(() => {
		const { videoPath } = getRenderConfig();
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}
		if (hasPendingExportSave) {
			setShowExportDropdown(true);
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			return;
		}
		setShowExportDropdown(true);
		setExportProgress(null);
		setExportError(null);
	}, [getRenderConfig, hasPendingExportSave]);

	const handleStartExportFromDropdown = useCallback(() => {
		const config = getRenderConfig();
		if (!config.videoPath) {
			toast.error("No video loaded");
			return;
		}
		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}
		const sourceWidth = video.videoWidth || 1920;
		const sourceHeight = video.videoHeight || 1080;
		const gifDimensions = calculateOutputDimensions(
			sourceWidth,
			sourceHeight,
			config.gifSizePreset,
			GIF_SIZE_PRESETS,
		);
		const settings: ExportSettings = {
			format: config.exportFormat,
			encodingMode: config.exportFormat === "mp4" ? config.exportEncodingMode : undefined,
			mp4FrameRate: config.exportFormat === "mp4" ? config.mp4FrameRate : undefined,
			backendPreference:
				config.exportFormat === "mp4" ? config.exportBackendPreference : undefined,
			pipelineModel: config.exportFormat === "mp4" ? config.exportPipelineModel : undefined,
			quality: config.exportFormat === "mp4" ? config.exportQuality : undefined,
			gifConfig:
				config.exportFormat === "gif"
					? {
							frameRate: config.gifFrameRate,
							loop: config.gifLoop,
							sizePreset: config.gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};
		setExportError(null);
		setExportedFilePath(undefined);
		setShowExportDropdown(true);
		handleExport(settings);
	}, [getRenderConfig, videoPlaybackRef, handleExport]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			clearPendingExportSave();
			setShowExportDropdown(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(undefined);
		}
	}, [clearPendingExportSave]);

	const handleExportDropdownClose = useCallback(() => {
		clearPendingExportSave();
		setShowExportDropdown(false);
		setExportProgress(null);
		setExportError(null);
		setExportedFilePath(undefined);
	}, [clearPendingExportSave]);

	const handleRetrySaveExport = useCallback(async () => {
		const pendingSave = pendingExportSaveRef.current;
		if (!pendingSave) return;
		const saveResult = await window.electronAPI.saveExportedVideo(
			pendingSave.arrayBuffer,
			pendingSave.fileName,
		);
		if (saveResult.canceled) {
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			toast.info("Save canceled. You can try again.");
			return;
		}
		if (saveResult.success && saveResult.path) {
			clearPendingExportSave();
			setExportError(null);
			setExportedFilePath(saveResult.path);
			showExportSuccessToast(saveResult.path);
			setShowExportDropdown(true);
			return;
		}
		const errorMessage = saveResult.message || "Failed to save video";
		setExportError(errorMessage);
		toast.error(errorMessage);
	}, [clearPendingExportSave, showExportSuccessToast]);

	// Export status derived values
	const isExportSaving = exportProgress?.phase === "saving";
	const isExportFinalizing = exportProgress?.phase === "finalizing";
	const isRenderingAudio =
		isExportFinalizing && typeof exportProgress?.audioProgress === "number";
	const exportFinalizingProgress = isExportFinalizing
		? Math.min(
				typeof exportProgress?.renderProgress === "number"
					? exportProgress.renderProgress
					: (exportProgress?.percentage ?? 100),
				100,
			)
		: null;

	// Smoke export trigger
	const smokeExportTriggerable = useMemo(
		() => ({
			enabled: smokeExportConfig.enabled,
			encodingMode: smokeExportConfig.encodingMode,
		}),
		[smokeExportConfig.enabled, smokeExportConfig.encodingMode],
	);

	return {
		isExporting,
		exportProgress,
		exportError,
		exportedFilePath,
		showExportDropdown,
		setShowExportDropdown,
		hasPendingExportSave,
		handleExport,
		handleOpenExportDropdown,
		handleStartExportFromDropdown,
		handleCancelExport,
		handleExportDropdownClose,
		handleRetrySaveExport,
		showExportSuccessToast,
		clearPendingExportSave,
		markExportAsSaving,
		isExportSaving,
		isExportFinalizing,
		isRenderingAudio,
		exportFinalizingProgress,
		smokeExportStartedRef,
		smokeExportTriggerable,
	};
}
