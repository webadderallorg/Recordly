import type { ComponentProps, Dispatch, SetStateAction } from "react";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import type { useVideoEditorAudio } from "../audio/useVideoEditorAudio";
import type { useAutoCaptionController } from "../captions/useAutoCaptionController";
import type { useAnnotationRegionCommands } from "../hooks/useAnnotationRegionCommands";
import type { useAudioRegionCommands } from "../hooks/useAudioRegionCommands";
import type { useCaptionCommands } from "../hooks/useCaptionCommands";
import type { useClipRegionCommands } from "../hooks/useClipRegionCommands";
import type { useZoomRegionCommands } from "../hooks/useZoomRegionCommands";
import { SettingsPanel } from "../SettingsPanel";
import type { useAppearanceState } from "../state/useAppearanceState";
import type { useTimelineState } from "../state/useTimelineState";
import type { EditorEffectSection } from "../types";

type Input = {
	activeEffectSection: EditorEffectSection;
	appearance: ReturnType<typeof useAppearanceState>;
	timeline: ReturnType<typeof useTimelineState>;
	audio: ReturnType<typeof useVideoEditorAudio>;
	zoomCommands: ReturnType<typeof useZoomRegionCommands>;
	clipCommands: ReturnType<typeof useClipRegionCommands>;
	audioCommands: ReturnType<typeof useAudioRegionCommands>;
	captionCommands: ReturnType<typeof useCaptionCommands>;
	annotationCommands: ReturnType<typeof useAnnotationRegionCommands>;
	autoCaptionController: ReturnType<typeof useAutoCaptionController>;
	effectiveShowCursor: boolean;
	handleShowCursorChange: (show: boolean) => void;
	currentTime: number;
	isPlaying: boolean;
	aspectRatio: AspectRatio;
	setAspectRatio: Dispatch<SetStateAction<AspectRatio>>;
	whisperExecutablePath: string | null;
	whisperModelPath: string | null;
	whisperModelDownloadStatus: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress: number;
	isGeneratingCaptions: boolean;
	sessionNativeCaptureUnavailable: boolean;
	setNativeCaptureUnavailableModalOpen: Dispatch<SetStateAction<boolean>>;
	handleUploadWebcam: () => void;
	handleClearWebcam: () => void;
};

export function useEditorSettingsPanelProps(input: Input): ComponentProps<typeof SettingsPanel> {
	const {
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
	} = input;
	const selectedZoom = timeline.zoomRegions.find(
		(region) => region.id === timeline.selectedZoomId,
	);
	const selectedClip = timeline.clipRegions.find(
		(region) => region.id === timeline.selectedClipId,
	);
	const selectedAudio = timeline.audioRegions.find(
		(region) => region.id === timeline.selectedAudioId,
	);

	return {
		panelMode: "editor",
		activeEffectSection,
		selected: appearance.wallpaper,
		onWallpaperChange: appearance.setWallpaper,
		selectedZoomDepth: selectedZoom?.depth ?? null,
		onZoomDepthChange: (depth) =>
			timeline.selectedZoomId && zoomCommands.handleZoomDepthChange(depth),
		selectedZoomId: timeline.selectedZoomId,
		selectedZoomMode: selectedZoom?.mode ?? (timeline.selectedZoomId ? "auto" : null),
		onZoomModeChange: (mode) =>
			timeline.selectedZoomId && zoomCommands.handleZoomModeChange(mode),
		onZoomDelete: zoomCommands.handleZoomDelete,
		selectedClipId: timeline.selectedClipId,
		selectedClipSpeed: selectedClip?.speed ?? (timeline.selectedClipId ? 1 : null),
		selectedClipMuted: selectedClip?.muted ?? (timeline.selectedClipId ? false : null),
		selectedClipShowSourceAudio:
			selectedClip?.showSourceAudio ?? (timeline.selectedClipId ? false : null),
		onClipSpeedChange: clipCommands.handleClipSpeedChange,
		onClipMutedChange: clipCommands.handleClipMutedChange,
		onClipShowSourceAudioChange: clipCommands.handleClipShowSourceAudioChange,
		onClipDelete: clipCommands.handleClipDelete,
		hasClipSourceAudio: timeline.hasClipSourceAudio,
		sourceAudioTrackMeta: audio.sourceAudioTrackMeta,
		sourceAudioTrackSettings: audio.selectedClipSourceAudioTrackSettings,
		onSourceAudioTrackVolumeChange: audio.onSelectedClipSourceAudioTrackVolumeChange,
		onSourceAudioTrackNormalizeChange: audio.onSelectedClipSourceAudioTrackNormalizeChange,
		selectedAudioId: timeline.selectedAudioId,
		selectedAudioVolume: selectedAudio?.volume ?? null,
		selectedAudioNormalize:
			selectedAudio?.normalize ?? (timeline.selectedAudioId ? false : null),
		onAudioVolumeChange: audioCommands.handleAudioVolumeChange,
		onAudioNormalizeChange: audioCommands.handleAudioNormalizeChange,
		onAudioDelete: audioCommands.handleAudioDelete,
		shadowIntensity: appearance.shadowIntensity,
		onShadowChange: appearance.setShadowIntensity,
		backgroundBlur: appearance.backgroundBlur,
		onBackgroundBlurChange: appearance.setBackgroundBlur,
		autoApplyFreshRecordingAutoZooms: appearance.autoApplyFreshRecordingAutoZooms,
		onAutoApplyFreshRecordingAutoZoomsChange: appearance.setAutoApplyFreshRecordingAutoZooms,
		connectZooms: appearance.connectZooms,
		onConnectZoomsChange: appearance.setConnectZooms,
		zoomInDurationMs: appearance.zoomInDurationMs,
		onZoomInDurationMsChange: appearance.setZoomInDurationMs,
		zoomInOverlapMs: appearance.zoomInOverlapMs,
		onZoomInOverlapMsChange: appearance.setZoomInOverlapMs,
		zoomOutDurationMs: appearance.zoomOutDurationMs,
		onZoomOutDurationMsChange: appearance.setZoomOutDurationMs,
		connectedZoomGapMs: appearance.connectedZoomGapMs,
		onConnectedZoomGapMsChange: appearance.setConnectedZoomGapMs,
		connectedZoomDurationMs: appearance.connectedZoomDurationMs,
		onConnectedZoomDurationMsChange: appearance.setConnectedZoomDurationMs,
		zoomInEasing: appearance.zoomInEasing,
		onZoomInEasingChange: appearance.setZoomInEasing,
		zoomOutEasing: appearance.zoomOutEasing,
		onZoomOutEasingChange: appearance.setZoomOutEasing,
		connectedZoomEasing: appearance.connectedZoomEasing,
		onConnectedZoomEasingChange: appearance.setConnectedZoomEasing,
		showCursor: effectiveShowCursor,
		onShowCursorChange: handleShowCursorChange,
		loopCursor: appearance.loopCursor,
		onLoopCursorChange: appearance.setLoopCursor,
		cursorStyle: appearance.cursorStyle,
		onCursorStyleChange: appearance.setCursorStyle,
		cursorSize: appearance.cursorSize,
		onCursorSizeChange: appearance.setCursorSize,
		cursorSmoothing: appearance.cursorSmoothing,
		onCursorSmoothingChange: appearance.setCursorSmoothing,
		cursorSpringStiffnessMultiplier: appearance.cursorSpringStiffnessMultiplier,
		onCursorSpringStiffnessMultiplierChange: appearance.setCursorSpringStiffnessMultiplier,
		cursorSpringDampingMultiplier: appearance.cursorSpringDampingMultiplier,
		onCursorSpringDampingMultiplierChange: appearance.setCursorSpringDampingMultiplier,
		cursorSpringMassMultiplier: appearance.cursorSpringMassMultiplier,
		onCursorSpringMassMultiplierChange: appearance.setCursorSpringMassMultiplier,
		cameraSpringStiffnessMultiplier: appearance.cameraSpringStiffnessMultiplier,
		onCameraSpringStiffnessMultiplierChange: appearance.setCameraSpringStiffnessMultiplier,
		cameraSpringDampingMultiplier: appearance.cameraSpringDampingMultiplier,
		onCameraSpringDampingMultiplierChange: appearance.setCameraSpringDampingMultiplier,
		cameraSpringMassMultiplier: appearance.cameraSpringMassMultiplier,
		onCameraSpringMassMultiplierChange: appearance.setCameraSpringMassMultiplier,
		zoomClassicMode: appearance.zoomClassicMode,
		onZoomClassicModeChange: appearance.setZoomClassicMode,
		cursorClickEffect: appearance.cursorClickEffect,
		cursorClickEffectColor: appearance.cursorClickEffectColor,
		onCursorClickEffectChange: appearance.setCursorClickEffect,
		onCursorClickEffectColorChange: appearance.setCursorClickEffectColor,
		cursorClickEffectScale: appearance.cursorClickEffectScale,
		onCursorClickEffectScaleChange: appearance.setCursorClickEffectScale,
		cursorClickEffectOpacity: appearance.cursorClickEffectOpacity,
		onCursorClickEffectOpacityChange: appearance.setCursorClickEffectOpacity,
		cursorClickEffectDurationMs: appearance.cursorClickEffectDurationMs,
		onCursorClickEffectDurationMsChange: appearance.setCursorClickEffectDurationMs,
		cursorClickBounce: appearance.cursorClickBounce,
		onCursorClickBounceChange: appearance.setCursorClickBounce,
		cursorClickBounceDuration: appearance.cursorClickBounceDuration,
		onCursorClickBounceDurationChange: appearance.setCursorClickBounceDuration,
		cursorSway: appearance.cursorSway,
		onCursorSwayChange: appearance.setCursorSway,
		deviceFrame: appearance.deviceFrame,
		onDeviceFrameChange: appearance.setDeviceFrame,
		borderRadius: appearance.borderRadius,
		onBorderRadiusChange: appearance.setBorderRadius,
		webcam: appearance.webcam,
		webcamPreviewSrc: appearance.webcam.sourcePath ? appearance.resolvedWebcamVideoUrl : null,
		webcamPreviewCurrentTime: currentTime,
		webcamPreviewPlaying: isPlaying,
		onWebcamChange: appearance.setWebcam,
		onUploadWebcam: handleUploadWebcam,
		onClearWebcam: handleClearWebcam,
		padding: appearance.padding,
		onPaddingChange: appearance.setPadding,
		cropRegion: appearance.cropRegion,
		onCropChange: appearance.setCropRegion,
		aspectRatio,
		onAspectRatioChange: setAspectRatio,
		selectedAnnotationId: timeline.selectedAnnotationId,
		annotationRegions: timeline.annotationRegions,
		autoCaptions: timeline.autoCaptions,
		autoCaptionSettings: timeline.autoCaptionSettings,
		whisperExecutablePath,
		whisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		onAutoCaptionSettingsChange: timeline.setAutoCaptionSettings,
		onPickWhisperExecutable: autoCaptionController.handlePickWhisperExecutable,
		onPickWhisperModel: autoCaptionController.handlePickWhisperModel,
		onGenerateAutoCaptions: autoCaptionController.handleGenerateAutoCaptions,
		onClearAutoCaptions: captionCommands.handleClearAutoCaptions,
		captionCurrentTimeMs: Math.round(currentTime * 1000),
		selectedCaptionId: timeline.selectedCaptionId,
		onBeginCaptionEdit: captionCommands.handleBeginCaptionEdit,
		onCaptionTextEdit: captionCommands.handleCaptionTextEdit,
		onCaptionRetime: captionCommands.handleCaptionRetime,
		onCaptionSplit: captionCommands.handleCaptionSplit,
		onCaptionMerge: captionCommands.handleCaptionMerge,
		onCaptionDelete: captionCommands.handleCaptionDelete,
		onDownloadWhisperSmallModel: autoCaptionController.handleDownloadWhisperSmallModel,
		onDeleteWhisperSmallModel: autoCaptionController.handleDeleteWhisperSmallModel,
		nativeCaptureUnavailableSession: sessionNativeCaptureUnavailable,
		onOpenNativeCaptureUnavailableModal: () => setNativeCaptureUnavailableModalOpen(true),
		onAnnotationContentChange: annotationCommands.handleAnnotationContentChange,
		onAnnotationTypeChange: annotationCommands.handleAnnotationTypeChange,
		onAnnotationStyleChange: annotationCommands.handleAnnotationStyleChange,
		onAnnotationFigureDataChange: annotationCommands.handleAnnotationFigureDataChange,
		onAnnotationBlurIntensityChange: annotationCommands.handleAnnotationBlurIntensityChange,
		onAnnotationBlurColorChange: annotationCommands.handleAnnotationBlurColorChange,
		onAnnotationDelete: annotationCommands.handleAnnotationDelete,
	};
}
