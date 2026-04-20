/**
 * useEditorProject – project save / load / library state.
 *
 * The caller (VideoEditor) owns all editor state; this hook manages the
 * project-file I/O and exposes stable handlers.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ProjectLibraryEntry } from "../ProjectBrowserDialog";
import type { EditorProjectData } from "../projectPersistence";
import {
	createProjectData,
	fromFileUrl,
	normalizeProjectEditor,
	resolveVideoUrl,
	validateProjectData,
} from "../projectPersistence";

interface UseEditorProjectParams {
	/** Returns current serialised editor state (snapshot without videoPath). */
	getCurrentPersistedState: () => Record<string, unknown>;
	/** Returns the current source path (already decoded from file-URL). */
	getCurrentSourcePath: () => string | null;
	/** Returns the current project path. */
	getCurrentProjectPath: () => string | null;
	/** Sets currentProjectPath. */
	setCurrentProjectPath: (path: string | null) => void;
	/** Captures a thumbnail data-URL from the preview. */
	captureProjectThumbnail: () => Promise<string | null>;
	/** Re-mounts the preview after save. */
	remountPreview: () => void;
	/** Called when a project file has been successfully loaded. Return false to abort. */
	onApplyLoadedProject: (
		normalizedEditor: ReturnType<typeof normalizeProjectEditor>,
		sourcePath: string,
		projectPath: string | null,
	) => Promise<boolean>;
	/** Resets the undo/redo stack after loading. */
	clearHistory: () => void;
}

export function useEditorProject({
	getCurrentPersistedState,
	getCurrentSourcePath,
	getCurrentProjectPath,
	setCurrentProjectPath,
	captureProjectThumbnail,
	remountPreview,
	onApplyLoadedProject,
	clearHistory,
}: UseEditorProjectParams) {
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<EditorProjectData | null>(null);

	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) throw new Error(result.error || "Failed to load project library");
			setProjectLibraryEntries(result.entries);
		} catch (error) {
			console.warn("Unable to refresh project library:", error);
		}
	}, []);

	const hasUnsavedChanges = useMemo(() => {
		if (!getCurrentProjectPath() || !lastSavedSnapshot) return false;
		const sourcePath = getCurrentSourcePath();
		if (!sourcePath) return false;
		const current = createProjectData(sourcePath, getCurrentPersistedState());
		return JSON.stringify(current) !== JSON.stringify(lastSavedSnapshot);
	}, [getCurrentPersistedState, getCurrentSourcePath, getCurrentProjectPath, lastSavedSnapshot]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			const sourcePath = getCurrentSourcePath();
			if (!sourcePath) {
				toast.error("No video loaded");
				return false;
			}
			try {
				const projectData = createProjectData(sourcePath, getCurrentPersistedState());
				const fileNameBase =
					sourcePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ||
					`project-${Date.now()}`;
				let targetProjectPath = forceSaveAs ? undefined : (getCurrentProjectPath() ?? undefined);

				if (!forceSaveAs && !targetProjectPath) {
					const activeResult = await window.electronAPI.loadCurrentProjectFile();
					if (activeResult.success && activeResult.path) {
						targetProjectPath = activeResult.path;
						setCurrentProjectPath(activeResult.path);
					}
				}

				const thumbnailDataUrl = await captureProjectThumbnail();
				const result = await window.electronAPI.saveProjectFile(
					projectData,
					fileNameBase,
					targetProjectPath,
					thumbnailDataUrl,
				);

				if (result.canceled) {
					toast.info("Project save canceled");
					return false;
				}
				if (!result.success) {
					toast.error(result.message || "Failed to save project");
					return false;
				}
				if (result.path) setCurrentProjectPath(result.path);
				setLastSavedSnapshot(globalThis.structuredClone(projectData));
				await refreshProjectLibrary();
				toast.success(`Project saved to ${result.path}`);
				return true;
			} finally {
				remountPreview();
			}
		},
		[
			captureProjectThumbnail,
			getCurrentPersistedState,
			getCurrentSourcePath,
			getCurrentProjectPath,
			setCurrentProjectPath,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	/** Load and apply a project from a raw (possibly unknown) candidate value. */
	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) return false;
			const sourcePath = fromFileUrl(candidate.videoPath);
			const normalizedEditor = normalizeProjectEditor(candidate.editor);
			const success = await onApplyLoadedProject(normalizedEditor, sourcePath, path ?? null);
			if (!success) return false;
			const videoUrl = await resolveVideoUrl(sourcePath);
			void videoUrl;
			setLastSavedSnapshot(
				globalThis.structuredClone(
					createProjectData(sourcePath, normalizedEditor as unknown as Record<string, unknown>),
				),
			);
			clearHistory();
			await refreshProjectLibrary();
			return true;
		},
		[onApplyLoadedProject, clearHistory, refreshProjectLibrary],
	);

	// Notify shell about unsaved changes
	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	// Prompt-to-save before window close
	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => saveProject(false));
		return () => cleanup?.();
	}, [saveProject]);

	// Menu bar events
	const handleSaveProject = useCallback(() => saveProject(false), [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		const saved = await saveProject(true);
		if (saved) setProjectBrowserOpen(false);
	}, [saveProject]);

	const handleOpenProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			const result = await window.electronAPI.openProjectFileAtPath(projectPath);
			if (result.canceled) return;
			if (!result.success) {
				toast.error(result.message || "Failed to load project");
				return;
			}
			const restored = await applyLoadedProject(result.project, result.path ?? null);
			if (!restored) {
				toast.error("Invalid project file format");
				return;
			}
			setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success(`Project loaded from ${result.path}`);
		},
		[applyLoadedProject, refreshProjectLibrary],
	);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (projectBrowserOpen) {
			setProjectBrowserOpen(false);
			return;
		}
		await refreshProjectLibrary();
		setProjectBrowserOpen(true);
	}, [projectBrowserOpen, refreshProjectLibrary]);

	useEffect(() => {
		const removeLoad = window.electronAPI.onMenuLoadProject(() => void handleOpenProjectBrowser());
		const removeSave = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAs = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);
		return () => {
			removeLoad?.();
			removeSave?.();
			removeSaveAs?.();
		};
	}, [handleOpenProjectBrowser, handleSaveProject, handleSaveProjectAs]);

	return {
		projectLibraryEntries,
		projectBrowserOpen,
		setProjectBrowserOpen,
		lastSavedSnapshot,
		setLastSavedSnapshot,
		hasUnsavedChanges,
		saveProject,
		handleSaveProject,
		handleSaveProjectAs,
		applyLoadedProject,
		handleOpenProjectFromLibrary,
		handleOpenProjectBrowser,
		refreshProjectLibrary,
	};
}