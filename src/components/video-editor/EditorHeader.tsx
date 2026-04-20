import {
	DownloadSimple as Download,
	FolderOpen,
	ArrowClockwise as Redo2,
	FloppyDisk as Save,
	ArrowCounterClockwise as Undo2,
} from "@phosphor-icons/react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/contexts/I18nContext";
import type { ExportProgress } from "@/lib/exporter";
import { ExportSettingsMenu } from "./ExportSettingsMenu";
import {
	APP_HEADER_ICON_BUTTON_CLASS,
	DiscordLinkButton,
	FeedbackDialog,
	openExternalLink,
	RECORDLY_ISSUES_URL,
} from "./TutorialHelp";
import type { useEditorPreferences } from "./hooks/useEditorPreferences";
import type { useEditorHistory } from "./hooks/useEditorHistory";
import type { useEditorExport } from "./hooks/useEditorExport";
import type { useEditorProject } from "./hooks/useEditorProject";

type Prefs = ReturnType<typeof useEditorPreferences>;
type History = ReturnType<typeof useEditorHistory>;
type Exp = ReturnType<typeof useEditorExport>;
type Project = ReturnType<typeof useEditorProject>;

interface EditorHeaderProps {
	prefs: Prefs;
	history: History;
	exp: Exp;
	project: Project;
	projectDisplayName: string;
	headerLeftControlsPaddingClass: string;
	mp4OutputDimensions: Record<string, { width: number; height: number }>;
	gifOutputDimensions: { width: number; height: number };
	openRecordingsFolder: () => Promise<void>;
	revealExportedFile: () => Promise<void>;
	projectBrowserTriggerRef: React.RefObject<HTMLButtonElement | null>;
}

export function EditorHeader({
	prefs,
	history,
	exp,
	project,
	projectDisplayName,
	headerLeftControlsPaddingClass,
	mp4OutputDimensions,
	gifOutputDimensions,
	openRecordingsFolder,
	revealExportedFile,
	projectBrowserTriggerRef,
}: EditorHeaderProps) {
	const { t } = useI18n();

	// ── Export derived labels ─────────────────────────────────────────
	const isLightningExportInProgress =
		prefs.exportFormat === "mp4" &&
		prefs.exportPipelineModel === "modern" &&
		(exp.isExporting || exp.exportProgress !== null);
	const isLegacyExportInProgress =
		prefs.exportFormat === "mp4" &&
		prefs.exportPipelineModel === "legacy" &&
		(exp.isExporting || exp.exportProgress !== null);
	const exportRenderSpeedLabel =
		typeof exp.exportProgress?.renderFps === "number" &&
		Number.isFinite(exp.exportProgress.renderFps) &&
		exp.exportProgress.renderFps > 0
			? t("editor.exportStatus.renderSpeed", "Render speed {{fps}} FPS", {
					fps: exp.exportProgress.renderFps.toFixed(1),
				})
			: null;
	const exportRuntimeLabel = useMemo(() => {
		const renderBackend = exp.exportProgress?.renderBackend;
		const encodeBackend = exp.exportProgress?.encodeBackend;
		const encoderName = exp.exportProgress?.encoderName;
		if (!renderBackend && !encodeBackend && !encoderName) return null;
		const rendererLabel =
			renderBackend === "webgpu" ? "WebGPU" : renderBackend === "webgl" ? "WebGL" : null;
		const encoderLabel =
			encodeBackend === "ffmpeg"
				? "Breeze"
				: encodeBackend === "webcodecs"
					? "WebCodecs"
					: null;
		const pathLabel =
			rendererLabel && encoderLabel
				? `${rendererLabel} + ${encoderLabel}`
				: (rendererLabel ?? encoderLabel);
		if (!pathLabel) return encoderName ?? null;
		return encoderName ? `${pathLabel} (${encoderName})` : pathLabel;
	}, [exp.exportProgress]);
	const exportPercentLabel = exp.exportProgress
		? exp.isExportSaving
			? t("editor.exportStatus.saving", "Opening save dialog...")
			: exp.isRenderingAudio
				? t("editor.exportStatus.renderingAudio", "Rendering audio {{percent}}%", {
						percent: Math.round((exp.exportProgress.audioProgress ?? 0) * 100),
					})
				: exp.isExportFinalizing
					? t("editor.exportStatus.finalizingPercent", "Finalizing {{percent}}%", {
							percent: Math.round(exp.exportFinalizingProgress ?? 99),
						})
					: t("editor.exportStatus.completePercent", "{{percent}}% complete", {
							percent: Math.round(exp.exportProgress.percentage),
						})
		: t("editor.exportStatus.preparing", "Preparing export...");

	const openLightningIssues = async () => {
		await openExternalLink(
			RECORDLY_ISSUES_URL,
			t("editor.feedback.openFailed", "Failed to open link."),
		);
	};

	return (
		<div
			className="relative flex h-11 flex-shrink-0 items-center justify-between bg-editor-header/88 px-5 backdrop-blur-md border-b border-foreground/10 z-50"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			<div
				className={`flex items-center gap-1.5 justify-self-start ${headerLeftControlsPaddingClass}`}
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => void openRecordingsFolder()}
					className={APP_HEADER_ICON_BUTTON_CLASS}
					title={t("common.app.manageRecordings", "Open recordings folder")}
					aria-label={t("common.app.manageRecordings", "Open recordings folder")}
				>
					<FolderOpen className="h-4 w-4" />
				</Button>
				<DiscordLinkButton />
				<FeedbackDialog />
				<div className="ml-1 h-5 w-px bg-foreground/10" />
				<Button
					type="button"
					variant="ghost"
					onClick={history.handleUndo}
					disabled={!history.canUndo}
					className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-foreground/10 bg-foreground/5 p-0 text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					title={t("common.actions.undo", "Undo")}
					aria-label={t("common.actions.undo", "Undo")}
				>
					<Undo2 className="h-4 w-4" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					onClick={history.handleRedo}
					disabled={!history.canRedo}
					className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-foreground/10 bg-foreground/5 p-0 text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					title={t("common.actions.redo", "Redo")}
					aria-label={t("common.actions.redo", "Redo")}
				>
					<Redo2 className="h-4 w-4" />
				</Button>
			</div>
			<div
				className="pointer-events-none absolute left-1/2 flex min-w-0 -translate-x-1/2 items-baseline justify-center gap-0"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<span className="text-sm font-semibold tracking-tight text-foreground/90">
					{projectDisplayName}
				</span>
				<span className="text-xs font-medium tracking-tight text-muted-foreground/70">
					.recordly
				</span>
			</div>
			<div
				className="flex items-center gap-2 justify-self-end pr-3"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<Button
					ref={projectBrowserTriggerRef as React.Ref<HTMLButtonElement>}
					type="button"
					onClick={project.handleOpenProjectBrowser}
					className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-neutral-800 px-4 text-white shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
				>
					<FolderOpen className="h-4 w-4" />
					<span className="text-sm font-semibold tracking-tight">
						{t("editor.project.projects", "Projects")}
					</span>
				</Button>
				<Button
					type="button"
					onClick={project.handleSaveProject}
					className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-neutral-800 px-4 text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
				>
					<span
						className={`${project.hasUnsavedChanges ? "flex" : "hidden"} size-2 relative`}
					>
						<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2563EB] opacity-75" />
						<span className="relative inline-flex size-2 rounded-full bg-[#2563EB]" />
					</span>
					<Save className="h-4 w-4" weight="fill" />
					<span className="text-sm font-semibold tracking-tight">
						{t("common.actions.save")}
					</span>
				</Button>
				<div className="mx-1 h-5 w-px bg-foreground/10" />
				<DropdownMenu
					open={exp.showExportDropdown}
					onOpenChange={exp.setShowExportDropdown}
					modal={false}
				>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							onClick={exp.handleOpenExportDropdown}
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
						{exp.isExporting ? (
							<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
								<div className="mb-3 flex items-center justify-between gap-3">
									<div>
										<p className="text-sm font-semibold text-foreground">
											{t("editor.exportStatus.exporting", "Exporting")}
										</p>
										<p className="text-xs text-muted-foreground">
											{t("editor.exportStatus.renderingFile", "Rendering your file.")}
										</p>
										{isLightningExportInProgress ? (
											<p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
												PLEASE
												<button
													type="button"
													onClick={() => void openLightningIssues()}
													className="underline decoration-slate-500/70 underline-offset-2 transition-colors hover:text-foreground"
												>
													report bugs
												</button>
												with Lightning export
												<span aria-hidden="true">{"\u{1F64F}"}</span>
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
										onClick={exp.handleCancelExport}
										className="h-8 border-red-500/20 bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20"
									>
										{t("common.actions.cancel")}
									</Button>
								</div>
								<div className="h-2 overflow-hidden rounded-full border border-foreground/5 bg-foreground/5">
									{exp.isExportSaving ? (
										<div className="indeterminate-progress h-full rounded-full bg-transparent" />
									) : (
										<div
											className="h-full bg-[#2563EB] transition-all duration-300 ease-out"
											style={{
												width: `${Math.min(exp.isRenderingAudio ? ((exp.exportProgress as ExportProgress).audioProgress ?? 0) * 100 : (exp.exportFinalizingProgress ?? exp.exportProgress?.percentage ?? 8), 100)}%`,
											}}
										/>
									)}
								</div>
								<p className="mt-2 text-xs text-muted-foreground">
									{exportPercentLabel}
								</p>
								{exp.isRenderingAudio ? (
									<p className="mt-1 text-[11px] text-muted-foreground/70">
										Audio requires real-time playback for speed/overlay edits
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
							</div>
						) : exp.exportError ? (
							<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
								<p className="text-sm font-semibold text-foreground">
									{t("editor.exportStatus.issue", "Export issue")}
								</p>
								{exportRuntimeLabel ? (
									<p className="mt-1 text-[11px] text-muted-foreground/70">
										Path: {exportRuntimeLabel}
									</p>
								) : null}
								<p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
									{exp.exportError}
								</p>
								<div className="mt-4 flex gap-2">
									{exp.hasPendingExportSave ? (
										<Button
											type="button"
											onClick={exp.handleRetrySaveExport}
											className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
										>
											{t("editor.actions.saveAgain", "Save Again")}
										</Button>
									) : null}
									<Button
										type="button"
										variant="outline"
										onClick={exp.handleExportDropdownClose}
										className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
									>
										{t("common.actions.close", "Close")}
									</Button>
								</div>
							</div>
						) : exp.exportedFilePath ? (
							<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
								<p className="text-sm font-semibold text-foreground">
									{t("editor.exportStatus.complete", "Export complete")}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									{t("editor.exportStatus.savedSuccessfully", "Your file was saved successfully.")}
								</p>
								{exportRuntimeLabel ? (
									<p className="mt-1 text-[11px] text-muted-foreground/70">
										Path: {exportRuntimeLabel}
									</p>
								) : null}
								<p className="mt-3 truncate text-xs text-muted-foreground/70">
									{exp.exportedFilePath.split("/").pop()}
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
										onClick={exp.handleExportDropdownClose}
										className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
									>
										Done
									</Button>
								</div>
							</div>
						) : (
							<ExportSettingsMenu
								exportFormat={prefs.exportFormat}
								onExportFormatChange={prefs.setExportFormat}
								exportEncodingMode={prefs.exportEncodingMode}
								onExportEncodingModeChange={prefs.setExportEncodingMode}
								mp4FrameRate={prefs.mp4FrameRate}
								onMp4FrameRateChange={prefs.setMp4FrameRate}
								exportPipelineModel={prefs.exportPipelineModel}
								onExportPipelineModelChange={prefs.setExportPipelineModel}
								exportQuality={prefs.exportQuality}
								onExportQualityChange={prefs.setExportQuality}
								gifFrameRate={prefs.gifFrameRate}
								onGifFrameRateChange={prefs.setGifFrameRate}
								gifLoop={prefs.gifLoop}
								onGifLoopChange={prefs.setGifLoop}
								gifSizePreset={prefs.gifSizePreset}
								onGifSizePresetChange={prefs.setGifSizePreset}
								mp4OutputDimensions={mp4OutputDimensions}
								gifOutputDimensions={gifOutputDimensions}
								onExport={exp.handleStartExportFromDropdown}
								className="shadow-2xl"
							/>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
