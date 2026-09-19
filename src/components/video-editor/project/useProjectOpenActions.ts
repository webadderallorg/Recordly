import {
	type Dispatch,
	type MutableRefObject,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
} from "react";
import { toast } from "sonner";
import type { useI18n } from "@/contexts/I18nContext";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Set<T> = Dispatch<SetStateAction<T>>;

type UseProjectOpenActionsInput = {
	t: ReturnType<typeof useI18n>["t"];
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
	saveProject: (forceSaveAs: boolean) => Promise<boolean>;
	refreshProjectLibrary: () => Promise<void>;
	resetSourceScopedEditorState: () => void;
	applySessionPresentation: (session: null) => void;
	handleSaveProject: () => Promise<unknown>;
	handleSaveProjectAs: () => Promise<unknown>;
};

export function useProjectOpenActions({
	t,
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
			if (
				!(await confirmReplaceSourceWithUnsavedChanges(
					t("editor.project.openAnotherProject", "open another project"),
				))
			)
				return;
			const result = await window.electronAPI.openProjectFileAtPath(projectPath);
			if (result.canceled) return;
			if (!result.success) {
				toast.error(
					result.message || t("editor.project.loadFailed", "Failed to load project"),
				);
				return;
			}
			if (!(await applyLoadedProject(result.project, result.path ?? null))) {
				toast.error(t("editor.project.invalidFormat", "Invalid project file format"));
				return;
			}
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success(
				t("editor.project.loadedFrom", "Project loaded from {{path}}", {
					path: result.path ?? "",
				}),
			);
		},
		[
			t,
			applyLoadedProject,
			confirmReplaceSourceWithUnsavedChanges,
			project,
			refreshProjectLibrary,
		],
	);

	const handleImportMediaOrProject = useCallback(async () => {
		if (
			!(await confirmReplaceSourceWithUnsavedChanges(
				t("editor.project.importFile", "import a file"),
			))
		)
			return;
		const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
		if (result.canceled) return;
		if (!result.success) {
			toast.error(
				result.message || t("editor.project.importFailed", "Failed to import file"),
			);
			return;
		}
		if (result.kind === "project" || result.project) {
			if (!(await applyLoadedProject(result.project, result.path ?? null))) {
				toast.error(t("editor.project.invalidFormat", "Invalid project file format"));
				return;
			}
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success(
				result.path
					? t("editor.project.loadedFrom", "Project loaded from {{path}}", {
							path: result.path,
						})
					: t("editor.project.loaded", "Project loaded"),
			);
			return;
		}
		if (!result.path) {
			toast.error(t("editor.project.noMediaSelected", "No media file selected"));
			return;
		}

		const sourcePath = fromFileUrl(result.path);
		await window.electronAPI.setCurrentVideoPath(sourcePath, { preserveProjectPath: false });
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
		pendingFreshRecordingAutoZoomPathRef.current = appearance.autoApplyFreshRecordingAutoZooms
			? sourceVideoUrl
			: null;
		appearance.setWebcam((previous) => ({
			...previous,
			enabled: false,
			sourcePath: null,
			timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		}));
		applySessionPresentation(null);
		project.setProjectBrowserOpen(false);
		await refreshProjectLibrary();
		toast.success(t("editor.project.mediaImported", "Media imported"));
	}, [
		t,
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

	const handleOpenProjectBrowser = useCallback(() => {
		if (project.projectBrowserOpen) {
			project.setProjectBrowserOpen(false);
			return;
		}
		project.setProjectBrowserOpen(true);
		void refreshProjectLibrary();
	}, [project.projectBrowserOpen, project.setProjectBrowserOpen, refreshProjectLibrary]);

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

	return { handleOpenProjectFromLibrary, handleImportMediaOrProject, handleOpenProjectBrowser };
}
