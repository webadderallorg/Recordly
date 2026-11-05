import { translate } from "@/i18n/runtime";
import { moveProjectFolderReferences } from "../dashboard/useProjectFolders";
import { moveProjectShareLink } from "../cloud/projectShareLinks";
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";
import { cloneStructured, getErrorMessage } from "../videoEditorUtils";
import { startProjectAutosave } from "./projectAutosave";

type SaveProjectOptions = {
	silent?: boolean;
	remountPreviewAfterSave?: boolean;
	refreshLibraryAfterSave?: boolean;
	captureThumbnail?: boolean;
};

type UseProjectSaveActionsInput = {
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
	const savingNameRef = useRef(false);
	const activePathRef = useRef(currentProjectPath);
	const activeSourceRef = useRef(currentSourcePath);
	const activeProjectIdRef = useRef(lastSavedSnapshot?.projectId ?? null);
	const sessionVersionRef = useRef(0);
	const saveErrorRef = useRef<string | null>(null);
	const reportSaveError = useCallback(
		(message: string, description?: string, silent?: boolean) => {
			const failure = JSON.stringify([sessionVersionRef.current, message, description]);
			if (silent && saveErrorRef.current === failure) return;
			saveErrorRef.current = failure;
			toast.error(message, { id: "project-save-error", description });
		},
		[],
	);
	const wasLoadingRef = useRef(project.loading);
	useLayoutEffect(() => {
		// Different projects can share a source video. Loading or selecting one
		// invalidates queued saves and completions from the previous editor session.
		const projectId = lastSavedSnapshot?.projectId ?? null;
		if (
			activePathRef.current !== currentProjectPath ||
			activeSourceRef.current !== currentSourcePath ||
			activeProjectIdRef.current !== projectId ||
			(project.loading && !wasLoadingRef.current)
		)
			sessionVersionRef.current++;
		activePathRef.current = currentProjectPath;
		activeSourceRef.current = currentSourcePath;
		activeProjectIdRef.current = projectId;
		wasLoadingRef.current = project.loading;
	}, [currentProjectPath, currentSourcePath, lastSavedSnapshot?.projectId, project.loading]);
	const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const queueSave = useCallback((task: () => Promise<boolean>) => {
		const run = saveQueueRef.current.catch(() => undefined).then(task);
		saveQueueRef.current = run.catch(() => undefined);
		return run;
	}, []);

	const saveProject = useCallback(
		async (forceSaveAs: boolean, options?: SaveProjectOptions) => {
			if (forceSaveAs)
				return openProjectSaveDialog(
					projectDisplayName || translate("editor.project.untitled", "Untitled Project"),
				);
			let sessionVersion = sessionVersionRef.current;
			return queueSave(async () => {
				if (
					sessionVersionRef.current !== sessionVersion ||
					activeSourceRef.current !== currentSourcePath
				)
					return false;
				if (!currentSourcePath) {
					if (!options?.silent)
						toast.error(translate("notifications.noVideo", "No video loaded"));
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
					if (sessionVersionRef.current !== sessionVersion) return false;
					const result = !targetPath
						? await window.electronAPI.createProjectFile(projectData, thumbnail)
						: await window.electronAPI.saveProjectFile(
								projectData,
								fileNameBase,
								targetPath,
								thumbnail,
							);
					if (sessionVersionRef.current !== sessionVersion)
						return Boolean(result.success);
					if (result.canceled) {
						if (!options?.silent)
							toast.info(
								translate(
									"notifications.projectSaveCanceled",
									"Project save canceled",
								),
							);
						return false;
					}
					if (!result.success) {
						reportSaveError(
							translate("notifications.saveProjectFailed", "Failed to save project"),
							result.message,
							options?.silent,
						);
						return false;
					}

					if (
						sessionVersionRef.current !== sessionVersion ||
						activeSourceRef.current !== currentSourcePath
					)
						return true;
					saveErrorRef.current = null;
					toast.dismiss("project-save-error");
					const savedProjectId = result.projectId ?? projectData.projectId ?? null;
					if (activeProjectIdRef.current !== savedProjectId) {
						activeProjectIdRef.current = savedProjectId;
						sessionVersion = ++sessionVersionRef.current;
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
								projectData.history,
							),
						),
					);
					if (refreshLibrary) await refreshProjectLibrary();

					return true;
				} catch (error) {
					if (sessionVersionRef.current !== sessionVersion) return false;
					reportSaveError(
						translate(
							"notifications.saveProjectError",
							"Could not save project: {{error}}",
							{ error: getErrorMessage(error) },
						),
						undefined,
						options?.silent,
					);
					return false;
				} finally {
					if (remount && sessionVersionRef.current === sessionVersion) remountPreview();
				}
			});
		},
		[
			queueSave,
			reportSaveError,
			currentSourcePath,
			currentProjectSnapshot,
			currentPersistedEditorState,
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
	const autosaveStateRef = useRef({
		loading: project.loading,
		currentSourcePath,
		hasUnsavedChanges,
		saveProject,
	});
	useLayoutEffect(() => {
		autosaveStateRef.current = {
			loading: project.loading,
			currentSourcePath,
			hasUnsavedChanges,
			saveProject,
		};
	}, [project.loading, currentSourcePath, hasUnsavedChanges, saveProject]);
	useEffect(
		() =>
			startProjectAutosave(() => {
				const latest = autosaveStateRef.current;
				if (latest.loading || !latest.currentSourcePath || !latest.hasUnsavedChanges)
					return;
				return latest.saveProject(false, {
					silent: true,
					remountPreviewAfterSave: false,
					refreshLibraryAfterSave: false,
					captureThumbnail: false,
				});
			}),
		[],
	);

	const saveProjectWithName = useCallback(
		async (name: string, mode: "rename" | "copy" = "rename") => {
			const trimmedName = name.trim();
			if (!trimmedName) {
				toast.error(
					translate("notifications.projectNameRequired", "Project name is required"),
				);
				return false;
			}
			if (!currentSourcePath) {
				toast.error(translate("notifications.noVideo", "No video loaded"));
				return false;
			}
			let sessionVersion = sessionVersionRef.current;
			return queueSave(async () => {
				if (
					sessionVersionRef.current !== sessionVersion ||
					activeSourceRef.current !== currentSourcePath
				)
					return false;
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
					const thumbnail = await captureProjectThumbnail();
					if (sessionVersionRef.current !== sessionVersion) return false;
					const result = await window.electronAPI.saveProjectFileNamed(
						projectData,
						trimmedName,
						thumbnail,
						mode,
					);
					if (sessionVersionRef.current !== sessionVersion)
						return Boolean(result.success);
					if (result.canceled) {
						toast.info(
							translate("notifications.projectSaveCanceled", "Project save canceled"),
						);
						return false;
					}
					if (!result.success) {
						toast.error(
							translate("notifications.saveProjectFailed", "Failed to save project"),
							{ description: result.message },
						);
						return false;
					}
					if (
						sessionVersionRef.current !== sessionVersion ||
						activeSourceRef.current !== currentSourcePath
					)
						return true;
					saveErrorRef.current = null;
					toast.dismiss("project-save-error");
					const savedProjectId = result.projectId ?? projectData.projectId ?? null;
					if (activeProjectIdRef.current !== savedProjectId) {
						activeProjectIdRef.current = savedProjectId;
						sessionVersion = ++sessionVersionRef.current;
					}
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
								translate(
									"notifications.renamedPreferencesFailed",
									"Project renamed, but library preferences could not be updated",
								),
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
								projectData.history,
							),
						),
					);
					await refreshProjectLibrary();

					return true;
				} finally {
					if (sessionVersionRef.current === sessionVersion) remountPreview();
				}
			});
		},
		[
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
				toast.error(
					translate("notifications.projectNameRequired", "Project name is required"),
				);
				projectSaveDialogInputRef.current?.focus();
				return;
			}
			setIsSavingProjectDialog(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(name, "copy");
			} catch (error) {
				toast.error(
					translate(
						"notifications.saveProjectError",
						"Could not save project: {{error}}",
						{ error: getErrorMessage(error) },
					),
				);
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
				toast.error(
					translate(
						"notifications.saveProjectError",
						"Could not save project: {{error}}",
						{ error: getErrorMessage(error) },
					),
				);
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
