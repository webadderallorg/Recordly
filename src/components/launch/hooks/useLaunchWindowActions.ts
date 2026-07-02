import { useCallback, useState } from "react";
import type { ProjectLibraryEntry } from "@/components/video-editor/ProjectBrowserDialog";
import type { DesktopSource } from "../popovers/launchPopoverTypes";

export function useLaunchWindowActions() {
	const [selectedSource, setSelectedSource] = useState("Screen");
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);

	const handleSourceSelect = useCallback(async (source: DesktopSource) => {
		await window.electronAPI.selectSource(source);
		setSelectedSource(source.name);
		setHasSelectedSource(true);

		try {
			const platform = await window.electronAPI.getPlatform();
			if (platform === "linux") {
				const clearPromise = window.electronAPI.clearSourceHighlight?.();
				if (clearPromise) {
					void clearPromise.catch((error) => {
						console.warn("Failed to clear Linux source highlight:", error);
					});
				}
				return;
			}
		} catch (error) {
			console.warn("Failed to check platform before source highlight:", error);
			const clearPromise = window.electronAPI.clearSourceHighlight?.();
			if (clearPromise) {
				void clearPromise.catch((clearError) => {
					console.warn(
						"Failed to clear source highlight after platform check failed:",
						clearError,
					);
				});
			}
			return;
		}

		const highlightPromise = window.electronAPI.showSourceHighlight?.({
			...source,
			name: source.appName ? `${source.appName} — ${source.name}` : source.name,
			appName: source.appName,
		});
		if (highlightPromise) {
			void highlightPromise.catch((error) => {
				console.warn("Failed to show selected source highlight:", error);
			});
		}
	}, []);

	const openVideoFile = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker({ includeProjects: true });
		if (result.canceled) return;
		if (result.success && result.kind === "project") {
			await window.electronAPI.switchToEditor();
			return;
		}
		if (result.success && result.path) {
			await window.electronAPI.setCurrentVideoPath(result.path);
			await window.electronAPI.switchToEditor();
		}
	}, []);

	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) return;
			setProjectLibraryEntries(result.entries);
		} catch (error) {
			console.error("Failed to load project library:", error);
		}
	}, []);
	const openProjectFromLibrary = useCallback(async (projectPath: string) => {
		try {
			const result = await window.electronAPI.openProjectFileAtPath(projectPath);
			if (result.canceled || !result.success) {
				return;
			}
			await window.electronAPI.switchToEditor();
		} catch (error) {
			console.error("Failed to open project from library:", error);
		}
	}, []);

	const syncSelectedSource = useCallback((source: { name?: string } | null | undefined) => {
		if (source?.name) {
			setSelectedSource(source.name);
			setHasSelectedSource(true);
			return;
		}
		setSelectedSource("Screen");
		setHasSelectedSource(false);
	}, []);

	return {
		selectedSource,
		hasSelectedSource,
		projectLibraryEntries,
		handleSourceSelect,
		openVideoFile,
		openProjectFromLibrary,
		syncSelectedSource,
		refreshProjectLibrary,
	};
}
