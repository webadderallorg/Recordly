/* biome-ignore-all lint/correctness/useExhaustiveDependencies: setters returned by the editor's domain-state hooks are stable React dispatchers. */
import { useCallback, useEffect, useMemo } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import { getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { loadEditorPreferences } from "./editorPreferences";
import { useEditorExportController } from "./export/useEditorExportController";
import { useExportDimensions } from "./export/useExportDimensions";
import { useExportSession } from "./export/useExportSession";
import { useExportSettings } from "./export/useExportSettings";
import { useTimelineEditingController } from "./hooks/useTimelineEditingController";
import { EditorShell } from "./layout/EditorShell";
import { useEditorSettingsPanelProps } from "./layout/useEditorSettingsPanelProps";
import { useVideoEditorPresets } from "./presets/useVideoEditorPresets";
import { useEditorProjectController } from "./project/useEditorProjectController";
import { useProjectLibraryController } from "./project/useProjectLibraryController";
import { getDevOpenRecordingConfig, getSmokeExportConfig } from "./smokeExportConfig";
import { useAppearanceState } from "./state/useAppearanceState";
import { useEditorUiState } from "./state/useEditorUiState";
import { useProjectState } from "./state/useProjectState";
import { useTimelineState } from "./state/useTimelineState";
import { useNvidiaCudaExportOptIn } from "./useNvidiaCudaExportOptIn";

export default function VideoEditor() {
	const { t } = useI18n();
	const smokeExportConfig = useMemo(
		() => getSmokeExportConfig(typeof window === "undefined" ? "" : window.location.search),
		[],
	);
	const devOpenRecordingConfig = useMemo(
		() =>
			getDevOpenRecordingConfig(typeof window === "undefined" ? "" : window.location.search),
		[],
	);
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const timeline = useTimelineState();
	const project = useProjectState();
	const { videoPath, setVideoPath, videoSourcePath, setVideoSourcePath, loading, error } =
		project;
	const appearance = useAppearanceState(initialEditorPreferences);
	const { showCursor, setShowCursor, cropRegion, setCropRegion } = appearance;
	const ui = useEditorUiState(initialEditorPreferences, cropRegion, setCropRegion);
	const {
		appPlatform,
		isPlaying,
		setIsPlaying,
		currentTime,
		setCurrentTime,
		duration,
		setDuration,
		sessionShowCursorOverride,
		setSessionShowCursorOverride,
		sessionNativeCaptureUnavailable,
		setNativeCaptureUnavailableModalOpen,
		whisperExecutablePath,
		setWhisperExecutablePath,
		whisperModelPath,
		setWhisperModelPath,
		downloadedWhisperModelPath,
		setDownloadedWhisperModelPath,
		whisperModelDownloadStatus,
		setWhisperModelDownloadStatus,
		whisperModelDownloadProgress,
		setWhisperModelDownloadProgress,
		isGeneratingCaptions,
		setIsGeneratingCaptions,
		previewVolume,
		aspectRatio,
		setAspectRatio,
		activeEffectSection,
		setActiveEffectSection,
		setPreviewVersion,
		isPreviewReady,
		setIsPreviewReady,
		setAutoSuggestZoomsTrigger,
		videoPlaybackRef,
		projectNameInputRef,
		projectSaveDialogInputRef,
		nextZoomIdRef,
		nextClipIdRef,
		clipInitializedRef,
		autoFullTrackClipIdRef,
		autoFullTrackClipEndMsRef,
		nextAudioIdRef,
		nextAnnotationIdRef,
		nextAnnotationZIndexRef,
		autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingAutoSuggestTimeoutRef,
		pendingFreshRecordingAutoSuggestTelemetryCountRef,
		timelineRef,
		applySessionPresentation,
	} = ui;
	const effectiveShowCursor = sessionShowCursorOverride ?? showCursor;
	const headerLeftControlsPaddingClass = appPlatform === "darwin" ? "pl-[76px]" : "";
	const { cursorTelemetrySourcePath, autoCaptions, autoCaptionSettings } = timeline;
	const exportSettings = useExportSettings(initialEditorPreferences, autoCaptions);
	const {
		includeCaptionSidecar,
		mp4FrameRate,
		gifSizePreset,
		captionSidecarCues,
		setExportPipelineModel,
	} = exportSettings;
	const exportSession = useExportSession();
	const { exporterRef, pendingExportSaveRef } = exportSession;
	const enableModernExportPipeline = useCallback(() => {
		setExportPipelineModel("modern");
	}, []);
	const {
		nvidiaCudaExportAvailable,
		experimentalNvidiaCudaExport,
		setExperimentalNvidiaCudaExport,
	} = useNvidiaCudaExportOptIn({
		onEnabled: enableModernExportPipeline,
	});
	const hasCaptionsForSidecar = autoCaptionSettings.enabled && autoCaptions.length > 0;
	const captionSidecarPayload =
		hasCaptionsForSidecar && captionSidecarCues.length > 0 && includeCaptionSidecar
			? {
					format: "both" as const,
					cues: captionSidecarCues,
				}
			: undefined;
	const { shortcuts, isMac } = useShortcuts();

	useEffect(() => {
		autoSuggestedVideoPathRef.current = null;
		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}
	}, []);

	const presets = useVideoEditorPresets({
		t,
		appearance,
		timeline,
		exportSettings,
		aspectRatio,
		setAspectRatio,
		whisperExecutablePath,
		setWhisperExecutablePath,
		whisperModelPath,
		setWhisperModelPath,
	});
	const { refreshProjectLibrary, captureProjectThumbnail } = useProjectLibraryController({
		project,
		appearance,
		timeline,
		videoPlaybackRef,
		currentTime,
		effectiveShowCursor,
	});
	const handleShowCursorChange = useCallback((nextShowCursor: boolean) => {
		setSessionShowCursorOverride(null);
		setShowCursor(nextShowCursor);
	}, []);

	const remountPreview = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((version) => version + 1);
	}, []);

	useEffect(() => {
		return () => {
			exporterRef.current?.cancel();
			exporterRef.current = null;
			const pending = pendingExportSaveRef.current;
			pendingExportSaveRef.current = null;
			if (pending?.tempFilePath && typeof window !== "undefined") {
				void window.electronAPI.discardExportedTemp?.(pending.tempFilePath);
			}
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		void refreshProjectLibrary();
	}, [refreshProjectLibrary]);

	const exportDimensions = useExportDimensions({
		videoPlaybackRef,
		isPreviewReady,
		aspectRatio,
		cropRegion,
		mp4FrameRate,
		gifSizePreset,
	});

	const projectController = useEditorProjectController({
		t,
		project,
		appearance,
		timeline,
		exportSettings,
		initialPreferences: initialEditorPreferences,
		smokeConfig: smokeExportConfig,
		devConfig: devOpenRecordingConfig,
		aspectRatio,
		setAspectRatio,
		videoPath,
		setVideoPath,
		videoSourcePath,
		setVideoSourcePath,
		currentTime,
		setCurrentTime,
		setIsPlaying,
		setDuration,
		whisperExecutablePath,
		setWhisperExecutablePath,
		whisperModelPath,
		setWhisperModelPath,
		downloadedWhisperModelPath,
		setDownloadedWhisperModelPath,
		whisperModelDownloadStatus,
		setWhisperModelDownloadStatus,
		setWhisperModelDownloadProgress,
		isGeneratingCaptions,
		setIsGeneratingCaptions,
		videoPlaybackRef,
		projectNameInputRef,
		projectSaveDialogInputRef,
		nextZoomIdRef,
		nextClipIdRef,
		nextAudioIdRef,
		nextAnnotationIdRef,
		nextAnnotationZIndexRef,
		clipInitializedRef,
		autoFullTrackClipIdRef,
		autoFullTrackClipEndMsRef,
		pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingAutoSuggestTelemetryCountRef,
		autoSuggestedVideoPathRef,
		applySessionPresentation,
		refreshProjectLibrary,
		captureProjectThumbnail,
		remountPreview,
	});
	const {
		snapshot: { currentSourcePath },
		history: { handleUndo, handleRedo },
		lifecycle: { handleUploadWebcam, handleClearWebcam },
		autoCaption: autoCaptionController,
	} = projectController;

	const editing = useTimelineEditingController({
		t,
		shortcuts,
		isMac,
		appPlatform,
		timeline,
		appearance,
		videoPath,
		videoSourcePath,
		currentSourcePath,
		duration,
		currentTime,
		isPlaying,
		previewVolume,
		loading,
		isPreviewReady,
		setActiveEffectSection,
		setAutoSuggestZoomsTrigger,
		videoPlaybackRef,
		timelineRef,
		nextZoomIdRef,
		nextClipIdRef,
		nextAudioIdRef,
		nextAnnotationIdRef,
		nextAnnotationZIndexRef,
		clipInitializedRef,
		autoFullTrackClipIdRef,
		autoFullTrackClipEndMsRef,
		autoSuggestedVideoPathRef,
		pendingFreshRecordingAutoZoomPathRef,
		pendingFreshRecordingAutoSuggestTimeoutRef,
		pendingFreshRecordingAutoSuggestTelemetryCountRef,
		handleUndo,
		handleRedo,
	});
	const {
		cursor: { effectiveCursorTelemetry },
		projection,
		audio,
		captionCommands,
		zoomCommands,
		clipCommands,
		audioCommands,
		annotationCommands,
	} = editing;
	const { effectiveSpeedRegions, effectiveZoomRegions } = projection;

	const exportController = useEditorExportController({
		t,
		videoPath,
		videoSourcePath,
		videoPlaybackRef,
		isPlaying,
		duration,
		error,
		loading,
		isPreviewReady,
		appearance,
		timeline,
		settings: exportSettings,
		session: exportSession,
		dimensions: exportDimensions,
		audio,
		smokeConfig: smokeExportConfig,
		effectiveSpeedRegions,
		effectiveZoomRegions,
		effectiveCursorTelemetry,
		effectiveShowCursor,
		cursorTelemetrySourcePath,
		hasCaptionsForSidecar,
		captionSidecarPayload,
		experimentalNvidiaCudaExport,
		nvidiaCudaExportAvailable,
		remountPreview,
	});
	const previewAspectRatioValue = getAspectRatioValue(
		aspectRatio,
		(() => {
			const previewVideo = videoPlaybackRef.current?.video;
			if (previewVideo && previewVideo.videoHeight > 0) {
				return previewVideo.videoWidth / previewVideo.videoHeight;
			}
			return 16 / 9;
		})(),
	);
	const settingsPanelProps = useEditorSettingsPanelProps({
		activeEffectSection,
		appearance,
		timeline,
		audio,
		zoomCommands,
		clipCommands,
		audioCommands,
		captionCommands,
		annotationCommands,
		autoCaptionController,
		effectiveShowCursor,
		handleShowCursorChange,
		currentTime,
		isPlaying,
		aspectRatio,
		setAspectRatio,
		whisperExecutablePath,
		whisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		sessionNativeCaptureUnavailable,
		setNativeCaptureUnavailableModalOpen,
		handleUploadWebcam,
		handleClearWebcam,
	});
	return (
		<EditorShell
			t={t}
			project={project}
			appearance={appearance}
			timeline={timeline}
			ui={ui}
			presets={presets}
			projectController={projectController}
			editing={editing}
			exportController={exportController}
			exportSettings={exportSettings}
			exportSession={exportSession}
			exportDimensions={exportDimensions}
			settingsPanelProps={settingsPanelProps}
			headerLeftControlsPaddingClass={headerLeftControlsPaddingClass}
			hasCaptionsForSidecar={hasCaptionsForSidecar}
			nvidiaCudaExportAvailable={nvidiaCudaExportAvailable}
			experimentalNvidiaCudaExport={experimentalNvidiaCudaExport}
			setExperimentalNvidiaCudaExport={setExperimentalNvidiaCudaExport}
			effectiveShowCursor={effectiveShowCursor}
			previewAspectRatioValue={previewAspectRatioValue}
		/>
	);
}
