import { type RefObject, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { useI18n } from "@/contexts/I18nContext";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";
import { cloneStructured, getErrorMessage } from "../videoEditorUtils";

const PROJECT_AUTOSAVE_DELAY_MS = 1_000;

type SaveProjectOptions = {
	silent?: boolean;
	remountPreviewAfterSave?: boolean;
	refreshLibraryAfterSave?: boolean;
	captureThumbnail?: boolean;
};

type UseProjectSaveActionsInput = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	currentSourcePath: string | null;
	currentProjectSnapshot: EditorProjectData | null;
	currentPersistedEditorState: Parameters<typeof createProjectData>[1];
	projectDisplayName: string;
	hasUnsavedChanges: boolean;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	openProjectSaveDialog: (initialName: string) => Promise<boolean>;
	resolveProjectSaveDialog: (saved: boolean) => void;
	captureProjectThumbnail: () => Promise<string | null>;
	refreshProjectLibrary: () => Promise<void>;
	remountPreview: () => void;
};

export function useProjectSaveActions({
	t,
	project,
	currentSourcePath,
	currentProjectSnapshot,
	currentPersistedEditorState,
	projectDisplayName,
	hasUnsavedChanges,
	projectSaveDialogInputRef,
	projectNameInputRef,
	openProjectSaveDialog,
	resolveProjectSaveDialog,
	captureProjectThumbnail,
	refreshProjectLibrary,
	remountPreview,
}: UseProjectSaveActionsInput) {
	const {
		currentProjectPath,
		lastSavedSnapshot,
		projectSaveDialogDraft,
		projectNameDraft,
		setCurrentProjectPath,
		setLastSavedSnapshot,
		setIsSavingProjectDialog,
		setProjectNameDraft,
		setIsEditingProjectName,
		setIsSavingProjectName,
		setProjectBrowserOpen,
	} = project;
	const autosaveTimeoutRef = useRef<number | null>(null);
	const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const clearPendingAutosave = useCallback(() => {
		if (autosaveTimeoutRef.current !== null) {
			window.clearTimeout(autosaveTimeoutRef.current);
			autosaveTimeoutRef.current = null;
		}
	}, []);
	const queueSave = useCallback((task: () => Promise<boolean>) => {
		const run = saveQueueRef.current.catch(() => undefined).then(task);
		saveQueueRef.current = run.catch(() => undefined);
		return run;
	}, []);

	const saveProject = useCallback(
		async (forceSaveAs: boolean, options?: SaveProjectOptions) => {
			clearPendingAutosave();
			return queueSave(async () => {
				if (!currentSourcePath) {
					if (!options?.silent)
						toast.error(t("editor.project.noVideoLoaded", "No video loaded"));
					return false;
				}

				const captureThumbnail = options?.captureThumbnail ?? true;
				const refreshLibrary = options?.refreshLibraryAfterSave ?? true;
				const remount = options?.remountPreviewAfterSave ?? true;
				try {
					const projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
								);
					const fileNameBase =
						currentSourcePath
							.split(/[\\/]/)
							.pop()
							?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
					let targetPath = forceSaveAs ? undefined : (currentProjectPath ?? undefined);

					if (!forceSaveAs && !targetPath) {
						const activeProject = await window.electronAPI.loadCurrentProjectFile();
						if (activeProject.success && activeProject.path) {
							targetPath = activeProject.path;
							setCurrentProjectPath(activeProject.path);
						}
					}
					if (forceSaveAs || !targetPath) {
						if (options?.silent) return false;
						return await openProjectSaveDialog(projectDisplayName || fileNameBase);
					}

					const thumbnail = captureThumbnail
						? await captureProjectThumbnail()
						: undefined;
					const result = await window.electronAPI.saveProjectFile(
						projectData,
						fileNameBase,
						targetPath,
						thumbnail,
					);
					if (result.canceled) {
						if (!options?.silent)
							toast.info(t("editor.project.saveCanceled", "Project save canceled"));
						return false;
					}
					if (!result.success) {
						if (!options?.silent)
							toast.error(
								result.message ||
									t("editor.project.saveFailed", "Failed to save project"),
							);
						return false;
					}

					if (result.path) setCurrentProjectPath(result.path);
					setLastSavedSnapshot(
						cloneStructured(
							createProjectData(
								projectData.videoPath,
								projectData.editor,
								result.projectId ?? projectData.projectId ?? null,
							),
						),
					);
					if (refreshLibrary) await refreshProjectLibrary();
					if (!options?.silent)
						toast.success(
							t("editor.project.savedTo", "Project saved to {{path}}", {
								path: result.path ?? "",
							}),
						);
					return true;
				} finally {
					if (remount) remountPreview();
				}
			});
		},
		[
			t,
			clearPendingAutosave,
			queueSave,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			currentProjectPath,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			openProjectSaveDialog,
			projectDisplayName,
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);
	useEffect(
		() => window.electronAPI.onRequestSaveBeforeClose(() => saveProject(false)),
		[saveProject],
	);
	useEffect(() => {
		if (!currentProjectPath || !hasUnsavedChanges) {
			clearPendingAutosave();
			return;
		}
		autosaveTimeoutRef.current = window.setTimeout(() => {
			autosaveTimeoutRef.current = null;
			void saveProject(false, {
				silent: true,
				remountPreviewAfterSave: false,
				refreshLibraryAfterSave: false,
				captureThumbnail: false,
			});
		}, PROJECT_AUTOSAVE_DELAY_MS);
		return clearPendingAutosave;
	}, [clearPendingAutosave, currentProjectPath, hasUnsavedChanges, saveProject]);
	useEffect(() => clearPendingAutosave, [clearPendingAutosave]);

	const saveProjectWithName = useCallback(
		async (name: string, mode: "rename" | "copy" = "rename") => {
			const trimmedName = name.trim();
			if (!trimmedName) {
				toast.error(t("editor.project.nameRequired", "Project name is required"));
				return false;
			}
			if (!currentSourcePath) {
				toast.error(t("editor.project.noVideoLoaded", "No video loaded"));
				return false;
			}
			try {
				const projectData =
					currentProjectSnapshot?.videoPath === currentSourcePath
						? currentProjectSnapshot
						: createProjectData(
								currentSourcePath,
								currentPersistedEditorState,
								lastSavedSnapshot?.projectId ?? null,
							);
				const result = await window.electronAPI.saveProjectFileNamed(
					projectData,
					trimmedName,
					await captureProjectThumbnail(),
					mode,
				);
				if (result.canceled) {
					toast.info(t("editor.project.saveCanceled", "Project save canceled"));
					return false;
				}
				if (!result.success) {
					toast.error(
						result.message || t("editor.project.saveFailed", "Failed to save project"),
					);
					return false;
				}
				if (result.path) setCurrentProjectPath(result.path);
				setLastSavedSnapshot(
					cloneStructured(
						createProjectData(
							projectData.videoPath,
							projectData.editor,
							result.projectId ?? projectData.projectId ?? null,
						),
					),
				);
				await refreshProjectLibrary();
				toast.success(
					result.path
						? t("editor.project.savedTo", "Project saved to {{path}}", {
								path: result.path,
							})
						: t("editor.project.saved", "Project saved"),
				);
				return true;
			} finally {
				remountPreview();
			}
		},
		[
			t,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	const handleProjectSaveDialogSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const name = projectSaveDialogDraft.trim();
			if (!name) {
				toast.error(t("editor.project.nameRequired", "Project name is required"));
				projectSaveDialogInputRef.current?.focus();
				return;
			}
			setIsSavingProjectDialog(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "copy");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectDialog(false);
			}
			if (saved) resolveProjectSaveDialog(true);
			else {
				projectSaveDialogInputRef.current?.focus();
				projectSaveDialogInputRef.current?.select();
			}
		},
		[
			t,
			projectSaveDialogDraft,
			setIsSavingProjectDialog,
			projectSaveDialogInputRef,
			resolveProjectSaveDialog,
			saveProjectWithName,
		],
	);

	const closeProjectNameEditor = useCallback(() => {
		setProjectNameDraft(projectDisplayName);
		setIsEditingProjectName(false);
	}, [setProjectNameDraft, setIsEditingProjectName, projectDisplayName]);
	const handleProjectNameSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const name = projectNameDraft.trim();
			if (!name) return closeProjectNameEditor();
			setIsSavingProjectName(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "rename");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectName(false);
			}
			if (saved) setIsEditingProjectName(false);
			else {
				projectNameInputRef.current?.focus();
				projectNameInputRef.current?.select();
			}
		},
		[
			projectNameDraft,
			setIsSavingProjectName,
			setIsEditingProjectName,
			projectNameInputRef,
			closeProjectNameEditor,
			saveProjectWithName,
		],
	);
	const handleSaveProject = useCallback(() => saveProject(false), [saveProject]);
	const handleSaveProjectAs = useCallback(async () => {
		if (await saveProject(true)) setProjectBrowserOpen(false);
	}, [saveProject, setProjectBrowserOpen]);

	return {
		saveProject,
		handleSaveProject,
		handleSaveProjectAs,
		handleProjectSaveDialogSubmit,
		closeProjectNameEditor,
		handleProjectNameSubmit,
	};
}
