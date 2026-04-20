import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { captureProjectThumbnail } from "./captureProjectThumbnail";
import { EditorContent } from "./EditorContent";
import { EditorHeader } from "./EditorHeader";
import { EditorSidebar } from "./EditorSidebar";
import { loadEditorPreferences } from "./editorPreferences";
import { useEditorAudioSync } from "./hooks/useEditorAudioSync";
import { useEditorCaptions } from "./hooks/useEditorCaptions";
import { useEditorCursorTelemetry } from "./hooks/useEditorCursorTelemetry";
import { useEditorExport } from "./hooks/useEditorExport";
import { useEditorHistory } from "./hooks/useEditorHistory";
import { useLoadInitialData, useOnApplyLoadedProject } from "./hooks/useEditorInit";
import { useEditorPreferences } from "./hooks/useEditorPreferences";
import { useEditorProject } from "./hooks/useEditorProject";
import { useEditorRegions } from "./hooks/useEditorRegions";
import { useEditorSideEffects } from "./hooks/useEditorSideEffects";
import { useEditorWiring } from "./hooks/useEditorWiring";
import ProjectBrowserDialog from "./ProjectBrowserDialog";
import { fromFileUrl } from "./projectPersistence";
import type { CropRegion } from "./types";
import { VideoPlaybackRef } from "./VideoPlayback";
import type { TimelineEditorHandle } from "./timeline/TimelineEditor";
import { getSmokeExportConfig } from "./videoEditorUtils";

export default function VideoEditor() {
	const { t } = useI18n();
	const { shortcuts, isMac } = useShortcuts();

	const smokeExportConfig = useMemo(
		() => getSmokeExportConfig(typeof window === "undefined" ? "" : window.location.search),
		[],
	);
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);

	// ── Core local state ──────────────────────────────────────────────
	const [appPlatform, setAppPlatform] = useState<string>(
		typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "darwin" : "",
	);
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<string[]>([]);
	const [autoSuggestZoomsTrigger, setAutoSuggestZoomsTrigger] = useState(0);
	const [previewVersion, setPreviewVersion] = useState(0);
	const [isPreviewReady, setIsPreviewReady] = useState(false);
	const [showCropModal, setShowCropModal] = useState(false);
	const [timelineCollapsed, setTimelineCollapsed] = useState(false);

	// ── Refs ──────────────────────────────────────────────────────────
	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
	const timelineRef = useRef<TimelineEditorHandle>(null);
	const projectBrowserTriggerRef = useRef<HTMLButtonElement | null>(null);
	const projectBrowserFallbackTriggerRef = useRef<HTMLButtonElement | null>(null);
	const cropSnapshotRef = useRef<CropRegion | null>(null);

	const headerLeftControlsPaddingClass = appPlatform === "darwin" ? "pl-[76px]" : "";

	const syncActiveVideoSource = useCallback(
		async (sourcePath: string, webcamPath?: string | null) => {
			if (webcamPath) {
				await window.electronAPI.setCurrentRecordingSession?.({
					videoPath: sourcePath,
					webcamPath,
				});
				return;
			}
			await window.electronAPI.setCurrentVideoPath(sourcePath);
		},
		[],
	);

	const remountPreview = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((v) => v + 1);
	}, []);

	// ── Hooks ─────────────────────────────────────────────────────────
	const prefs = useEditorPreferences();

	const regions = useEditorRegions({
		duration,
		currentTime,
		videoPath,
		setActiveEffectSection: prefs.setActiveEffectSection,
	});

	const captions = useEditorCaptions({
		videoSourcePath,
		videoPath,
		webcamSourcePath: prefs.webcam.sourcePath,
		syncActiveVideoSource,
		setVideoSourcePath,
		setVideoPath,
	});

	const { cursorTelemetry } = useEditorCursorTelemetry({
		videoPath,
		videoSourcePath,
		pendingFreshRecordingAutoZoomPathRef: regions.pendingFreshRecordingAutoZoomPathRef,
		autoSuggestedVideoPathRef: regions.autoSuggestedVideoPathRef,
	});

	const wiring = useEditorWiring({
		prefs,
		regions,
		captions,
		videoPath,
		isPlaying,
		duration,
		sourceAudioFallbackPaths,
		cursorTelemetry,
		videoPlaybackRef,
	});

	const history = useEditorHistory({
		buildSnapshot: wiring.buildHistorySnapshot,
		applySnapshot: wiring.applyHistorySnapshot,
	});

	useEditorAudioSync({
		audioRegions: regions.audioRegions,
		speedRegions: regions.effectiveSpeedRegions,
		sourceAudioFallbackPaths,
		isPlaying,
		currentTime,
		duration,
		previewVolume: prefs.previewVolume,
		mapSourceTimeToTimelineTime: regions.mapSourceTimeToTimelineTime,
	});

	const captureThumb = useCallback(
		() => captureProjectThumbnail(videoPlaybackRef, currentTime, cursorTelemetry, prefs, regions, captions),
		[currentTime, cursorTelemetry, prefs, regions, captions],
	);

	const exp = useEditorExport({
		videoPlaybackRef,
		smokeExportConfig,
		getRenderConfig: wiring.getRenderConfig,
		ensureSupportedMp4SourceDimensions: wiring.ensureSupportedMp4SourceDimensions,
		remountPreview,
	});

	const currentSourcePath = useMemo(
		() => videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null),
		[videoPath, videoSourcePath],
	);
	const hasSourceAudioFallback = sourceAudioFallbackPaths.length > 0;

	const projectDisplayName = useMemo(() => {
		const fileName =
			currentProjectPath?.split(/[\\/]/).pop() ??
			currentSourcePath?.split(/[\\/]/).pop() ??
			"";
		const withoutExtension = fileName.replace(/\.recordly$/i, "").replace(/\.[^.]+$/, "");
		return withoutExtension || t("editor.project.untitled", "Untitled");
	}, [currentProjectPath, currentSourcePath, t]);

	const onApplyLoadedProject = useOnApplyLoadedProject({
		prefs,
		regions,
		captions,
		setIsPlaying,
		setCurrentTime,
		setDuration,
		setError,
		setVideoSourcePath,
		setVideoPath,
		setCurrentProjectPath,
		videoPlaybackRef,
	});

	const project = useEditorProject({
		getCurrentPersistedState: wiring.getCurrentPersistedState,
		getCurrentSourcePath: useCallback(() => currentSourcePath, [currentSourcePath]),
		getCurrentProjectPath: useCallback(() => currentProjectPath, [currentProjectPath]),
		setCurrentProjectPath,
		captureProjectThumbnail: captureThumb,
		remountPreview,
		onApplyLoadedProject,
		clearHistory: history.clearHistory,
	});

	useLoadInitialData({
		prefs,
		regions,
		project,
		smokeExportConfig,
		initialEditorPreferences,
		setVideoSourcePath,
		setVideoPath,
		setCurrentProjectPath,
		setError,
		setLoading,
	});

	const { extensionSectionButtons, handleAutoSuggestZoomsConsumed } = useEditorSideEffects({
		prefs,
		regions,
		captions,
		history,
		exp,
		videoPath,
		currentSourcePath,
		loading,
		isPreviewReady,
		duration,
		error,
		cursorTelemetry,
		normalizedCursorTelemetry: wiring.normalizedCursorTelemetry,
		isMac,
		shortcuts,
		smokeExportConfig,
		videoPlaybackRef,
		setAppPlatform,
		setSourceAudioFallbackPaths,
		setAutoSuggestZoomsTrigger,
	});

	// ── Webcam handlers ──────────────────────────────────────────────
	const syncRecordingSessionWebcam = useCallback(
		async (webcamPath: string | null) => {
			if (!currentSourcePath || !window.electronAPI.setCurrentRecordingSession) return;
			await window.electronAPI.setCurrentRecordingSession({
				videoPath: currentSourcePath,
				webcamPath,
			});
		},
		[currentSourcePath],
	);

	const handleUploadWebcam = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (!result.success || !result.path) return;
		prefs.setWebcam((prev) => ({ ...prev, enabled: true, sourcePath: result.path ?? null }));
		await syncRecordingSessionWebcam(result.path);
		toast.success(t("settings.effects.webcamFootageAdded"));
	}, [syncRecordingSessionWebcam, prefs.setWebcam, t]);

	const handleClearWebcam = useCallback(async () => {
		prefs.setWebcam((prev) => ({ ...prev, enabled: false, sourcePath: null }));
		await syncRecordingSessionWebcam(null);
		toast.success(t("settings.effects.webcamFootageRemoved"));
	}, [syncRecordingSessionWebcam, prefs.setWebcam, t]);

	// ── Playback helpers ─────────────────────────────────────────────
	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;
		if (!video.paused && !video.ended) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}

	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = regions.mapTimelineTimeToSourceTime(time * 1000) / 1000;
	}

	// ── Crop handlers ────────────────────────────────────────────────
	const handleOpenCropEditor = useCallback(() => {
		cropSnapshotRef.current = { ...prefs.cropRegion };
		setShowCropModal(true);
	}, [prefs.cropRegion]);

	const handleCloseCropEditor = useCallback(() => setShowCropModal(false), []);

	const handleCancelCropEditor = useCallback(() => {
		if (cropSnapshotRef.current) prefs.setCropRegion(cropSnapshotRef.current);
		setShowCropModal(false);
	}, [prefs.setCropRegion]);

	const isCropped = useMemo(() => {
		const { x, y, width, height } = prefs.cropRegion;
		const top = Math.round(y * 100);
		const left = Math.round(x * 100);
		const bottom = Math.round((1 - y - height) * 100);
		const right = Math.round((1 - x - width) * 100);
		return top > 0 || left > 0 || bottom > 0 || right > 0;
	}, [prefs.cropRegion]);

	// ── Misc handlers ────────────────────────────────────────────────
	const openRecordingsFolder = useCallback(async () => {
		try {
			const result = await window.electronAPI.openRecordingsFolder();
			if (!result.success)
				toast.error(result.message || result.error || "Failed to open recordings folder.");
		} catch (err) {
			toast.error(`Failed to open recordings folder: ${String(err)}`);
		}
	}, []);

	const revealExportedFile = useCallback(async () => {
		if (!exp.exportedFilePath) return;
		try {
			const result = await window.electronAPI.revealInFolder(exp.exportedFilePath);
			if (!result.success)
				toast.error(result.error || result.message || "Failed to reveal item in folder.");
		} catch (err) {
			toast.error(`Failed to reveal item in folder: ${String(err)}`);
		}
	}, [exp.exportedFilePath]);

	// ── Project browser element ──────────────────────────────────────
	const projectBrowser = (
		<ProjectBrowserDialog
			open={project.projectBrowserOpen}
			onOpenChange={project.setProjectBrowserOpen}
			entries={project.projectLibraryEntries}
			anchorRef={error ? projectBrowserFallbackTriggerRef : projectBrowserTriggerRef}
			onOpenProject={(projectPath) => {
				void project.handleOpenProjectFromLibrary(projectPath);
			}}
		/>
	);

	// ── Render ───────────────────────────────────────────────────────
	if (loading) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="text-foreground">Loading video...</div>
				{projectBrowser}
				<Toaster className="pointer-events-auto" />
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						ref={projectBrowserFallbackTriggerRef}
						type="button"
						onClick={project.handleOpenProjectBrowser}
						className="rounded-[5px] bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"
					>
						Open Projects
					</button>
				</div>
				{projectBrowser}
				<Toaster className="pointer-events-auto" />
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-editor-bg text-foreground overflow-hidden selection:bg-[#2563EB]/30">
			<EditorHeader
				prefs={prefs}
				history={history}
				exp={exp}
				project={project}
				projectDisplayName={projectDisplayName}
				headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
				mp4OutputDimensions={wiring.mp4OutputDimensions}
				gifOutputDimensions={wiring.gifOutputDimensions}
				openRecordingsFolder={openRecordingsFolder}
				revealExportedFile={revealExportedFile}
				projectBrowserTriggerRef={projectBrowserTriggerRef}
			/>
			<div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
				<div className="flex min-h-0 flex-1 gap-3">
					<EditorSidebar
						prefs={prefs}
						regions={regions}
						captions={captions}
						extensionSectionButtons={extensionSectionButtons}
						handleUploadWebcam={handleUploadWebcam}
						handleClearWebcam={handleClearWebcam}
					/>
					<EditorContent
						prefs={prefs}
						regions={regions}
						captions={captions}
						videoPath={videoPath}
						currentTime={currentTime}
						duration={duration}
						isPlaying={isPlaying}
						previewVersion={previewVersion}
						timelineCollapsed={timelineCollapsed}
						showCropModal={showCropModal}
						isCropped={isCropped}
						hasSourceAudioFallback={hasSourceAudioFallback}
						effectiveCursorTelemetry={wiring.effectiveCursorTelemetry}
						normalizedCursorTelemetry={wiring.normalizedCursorTelemetry}
						autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
						videoPlaybackRef={videoPlaybackRef}
						timelineRef={timelineRef}
						setDuration={setDuration}
						setIsPreviewReady={setIsPreviewReady}
						setCurrentTime={setCurrentTime}
						setIsPlaying={setIsPlaying}
						setError={setError}
						setTimelineCollapsed={setTimelineCollapsed}
						togglePlayPause={togglePlayPause}
						handleSeek={handleSeek}
						handleOpenCropEditor={handleOpenCropEditor}
						handleCloseCropEditor={handleCloseCropEditor}
						handleCancelCropEditor={handleCancelCropEditor}
						handleAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
					/>
				</div>
			</div>
			{projectBrowser}
			<Toaster className="pointer-events-auto" />
		</div>
	);
}
