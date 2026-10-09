import { ExportErrorReportButton } from "@/components/feedback/ExportErrorReportButton";
import { LinkSimple, HardDrive, Export } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CloudShareButton } from "../cloud/CloudShareButton";
import { Card, TagGroup, Tag } from "@heroui/react";
import { motion, useReducedMotion } from "motion/react";
import { ProgressBar } from "@heroui/react";

import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { useI18n } from "@/contexts/I18nContext";
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
	accountId?: string;
};

/**
 * Video editor export menu providing export configuration, status feedback, and triggers.
 *
 * @param props - Component props including export settings, dimensions, status, and callbacks.
 */
export function EditorExportMenu(props: Props) {
	const { publishDestination: destination, setPublishDestination: setDestination } =
		props.exportSettings;
	const [shareBusy, setShareBusy] = useState(false);
	const reducedMotion = useReducedMotion();
	const handledShareRequest = useRef(0);
	const contentRef = useRef<HTMLDivElement>(null);
	const [contentHeight, setContentHeight] = useState<number>();
	useLayoutEffect(() => {
		if (!props.exportSession.showExportDropdown) return;
		const content = contentRef.current;
		if (!content) return;
		// The popover scales in on entry. Its bounding rect includes that scale,
		// so measuring it would lock the wrapper to a height smaller than its content.
		const measure = () => setContentHeight(content.offsetHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(content);
		return () => observer.disconnect();
	}, [props.exportSession.showExportDropdown]);
	useEffect(() => {
		if (props.shareRequestNonce > handledShareRequest.current) {
			handledShareRequest.current = props.shareRequestNonce;
			setDestination("link");
			props.handleOpenExportDropdown();
		}
	}, [props.shareRequestNonce, props.handleOpenExportDropdown, setDestination]);

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

	const settingsForm = (
		<ExportSettingsMenu
			exportFormat={destination === "link" ? "mp4" : exportFormat}
			onExportFormatChange={setExportFormat}
			exportEncodingMode={exportEncodingMode}
			onExportEncodingModeChange={setExportEncodingMode}
			mp4FrameRate={mp4FrameRate}
			onMp4FrameRateChange={setMp4FrameRate}
			exportPipelineModel={exportPipelineModel}
			experimentalNvidiaCudaExport={experimentalNvidiaCudaExport && nvidiaCudaExportAvailable}
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
			hideHeading
			hideAction={destination === "link"}
			linkMode={destination === "link"}
			className="rounded-none bg-transparent px-5 pb-5 pt-0 shadow-none"
		/>
	);

	return (
		<>
			<Popover
				open={showExportDropdown}
				onOpenChange={(open) => {
					if (shareBusy) return;
					if (open) {
						handleOpenExportDropdown();
					} else setShowExportDropdown(false);
				}}
				modal={true}
			>
				<PopoverTrigger asChild>
					<Button
						type="button"
						className="inline-flex h-9 min-w-[104px] items-center justify-center gap-2 px-4.5"
					>
						<Export className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">Publish</span>
					</Button>
				</PopoverTrigger>
				<PopoverContent
					aria-label="Publish"
					align="end"
					sideOffset={10}
					className="w-[360px] max-h-none overflow-hidden p-0"
					isKeyboardDismissDisabled={shareBusy}
					shouldCloseOnInteractOutside={() => !shareBusy}
				>
					<motion.div
						initial={false}
						animate={{ height: contentHeight ?? "auto" }}
						transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeInOut" }}
						className="overflow-hidden"
					>
						<div ref={contentRef}>
							<div className="p-5 space-y-3">
								<h2 className="text-sm font-semibold">Publish</h2>
								<TagGroup
									aria-label="Publish destination"
									selectionMode="single"
									disallowEmptySelection
									selectedKeys={[destination]}
									onSelectionChange={(keys) => {
										if (
											keys !== "all" &&
											keys.size > 0 &&
											!isExporting &&
											!shareBusy
										)
											setDestination(keys.has("link") ? "link" : "local");
									}}
								>
									<TagGroup.List className="flex gap-2">
										<Tag
											id="link"
											isDisabled={isExporting || shareBusy}
											className="h-24 flex-1 flex-col justify-center gap-2 rounded-xl border border-foreground/10"
										>
											<LinkSimple className="size-6" />
											Link
										</Tag>
										<Tag
											id="local"
											isDisabled={isExporting || shareBusy}
											className="h-24 flex-1 flex-col justify-center gap-2 rounded-xl border border-foreground/10"
										>
											<HardDrive className="size-6" />
											Local
										</Tag>
									</TagGroup.List>
								</TagGroup>
							</div>
							<div>
								{destination === "link" ? (
									<div className="px-5 pb-5">
										<CloudShareButton
											inline
											projectPath={props.projectPath}
											projectTitle={props.projectTitle}
											prepareFile={props.prepareExportForShare}
											onCancelPrepare={handleCancelExport}
											preparationProgress={exportProgress?.percentage ?? 0}
											authToken={props.authToken}
											accountId={props.accountId}
											onBusyChange={setShareBusy}
											onRequestSignIn={() => {
												setShowExportDropdown(false);
												props.onRequestShareSignIn();
											}}
										/>
										{exportError && !shareBusy && (
											<ExportErrorReportButton
												key={exportError}
												error={exportError}
												format="mp4"
											/>
										)}
									</div>
								) : isExporting ? (
									<Card className="rounded-none bg-transparent p-5 text-foreground shadow-none">
										<div className="mb-3 flex items-center justify-between gap-3">
											<div>
												<p className="text-sm font-semibold text-foreground">
													{t(
														"editor.exportStatus.exporting",
														"Exporting",
													)}
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
														Export too slow? Cancel and try Lightning
														export!
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
											aria-label={t(
												"editor.exportStatus.exporting",
												"Exporting",
											)}
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
													const copied = await copyTextToClipboard(exportError);
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
											<ExportErrorReportButton
												key={exportError}
												error={exportError}
												format={exportFormat}
											/>
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
									<>{settingsForm}</>
								)}
							</div>
						</div>
					</motion.div>
				</PopoverContent>
			</Popover>
		</>
	);
}
