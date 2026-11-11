import type { GifSizeEstimateState } from "./useGifSizeEstimate";
import type { GifOptimizationSummary } from "@/lib/exporter/gifOptimization";
import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import type { ExportProgress } from "@/lib/exporter";
import { resolveExportProgressUpdate, resolveSavingExportProgress } from "../exportProgressState";
import type { PendingExportSave } from "./exportPersistence";

export type CancelableExporter = { cancel(): void };

export function useExportSession() {
	const exportIdentityRef = useRef<
		import("../dashboard/libraryExportHistory").LibraryExportIdentity | null
	>(null);
	const [mp4SizeEstimate, setMp4SizeEstimate] = useState<number | null>(null);
	const [gifSizeEstimate, setGifSizeEstimate] = useState<GifSizeEstimateState | null>(null);
	const [gifOptimization, setGifOptimization] = useState<GifOptimizationSummary | null>(null);
	const [isOptimizingGif, setIsOptimizingGif] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, updateExportProgress] = useState<ExportProgress | null>(null);
	const setExportProgress = useCallback((update: SetStateAction<ExportProgress | null>) => {
		updateExportProgress((previous) =>
			resolveExportProgressUpdate(
				previous,
				typeof update === "function" ? update(previous) : update,
			),
		);
	}, []);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [suggestedFileName, setSuggestedFileName] = useState<string>();
	const [exportedFilePath, setExportedFilePath] = useState<string>();
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const exporterRef = useRef<CancelableExporter | null>(null);
	const exportRunIdRef = useRef(0);
	const cancelledExportRunIdRef = useRef<number | null>(null);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);
	useEffect(() => {
		window.electronAPI?.setExportInProgress?.(
			isExporting || isOptimizingGif || hasPendingExportSave,
		);
	}, [isExporting, isOptimizingGif, hasPendingExportSave]);
	useEffect(() => () => window.electronAPI?.setExportInProgress?.(false), []);

	const clearPendingExportSave = useCallback(() => {
		const pendingSave = pendingExportSaveRef.current;
		pendingExportSaveRef.current = null;
		setHasPendingExportSave(false);
		if (pendingSave?.tempFilePath && typeof window !== "undefined") {
			void window.electronAPI.discardExportedTemp?.(pendingSave.tempFilePath);
		}
	}, []);

	const markExportAsSaving = useCallback(() => {
		setExportProgress(resolveSavingExportProgress);
	}, [setExportProgress]);

	return {
		exportIdentityRef,
		mp4SizeEstimate,
		setMp4SizeEstimate,
		gifSizeEstimate,
		setGifSizeEstimate,
		gifOptimization,
		setGifOptimization,
		isOptimizingGif,
		setIsOptimizingGif,
		isExporting,
		setIsExporting,
		exportProgress,
		setExportProgress,
		exportError,
		setExportError,
		showExportDropdown,
		setShowExportDropdown,
		suggestedFileName,
		setSuggestedFileName,
		exportedFilePath,
		setExportedFilePath,
		hasPendingExportSave,
		setHasPendingExportSave,
		exporterRef,
		exportRunIdRef,
		cancelledExportRunIdRef,
		pendingExportSaveRef,
		clearPendingExportSave,
		markExportAsSaving,
	};
}
