import { translate } from "@/i18n/runtime";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import type { useProjectSaveActions } from "./useProjectSaveActions";
import { toast } from "@/components/ui/toast";
import { fromFileUrl, resolveVideoUrl } from "../projectPersistence";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import { DEFAULT_WEBCAM_TIME_OFFSET_MS } from "../types";
import { errorSourceName, isMissingProjectRecording, projectLoadError } from "./projectLoadError";
import type { VideoPlaybackRef } from "../VideoPlayback";

type Set<T> = Dispatch<SetStateAction<T>>;

type UseProjectOpenActionsInput = {
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	hasUnsavedChanges: boolean;
	setIsPlaying: Set<boolean>;
	setCurrentTime: Set<number>;
	setDuration: Set<number>;
	applyLoadedProject: (
		candidate: unknown,
		path?: string | null,
		isCurrent?: () => boolean,
	) => Promise<boolean>;
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
	hasUnsavedChanges,
	setIsPlaying,
	setCurrentTime,
	setDuration,
	applyLoadedProject,
	saveProject,
	refreshProjectLibrary,
	resetSourceScopedEditorState,
	applySessionPresentation,
	handleSaveProject,
	handleSaveProjectAs,
}: UseProjectOpenActionsInput) {
	const latestOpen = useRef<(path: string) => Promise<unknown>>(async () => undefined);
	const latestRelink = useRef<(path: string) => Promise<unknown>>(async () => undefined);
	const opening = useRef(false);
	const mounted = useRef(true);
	const projectPath = fromFileUrl(project.currentProjectPath || "").replace(/\\/g, "/");
	// A media-server capability/port refresh does not replace the underlying source.
	const sourcePath = fromFileUrl(project.videoSourcePath || project.videoPath || "").replace(
		/\\/g,
		"/",
	);
	const relinkContext = useRef({ projectPath, sourcePath, generation: 0 });
	// Invalidate only committed identity changes; a discarded React render must
	// not suppress an authorized relink for the project that is still displayed.
	useLayoutEffect(() => {
		if (
			relinkContext.current.projectPath !== projectPath ||
			relinkContext.current.sourcePath !== sourcePath
		) {
			relinkContext.current = {
				projectPath,
				sourcePath,
				generation: relinkContext.current.generation + 1,
			};
		}
	}, [projectPath, sourcePath]);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			relinkContext.current.generation++;
		};
	}, []);
	const reportOpenError = useCallback((error: unknown, path?: string) => {
		const { title, description } = projectLoadError(error);
		console.warn("Could not open file:", error);
		toast.error(path ? `${title}: ${errorSourceName(path)}` : title, {
			id: "project-open-error",
			description,
			action: path
				? {
						label: isMissingProjectRecording(error)
							? translate("notifications.locateRecording", "Locate recording")
							: translate("notifications.tryAgain", "Try again"),
						onClick: () =>
							void (
								isMissingProjectRecording(error) ? latestRelink : latestOpen
							).current(path),
					}
				: undefined,
		});
	}, []);
	const confirmReplaceSourceWithUnsavedChanges = useCallback(
		async (_actionLabel: string) => {
			if (!hasUnsavedChanges) return true;
			return saveProject(false, { remountPreviewAfterSave: false });
		},
		[hasUnsavedChanges, saveProject],
	);

	const handleRelinkProjectRecording = useCallback(
		async (projectPath: string) => {
			if (opening.current) return false;
			opening.current = true;
			const generation = relinkContext.current.generation;
			const isCurrent = () =>
				mounted.current && relinkContext.current.generation === generation;
			try {
				if (!(await confirmReplaceSourceWithUnsavedChanges("locate recording")) || !isCurrent())
					return false;
				const result = await window.electronAPI.relinkProjectRecording(projectPath);
				if (result.canceled || !isCurrent()) return false;
				if (!result.success)
					throw new Error(
						result.error || result.message || "Failed to reconnect recording",
					);
				if (
					!(await applyLoadedProject(
						result.project,
						result.path ?? projectPath,
						isCurrent,
					))
				) {
					if (!isCurrent()) return false;
					throw new Error("Invalid project file format");
				}
				project.setError(null);
				project.setProjectBrowserOpen(false);
				toast.dismiss("project-open-error");
				await refreshProjectLibrary();
				return true;
			} catch (error) {
				if (!isCurrent()) return false;
				toast.error(
					translate(
						"notifications.recordingRelinkFailed",
						"Could not reconnect the recording",
					),
					{
						id: "project-open-error",
						description: error instanceof Error ? error.message : String(error),
						action: {
							label: translate("notifications.locateRecording", "Locate recording"),
							onClick: () => void latestRelink.current(projectPath),
						},
					},
				);
				return false;
			} finally {
				opening.current = false;
			}
		},
		[
			applyLoadedProject,
			confirmReplaceSourceWithUnsavedChanges,
			project,
			refreshProjectLibrary,
		],
	);
	useLayoutEffect(() => {
		latestRelink.current = handleRelinkProjectRecording;
	}, [handleRelinkProjectRecording]);

	const handleOpenProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			if (opening.current) return;
			opening.current = true;
			try {
				if (!(await confirmReplaceSourceWithUnsavedChanges("open another project"))) return;
				const result = await window.electronAPI.openProjectFileAtPath(projectPath);
				if (result.canceled) return;
				if (!result.success) {
					reportOpenError(
						result.error || result.message || "Failed to load project",
						projectPath,
					);
					return;
				}
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					reportOpenError("Invalid project file format", projectPath);
					return;
				}
				project.setProjectBrowserOpen(false);
				toast.dismiss("project-open-error");
				await refreshProjectLibrary();
				return true;
			} catch (error) {
				reportOpenError(error, projectPath);
			} finally {
				opening.current = false;
			}
		},
		[
			applyLoadedProject,
			confirmReplaceSourceWithUnsavedChanges,
			project,
			refreshProjectLibrary,
			reportOpenError,
		],
	);
	useLayoutEffect(() => {
		latestOpen.current = handleOpenProjectFromLibrary;
	}, [handleOpenProjectFromLibrary]);

	const handleImportMediaOrProject = useCallback(async () => {
		if (opening.current) return;
		opening.current = true;
		try {
			if (!(await confirmReplaceSourceWithUnsavedChanges("import a file"))) return;
			const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
			if (result.canceled) return;
			if (!result.success) {
				reportOpenError(
					result.error || result.message || "Failed to import file",
					result.path,
				);
				return;
			}
			if (result.kind === "project" || result.project) {
				if (!(await applyLoadedProject(result.project, result.path ?? null))) {
					reportOpenError("Invalid project file format");
					return;
				}
				project.setProjectBrowserOpen(false);
				toast.dismiss("project-open-error");
				await refreshProjectLibrary();
				toast.success(
					result.path
						? translate(
								"notifications.projectLoadedFrom",
								"Project loaded from {{path}}",
								{ path: result.path },
							)
						: translate("notifications.projectLoaded", "Project loaded"),
				);
				return;
			}
			if (!result.path) {
				toast.error(translate("notifications.noMediaSelected", "No media file selected"));
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
			appearance.setWebcam((previous) => ({
				...previous,
				visibleRanges: undefined,
				enabled: false,
				sourcePath: null,
				timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			}));
			applySessionPresentation(null);
			project.setError(null);
			toast.dismiss("project-open-error");
			project.setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success(translate("notifications.mediaImported", "Media imported"));
		} catch (error) {
			reportOpenError(error);
		} finally {
			opening.current = false;
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
		applySessionPresentation,
		refreshProjectLibrary,
		reportOpenError,
	]);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (project.projectBrowserOpen) {
			project.setProjectBrowserOpen(false);
			return;
		}
		videoPlaybackRef.current?.pause();
		setIsPlaying(false);
		project.setProjectLibraryLoading(true);
		project.setProjectBrowserOpen(true);
		try {
			if (project.videoPath && !project.error) {
				await saveProject(false, {
					remountPreviewAfterSave: false,
					refreshLibraryAfterSave: false,
				});
			}
		} finally {
			await refreshProjectLibrary();
		}
	}, [
		project.projectBrowserOpen,
		project.setProjectBrowserOpen,
		project.setProjectLibraryLoading,
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
			if (result.errors.length)
				toast.error(
					translate(
						"notifications.deleteProjectsFailed",
						"Could not delete some projects",
					),
					{ description: result.errors.join("\n") },
				);
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
		handleRelinkProjectRecording,
		handleRenameLibraryProject,
		handleOpenProjectFromLibrary,
		handleImportMediaOrProject,
		handleOpenProjectBrowser,
		handleDeleteProjects,
	};
}
