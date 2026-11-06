import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { moveProjectShareLink } from "../cloud/projectShareLinks";
import { moveProjectFolderReferences } from "../dashboard/useProjectFolders";
import { createProjectData, type EditorProjectData } from "../projectPersistence";
import type { useProjectState } from "../state/useProjectState";
import { cloneStructured, getErrorMessage } from "../videoEditorUtils";

const PROJECT_AUTOSAVE_DELAY_MS = 500;

/**
 * The close-before-save flow below is a long-running async closure (awaits a
 * dialog, then a save) that calls back into hook-scoped functions. Those
 * functions get a new identity every time their underlying state (snapshot,
 * hasUnsavedChanges) changes, but a closure already in flight keeps whatever
 * it captured when it started - so without this, it can act on stale state
 * from before the edits that happened while it was awaiting.
 */
function useLatestRef<T>(value: T) {
	const ref = useRef(value);
	useLayoutEffect(() => {
		ref.current = value;
	}, [value]);
	return ref;
}

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
	openUnsavedChangesDialog: (actionLabel: string) => Promise<"cancel" | "discard" | "save">;
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
	openUnsavedChangesDialog,
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
	const hasUnsavedChangesRef = useLatestRef(hasUnsavedChanges);
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
			captureProjectThumbnail,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	useEffect(() => {
		console.log("[close-debug] renderer hasUnsavedChanges ->", hasUnsavedChanges, {
			currentSourcePath,
			hasSnapshot: Boolean(currentProjectSnapshot),
		});
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges, currentSourcePath, currentProjectSnapshot]);
	const scheduleAutosave = useCallback(() => {
		if (project.loading || !currentSourcePath || !hasUnsavedChanges) {
			clearPendingAutosave();
			return;
		}
		clearPendingAutosave();
		autosaveTimeoutRef.current = window.setTimeout(() => {
			autosaveTimeoutRef.current = null;
			void saveProject(false, {
				silent: true,
				remountPreviewAfterSave: false,
				refreshLibraryAfterSave: false,
				captureThumbnail: false,
			});
		}, PROJECT_AUTOSAVE_DELAY_MS);
	}, [clearPendingAutosave, hasUnsavedChanges, saveProject, project.loading, currentSourcePath]);
	const scheduleAutosaveRef = useLatestRef(scheduleAutosave);
	const saveProjectRef = useLatestRef(saveProject);

	useEffect(
		() =>
			window.electronAPI.onRequestSaveBeforeClose(async () => {
				// Stop a new autosave from sneaking in while the user is deciding.
				clearPendingAutosave();
				const decision = await openUnsavedChangesDialog("close this project");
				if (decision === "cancel") {
					// ponytail: doesn't cancel an autosave that was already mid-flight
					// when Discard/Save was picked - not worth cancelling an in-flight
					// IPC file write for a sub-500ms race. Goes through the ref (see
					// above) so it reflects any edits made while the dialog was open.
					scheduleAutosaveRef.current();
					return "cancel";
				}
				if (decision === "discard") return "discard";

				let saved = await saveProjectRef.current(false);
				// Background edits (e.g. caption generation finishing) can land
				// while the dialog was open, or while that save itself was still
				// writing to disk. Keep saving the latest snapshot - via the ref,
				// so each attempt reflects the newest edits, not the one captured
				// when this handler started - until there's nothing left to
				// persist, instead of closing with stale content. Bounded so a
				// continuous stream of background edits can't hang the close
				// indefinitely; raise the bound if that proves too tight in
				// practice.
				for (
					let attempt = 0;
					saved && hasUnsavedChangesRef.current && attempt < 3;
					attempt++
				) {
					saved = await saveProjectRef.current(false);
				}
				// Don't report success while something is still unsaved - whether
				// because we ran out of retries above, or because an edit landed
				// after the last save started but before it finished. Closing on
				// "save" here would mean losing whatever that edit was.
				if (hasUnsavedChangesRef.current) saved = false;
				// The main process now shows a native recovery dialog; if the user
				// cancels there, this window stays open, so autosave must resume -
				// via the ref, so a retry never re-arms with a stale snapshot or
				// clobbers a newer autosave scheduled for edits made during the save.
				if (!saved) scheduleAutosaveRef.current();
				return saved ? "save" : "save-failed";
			}),
		// The ref.current reads below are deliberately excluded from triggering
		// a resubscribe (that's the point of the latest-ref pattern) - listed
		// here only to satisfy the exhaustive-deps lint rule.
		[
			openUnsavedChangesDialog,
			clearPendingAutosave,
			hasUnsavedChangesRef.current,
			saveProjectRef.current,
			scheduleAutosaveRef.current,
		],
	);
	useEffect(() => {
		scheduleAutosave();
		return clearPendingAutosave;
	}, [scheduleAutosave, clearPendingAutosave]);

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
