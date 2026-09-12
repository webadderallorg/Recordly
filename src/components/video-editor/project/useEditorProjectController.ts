import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useMemo } from "react";
import type { useI18n } from "@/contexts/I18nContext";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useAutoCaptionController } from "../captions/useAutoCaptionController";
import { loadEditorPreferences } from "../editorPreferences";
import type { useExportSettings } from "../export/useExportSettings";
import { useEditorHistory } from "../hooks/useEditorHistory";
import { useEditorPreferencesPersistence } from "../presets/useEditorPreferencesPersistence";
import { hasUnsavedProjectChanges } from "../projectDirtyState";
import { getDevOpenRecordingConfig, getSmokeExportConfig } from "../smokeExportConfig";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useProjectState } from "../state/useProjectState";
import type { useTimelineState } from "../state/useTimelineState";
import type { VideoPlaybackRef } from "../VideoPlayback";
import { useInitialEditorSource } from "./useInitialEditorSource";
import type { useProjectLibraryController } from "./useProjectLibraryController";
import { useProjectLifecycle } from "./useProjectLifecycle";
import { useProjectOpenActions } from "./useProjectOpenActions";
import { useProjectSaveActions } from "./useProjectSaveActions";
import { useProjectSnapshotModel } from "./useProjectSnapshotModel";

type Input = {
	t: ReturnType<typeof useI18n>["t"];
	project: ReturnType<typeof useProjectState>;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	exportSettings: ReturnType<typeof useExportSettings>;
	initialPreferences: ReturnType<typeof loadEditorPreferences>;
	smokeConfig: ReturnType<typeof getSmokeExportConfig>;
	devConfig: ReturnType<typeof getDevOpenRecordingConfig>;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	videoPath: string | null;
	setVideoPath: Dispatch<SetStateAction<string | null>>;
	videoSourcePath: string | null;
	setVideoSourcePath: Dispatch<SetStateAction<string | null>>;
	currentTime: number;
	setCurrentTime: Dispatch<SetStateAction<number>>;
	setIsPlaying: Dispatch<SetStateAction<boolean>>;
	setDuration: Dispatch<SetStateAction<number>>;
	whisperExecutablePath: string | null;
	setWhisperExecutablePath: Dispatch<SetStateAction<string | null>>;
	whisperModelPath: string | null;
	setWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedWhisperModelPath: string | null;
	setDownloadedWhisperModelPath: Dispatch<SetStateAction<string | null>>;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	setWhisperModelDownloadStatus: Dispatch<
		SetStateAction<"idle" | "downloading" | "downloaded" | "error">
	>;
	setWhisperModelDownloadProgress: Dispatch<SetStateAction<number>>;
	captionEngine: "whisper" | "parakeet";
	setCaptionEngine: Dispatch<SetStateAction<"whisper" | "parakeet">>;
	parakeetExecutablePath: string | null;
	setParakeetExecutablePath: Dispatch<SetStateAction<string | null>>;
	parakeetModelPath: string | null;
	setParakeetModelPath: Dispatch<SetStateAction<string | null>>;
	downloadedParakeetModelPath: string | null;
	setDownloadedParakeetModelPath: Dispatch<SetStateAction<string | null>>;
	parakeetModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	setParakeetModelDownloadStatus: Dispatch<
		SetStateAction<"idle" | "downloading" | "downloaded" | "error">
	>;
	parakeetModelDownloadProgress: number;
	setParakeetModelDownloadProgress: Dispatch<SetStateAction<number>>;
	isGeneratingCaptions: boolean;
	setIsGeneratingCaptions: Dispatch<SetStateAction<boolean>>;
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	projectNameInputRef: RefObject<HTMLInputElement>;
	projectSaveDialogInputRef: RefObject<HTMLInputElement>;
	nextZoomIdRef: MutableRefObject<number>;
	nextClipIdRef: MutableRefObject<number>;
	nextAudioIdRef: MutableRefObject<number>;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
	clipInitializedRef: MutableRefObject<boolean>;
	autoFullTrackClipIdRef: MutableRefObject<string | null>;
	autoFullTrackClipEndMsRef: MutableRefObject<number | null>;
	pendingFreshRecordingAutoZoomPathRef: MutableRefObject<string | null>;
	pendingFreshRecordingAutoSuggestTelemetryCountRef: MutableRefObject<number>;
	autoSuggestedVideoPathRef: MutableRefObject<string | null>;
	applySessionPresentation: (
		session:
			| { hideOverlayCursorByDefault?: boolean; nativeCaptureUnavailable?: boolean }
			| null
			| undefined,
	) => void;
	refreshProjectLibrary: ReturnType<typeof useProjectLibraryController>["refreshProjectLibrary"];
	captureProjectThumbnail: ReturnType<
		typeof useProjectLibraryController
	>["captureProjectThumbnail"];
	remountPreview: () => void;
};

export function useEditorProjectController(input: Input) {
	const snapshot = useProjectSnapshotModel({
		t: input.t,
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		exportSettings: input.exportSettings,
		aspectRatio: input.aspectRatio,
		projectNameInputRef: input.projectNameInputRef,
		projectSaveDialogInputRef: input.projectSaveDialogInputRef,
	});
	const history = useEditorHistory({
		timeline: input.timeline,
		nextZoomIdRef: input.nextZoomIdRef,
		nextClipIdRef: input.nextClipIdRef,
		nextAnnotationIdRef: input.nextAnnotationIdRef,
		nextAudioIdRef: input.nextAudioIdRef,
		nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
	});
	const lifecycle = useProjectLifecycle({
		t: input.t,
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		exportSettings: input.exportSettings,
		aspectRatio: input.aspectRatio,
		setAspectRatio: input.setAspectRatio,
		currentSourcePath: snapshot.currentSourcePath,
		currentPersistedEditorState: snapshot.currentPersistedEditorState,
		videoPlaybackRef: input.videoPlaybackRef,
		setIsPlaying: input.setIsPlaying,
		setCurrentTime: input.setCurrentTime,
		setDuration: input.setDuration,
		applySessionPresentation: input.applySessionPresentation,
		refreshProjectLibrary: input.refreshProjectLibrary,
		buildPersistedEditorState: snapshot.buildPersistedEditorState,
		resetHistory: history.resetHistory,
		refs: {
			nextZoomIdRef: input.nextZoomIdRef,
			nextClipIdRef: input.nextClipIdRef,
			nextAudioIdRef: input.nextAudioIdRef,
			nextAnnotationIdRef: input.nextAnnotationIdRef,
			nextAnnotationZIndexRef: input.nextAnnotationZIndexRef,
			clipInitializedRef: input.clipInitializedRef,
			autoFullTrackClipIdRef: input.autoFullTrackClipIdRef,
			autoFullTrackClipEndMsRef: input.autoFullTrackClipEndMsRef,
			pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
			pendingFreshRecordingAutoSuggestTelemetryCountRef:
				input.pendingFreshRecordingAutoSuggestTelemetryCountRef,
			autoSuggestedVideoPathRef: input.autoSuggestedVideoPathRef,
		},
	});
	const hasUnsavedChanges = useMemo(
		() =>
			hasUnsavedProjectChanges(
				lifecycle.currentProjectSnapshot,
				input.project.lastSavedSnapshot,
			),
		[lifecycle.currentProjectSnapshot, input.project.lastSavedSnapshot],
	);

	useInitialEditorSource({
		project: input.project,
		appearance: input.appearance,
		timeline: input.timeline,
		smokeConfig: input.smokeConfig,
		devConfig: input.devConfig,
		videoSourcePath: input.videoSourcePath,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		applyLoadedProject: lifecycle.applyLoadedProject,
		resetSourceScopedEditorState: lifecycle.resetSourceScopedEditorState,
		applySessionPresentation: input.applySessionPresentation,
	});
	useEditorPreferencesPersistence({
		appearance: input.appearance,
		exportSettings: input.exportSettings,
		aspectRatio: input.aspectRatio,
		captionEngine: input.captionEngine,
		whisperExecutablePath: input.whisperExecutablePath,
		whisperModelPath: input.whisperModelPath,
		parakeetExecutablePath: input.parakeetExecutablePath,
		parakeetModelPath: input.parakeetModelPath,
	});
	const autoCaption = useAutoCaptionController({
		t: input.t,
		videoPath: input.videoPath,
		setVideoPath: input.setVideoPath,
		videoSourcePath: input.videoSourcePath,
		setVideoSourcePath: input.setVideoSourcePath,
		webcamSourcePath: input.appearance.webcam.sourcePath ?? null,
		captionEngine: input.captionEngine,
		setCaptionEngine: input.setCaptionEngine,
		whisperExecutablePath: input.whisperExecutablePath,
		setWhisperExecutablePath: input.setWhisperExecutablePath,
		whisperModelPath: input.whisperModelPath,
		setWhisperModelPath: input.setWhisperModelPath,
		downloadedWhisperModelPath: input.downloadedWhisperModelPath,
		setDownloadedWhisperModelPath: input.setDownloadedWhisperModelPath,
		whisperModelDownloadStatus: input.whisperModelDownloadStatus,
		setWhisperModelDownloadStatus: input.setWhisperModelDownloadStatus,
		setWhisperModelDownloadProgress: input.setWhisperModelDownloadProgress,
		parakeetExecutablePath: input.parakeetExecutablePath,
		setParakeetExecutablePath: input.setParakeetExecutablePath,
		parakeetModelPath: input.parakeetModelPath,
		setParakeetModelPath: input.setParakeetModelPath,
		downloadedParakeetModelPath: input.downloadedParakeetModelPath,
		setDownloadedParakeetModelPath: input.setDownloadedParakeetModelPath,
		parakeetModelDownloadStatus: input.parakeetModelDownloadStatus,
		setParakeetModelDownloadStatus: input.setParakeetModelDownloadStatus,
		parakeetModelDownloadProgress: input.parakeetModelDownloadProgress,
		setParakeetModelDownloadProgress: input.setParakeetModelDownloadProgress,
		isGeneratingCaptions: input.isGeneratingCaptions,
		setIsGeneratingCaptions: input.setIsGeneratingCaptions,
		autoCaptionSettings: input.timeline.autoCaptionSettings,
		setAutoCaptionSettings: input.timeline.setAutoCaptionSettings,
		setAutoCaptions: input.timeline.setAutoCaptions,
		syncActiveVideoSource: lifecycle.syncActiveVideoSource,
		clipRegions: input.timeline.clipRegions,
	});
	const saveActions = useProjectSaveActions({
		project: input.project,
		currentSourcePath: snapshot.currentSourcePath,
		currentProjectSnapshot: lifecycle.currentProjectSnapshot,
		currentPersistedEditorState: snapshot.currentPersistedEditorState,
		projectDisplayName: snapshot.projectDisplayName,
		hasUnsavedChanges,
		projectSaveDialogInputRef: input.projectSaveDialogInputRef,
		projectNameInputRef: input.projectNameInputRef,
		openProjectSaveDialog: lifecycle.openProjectSaveDialog,
		resolveProjectSaveDialog: lifecycle.resolveProjectSaveDialog,
		captureProjectThumbnail: input.captureProjectThumbnail,
		refreshProjectLibrary: input.refreshProjectLibrary,
		remountPreview: input.remountPreview,
	});
	const openActions = useProjectOpenActions({
		project: input.project,
		appearance: input.appearance,
		videoPlaybackRef: input.videoPlaybackRef,
		pendingFreshRecordingAutoZoomPathRef: input.pendingFreshRecordingAutoZoomPathRef,
		hasUnsavedChanges,
		setIsPlaying: input.setIsPlaying,
		setCurrentTime: input.setCurrentTime,
		setDuration: input.setDuration,
		applyLoadedProject: lifecycle.applyLoadedProject,
		openUnsavedChangesDialog: lifecycle.openUnsavedChangesDialog,
		saveProject: saveActions.saveProject,
		refreshProjectLibrary: input.refreshProjectLibrary,
		resetSourceScopedEditorState: lifecycle.resetSourceScopedEditorState,
		applySessionPresentation: input.applySessionPresentation,
		handleSaveProject: saveActions.handleSaveProject,
		handleSaveProjectAs: saveActions.handleSaveProjectAs,
	});

	return {
		snapshot,
		history,
		lifecycle,
		autoCaption,
		saveActions,
		openActions,
		hasUnsavedChanges,
	};
}
