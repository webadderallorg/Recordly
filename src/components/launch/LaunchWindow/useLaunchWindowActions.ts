import { useCallback } from "react";
import type ProjectBrowserDialog from "@/components/video-editor/ProjectBrowserDialog";
import type { DesktopSource } from "./types";

type ProjectLibraryEntry = React.ComponentProps<typeof ProjectBrowserDialog>["entries"][number];

function toProcessedDesktopSource(source: DesktopSource): ProcessedDesktopSource {
	return {
		id: source.id,
		name: source.originalName,
		thumbnail: source.thumbnail,
		display_id: source.display_id,
		appIcon: source.appIcon,
		originalName: source.originalName,
		sourceType: source.sourceType,
		appName: source.appName,
		windowTitle: source.windowTitle,
	};
}

interface UseLaunchWindowActionsParams {
	activeDropdown: "none" | "sources" | "more" | "mic" | "countdown" | "webcam";
	projectBrowserOpen: boolean;
	recording: boolean;
	hideHudFromCapture: boolean;
	setActiveDropdown: (value: "none" | "sources" | "more" | "mic" | "countdown" | "webcam") => void;
	setSelectedSource: (value: string) => void;
	setHasSelectedSource: (value: boolean) => void;
	setSources: (value: DesktopSource[]) => void;
	setSourcesLoading: (value: boolean) => void;
	setProjectLibraryEntries: (value: ProjectLibraryEntry[]) => void;
	setProjectBrowserOpen: (value: boolean) => void;
	setRecordingsDirectory: (value: string | null) => void;
	setHideHudFromCapture: (value: boolean) => void;
	fetchSourcesOnOpen: boolean;
}

export function useLaunchWindowActions({
	activeDropdown,
	projectBrowserOpen,
	recording,
	hideHudFromCapture,
	setActiveDropdown,
	setSelectedSource,
	setHasSelectedSource,
	setSources,
	setSourcesLoading,
	setProjectLibraryEntries,
	setProjectBrowserOpen,
	setRecordingsDirectory,
	setHideHudFromCapture,
	fetchSourcesOnOpen,
}: UseLaunchWindowActionsParams) {
	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setSourcesLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setSources(
				rawSources.map((source) => {
					const isWindow = source.id.startsWith("window:");
					const type = source.sourceType ?? (isWindow ? "window" : "screen");
					let displayName = source.name;
					let appName = source.appName;
					if (isWindow && !appName && source.name.includes(" — ")) {
						const parts = source.name.split(" — ");
						appName = parts[0]?.trim();
						displayName = parts.slice(1).join(" — ").trim() || source.name;
					} else if (isWindow && source.windowTitle) {
						displayName = source.windowTitle;
					}
					return {
						id: source.id,
						name: displayName,
						thumbnail: source.thumbnail ?? null,
						display_id: source.display_id ?? "",
						appIcon: source.appIcon ?? null,
						originalName: source.name,
						sourceType: type,
						appName,
						windowTitle: source.windowTitle ?? displayName,
					};
				}),
			);
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setSourcesLoading(false);
		}
	}, [setSources, setSourcesLoading]);

	const toggleDropdown = useCallback(
		(which: "sources" | "more" | "mic" | "countdown" | "webcam") => {
			setProjectBrowserOpen(false);
			setActiveDropdown(activeDropdown === which ? "none" : which);
			if (fetchSourcesOnOpen && activeDropdown !== which && which === "sources") {
				void fetchSources();
			}
		},
		[activeDropdown, fetchSources, fetchSourcesOnOpen, setActiveDropdown, setProjectBrowserOpen],
	);

	const handleSourceSelect = useCallback(
		async (source: DesktopSource) => {
			const processedSource = toProcessedDesktopSource(source);
			await window.electronAPI.selectSource(processedSource);
			setSelectedSource(source.name);
			setHasSelectedSource(true);
			setActiveDropdown("none");
			window.electronAPI.showSourceHighlight?.(processedSource);
		},
		[setActiveDropdown, setHasSelectedSource, setSelectedSource],
	);

	const openVideoFile = useCallback(async () => {
		setActiveDropdown("none");
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled) return;
		if (result.success && result.path) {
			await window.electronAPI.setCurrentVideoPath(result.path);
			await window.electronAPI.switchToEditor();
		}
	}, [setActiveDropdown]);

	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) return;
			setProjectLibraryEntries(result.entries);
		} catch (error) {
			console.error("Failed to load project library:", error);
		}
	}, [setProjectLibraryEntries]);

	const openProjectBrowser = useCallback(async () => {
		if (projectBrowserOpen) {
			setProjectBrowserOpen(false);
			return;
		}
		setActiveDropdown("none");
		await refreshProjectLibrary();
		setProjectBrowserOpen(true);
	}, [projectBrowserOpen, refreshProjectLibrary, setActiveDropdown, setProjectBrowserOpen]);

	const openProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			try {
				const result = await window.electronAPI.openProjectFileAtPath(projectPath);
				if (result.canceled || !result.success) return;
				setProjectBrowserOpen(false);
				await window.electronAPI.switchToEditor();
			} catch (error) {
				console.error("Failed to open project from library:", error);
			}
		},
		[setProjectBrowserOpen],
	);

	const chooseRecordingsDirectory = useCallback(async () => {
		setActiveDropdown("none");
		const result = await window.electronAPI.chooseRecordingsDirectory();
		if (result.canceled) return;
		if (result.success && result.path) setRecordingsDirectory(result.path);
	}, [setActiveDropdown, setRecordingsDirectory]);

	const toggleHudCaptureProtection = useCallback(async () => {
		const nextValue = !hideHudFromCapture;
		setHideHudFromCapture(nextValue);
		try {
			const result = await window.electronAPI.setHudOverlayCaptureProtection(nextValue);
			if (!result.success) {
				setHideHudFromCapture(!nextValue);
				return;
			}
			setHideHudFromCapture(result.enabled);
		} catch (error) {
			console.error("Failed to update HUD capture protection:", error);
			setHideHudFromCapture(!nextValue);
		}
	}, [hideHudFromCapture, setHideHudFromCapture]);

	const toggleMicrophone = useCallback(() => {
		if (recording) return;
		toggleDropdown("mic");
	}, [recording, toggleDropdown]);

	const toggleWebcam = useCallback(() => {
		if (recording) return;
		toggleDropdown("webcam");
	}, [recording, toggleDropdown]);

	return {
		fetchSources,
		toggleDropdown,
		handleSourceSelect,
		openVideoFile,
		openProjectBrowser,
		openProjectFromLibrary,
		chooseRecordingsDirectory,
		toggleHudCaptureProtection,
		toggleMicrophone,
		toggleWebcam,
	};
}