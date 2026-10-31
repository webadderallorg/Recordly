import { Card } from "@heroui/react";
import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import { Dashboard } from "../dashboard/Dashboard";

export type UnsavedChangesDecision = "cancel" | "discard" | "save";

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface EditorDialogsProps {
	t: Translator;
	projectSaveDialogOpen: boolean;
	setProjectSaveDialogOpen: Dispatch<SetStateAction<boolean>>;
	projectSaveDialogDraft: string;
	setProjectSaveDialogDraft: Dispatch<SetStateAction<string>>;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	isSavingProjectDialog: boolean;
	resolveProjectSaveDialog: (saved: boolean) => void;
	handleProjectSaveDialogSubmit: (event?: FormEvent<HTMLFormElement>) => Promise<void>;
	unsavedChangesDialogOpen: boolean;
	setUnsavedChangesDialogOpen: Dispatch<SetStateAction<boolean>>;
	unsavedChangesDialogActionLabel: string;
	resolveUnsavedChangesDialog: (decision: UnsavedChangesDecision) => void;
	projectBrowserOpen: boolean;
	setProjectBrowserOpen: Dispatch<SetStateAction<boolean>>;
	projectLibraryEntries: ProjectLibraryEntry[];
	projectLibraryLoading: boolean;
	projectError: string | null;
	onDashboardSignIn: () => void;
	onDeleteProjects: (paths: string[]) => Promise<string[]>;
	onRenameProject: (path: string, name: string) => Promise<string>;
	onShareProject: (path: string) => Promise<void>;
	accountLabel?: string;
	authToken?: string;
	handleImportMediaOrProject: () => Promise<void>;
	handleOpenProjectFromLibrary: (projectPath: string) => Promise<unknown>;
	nativeCaptureUnavailableModalOpen: boolean;
	setNativeCaptureUnavailableModalOpen: Dispatch<SetStateAction<boolean>>;
}

export function EditorDialogs({
	t,
	projectSaveDialogOpen,
	setProjectSaveDialogOpen,
	projectSaveDialogDraft,
	setProjectSaveDialogDraft,
	projectSaveDialogInputRef,
	isSavingProjectDialog,
	resolveProjectSaveDialog,
	handleProjectSaveDialogSubmit,
	unsavedChangesDialogOpen,
	setUnsavedChangesDialogOpen,
	unsavedChangesDialogActionLabel,
	resolveUnsavedChangesDialog,
	projectBrowserOpen,
	setProjectBrowserOpen,
	projectLibraryEntries,
	projectLibraryLoading,
	projectError,
	onDashboardSignIn,
	onDeleteProjects,
	onRenameProject,
	onShareProject,
	accountLabel,
	authToken,
	handleImportMediaOrProject,
	handleOpenProjectFromLibrary,
	nativeCaptureUnavailableModalOpen,
	setNativeCaptureUnavailableModalOpen,
}: EditorDialogsProps) {
	return (
		<>
			<Dialog
				open={projectSaveDialogOpen}
				onOpenChange={(open) => {
					if (open) setProjectSaveDialogOpen(true);
					else if (!isSavingProjectDialog) resolveProjectSaveDialog(false);
				}}
			>
				<DialogContent className="max-w-sm">
					<form onSubmit={(event) => void handleProjectSaveDialogSubmit(event)}>
						<DialogHeader>
							<DialogTitle>
								{t("editor.project.saveTitle", "Save Project")}
							</DialogTitle>
							<DialogDescription className="text-muted-foreground">
								{t(
									"editor.project.saveDescription",
									"Name this project. It will be saved in your Recordly Projects folder.",
								)}
							</DialogDescription>
						</DialogHeader>
						<div className="py-4">
							<label className="mb-2 block text-xs font-medium text-muted-foreground">
								{t("editor.project.saveNameLabel", "Project name")}
							</label>
							<Card className="flex-row items-center overflow-hidden">
								<Input
									ref={projectSaveDialogInputRef}
									value={projectSaveDialogDraft}
									onChange={(event) =>
										setProjectSaveDialogDraft(event.target.value)
									}
									disabled={isSavingProjectDialog}
									className="h-10 flex-1"
									aria-label={t("editor.project.saveNameLabel", "Project name")}
								/>
								<span className="shrink-0 px-3 text-xs font-medium text-muted-foreground/70">
									.recordly
								</span>
							</Card>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="ghost"
								onClick={() => resolveProjectSaveDialog(false)}
								disabled={isSavingProjectDialog}
							>
								{t("common.actions.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isSavingProjectDialog}>
								{isSavingProjectDialog
									? t("editor.project.saving", "Saving...")
									: t("common.actions.save", "Save")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={unsavedChangesDialogOpen}
				onOpenChange={(open) => {
					if (open) setUnsavedChangesDialogOpen(true);
					else resolveUnsavedChangesDialog("cancel");
				}}
			>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>
							{t("editor.project.unsavedChangesTitle", "Unsaved changes")}
						</DialogTitle>
						<DialogDescription className="text-muted-foreground">
							{t(
								"editor.project.unsavedChangesDescription",
								"Save your current project before you {{action}}?",
								{ action: unsavedChangesDialogActionLabel },
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => resolveUnsavedChangesDialog("cancel")}
						>
							{t("common.actions.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={() => resolveUnsavedChangesDialog("discard")}
						>
							{t("editor.project.discardChanges", "Discard changes")}
						</Button>
						<Button type="button" onClick={() => resolveUnsavedChangesDialog("save")}>
							{t("editor.project.saveProject", "Save project")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dashboard
				open={projectBrowserOpen}
				onOpenChange={setProjectBrowserOpen}
				entries={projectLibraryEntries}
				loading={projectLibraryLoading}
				error={projectError}
				onSignIn={onDashboardSignIn}
				onDeleteProjects={onDeleteProjects}
				onRenameProject={onRenameProject}
				onShareProject={onShareProject}
				accountLabel={accountLabel}
				authToken={authToken}
				onImportFile={handleImportMediaOrProject}
				onOpenProject={handleOpenProjectFromLibrary}
			/>

			<Dialog
				open={nativeCaptureUnavailableModalOpen}
				onOpenChange={setNativeCaptureUnavailableModalOpen}
			>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{t(
								"editor.nativeCaptureUnavailable.title",
								"Nothing’s broken, but we won’t be able to render an animated cursor overlay.",
							)}
						</DialogTitle>
						<DialogDescription className="text-muted-foreground">
							{t(
								"editor.nativeCaptureUnavailable.description",
								"Your device does not support native capture. This could be for a variety of reasons we haven’t figured out yet. This doesn’t break Recordly, but it does make cursor smoothing impossible.",
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button onClick={() => setNativeCaptureUnavailableModalOpen(false)}>
							{t("editor.nativeCaptureUnavailable.confirm", "Okay")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
