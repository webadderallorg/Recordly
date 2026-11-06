import { Separator } from "@heroui/react";
import type { FormEvent, ReactNode, RefObject } from "react";
import { UpgradeButton } from "@/components/billing/UpgradeButton";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { Button } from "@/components/ui/button";
import { FilmStrip, House, ArrowCounterClockwise as Undo2 } from "@/components/ui/icons";
import type { useI18n } from "@/contexts/I18nContext";
import { useI18n as useUiLocale } from "@/contexts/I18nContext";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useExportStatusViewModel } from "../export/useExportStatusViewModel";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";
import type { useProjectState } from "../state/useProjectState";
import { AppFrameHeader } from "./AppFrameHeader";
import { AppUpdateButton } from "./AppUpdateButton";
import { EditorExportMenu } from "./EditorExportMenu";
import { EditorPresetMenu } from "./EditorPresetMenu";

// Keep the preset implementation available for future use.
const SHOW_PRESETS_BUTTON = false;

type Props = {
	accountMenu?: ReactNode;
	projectRevision?: string;
	clipsOpen: boolean;
	onToggleClips: () => void;
	t: ReturnType<typeof useI18n>["t"];
	headerLeftControlsPaddingClass: string;
	project: ReturnType<typeof useProjectState>;
	projectBrowserTriggerRef: RefObject<HTMLButtonElement | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	projectDisplayName: string;
	hasUnsavedChanges: boolean;
	canUndo: boolean;
	canRedo: boolean;
	handleOpenProjectBrowser: () => void;
	handleUndo: () => void;
	handleRedo: () => void;
	handleProjectNameSubmit: (event?: FormEvent<HTMLFormElement>) => void;
	closeProjectNameEditor: () => void;
	presets: ReturnType<typeof useVideoEditorPresets>;
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
	prepareExportForShare: () => Promise<string | undefined>;
	onRequestShareSignIn: () => void;
	onRequestFeedbackSignIn: () => void;
	shareRequestNonce: number;
	authToken?: string;
	accountId?: string;
};

export function EditorHeader(props: Props) {
	const { t: uiText } = useUiLocale();
	const {
		t,
		headerLeftControlsPaddingClass,
		project,
		projectBrowserTriggerRef,
		projectNameInputRef,
		projectDisplayName,
		canUndo,
		canRedo,
		handleOpenProjectBrowser,
		handleUndo,
		handleRedo,
		handleProjectNameSubmit,
		closeProjectNameEditor,
		presets,
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
	} = props;
	const {
		isEditingProjectName,
		setIsEditingProjectName,
		projectNameDraft,
		setProjectNameDraft,
		isSavingProjectName,
	} = project;

	return (
		<AppFrameHeader className="editor-header">
			<div
				className={`editor-header-start flex min-w-0 items-center gap-1 ${headerLeftControlsPaddingClass}`}
			>
				<Button
					ref={projectBrowserTriggerRef}
					type="button"
					variant="ghost"
					size="sm"
					onClick={handleOpenProjectBrowser}
					className="h-9 shrink-0 gap-2 px-3"
					title={uiText("ui.home")}
					aria-label={uiText("ui.home")}
				>
					<House weight="fill" className="h-4 w-4" />
					<span>{uiText("ui.home")}</span>
				</Button>
				<span
					aria-hidden="true"
					className="mx-2 shrink-0 text-xl font-light text-muted-foreground/60"
				>
					/
				</span>

				<div className="editor-header-title flex min-w-0 items-center">
					{isEditingProjectName ? (
						<form
							onSubmit={(event) => void handleProjectNameSubmit(event)}
							className="flex w-full min-w-0 items-center gap-1.5 px-2"
						>
							<input
								ref={projectNameInputRef}
								type="text"
								value={projectNameDraft}
								onChange={(event) => setProjectNameDraft(event.target.value)}
								onBlur={() => {
									if (
										!isSavingProjectName &&
										projectNameDraft.trim() !== projectDisplayName
									)
										void handleProjectNameSubmit();
									else if (!isSavingProjectName) closeProjectNameEditor();
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										closeProjectNameEditor();
									}
								}}
								disabled={isSavingProjectName}
								className="inline-project-name h-9 min-w-0 max-w-full text-sm font-semibold tracking-tight text-foreground/90 disabled:cursor-wait"
								aria-label={t("editor.project.renameInput", "Project name")}
							/>
						</form>
					) : (
						<Button
							variant="ghost"
							type="button"
							onClick={() => setIsEditingProjectName(true)}
							className="inline-flex h-9 min-w-0 max-w-full cursor-text items-center gap-1.5 rounded-lg px-2 hover:bg-transparent"
							title={t("editor.project.renameTitle", "Rename project")}
							aria-label={t("editor.project.renameTitle", "Rename project")}
						>
							<span className="truncate text-sm font-semibold tracking-tight text-foreground/90">
								{projectDisplayName}
							</span>
						</Button>
					)}
				</div>
				<Separator orientation="vertical" className="mx-3 h-5 shrink-0 self-center" />
				<Button
					variant="ghost"
					size="sm"
					className={`h-8 shrink-0 gap-2 rounded-lg border px-3 text-xs font-medium transition-colors ${props.clipsOpen ? "border-foreground/20 bg-foreground/10 text-foreground" : "border-border bg-transparent text-muted hover:bg-foreground/5 hover:text-foreground"}`}
					aria-label={uiText("ui.clips")}
					aria-expanded={props.clipsOpen}
					onClick={props.onToggleClips}
				>
					<FilmStrip weight={props.clipsOpen ? "fill" : "regular"} className="size-4" />
					{uiText("ui.clips")}
				</Button>
			</div>

			<div className="editor-header-end flex min-w-0 items-center justify-self-end gap-3">
				<UpgradeButton
					label={uiText("billing.getCloud", "Get Recordly Cloud")}
					variant="secondary"
					size="sm"
					className="h-9 gap-1.5"
				/>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						onClick={handleUndo}
						disabled={!canUndo}
						className="inline-flex h-9 w-9 min-w-9 items-center justify-center p-0 disabled:cursor-not-allowed"
						title={t("common.actions.undo", "Undo")}
						aria-label={t("common.actions.undo", "Undo")}
					>
						<Undo2 className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={handleRedo}
						disabled={!canRedo}
						className="inline-flex h-9 w-9 min-w-9 items-center justify-center p-0 disabled:cursor-not-allowed"
						title={t("common.actions.redo", "Redo")}
						aria-label={t("common.actions.redo", "Redo")}
					>
						<Undo2 mirrored className="h-4 w-4" />
					</Button>
				</div>
				{SHOW_PRESETS_BUTTON && <EditorPresetMenu t={t} presets={presets} />}
				<FeedbackDialog
					showLabel={false}
					className="h-9 w-9 min-w-9"
					onSignIn={props.onRequestFeedbackSignIn}
				/>
				<EditorExportMenu
					t={t}
					exportSettings={exportSettings}
					exportSession={exportSession}
					exportDimensions={exportDimensions}
					exportStatus={exportStatus}
					hasCaptionsForSidecar={hasCaptionsForSidecar}
					nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
					experimentalNvidiaCudaExport={experimentalNvidiaCudaExport}
					setExperimentalNvidiaCudaExport={setExperimentalNvidiaCudaExport}
					handleOpenExportDropdown={handleOpenExportDropdown}
					handleExportDropdownClose={handleExportDropdownClose}
					handleCancelExport={handleCancelExport}
					handleRetrySaveExport={handleRetrySaveExport}
					handleStartExportFromDropdown={handleStartExportFromDropdown}
					revealExportedFile={revealExportedFile}
					projectPath={project.currentProjectPath}
					projectRevision={props.projectRevision}
					projectTitle={projectDisplayName}
					prepareExportForShare={props.prepareExportForShare}
					onRequestShareSignIn={props.onRequestShareSignIn}
					shareRequestNonce={props.shareRequestNonce}
					authToken={props.authToken}
					accountId={props.accountId}
				/>
				{props.accountMenu}
				<AppUpdateButton />
			</div>
		</AppFrameHeader>
	);
}
