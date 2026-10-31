import { useCallback, useRef, useState } from "react";
import type { ExportProgress } from "@/lib/exporter";
import { resolveSavingExportProgress } from "../exportProgressState";
import type { PendingExportSave } from "./exportPersistence";

export type CancelableExporter = { cancel(): void };

export function useExportSession() {
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [exportedFilePath, setExportedFilePath] = useState<string>();
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const exporterRef = useRef<CancelableExporter | null>(null);
	const exportRunIdRef = useRef(0);
	const cancelledExportRunIdRef = useRef<number | null>(null);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);

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
	}, []);

	return {
		isExporting,
		setIsExporting,
		exportProgress,
		setExportProgress,
		exportError,
		setExportError,
		showExportDropdown,
		setShowExportDropdown,
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
