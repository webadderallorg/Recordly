import { useDeferredValue, useMemo, useState } from "react";
import minimalCursorUrl from "@/assets/cursors/custom/minimal-cursor.svg";
import { useTheme } from "@/contexts/ThemeContext";
import { useI18n, useScopedT } from "../../../contexts/I18nContext";
import { AnnotationSettingsPanel } from "../AnnotationSettingsPanel";
import { loadEditorPreferences, saveEditorPreferences } from "../editorPreferences";
import { SettingsPanelFooterActions } from "./components/SettingsPanelFooterActions";
import { SettingsPanelShell } from "./components/SettingsPanelShell";
import { SettingsSectionRouter } from "./components/SettingsSectionRouter";
import { BUILTIN_CURSOR_STYLE_OPTIONS, GRADIENTS } from "./constants";
import { useSettingsPanel } from "./hooks/useSettingsPanel";
import { createSettingsSectionProps } from "./hooks/useSettingsSectionProps";
import {
	createInvertedPreview,
	createTrimmedSvgPreview,
} from "./utils/cursorPreview";
import { BackgroundSection } from "./sections/BackgroundSection";
import type { SettingsPanelProps } from "./types/SettingsPanelProps";
import type {
	EditorEffectSection,
} from "../types";
import {
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_PADDING,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	DEFAULT_ZOOM_OUT_DURATION_MS,
} from "../types";
import { cursorSetAssets } from "../videoPlayback/uploadedCursorAssets";
import { Palette } from "@phosphor-icons/react";

const tahoeCursorUrl = cursorSetAssets.tahoe.arrow.url;

export function SettingsPanel({
	panelMode = "editor",
	activeEffectSection: activeEffectSectionProp,
	selected,
	onWallpaperChange,
	selectedZoomDepth,
	onZoomDepthChange,
	selectedZoomId,
	selectedZoomMode,
	onZoomModeChange,
	onZoomDelete,
	selectedClipId,
	selectedClipSpeed,
	selectedClipMuted,
	selectedClipShowSourceAudio = false,
	hasClipSourceAudio = false,
	onClipSpeedChange,
	onClipMutedChange,
	onClipShowSourceAudioChange,
	sourceAudioTrackMeta = [],
	sourceAudioTrackSettings = {},
	onSourceAudioTrackVolumeChange,
	onSourceAudioTrackNormalizeChange,
	onClipDelete,
	selectedAudioId,
	selectedAudioVolume,
	selectedAudioNormalize,
	onAudioVolumeChange,
	onAudioNormalizeChange,
	onAudioDelete,
	shadowIntensity = 0.67,
	onShadowChange,
	backgroundBlur = 0,
	onBackgroundBlurChange,
	zoomMotionBlurTuning = DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	onZoomMotionBlurTuningChange,
	connectZooms = true,
	onConnectZoomsChange,
	autoApplyFreshRecordingAutoZooms = true,
	onAutoApplyFreshRecordingAutoZoomsChange,
	zoomInDurationMs = DEFAULT_ZOOM_IN_DURATION_MS,
	onZoomInDurationMsChange,
	zoomOutDurationMs = DEFAULT_ZOOM_OUT_DURATION_MS,
	onZoomOutDurationMsChange,
	showCursor = false,
	onShowCursorChange,
	loopCursor = false,
	onLoopCursorChange,
	cursorStyle = DEFAULT_CURSOR_STYLE,
	onCursorStyleChange,
	cursorSize = 5,
	onCursorSizeChange,
	cursorSmoothing = 2,
	onCursorSmoothingChange,
	cursorSpringStiffnessMultiplier = 1,
	onCursorSpringStiffnessMultiplierChange,
	cursorSpringDampingMultiplier = 1,
	onCursorSpringDampingMultiplierChange,
	cursorSpringMassMultiplier = 1,
	onCursorSpringMassMultiplierChange,
	cameraSpringStiffnessMultiplier = 1,
	onCameraSpringStiffnessMultiplierChange,
	cameraSpringDampingMultiplier = 1.13,
	onCameraSpringDampingMultiplierChange,
	cameraSpringMassMultiplier = 1.12,
	onCameraSpringMassMultiplierChange,
	zoomClassicMode = false,
	onZoomClassicModeChange,
	cursorMotionBlur = DEFAULT_CURSOR_MOTION_BLUR,
	onCursorMotionBlurChange,
	cursorClickBounce = 1,
	onCursorClickBounceChange,
	cursorClickBounceDuration = DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	onCursorClickBounceDurationChange,
	cursorSway = DEFAULT_CURSOR_SWAY,
	onCursorSwayChange,
	borderRadius = 12.5,
	onBorderRadiusChange,
	webcam,
	webcamPreviewSrc = null,
	webcamPreviewCurrentTime = 0,
	webcamPreviewPlaying = false,
	onWebcamChange,
	onUploadWebcam,
	onClearWebcam,
	padding = DEFAULT_PADDING,
	onPaddingChange,
	frame = null,
	onFrameChange,
	cropRegion,
	onCropChange,
	aspectRatio,
	onAspectRatioChange,
	selectedAnnotationId,
	annotationRegions = [],
	onAnnotationContentChange,
	onAnnotationTypeChange,
	onAnnotationStyleChange,
	onAnnotationFigureDataChange,
	onAnnotationBlurIntensityChange,
	onAnnotationBlurColorChange,
	onAnnotationDelete,
	autoCaptions = [],
	autoCaptionSettings = DEFAULT_AUTO_CAPTION_SETTINGS,
	whisperModelPath,
	whisperModelDownloadStatus = "idle",
	whisperModelDownloadProgress = 0,
	isGeneratingCaptions = false,
	onAutoCaptionSettingsChange,
	onPickWhisperModel,
	onGenerateAutoCaptions,
	onClearAutoCaptions,
	onDownloadWhisperSmallModel,
	onDeleteWhisperSmallModel,
	nativeCaptureUnavailableSession = false,
	onOpenNativeCaptureUnavailableModal,
}: SettingsPanelProps) {
	const tSettings = useScopedT("settings");
	const { locale, setLocale, t } = useI18n();
	const { preference: themePreference, setPreference: setThemePreference } = useTheme();
	const isBackgroundPanel = panelMode === "background";
	const {
		initialEditorPreferences,
		customImages,
		fileInputRef,
		customColorInputRef,
		builtInWallpaperPaths,
		extensionWallpaperPaths,
		backgroundTab,
		setBackgroundTab,
		selectedColor,
		setSelectedColor,
		gradient,
		setGradient,
		availableFrames,
		extensionPanels,
		cursorPreviewUrls,
		cursorStyleOptions,
		imageWallpaperTiles,
		videoWallpaperTiles,
		handleImageUpload,
		handleVideoUpload,
		handleRemoveCustomImage,
		isInitialLoading,
	} = useSettingsPanel({
		selected,
		onWallpaperChange,
		loadEditorPreferences,
		saveEditorPreferences,
		tSettings,
		t,
		gradients: GRADIENTS,
		builtInCursorStyleOptions: BUILTIN_CURSOR_STYLE_OPTIONS,
		createTrimmedSvgPreview,
		createInvertedPreview,
		minimalCursorUrl,
		tahoeCursorUrl,
	});
	const captionCueCount = autoCaptions.length;
	const [internalActiveEffectSection] = useState<EditorEffectSection>("scene");
	const activeEffectSection = activeEffectSectionProp ?? internalActiveEffectSection;
	const showDevMotionControls = import.meta.env.DEV;

	// Optimization: Defer the section switch to keep the UI snappy
	const deferredActiveSection = useDeferredValue(activeEffectSection);
	const isSwitchingSection = activeEffectSection !== deferredActiveSection;

	// Find selected annotation
	const selectedAnnotation = selectedAnnotationId
		? annotationRegions.find((a) => a.id === selectedAnnotationId)
		: null;

	const backgroundSettingsContent = useMemo(() => (
		<BackgroundSection
			tSettings={tSettings}
			t={t}
			selected={selected}
			onWallpaperChange={onWallpaperChange}
			backgroundBlur={backgroundBlur}
			onBackgroundBlurChange={onBackgroundBlurChange}
			backgroundTab={backgroundTab}
			setBackgroundTab={setBackgroundTab}
			fileInputRef={fileInputRef}
			handleImageUpload={handleImageUpload}
			customImages={customImages}
			imageWallpaperTiles={imageWallpaperTiles}
			videoWallpaperTiles={videoWallpaperTiles}
			handleVideoUpload={handleVideoUpload}
			handleRemoveCustomImage={handleRemoveCustomImage}
			customColorInputRef={customColorInputRef}
			selectedColor={selectedColor}
			setSelectedColor={setSelectedColor}
			gradient={gradient}
			setGradient={setGradient}
			initialEditorPreferences={initialEditorPreferences}
			builtInWallpaperPaths={builtInWallpaperPaths}
			extensionWallpaperPaths={extensionWallpaperPaths}
			isInitialLoading={isInitialLoading}
		/>
	), [
		tSettings,
		t,
		selected,
		onWallpaperChange,
		backgroundBlur,
		onBackgroundBlurChange,
		backgroundTab,
		setBackgroundTab,
		fileInputRef,
		handleImageUpload,
		customImages,
		imageWallpaperTiles,
		videoWallpaperTiles,
		handleVideoUpload,
		handleRemoveCustomImage,
		customColorInputRef,
		selectedColor,
		setSelectedColor,
		gradient,
		setGradient,
		initialEditorPreferences,
		builtInWallpaperPaths,
		extensionWallpaperPaths,
		isInitialLoading,
	]);

	// If an annotation is selected, show annotation settings instead
	if (
		!isBackgroundPanel &&
		selectedAnnotation &&
		onAnnotationContentChange &&
		onAnnotationTypeChange &&
		onAnnotationStyleChange &&
		onAnnotationDelete
	) {
		return (
			<AnnotationSettingsPanel
				annotation={selectedAnnotation}
				onContentChange={(content) =>
					onAnnotationContentChange(selectedAnnotation.id, content)
				}
				onTypeChange={(type) => onAnnotationTypeChange(selectedAnnotation.id, type)}
				onStyleChange={(style) => onAnnotationStyleChange(selectedAnnotation.id, style)}
				onFigureDataChange={
					onAnnotationFigureDataChange
						? (figureData) =>
								onAnnotationFigureDataChange(selectedAnnotation.id, figureData)
						: undefined
				}
				onBlurIntensityChange={
					onAnnotationBlurIntensityChange
						? (intensity) =>
								onAnnotationBlurIntensityChange(selectedAnnotation.id, intensity)
						: undefined
				}
				onBlurColorChange={
					onAnnotationBlurColorChange
						? (color) => onAnnotationBlurColorChange(selectedAnnotation.id, color)
						: undefined
				}
				onDelete={() => onAnnotationDelete(selectedAnnotation.id)}
			/>
		);
	}

	if (isBackgroundPanel) {
		return (
			<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
				<div
					className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0"
					style={{ scrollbarGutter: "stable" }}
				>
					<div className="mb-4 flex items-center gap-2">
						<Palette className="w-4 h-4 text-[#2563EB]" />
						<span className="text-sm font-medium text-foreground">
							{tSettings("background.title")}
						</span>
					</div>
					{backgroundSettingsContent}
				</div>
			</div>
		);
	}

	const sectionProps = createSettingsSectionProps({
		backgroundProps: {
			tSettings,
			t,
			selected,
			onWallpaperChange,
			backgroundBlur,
			onBackgroundBlurChange,
			backgroundTab,
			setBackgroundTab,
			fileInputRef,
			handleImageUpload,
			customImages,
			imageWallpaperTiles,
			videoWallpaperTiles,
			handleVideoUpload,
			handleRemoveCustomImage,
			customColorInputRef,
			selectedColor,
			setSelectedColor,
			gradient,
			setGradient,
			initialEditorPreferences,
			builtInWallpaperPaths,
			extensionWallpaperPaths,
			isInitialLoading: isInitialLoading || isSwitchingSection,
		},
		frameProps: {
			tSettings,
			t,
			shadowIntensity,
			borderRadius,
			onShadowChange,
			onBorderRadiusChange,
			padding,
			onPaddingChange,
			aspectRatio,
			onAspectRatioChange,
			availableFrames,
			frame,
			onFrameChange,
			initialEditorPreferences,
			isInitialLoading: isSwitchingSection,
		},
		cropProps: {
			tSettings,
			t,
			cropRegion,
			onCropChange,
			isInitialLoading: isSwitchingSection,
		},
		captionsProps: {
			tSettings,
			t,
			autoCaptionSettings,
			defaultAutoCaptionSettings: DEFAULT_AUTO_CAPTION_SETTINGS,
			onAutoCaptionSettingsChange,
			onPickWhisperModel,
			onGenerateAutoCaptions,
			onClearAutoCaptions,
			onDownloadWhisperSmallModel,
			onDeleteWhisperSmallModel,
			whisperModelPath,
			whisperModelDownloadStatus,
			whisperModelDownloadProgress,
			isGeneratingCaptions,
			captionCueCount,
			extensionPanels,
			isInitialLoading: isSwitchingSection,
		},
		zoomProps: {
			tSettings,
			t,
			selectedZoomId,
			selectedZoomDepth,
			selectedZoomMode,
			onZoomModeChange,
			onZoomDepthChange,
			zoomClassicMode,
			onZoomClassicModeChange,
			showDevMotionControls,
			onZoomDelete,
			initialEditorPreferences,
			onZoomMotionBlurTuningChange,
			onCameraSpringStiffnessMultiplierChange,
			onCameraSpringDampingMultiplierChange,
			onCameraSpringMassMultiplierChange,
			onZoomInDurationMsChange,
			onZoomOutDurationMsChange,
			extensionPanels,
			isInitialLoading: isSwitchingSection,
		},
		audioProps: {
			tSettings,
			t,
			selectedAudioVolume,
			selectedAudioNormalize,
			onAudioVolumeChange,
			onAudioNormalizeChange,
			isInitialLoading: isSwitchingSection,
		},
		clipProps: {
			tSettings,
			t,
			selectedClipId,
			selectedClipSpeed,
			selectedClipMuted,
			selectedClipShowSourceAudio,
			hasClipSourceAudio,
			onClipSpeedChange,
			onClipMutedChange,
			onClipShowSourceAudioChange,
			sourceAudioTrackMeta,
			sourceAudioTrackSettings,
			onSourceAudioTrackVolumeChange,
			onSourceAudioTrackNormalizeChange,
			isInitialLoading: isSwitchingSection,
		},
		cursorProps: {
			tSettings,
			t,
			showCursor,
			onShowCursorChange,
			loopCursor,
			onLoopCursorChange,
			cursorStyle,
			onCursorStyleChange,
			cursorStyleOptions,
			cursorPreviewUrls,
			cursorSize,
			onCursorSizeChange,
			onCursorSmoothingChange,
			onCursorSpringStiffnessMultiplierChange,
			onCursorSpringDampingMultiplierChange,
			onCursorSpringMassMultiplierChange,
			cursorMotionBlur,
			onCursorMotionBlurChange,
			cursorClickBounce,
			onCursorClickBounceChange,
			cursorClickBounceDuration,
			onCursorClickBounceDurationChange,
			cursorSway,
			onCursorSwayChange,
			showDevMotionControls,
			initialEditorPreferences,
			extensionPanels,
			isInitialLoading: isSwitchingSection,
		},
		webcamProps: {
			tSettings,
			t,
			webcam,
			webcamPreviewSrc,
			webcamPreviewCurrentTime,
			webcamPreviewPlaying,
			onWebcamChange,
			onUploadWebcam,
			onClearWebcam,
			initialEditorPreferences,
			extensionPanels,
			isInitialLoading: isSwitchingSection,
		},
		generalSettingsProps: {
			t,
			tSettings,
			themePreference,
			setThemePreference,
			locale,
			setLocale,
			autoApplyFreshRecordingAutoZooms,
			onAutoApplyFreshRecordingAutoZoomsChange,
			connectZooms,
			onConnectZoomsChange,
			showDevMotionControls,
			nativeCaptureUnavailableSession,
			onOpenNativeCaptureUnavailableModal,
			zoomInDurationMs,
			onZoomInDurationMsChange,
			zoomOutDurationMs,
			onZoomOutDurationMsChange,
			cursorSize,
			onCursorSizeChange,
			cursorSmoothing,
			onCursorSmoothingChange,
			cursorMotionBlur,
			onCursorMotionBlurChange,
			cursorClickBounce,
			onCursorClickBounceChange,
			cursorClickBounceDuration,
			onCursorClickBounceDurationChange,
			zoomMotionBlurTuning,
			initialEditorPreferences,
			onZoomMotionBlurTuningChange,
			cameraSpringStiffnessMultiplier,
			onCameraSpringStiffnessMultiplierChange,
			cameraSpringDampingMultiplier,
			onCameraSpringDampingMultiplierChange,
			cameraSpringMassMultiplier,
			onCameraSpringMassMultiplierChange,
			cursorSpringStiffnessMultiplier,
			onCursorSpringStiffnessMultiplierChange,
			cursorSpringDampingMultiplier,
			onCursorSpringDampingMultiplierChange,
			cursorSpringMassMultiplier,
			onCursorSpringMassMultiplierChange,
			isInitialLoading: isSwitchingSection,
		},
	});

	return (
		<SettingsPanelShell
			activeEffectSection={activeEffectSection}
			content={
				<SettingsSectionRouter
					activeEffectSection={deferredActiveSection}
					extensionPanels={extensionPanels}
					isInitialLoading={isSwitchingSection}
					{...sectionProps}
				/>
			}
			footer={
				<SettingsPanelFooterActions
					activeEffectSection={activeEffectSection}
					selectedClipId={selectedClipId}
					selectedZoomId={selectedZoomId}
					selectedAudioId={selectedAudioId}
					selectedAnnotationId={selectedAnnotationId}
					onClipDelete={onClipDelete}
					onZoomDelete={onZoomDelete}
					onAudioDelete={onAudioDelete}
					onAnnotationDelete={onAnnotationDelete}
					tSettings={tSettings}
				/>
			}
		/>
	);
}
