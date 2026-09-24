import { Card, ProgressBar } from "@heroui/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CloudArrowUp, DownloadSimple as Download } from "@/components/ui/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import type { useI18n } from "@/contexts/I18nContext";
import { copyToClipboard } from "@/lib/clipboard";
import { CloudShareButton } from "../cloud/CloudShareButton";
import { ExportSettingsMenu } from "../ExportSettingsMenu";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useExportStatusViewModel } from "../export/useExportStatusViewModel";

type Props = {
	projectPath?: string | null;
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
	projectTitle: string;
	prepareExportForShare: () => Promise<string | undefined>;
	onRequestShareSignIn: () => void;
	shareRequestNonce: number;
	authToken?: string;
};

export function EditorExportMenu(props: Props) {
	const [shareOpen, setShareOpen] = useState(false);
	useEffect(() => {
		if (props.shareRequestNonce > 0) setShareOpen(true);
	}, [props.shareRequestNonce]);
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
		<>
			<Popover
				open={showExportDropdown}
				onOpenChange={(open) => {
					if (open) handleOpenExportDropdown();
					else setShowExportDropdown(false);
				}}
				modal={true}
			>
				<PopoverTrigger asChild>
					<Button
						type="button"
						className="inline-flex h-9 min-w-[104px] items-center justify-center gap-2 px-4.5"
					>
						<Download className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">
							{t("common.actions.export", "Export")}
						</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					aria-label="Export"
					align="end"
					sideOffset={10}
					className="w-[360px] p-0"
				>
					{isExporting ? (
						<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
							<div className="mb-3 flex items-center justify-between gap-3">
								<div>
									<p className="text-sm font-semibold text-foreground">
										{t("editor.exportStatus.exporting", "Exporting")}
									</p>
									<p className="text-xs text-muted-foreground">
										{t(
											"editor.exportStatus.renderingFile",
											"Rendering your file.",
										)}
									</p>
									{isLightningExportInProgress && exportMessage ? (
										<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/70">
											{exportMessage}
										</p>
									) : null}
									{isLegacyExportInProgress ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Export too slow? Cancel and try Lightning export!
										</p>
									) : null}
								</div>
								<Button
									type="button"
									variant="outline"
									onClick={handleCancelExport}
									className="h-8 px-3 text-xs"
								>
									{t("common.actions.cancel")}
								</Button>
							</div>
							<ProgressBar
								aria-label={t("editor.exportStatus.exporting", "Exporting")}
								isIndeterminate={
									isExportPreparing ||
									isExportSaving ||
									isExportFinalSaveIndeterminate
								}
								value={Math.min(
									isRenderingAudio
										? (exportProgress?.audioProgress ?? 0) * 100
										: (exportFinalizingProgress ??
												exportProgress?.percentage ??
												8),
									100,
								)}
							>
								<ProgressBar.Track>
									<ProgressBar.Fill />
								</ProgressBar.Track>
							</ProgressBar>
							<p className="mt-2 text-xs text-muted-foreground">
								{exportPercentLabel}
							</p>
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
									Path: {exportRuntimeLabel}
								</p>
							) : null}
							{exportNativeSkipLabel ? (
								<p className="mt-1 text-[11px] text-amber-500/80">
									{exportNativeSkipLabel}
								</p>
							) : null}
						</Card>
					) : exportError ? (
						<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
							<p className="text-sm font-semibold text-foreground">
								{t("editor.exportStatus.issue", "Export issue")}
							</p>
							{exportRuntimeLabel ? (
								<p className="mt-1 text-[11px] text-muted-foreground/70">
									Path: {exportRuntimeLabel}
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
										const copied = await copyToClipboard(exportError);
										if (copied) {
											toast.success(
												t(
													"editor.exportStatus.errorCopied",
													"Error copied",
												),
											);
										} else {
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
										className="h-8 flex-1 text-xs"
									>
										{t("editor.actions.saveAgain", "Save Again")}
									</Button>
								) : null}
								<Button
									type="button"
									variant="outline"
									onClick={handleExportDropdownClose}
									className="h-8 flex-1 text-xs"
								>
									{t("common.actions.close", "Close")}
								</Button>
							</div>
						</Card>
					) : exportedFilePath ? (
						<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
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
									Path: {exportRuntimeLabel}
								</p>
							) : null}
							<p className="mt-3 truncate text-xs text-muted-foreground/70">
								{exportedFilePath.split(/[\\/]/).pop()}
							</p>
							<div className="mt-4 flex gap-2">
								<Button
									type="button"
									onClick={revealExportedFile}
									className="h-8 flex-1 text-xs"
								>
									{t("editor.actions.showInFolder", "Show In Folder")}
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={handleExportDropdownClose}
									className="h-8 flex-1 text-xs"
								>
									{t("editor.cloud.done")}
								</Button>
							</div>
						</Card>
					) : (
						<>
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
								onExperimentalNvidiaCudaExportChange={
									setExperimentalNvidiaCudaExport
								}
								nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
								exportQuality={exportQuality}
								onExportQualityChange={setExportQuality}
								gifFrameRate={gifFrameRate}
								onGifFrameRateChange={setGifFrameRate}
								gifLoop={gifLoop}
								onGifLoopChange={setGifLoop}
								gifSizePreset={gifSizePreset}
								onGifSizePresetChange={setGifSizePreset}
								showCaptionSidecarOption={
									hasCaptionsForSidecar && exportFormat === "mp4"
								}
								includeCaptionSidecar={includeCaptionSidecar}
								onIncludeCaptionSidecarChange={setIncludeCaptionSidecar}
								mp4OutputDimensions={mp4OutputDimensions}
								gifOutputDimensions={gifOutputDimensions}
								onExport={handleStartExportFromDropdown}
								className="rounded-none bg-transparent p-5 shadow-none"
							/>
							<div className="px-5 pb-5">
								<Button
									variant="secondary"
									className="w-full"
									onClick={() => {
										setShowExportDropdown(false);
										props.onRequestShareSignIn();
									}}
								>
									<CloudArrowUp className="size-4" />
									{t("editor.cloud.createShareLink")}
								</Button>
							</div>
						</>
					)}
				</PopoverContent>
			</Popover>
			{shareOpen && (
				<CloudShareButton
					projectPath={props.projectPath}
					hideTrigger
					open={shareOpen}
					onOpenChange={setShareOpen}
					projectTitle={props.projectTitle}
					prepareFile={props.prepareExportForShare}
					onCancelPrepare={handleCancelExport}
					authToken={props.authToken}
				/>
			)}
		</>
	);
}
