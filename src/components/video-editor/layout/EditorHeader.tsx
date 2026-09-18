import {
	FolderOpen,
	ArrowClockwise as Redo2,
	ArrowCounterClockwise as Undo2,
} from "@phosphor-icons/react";
import type { CSSProperties, FormEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import type { useI18n } from "@/contexts/I18nContext";
import type { useExportDimensions } from "../export/useExportDimensions";
import type { useExportSession } from "../export/useExportSession";
import type { useExportSettings } from "../export/useExportSettings";
import type { useExportStatusViewModel } from "../export/useExportStatusViewModel";
import type { useVideoEditorPresets } from "../presets/useVideoEditorPresets";
import type { useProjectState } from "../state/useProjectState";
import { APP_HEADER_ICON_BUTTON_CLASS, DiscordLinkButton, FeedbackDialog } from "../TutorialHelp";
import { EditorExportMenu } from "./EditorExportMenu";
import { EditorPresetMenu } from "./EditorPresetMenu";

type Props = {
	t: ReturnType<typeof useI18n>["t"];
	headerLeftControlsPaddingClass: string;
	project: ReturnType<typeof useProjectState>;
	projectBrowserTriggerRef: RefObject<HTMLButtonElement>;
	projectNameInputRef: RefObject<HTMLInputElement>;
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
	exportMessage: string | null;
};

export function EditorHeader(props: Props) {
	const {
		t,
		headerLeftControlsPaddingClass,
		project,
		projectBrowserTriggerRef,
		projectNameInputRef,
		projectDisplayName,
		hasUnsavedChanges,
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
		exportMessage,
	} = props;
	const {
		isEditingProjectName,
		setIsEditingProjectName,
		projectNameDraft,
		setProjectNameDraft,
		isSavingProjectName,
	} = project;

	return (
		<div
			className="relative z-50 flex h-11 flex-shrink-0 items-center justify-between bg-card rounded-md px-5"
			style={{ WebkitAppRegion: "drag" } as CSSProperties}
		>
			<div
				className={`flex items-center justify-self-start gap-1.5 ${headerLeftControlsPaddingClass}`}
				style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
			>
				<Button
					ref={projectBrowserTriggerRef}
					type="button"
					variant="ghost"
					size="sm"
					onClick={handleOpenProjectBrowser}
					className={APP_HEADER_ICON_BUTTON_CLASS}
					title={t("editor.project.projects", "Open projects")}
					aria-label={t("editor.project.projects", "Open projects")}
				>
					<FolderOpen className="h-4 w-4" />
				</Button>
				<DiscordLinkButton />
				<FeedbackDialog />
				<div className="ml-1 h-5 w-px bg-foreground/10" />
				<Button
					type="button"
					variant="ghost"
					onClick={handleUndo}
					disabled={!canUndo}
					className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] bg-transparent p-0 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					title={t("common.actions.undo", "Undo")}
					aria-label={t("common.actions.undo", "Undo")}
				>
					<Undo2 className="h-[14px] w-[14px]" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					onClick={handleRedo}
					disabled={!canRedo}
					className="inline-flex h-7 w-7 items-center justify-center rounded-[5px] bg-transparent p-0 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					title={t("common.actions.redo", "Redo")}
					aria-label={t("common.actions.redo", "Redo")}
				>
					<Redo2 className="h-[14px] w-[14px]" />
				</Button>
			</div>

			<div
				className="absolute left-1/2 flex min-w-0 -translate-x-1/2 items-center justify-center"
				style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
			>
				{isEditingProjectName ? (
					<form
						onSubmit={(event) => void handleProjectNameSubmit(event)}
						className="flex max-w-[min(52vw,460px)] items-baseline gap-1 rounded-[7px] border border-foreground/10 bg-editor-panel/[0.88] px-2.5 py-1 shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
					>
						{hasUnsavedChanges ? (
							<span className="mt-[1px] size-2 shrink-0 rounded-full bg-primary" />
						) : null}
						<input
							ref={projectNameInputRef}
							type="text"
							value={projectNameDraft}
							onChange={(event) => setProjectNameDraft(event.target.value)}
							onBlur={() => {
								if (!isSavingProjectName) closeProjectNameEditor();
							}}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									closeProjectNameEditor();
								}
							}}
							disabled={isSavingProjectName}
							className="min-w-[10ch] max-w-[min(40vw,360px)] bg-transparent text-sm font-semibold tracking-tight text-foreground/95 outline-none placeholder:text-muted-foreground/60 disabled:cursor-wait"
							style={{ width: `${Math.max(projectNameDraft.length, 10)}ch` }}
							aria-label={t("editor.project.renameInput", "Project name")}
						/>
						<span className="shrink-0 text-xs font-medium tracking-tight text-muted-foreground/70">
							.recordly
						</span>
					</form>
				) : (
					<button
						type="button"
						onClick={() => setIsEditingProjectName(true)}
						className="inline-flex max-w-[min(52vw,460px)] items-baseline gap-1 rounded-[7px] px-2.5 py-1 transition-colors hover:bg-foreground/5"
						title={t("editor.project.renameTitle", "Rename project")}
						aria-label={t("editor.project.renameTitle", "Rename project")}
					>
						{hasUnsavedChanges ? (
							<span className="mt-[1px] size-2 shrink-0 rounded-full bg-primary" />
						) : null}
						<span className="truncate text-sm font-semibold tracking-tight text-foreground/90">
							{projectDisplayName}
						</span>
						<span className="shrink-0 text-xs font-medium tracking-tight text-muted-foreground/70">
							.recordly
						</span>
					</button>
				)}
			</div>

			<div
				className="flex items-center justify-self-end"
				style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
			>
				<EditorPresetMenu t={t} presets={presets} />
				<div
					aria-hidden="true"
					className="mx-2 h-4 w-px shrink-0 bg-foreground/10 opacity-0"
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
					exportMessage={exportMessage}
				/>
			</div>
		</div>
	);
}
