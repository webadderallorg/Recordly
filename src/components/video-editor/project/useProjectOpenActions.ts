import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
} from "react";
import type { useProjectSaveActions } from "./useProjectSaveActions";
import { toast } from "@/components/ui/toast";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { isAutoMotionAllowed } from "../videoPlayback/motionAnimation";

type Set<T> = Dispatch<SetStateAction<T>>;

type UseProjectOpenActionsInput = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	hasUnsavedChanges: boolean;
	setIsPlaying: Set<boolean>;
	setCurrentTime: Set<number>;
	setDuration: Set<number>;
	applyLoadedProject: (candidate: unknown, path?: string | null) => Promise<boolean>;
	openUnsavedChangesDialog: (actionLabel: string) => Promise<"save" | "discard" | "cancel">;
	saveProject: ReturnType<typeof useProjectSaveActions>["saveProject"];
	refreshProjectLibrary: () => Promise<void>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: null) => void;
	handleSaveProject: () => Promise<unknown>;
	handleSaveProjectAs: () => Promise<unknown>;
};

export function useProjectOpenActions({
	project,
	appearance,
	videoPlaybackRef,
	pendingFreshRecordingAutoZoomPathRef,
	hasUnsavedChanges,
	setIsPlaying,
	setCurrentTime,
	setDuration,
	applyLoadedProject,
	openUnsavedChangesDialog,
	saveProject,
	refreshProjectLibrary,
	resetSourceScopedEditorState,
	applySessionPresentation,
	handleSaveProject,
	handleSaveProjectAs,
}: UseProjectOpenActionsInput) {
	const confirmReplaceSourceWithUnsavedChanges = useCallback(
		async (actionLabel: string) => {
			if (!hasUnsavedChanges) return true;
			const decision = await openUnsavedChangesDialog(actionLabel);
			if (decision === "discard") return true;
			if (decision === "save") return saveProject(false);
			return false;
		},
		[hasUnsavedChanges, openUnsavedChangesDialog, saveProject],
	);

	const handleOpenProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			if (!(await confirmReplaceSourceWithUnsavedChanges("open another project"))) return;
			try {
				const result = await window.electronAPI.openProjectFileAtPath(projectPath);
				if (result.canceled) return;
				if (!result.success) {
					project.setError(result.error || result.message || "Failed to load project");
					return;
				}
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					project.setError("Could not load project: invalid project file format");
					return;
				}
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				return true;
			} catch (error) {
				project.setError(
					`Could not load project: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[
			applyLoadedProject,
			confirmReplaceSourceWithUnsavedChanges,
			project,
			refreshProjectLibrary,
		],
	);

	const handleImportMediaOrProject = useCallback(async () => {
		if (!(await confirmReplaceSourceWithUnsavedChanges("import a file"))) return;
		try {
			const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
			if (result.canceled) return;
			if (!result.success) {
				toast.error(result.message || "Failed to import file");
				return;
			}
			if (result.kind === "project" || result.project) {
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					project.setError("Could not load project: invalid project file format");
					return;
				}
				project.setProjectBrowserOpen(false);
				await refreshProjectLibrary();
				toast.success(
					result.path ? `Project loaded from ${result.path}` : "Project loaded",
				);
				return;
			}
			if (!result.path) {
				toast.error("No media file selected");
				return;
			}

			const sourcePath = fromFileUrl(result.path);
			const setPathResult = await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: false,
			});
			if (!setPathResult.success) throw new Error("Could not load media");
			const sourceVideoUrl = await resolveVideoUrl(sourcePath);
			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// The preview may already be tearing down.
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);
			project.setVideoSourcePath(sourcePath);
			project.setVideoPath(sourceVideoUrl);
			project.setCurrentProjectPath(null);
			project.setLastSavedSnapshot(null);
			resetSourceScopedEditorState();
			pendingFreshRecordingAutoZoomPathRef.current =
				isAutoMotionAllowed(appearance.motionAnimationEnabled, appearance.autoApplyFreshRecordingAutoZooms)
					? sourceVideoUrl
					: null;
			appearance.setWebcam((previous) => ({
				...previous,
				visibleRanges: undefined,
				enabled: false,
				sourcePath: null,
				timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			}));
			applySessionPresentation(null);
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success("Media imported");
		} catch (error) {
			project.setError(
				`Could not load file: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}, [
		confirmReplaceSourceWithUnsavedChanges,
		applyLoadedProject,
		project,
		appearance,
		videoPlaybackRef,
		setIsPlaying,
		setCurrentTime,
		setDuration,
		resetSourceScopedEditorState,
		pendingFreshRecordingAutoZoomPathRef,
		applySessionPresentation,
		refreshProjectLibrary,
	]);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (project.projectBrowserOpen) {
			project.setProjectBrowserOpen(false);
			return;
		}
		videoPlaybackRef.current?.pause();
		setIsPlaying(false);
		if (project.videoPath && !project.error) {
			await saveProject(false, { remountPreviewAfterSave: false });
		}
		project.setProjectBrowserOpen(true);
		void refreshProjectLibrary();
	}, [
		project.projectBrowserOpen,
		project.setProjectBrowserOpen,
		refreshProjectLibrary,
		videoPlaybackRef,
		setIsPlaying,
		saveProject,
		project.videoPath,
		project.error,
	]);

	useEffect(() => {
		const openRequestedDashboard = () => {
			if (!localStorage.getItem("recordly.open-dashboard")) return;
			localStorage.removeItem("recordly.open-dashboard");
			if (!project.projectBrowserOpen) void handleOpenProjectBrowser();
		};
		openRequestedDashboard();
		window.addEventListener("storage", openRequestedDashboard);
		return () => window.removeEventListener("storage", openRequestedDashboard);
	}, [handleOpenProjectBrowser, project.projectBrowserOpen]);

	useEffect(() => {
		const removeLoad = window.electronAPI.onMenuLoadProject(
			() => void handleOpenProjectBrowser(),
		);
		const removeSave = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAs = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);
		return () => {
			removeLoad?.();
			removeSave?.();
			removeSaveAs?.();
		};
	}, [handleOpenProjectBrowser, handleSaveProject, handleSaveProjectAs]);

	const handleDeleteProjects = useCallback(
		async (paths: string[]) => {
			const result = await window.electronAPI.trashProjectFiles(paths);
			if (project.currentProjectPath && result.deleted.includes(project.currentProjectPath)) {
				project.setCurrentProjectPath(null);
				project.setLastSavedSnapshot(null);
			}
			await refreshProjectLibrary();
			if (result.errors.length) toast.error(result.errors.join("\n"));
			return result.deleted;
		},
		[project, refreshProjectLibrary],
	);
	const handleRenameLibraryProject = useCallback(
		async (path: string, name: string) => {
			const result = await window.electronAPI.renameLibraryProject(path, name);
			if (!result.success || !result.path)
				throw new Error(result.error || "Could not rename project");
			if (project.currentProjectPath === path) project.setCurrentProjectPath(result.path);
			await refreshProjectLibrary();
			return result.path;
		},
		[project, refreshProjectLibrary],
	);

	return {
		handleRenameLibraryProject,
		handleOpenProjectFromLibrary,
		handleImportMediaOrProject,
		handleOpenProjectBrowser,
		handleDeleteProjects,
	};
}
