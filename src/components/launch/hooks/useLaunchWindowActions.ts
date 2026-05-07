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
		window.electronAPI.showSourceHighlight?.({
			...source,
			name: source.appName ? `${source.appName} — ${source.name}` : source.name,
			appName: source.appName,
		});
	}, []);

	const openVideoFile = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled) return;
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
