import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { moveProjectShareLink } from "../cloud/projectShareLinks";
import { moveProjectFolderReferences } from "../dashboard/useProjectFolders";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";
import { cloneStructured, getErrorMessage } from "../videoEditorUtils";

const PROJECT_AUTOSAVE_DELAY_MS = 500;

type SaveProjectOptions = {
	silent?: boolean;
	remountPreviewAfterSave?: boolean;
	refreshLibraryAfterSave?: boolean;
	captureThumbnail?: boolean;
	explicit?: boolean;
};

type UseProjectSaveActionsInput = {
	project: ReturnType<typeof useProjectState>;
	currentSourcePath: string | null;
	currentProjectSnapshot: EditorProjectData | null;
	currentPersistedEditorState: Parameters<typeof createProjectData>[1];
	projectDisplayName: string;
	hasUnsavedChanges: boolean;
	isPristineRecording: () => boolean;
	projectSaveDialogInputRef: RefObject<HTMLInputElement | null>;
	projectNameInputRef: RefObject<HTMLInputElement | null>;
	openProjectSaveDialog: (initialName: string) => Promise<boolean>;
	resolveProjectSaveDialog: (saved: boolean) => void;
	captureProjectThumbnail: () => Promise<string | null>;
	refreshProjectLibrary: () => Promise<void>;
	remountPreview: () => void;
};

export function useProjectSaveActions({
	project,
	currentSourcePath,
	currentProjectSnapshot,
	currentPersistedEditorState,
	projectDisplayName,
	hasUnsavedChanges,
	isPristineRecording,
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
	const savingNameRef = useRef(false);
	const activePathRef = useRef(currentProjectPath);
	const activeSourceRef = useRef(currentSourcePath);
	useLayoutEffect(() => {
		activePathRef.current = currentProjectPath;
	}, [currentProjectPath]);
	useLayoutEffect(() => {
		activeSourceRef.current = currentSourcePath;
	}, [currentSourcePath]);
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
			if (forceSaveAs) return openProjectSaveDialog(projectDisplayName || "Untitled Project");
			return queueSave(async () => {
				if (activeSourceRef.current !== currentSourcePath) return false;
				if (!options?.explicit && !activePathRef.current && isPristineRecording())
					return true;
				if (!currentSourcePath) {
					if (!options?.silent) toast.error("No video loaded");
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
					const targetPath = forceSaveAs
						? undefined
						: (activePathRef.current ?? undefined);

					const thumbnail = captureThumbnail
						? ((await captureProjectThumbnail()) ?? undefined)
						: undefined;
					const result = !targetPath
						? await window.electronAPI.createProjectFile(projectData, thumbnail)
						: await window.electronAPI.saveProjectFile(
								projectData,
								fileNameBase,
								targetPath,
								thumbnail,
							);
					if (result.canceled) {
						if (!options?.silent) toast.info("Project save canceled");
						return false;
					}
					if (!result.success) {
						toast.error(result.message || "Failed to save project");
						return false;
					}

					if (activeSourceRef.current !== currentSourcePath) return true;
					if (result.path) {
						activePathRef.current = result.path;
						setCurrentProjectPath(result.path);
					}
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

					return true;
				} catch (error) {
					toast.error(`Could not save project: ${getErrorMessage(error)}`);
					return false;
				} finally {
					if (remount) remountPreview();
				}
			});
		},
		[
			clearPendingAutosave,
			queueSave,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot,
			setCurrentProjectPath,
			setLastSavedSnapshot,
			openProjectSaveDialog,
			projectDisplayName,
			isPristineRecording,
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
		if (project.loading || !currentSourcePath || !hasUnsavedChanges) {
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
	}, [clearPendingAutosave, hasUnsavedChanges, saveProject, project.loading, currentSourcePath]);
	useEffect(() => clearPendingAutosave, [clearPendingAutosave]);

	const saveProjectWithName = useCallback(
		async (name: string, mode: "rename" | "copy" = "rename") => {
			const trimmedName = name.trim();
			if (!trimmedName) {
				toast.error("Project name is required");
				return false;
			}
			if (!currentSourcePath) {
				toast.error("No video loaded");
				return false;
			}
			clearPendingAutosave();
			return queueSave(async () => {
				if (activeSourceRef.current !== currentSourcePath) return false;
				try {
					const projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
								);
					const previousPath = activePathRef.current;
					const result = await window.electronAPI.saveProjectFileNamed(
						projectData,
						trimmedName,
						await captureProjectThumbnail(),
						mode,
					);
					if (result.canceled) {
						toast.info("Project save canceled");
						return false;
					}
					if (!result.success) {
						toast.error(result.message || "Failed to save project");
						return false;
					}
					if (activeSourceRef.current !== currentSourcePath) return true;
					if (
						mode === "rename" &&
						previousPath &&
						result.path &&
						previousPath !== result.path
					) {
						try {
							moveProjectFolderReferences(previousPath, result.path);
							moveProjectShareLink(previousPath, result.path);
						} catch {
							toast.error(
								"Project renamed, but library preferences could not be updated",
							);
						}
					}
					if (result.path) {
						activePathRef.current = result.path;
						setCurrentProjectPath(result.path);
					}
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

					return true;
				} finally {
					remountPreview();
				}
			});
		},
		[
			clearPendingAutosave,
			queueSave,
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
				toast.error("Project name is required");
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
			if (savingNameRef.current) return;
			if (!name || name === projectDisplayName) return closeProjectNameEditor();
			savingNameRef.current = true;
			setIsSavingProjectName(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "rename");
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectName(false);
				savingNameRef.current = false;
			}
			if (saved) setIsEditingProjectName(false);
			else {
				projectNameInputRef.current?.focus();
				projectNameInputRef.current?.select();
			}
		},
		[
			projectNameDraft,
			projectDisplayName,
			setIsSavingProjectName,
			setIsEditingProjectName,
			projectNameInputRef,
			closeProjectNameEditor,
			saveProjectWithName,
		],
	);
	const handleSaveProject = useCallback(
		() => saveProject(false, { explicit: true }),
		[saveProject],
	);
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
