import { DownloadSimple as Download } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { useI18n } from "@/contexts/I18nContext";
import { ExportSettingsMenu } from "../ExportSettingsMenu";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useExportStatusViewModel } from "../export/useExportStatusViewModel";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	exportSettings: ReturnType<typeof useExportSettings>;
	exportSession: ReturnType<typeof useExportSession>;
	exportDimensions: ReturnType<typeof useExportDimensions>;
	exportStatus: ReturnType<typeof useExportStatusViewModel>;
	hasCaptionsForSidecar: boolean;
	nvidiaCudaExportAvailable: boolean;
	experimentalNvidiaCudaExport: boolean;
	setExperimentalNvidiaCudaExport: (enabled: boolean) => void;
	handleOpenExportDropdown: () => void;
	handleExportDropdownClose: () => void;
	handleCancelExport: () => void;
	handleRetrySaveExport: () => void;
	handleStartExportFromDropdown: () => void;
	revealExportedFile: () => void;
	exportMessage: string | null;
};

export function EditorExportMenu(props: Props) {
	const {
		t,
		exportSettings,
		exportSession,
		exportDimensions,
		exportStatus,
		hasCaptionsForSidecar,
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
		handleOpenExportDropdown,
		handleExportDropdownClose,
		handleCancelExport,
		handleRetrySaveExport,
		handleStartExportFromDropdown,
		revealExportedFile,
		exportMessage,
	} = props;
	const {
		exportQuality,
		setExportQuality,
		exportEncodingMode,
		setExportEncodingMode,
		exportPipelineModel,
		mp4FrameRate,
		setMp4FrameRate,
		exportFormat,
		setExportFormat,
		gifFrameRate,
		setGifFrameRate,
		gifLoop,
		setGifLoop,
		gifSizePreset,
		setGifSizePreset,
		includeCaptionSidecar,
		setIncludeCaptionSidecar,
	} = exportSettings;
	const {
		isExporting,
		exportProgress,
		exportError,
		showExportDropdown,
		setShowExportDropdown,
		exportedFilePath,
		hasPendingExportSave,
	} = exportSession;
	const { gifOutputDimensions, mp4OutputDimensions } = exportDimensions;
	const {
		isExportPreparing,
		isExportSaving,
		isRenderingAudio,
		isExportFinalSaveIndeterminate,
		isLightningExportInProgress,
		isLegacyExportInProgress,
		exportFinalizingProgress,
		exportRenderSpeedLabel,
		exportPercentLabel,
		runtimeLabel: exportRuntimeLabel,
		nativeSkipLabel: exportNativeSkipLabel,
	} = exportStatus;

	return (
		<DropdownMenu open={showExportDropdown} onOpenChange={setShowExportDropdown} modal={false}>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					onClick={handleOpenExportDropdown}
					className="inline-flex h-8 min-w-[112px] items-center justify-center gap-2 rounded-[5px] bg-[#2563EB] px-4.5 text-white transition-colors hover:bg-[#2563EB]/92"
				>
					<Download className="h-4 w-4" />
					<span className="text-sm font-semibold tracking-tight">
						{t("common.actions.export", "Export")}
					</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				sideOffset={10}
				className="w-[360px] border-none bg-transparent p-0 shadow-none"
			>
				{isExporting ? (
					<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
						<div className="mb-3 flex items-center justify-between gap-3">
							<div>
								<p className="text-sm font-semibold text-foreground">
									{t("editor.exportStatus.exporting", "Exporting")}
								</p>
								<p className="text-xs text-muted-foreground">
									{t("editor.exportStatus.renderingFile", "Rendering your file.")}
								</p>
								{isLightningExportInProgress && exportMessage ? (
									<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
										{exportMessage}
									</p>
								) : null}
								{isLegacyExportInProgress ? (
									<p className="mt-1 text-[11px] text-muted-foreground/70">
										{t(
											"editor.exportStatus.legacySlow",
											"Export too slow? Cancel and try Lightning export!",
										)}
									</p>
								) : null}
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={handleCancelExport}
								className="h-8 border-red-500/20 bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20"
							>
								{t("common.actions.cancel")}
							</Button>
						</div>
						<div className="h-2 overflow-hidden rounded-full border border-foreground/5 bg-foreground/5">
							{isExportPreparing ||
							isExportSaving ||
							isExportFinalSaveIndeterminate ? (
								<div className="indeterminate-progress h-full rounded-full bg-transparent" />
							) : (
								<div
									className="h-full bg-[#2563EB] transition-all duration-300 ease-out"
									style={{
										width: `${Math.min(isRenderingAudio ? (exportProgress?.audioProgress ?? 0) * 100 : (exportFinalizingProgress ?? exportProgress?.percentage ?? 8), 100)}%`,
									}}
								/>
							)}
						</div>
						<p className="mt-2 text-xs text-muted-foreground">{exportPercentLabel}</p>
						{isRenderingAudio ? (
							<p className="mt-1 text-[11px] text-muted-foreground/70">
								{t(
									"editor.export.processingAudioEdits",
									"Processing audio with speed/overlay edits",
								)}
							</p>
						) : exportRenderSpeedLabel ? (
							<p className="mt-1 text-[11px] text-muted-foreground/70">
								{exportRenderSpeedLabel}
							</p>
						) : null}
						{exportRuntimeLabel ? (
							<p className="mt-1 text-[11px] text-muted-foreground/70">
								{t("editor.exportStatus.path", "Path: {{path}}", {
									path: exportRuntimeLabel,
								})}
							</p>
						) : null}
						{exportNativeSkipLabel ? (
							<p className="mt-1 text-[11px] text-amber-500/80">
								{exportNativeSkipLabel}
							</p>
						) : null}
					</div>
				) : exportError ? (
					<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
						<p className="text-sm font-semibold text-foreground">
							{t("editor.exportStatus.issue", "Export issue")}
						</p>
						{exportRuntimeLabel ? (
							<p className="mt-1 text-[11px] text-muted-foreground/70">
								{t("editor.exportStatus.path", "Path: {{path}}", {
									path: exportRuntimeLabel,
								})}
							</p>
						) : null}
						<p className="mt-1 select-text whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
							{exportError}
						</p>
						<div className="mt-4 flex gap-2">
							<Button
								type="button"
								variant="outline"
								className="h-8 text-xs"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(exportError);
										toast.success(
											t("editor.exportStatus.errorCopied", "Error copied"),
										);
									} catch {
										toast.error(
											t(
												"editor.exportStatus.errorCopyFailed",
												"Couldn't copy. Select the error text and copy it manually.",
											),
										);
									}
								}}
							>
								{t("editor.exportStatus.copyError", "Copy error")}
							</Button>
							{hasPendingExportSave ? (
								<Button
									type="button"
									onClick={handleRetrySaveExport}
									className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
								>
									{t("editor.actions.saveAgain", "Save Again")}
								</Button>
							) : null}
							<Button
								type="button"
								variant="outline"
								onClick={handleExportDropdownClose}
								className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
							>
								{t("common.actions.close", "Close")}
							</Button>
						</div>
					</div>
				) : exportedFilePath ? (
					<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
						<p className="text-sm font-semibold text-foreground">
							{t("editor.exportStatus.complete", "Export complete")}
						</p>
						<p className="mt-1 text-xs text-muted-foreground">
							{t(
								"editor.exportStatus.savedSuccessfully",
								"Your file was saved successfully.",
							)}
						</p>
						{exportRuntimeLabel ? (
							<p className="mt-1 text-[11px] text-muted-foreground/70">
								{t("editor.exportStatus.path", "Path: {{path}}", {
									path: exportRuntimeLabel,
								})}
							</p>
						) : null}
						<p className="mt-3 truncate text-xs text-muted-foreground/70">
							{exportedFilePath.split(/[\\/]/).pop()}
						</p>
						<div className="mt-4 flex gap-2">
							<Button
								type="button"
								onClick={revealExportedFile}
								className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
							>
								{t("editor.actions.showInFolder", "Show In Folder")}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={handleExportDropdownClose}
								className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
							>
								{t("editor.exportStatus.done", "Done")}
							</Button>
						</div>
					</div>
				) : (
					<ExportSettingsMenu
						exportFormat={exportFormat}
						onExportFormatChange={setExportFormat}
						exportEncodingMode={exportEncodingMode}
						onExportEncodingModeChange={setExportEncodingMode}
						mp4FrameRate={mp4FrameRate}
						onMp4FrameRateChange={setMp4FrameRate}
						exportPipelineModel={exportPipelineModel}
						experimentalNvidiaCudaExport={
							experimentalNvidiaCudaExport && nvidiaCudaExportAvailable
						}
						onExperimentalNvidiaCudaExportChange={setExperimentalNvidiaCudaExport}
						nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
						exportQuality={exportQuality}
						onExportQualityChange={setExportQuality}
						gifFrameRate={gifFrameRate}
						onGifFrameRateChange={setGifFrameRate}
						gifLoop={gifLoop}
						onGifLoopChange={setGifLoop}
						gifSizePreset={gifSizePreset}
						onGifSizePresetChange={setGifSizePreset}
						showCaptionSidecarOption={hasCaptionsForSidecar && exportFormat === "mp4"}
						includeCaptionSidecar={includeCaptionSidecar}
						onIncludeCaptionSidecarChange={setIncludeCaptionSidecar}
						mp4OutputDimensions={mp4OutputDimensions}
						gifOutputDimensions={gifOutputDimensions}
						onExport={handleStartExportFromDropdown}
						className="shadow-2xl"
					/>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
