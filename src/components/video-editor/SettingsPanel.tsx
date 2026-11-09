import { Card } from "@heroui/react";
import { useMemo, useRef, useState } from "react";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Palette } from "@/components/ui/icons";
import { AnnotationSettingsPanel } from "@/components/video-editor/AnnotationSettingsPanel";
import { loadEditorPreferences } from "@/components/video-editor/editorPreferences";
import { CaptionGenerationSettings } from "@/components/video-editor/settings/CaptionGenerationSettings";
import { WebcamSettings } from "@/components/video-editor/settings/WebcamSettings";
import type { EditorEffectSection } from "@/components/video-editor/types";
import { AppSettings, appSettingsKeys as appSettingsKeysForView } from "./settings/AppSettings";
import { AudioSettings, audioSettingsKeys } from "./settings/AudioSettings";
import { BackgroundDetails, backgroundDetailsKeys } from "./settings/BackgroundDetails";
import {
	BackgroundSettings,
	backgroundSettingsKeys as backgroundSettingsKeysForView,
} from "./settings/BackgroundSettings";
import { CaptionItemSettings, captionItemSettingsKeys } from "./settings/CaptionItemSettings";
import { ClipSettings, clipSettingsKeys } from "./settings/ClipSettings";
import { CropSettings, cropSettingsKeys } from "./settings/CropSettings";
import {
	CursorSettings,
	cursorSettingsKeys as cursorSettingsKeysForView,
} from "./settings/CursorSettings";
import { developerMotionSettingsKeys } from "./settings/DeveloperMotionSettings";
import {
	FrameSettings,
	frameSettingsKeys as frameSettingsKeysForView,
} from "./settings/FrameSettings";
import { SettingsPanelShell, settingsPanelShellKeys } from "./settings/SettingsPanelShell";
import { pickSettingsProps, resolveSettingsPanelProps } from "./settings/settingsPanelDefaults";
import type { SettingsPanelProps } from "./settings/settingsPanelProps";
import { appSettingsKeys, useAppSettings } from "./settings/useAppSettings";
import { backgroundSettingsKeys, useBackgroundSettings } from "./settings/useBackgroundSettings";
import { cursorSettingsKeys, useCursorSettings } from "./settings/useCursorSettings";
import { frameSettingsKeys, useFrameSettings } from "./settings/useFrameSettings";
import { useScrollFade } from "./settings/useScrollFade";
import { useSettingsTranslations } from "./settings/useSettingsTranslations";
import { ZoomSettings, zoomSettingsKeys } from "./settings/ZoomSettings";
import { getPreviewPlaybackRateRange } from "./videoPlayback/playbackRate";

export function SettingsPanel(input: SettingsPanelProps) {
	const props = resolveSettingsPanelProps(input);
	const {
		panelMode,
		activeEffectSection: activeEffectSectionProp,
		selectedAnnotationId,
		annotationRegions,
		onAnnotationContentChange,
		onAnnotationTypeChange,
		onAnnotationStyleChange,
		onAnnotationFigureDataChange,
		onAnnotationBlurIntensityChange,
		onAnnotationBlurColorChange,
		onAnnotationDelete,
		advanced,
	} = props;
	const { tSettings } = useSettingsTranslations();
	const isBackgroundPanel = panelMode === "background";
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const clipSpeedRange = useMemo(getPreviewPlaybackRateRange, []);
	const [internalActiveEffectSection] = useState<EditorEffectSection>("scene");
	const activeEffectSection = activeEffectSectionProp ?? internalActiveEffectSection;
	const background = useBackgroundSettings(
		pickSettingsProps(props, backgroundSettingsKeys),
		initialEditorPreferences,
		isBackgroundPanel ||
			["scene", "frame", "crop", "extensions"].includes(activeEffectSection) ||
			activeEffectSection.startsWith("ext:"),
	);
	const frame = useFrameSettings(
		pickSettingsProps(props, frameSettingsKeys),
		initialEditorPreferences,
	);
	const cursor = useCursorSettings(pickSettingsProps(props, cursorSettingsKeys));
	const app = useAppSettings(pickSettingsProps(props, appSettingsKeys));
	const {
		webcam,
		webcamPreviewSrc,
		webcamPreviewCurrentTime,
		webcamPreviewPlaying,
		onWebcamChange,
		onUploadWebcam,
		autoCaptions,
		autoCaptionSettings,
		captionModelId,
		captionModelLoading,
		onCaptionModelChange,
		whisperModelPath,
		whisperModelDownloadStatus,
		whisperModelDownloadProgress,
		isGeneratingCaptions,
		onAutoCaptionSettingsChange,
		onPickWhisperModel,
		onGenerateAutoCaptions,
		onClearAutoCaptions,
		onDownloadWhisperSmallModel,
		onDeleteWhisperSmallModel,
	} = props;
	const backgroundScrollRef = useRef<HTMLDivElement>(null);
	const backgroundScrollFade = useScrollFade(backgroundScrollRef, isBackgroundPanel);
	const backgroundSettingsContent = (
		<BackgroundSettings
			{...pickSettingsProps(props, backgroundSettingsKeysForView)}
			background={background}
		/>
	);
	const backgroundDetails = (
		<BackgroundDetails {...pickSettingsProps(props, backgroundDetailsKeys)} />
	);
	// Find selected annotation
	const selectedAnnotation = selectedAnnotationId
		? annotationRegions.find((a) => a.id === selectedAnnotationId)
		: null;
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
			<Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden rounded-none bg-transparent p-0 shadow-none">
				<div
					className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-6 pt-1 scroll-shadow scroll-shadow--vertical scroll-shadow--fade scroll-shadow--hide-scrollbar [--scroll-shadow-size:16px]"
					ref={backgroundScrollRef}
					data-scroll-shadow-mode={backgroundScrollFade}
					style={{ scrollbarGutter: "stable" }}
				>
					<div className="mb-4 flex items-center gap-2">
						<Palette className="w-4 h-4 text-accent" />
						<span className="text-sm font-medium text-foreground">
							{tSettings("background.title")}
						</span>
					</div>
					{backgroundSettingsContent}
					{backgroundDetails}
				</div>
			</Card>
		);
	}
	const sceneSectionContent = (
		<div className="space-y-5">
			{backgroundSettingsContent}
			<FrameSettings {...pickSettingsProps(props, frameSettingsKeysForView)} frame={frame} />
			{advanced && (
				<Accordion>
					<AccordionItem id="crop-details">
						<AccordionTrigger>
							{tSettings("crop.details", "Crop details")}
						</AccordionTrigger>
						<AccordionContent>
							<CropSettings {...pickSettingsProps(props, cropSettingsKeys)} />
						</AccordionContent>
					</AccordionItem>
				</Accordion>
			)}
		</div>
	);
	const effectSectionContent = (() => {
		switch (activeEffectSection) {
			case "settings":
				return (
					<AppSettings
						{...pickSettingsProps(props, appSettingsKeysForView)}
						{...pickSettingsProps(props, developerMotionSettingsKeys)}
						app={app}
					/>
				);
			case "zoom":
				return <ZoomSettings {...pickSettingsProps(props, zoomSettingsKeys)} />;
			case "clip":
				return (
					<ClipSettings
						{...pickSettingsProps(props, clipSettingsKeys)}
						clipSpeedRange={clipSpeedRange}
					/>
				);
			case "audio":
				return <AudioSettings {...pickSettingsProps(props, audioSettingsKeys)} />;
			case "caption":
				return (
					<CaptionItemSettings {...pickSettingsProps(props, captionItemSettingsKeys)} />
				);
			case "cursor":
				return (
					<CursorSettings
						{...pickSettingsProps(props, cursorSettingsKeysForView)}
						cursor={cursor}
					/>
				);
			case "captions":
				return (
					<CaptionGenerationSettings
						advanced={advanced}
						captionCueCount={autoCaptions.length}
						autoCaptionSettings={autoCaptionSettings}
						captionModelId={captionModelId}
						captionModelLoading={captionModelLoading}
						onCaptionModelChange={onCaptionModelChange}
						whisperModelPath={whisperModelPath}
						whisperModelDownloadStatus={whisperModelDownloadStatus}
						whisperModelDownloadProgress={whisperModelDownloadProgress}
						isGeneratingCaptions={isGeneratingCaptions}
						onAutoCaptionSettingsChange={onAutoCaptionSettingsChange}
						onPickWhisperModel={onPickWhisperModel}
						onGenerateAutoCaptions={onGenerateAutoCaptions}
						onClearAutoCaptions={onClearAutoCaptions}
						onDownloadWhisperSmallModel={onDownloadWhisperSmallModel}
						onDeleteWhisperSmallModel={onDeleteWhisperSmallModel}
					/>
				);
			case "webcam":
				return (
					<WebcamSettings
						advanced={advanced}
						webcam={webcam}
						webcamPreviewSrc={webcamPreviewSrc}
						webcamPreviewCurrentTime={webcamPreviewCurrentTime}
						webcamPreviewPlaying={webcamPreviewPlaying}
						onWebcamChange={onWebcamChange}
						onUploadWebcam={onUploadWebcam}
					/>
				);
			default:
				return sceneSectionContent;
		}
	})();
	return (
		<SettingsPanelShell
			{...pickSettingsProps(props, settingsPanelShellKeys)}
			activeEffectSection={activeEffectSection}
		>
			{effectSectionContent}
		</SettingsPanelShell>
	);
}
