import { Palette } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { extensionHost } from "@/lib/extensions";
import type { AspectRatio } from "@/utils/aspectRatioUtils";
import { useScopedT } from "../../contexts/I18nContext";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { ExtensionSettingsSection } from "./ExtensionSettingsSection";
import { SectionLabel } from "./settingsPanelConstants";
import { BackgroundSection } from "./settings/BackgroundSection";
import { CaptionsSection } from "./settings/CaptionsSection";
import { ClipSection } from "./settings/ClipSection";
import { CursorSection } from "./settings/CursorSection";
import { FrameSection } from "./settings/FrameSection";
import { GeneralSettingsSection } from "./settings/GeneralSettingsSection";
import { WebcamSection } from "./settings/WebcamSection";
import { ZoomSection } from "./settings/ZoomSection";
import type {
	AnnotationRegion,
	AnnotationType,
	AutoCaptionSettings,
	CaptionCue,
	CropRegion,
	CursorStyle,
	EditorEffectSection,
	FigureData,
	WebcamOverlaySettings,
	ZoomDepth,
	ZoomMode,
	ZoomTransitionEasing,
} from "./types";
import {
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_CURSOR_SWAY,
} from "./types";

interface SettingsPanelProps {
	panelMode?: "editor" | "background";
	activeEffectSection?: EditorEffectSection;
	selected: string;
	onWallpaperChange: (path: string) => void;
	selectedZoomDepth?: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	selectedZoomId?: string | null;
	selectedZoomMode?: ZoomMode | null;
	onZoomModeChange?: (mode: ZoomMode) => void;
	onZoomDelete?: (id: string) => void;
	selectedClipId?: string | null;
	selectedClipSpeed?: number | null;
	selectedClipMuted?: boolean | null;
	onClipSpeedChange?: (speed: number) => void;
	onClipMutedChange?: (muted: boolean) => void;
	onClipDelete?: (id: string) => void;
	shadowIntensity?: number;
	onShadowChange?: (intensity: number) => void;
	backgroundBlur?: number;
	onBackgroundBlurChange?: (amount: number) => void;
	zoomMotionBlur?: number;
	onZoomMotionBlurChange?: (amount: number) => void;
	connectZooms?: boolean;
	onConnectZoomsChange?: (enabled: boolean) => void;
	autoApplyFreshRecordingAutoZooms?: boolean;
	onAutoApplyFreshRecordingAutoZoomsChange?: (enabled: boolean) => void;
	zoomInDurationMs?: number;
	onZoomInDurationMsChange?: (duration: number) => void;
	zoomInOverlapMs?: number;
	onZoomInOverlapMsChange?: (duration: number) => void;
	zoomOutDurationMs?: number;
	onZoomOutDurationMsChange?: (duration: number) => void;
	connectedZoomGapMs?: number;
	onConnectedZoomGapMsChange?: (duration: number) => void;
	connectedZoomDurationMs?: number;
	onConnectedZoomDurationMsChange?: (duration: number) => void;
	zoomInEasing?: ZoomTransitionEasing;
	onZoomInEasingChange?: (easing: ZoomTransitionEasing) => void;
	zoomOutEasing?: ZoomTransitionEasing;
	onZoomOutEasingChange?: (easing: ZoomTransitionEasing) => void;
	connectedZoomEasing?: ZoomTransitionEasing;
	onConnectedZoomEasingChange?: (easing: ZoomTransitionEasing) => void;
	showCursor?: boolean;
	onShowCursorChange?: (enabled: boolean) => void;
	loopCursor?: boolean;
	onLoopCursorChange?: (enabled: boolean) => void;
	cursorStyle?: CursorStyle;
	onCursorStyleChange?: (style: CursorStyle) => void;
	cursorSize?: number;
	onCursorSizeChange?: (size: number) => void;
	cursorSmoothing?: number;
	onCursorSmoothingChange?: (smoothing: number) => void;
	zoomSmoothness?: number;
	onZoomSmoothnessChange?: (smoothness: number) => void;
	zoomClassicMode?: boolean;
	onZoomClassicModeChange?: (enabled: boolean) => void;
	cursorMotionBlur?: number;
	onCursorMotionBlurChange?: (amount: number) => void;
	cursorClickBounce?: number;
	onCursorClickBounceChange?: (amount: number) => void;
	cursorClickBounceDuration?: number;
	onCursorClickBounceDurationChange?: (duration: number) => void;
	cursorSway?: number;
	onCursorSwayChange?: (amount: number) => void;
	borderRadius?: number;
	onBorderRadiusChange?: (radius: number) => void;
	webcam?: WebcamOverlaySettings;
	onWebcamChange?: (webcam: WebcamOverlaySettings) => void;
	onUploadWebcam?: () => void;
	onClearWebcam?: () => void;
	padding?: number;
	onPaddingChange?: (padding: number) => void;
	frame?: string | null;
	onFrameChange?: (frameId: string | null) => void;
	cropRegion?: CropRegion;
	onCropChange?: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
	onAspectRatioChange?: (ratio: AspectRatio) => void;
	selectedAnnotationId?: string | null;
	annotationRegions?: AnnotationRegion[];
	onAnnotationContentChange?: (id: string, content: string) => void;
	onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
	onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion["style"]>) => void;
	onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
	onAnnotationBlurIntensityChange?: (id: string, intensity: number) => void;
	onAnnotationBlurColorChange?: (id: string, color: string) => void;
	onAnnotationDelete?: (id: string) => void;
	autoCaptions?: CaptionCue[];
	autoCaptionSettings?: AutoCaptionSettings;
	whisperExecutablePath?: string | null;
	whisperModelPath?: string | null;
	whisperModelDownloadStatus?: "idle" | "downloading" | "downloaded" | "error";
	whisperModelDownloadProgress?: number;
	isGeneratingCaptions?: boolean;
	onAutoCaptionSettingsChange?: (settings: AutoCaptionSettings) => void;
	onPickWhisperExecutable?: () => void;
	onPickWhisperModel?: () => void;
	onGenerateAutoCaptions?: () => void;
	onClearAutoCaptions?: () => void;
	onDownloadWhisperSmallModel?: () => void;
	onDeleteWhisperSmallModel?: () => void;
}

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
	onClipSpeedChange,
	onClipMutedChange,
	onClipDelete,
	shadowIntensity = 0.67,
	onShadowChange,
	backgroundBlur = 0,
	onBackgroundBlurChange,
	zoomMotionBlur = 0,
	onZoomMotionBlurChange,
	connectZooms = true,
	onConnectZoomsChange,
	autoApplyFreshRecordingAutoZooms = true,
	onAutoApplyFreshRecordingAutoZoomsChange,
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
	zoomSmoothness = 0.5,
	onZoomSmoothnessChange,
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
	onWebcamChange,
	onUploadWebcam,
	onClearWebcam,
	padding = 50,
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
}: SettingsPanelProps) {
	const tSettings = useScopedT("settings");
	const isBackgroundPanel = panelMode === "background";

	const [internalActiveEffectSection] = useState<EditorEffectSection>("scene");
	const activeEffectSection = activeEffectSectionProp ?? internalActiveEffectSection;

	const [extensionPanels, setExtensionPanels] = useState<
		ReturnType<typeof extensionHost.getSettingsPanels>
	>([]);
	useEffect(() => {
		const update = () => setExtensionPanels(extensionHost.getSettingsPanels());
		update();
		return extensionHost.onChange(update);
	}, []);

	const renderExtensionPanelsForSections = (...sections: string[]) =>
		extensionPanels
			.filter((panel) => {
				const parentSection = panel.panel.parentSection;
				return parentSection ? sections.includes(parentSection) : false;
			})
			.map((panel) => (
				<ExtensionSettingsSection
					key={`${panel.extensionId}/${panel.panel.id}`}
					extensionId={panel.extensionId}
					label={panel.panel.label}
					fields={panel.panel.fields}
				/>
			));

	const selectedAnnotation = selectedAnnotationId
		? annotationRegions.find((a) => a.id === selectedAnnotationId)
		: null;

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
					<BackgroundSection
						selected={selected}
						onWallpaperChange={onWallpaperChange}
						backgroundBlur={backgroundBlur}
						onBackgroundBlurChange={onBackgroundBlurChange}
					/>
				</div>
			</div>
		);
	}

	const sceneSectionContent = (
		<div className="space-y-4">
			<BackgroundSection
				selected={selected}
				onWallpaperChange={onWallpaperChange}
				backgroundBlur={backgroundBlur}
				onBackgroundBlurChange={onBackgroundBlurChange}
			/>
			<FrameSection
				shadowIntensity={shadowIntensity}
				onShadowChange={onShadowChange}
				borderRadius={borderRadius}
				onBorderRadiusChange={onBorderRadiusChange}
				padding={padding}
				onPaddingChange={onPaddingChange}
				frame={frame}
				onFrameChange={onFrameChange}
				aspectRatio={aspectRatio}
				onAspectRatioChange={onAspectRatioChange}
				cropRegion={cropRegion}
				onCropChange={onCropChange}
			/>
			{renderExtensionPanelsForSections("scene", "appearance", "frame", "crop")}
		</div>
	);

	const effectSectionContent = (() => {
		switch (activeEffectSection) {
			case "settings":
				return (
					<GeneralSettingsSection
						connectZooms={connectZooms}
						onConnectZoomsChange={onConnectZoomsChange}
						autoApplyFreshRecordingAutoZooms={autoApplyFreshRecordingAutoZooms}
						onAutoApplyFreshRecordingAutoZoomsChange={onAutoApplyFreshRecordingAutoZoomsChange}
					/>
				);
			case "scene":
			case "frame":
			case "crop":
				return sceneSectionContent;
			case "zoom":
				return (
					<ZoomSection
						selectedZoomId={selectedZoomId}
						selectedZoomDepth={selectedZoomDepth}
						onZoomDepthChange={onZoomDepthChange}
						selectedZoomMode={selectedZoomMode}
						onZoomModeChange={onZoomModeChange}
						onZoomDelete={onZoomDelete}
						zoomMotionBlur={zoomMotionBlur}
						onZoomMotionBlurChange={onZoomMotionBlurChange}
						zoomSmoothness={zoomSmoothness}
						onZoomSmoothnessChange={onZoomSmoothnessChange}
						zoomClassicMode={zoomClassicMode}
						onZoomClassicModeChange={onZoomClassicModeChange}
						extensionContent={renderExtensionPanelsForSections("zoom", "appearance", "frame", "crop")}
					/>
				);
			case "clip":
				return (
					<ClipSection
						selectedClipId={selectedClipId}
						selectedClipSpeed={selectedClipSpeed}
						selectedClipMuted={selectedClipMuted}
						onClipSpeedChange={onClipSpeedChange}
						onClipMutedChange={onClipMutedChange}
						onClipDelete={onClipDelete}
					/>
				);
			case "captions":
				return (
					<CaptionsSection
						autoCaptionSettings={autoCaptionSettings}
						captionCueCount={autoCaptions.length}
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
						extensionContent={renderExtensionPanelsForSections("captions")}
					/>
				);
			case "cursor":
				return (
					<CursorSection
						showCursor={showCursor}
						onShowCursorChange={onShowCursorChange}
						loopCursor={loopCursor}
						onLoopCursorChange={onLoopCursorChange}
						cursorStyle={cursorStyle}
						onCursorStyleChange={onCursorStyleChange}
						cursorSize={cursorSize}
						onCursorSizeChange={onCursorSizeChange}
						cursorSmoothing={cursorSmoothing}
						onCursorSmoothingChange={onCursorSmoothingChange}
						cursorMotionBlur={cursorMotionBlur}
						onCursorMotionBlurChange={onCursorMotionBlurChange}
						cursorClickBounce={cursorClickBounce}
						onCursorClickBounceChange={onCursorClickBounceChange}
						cursorClickBounceDuration={cursorClickBounceDuration}
						onCursorClickBounceDurationChange={onCursorClickBounceDurationChange}
						cursorSway={cursorSway}
						onCursorSwayChange={onCursorSwayChange}
						extensionContent={renderExtensionPanelsForSections("cursor")}
					/>
				);
			case "webcam":
				return (
					<WebcamSection
						webcam={webcam}
						onWebcamChange={onWebcamChange}
						onUploadWebcam={onUploadWebcam}
						onClearWebcam={onClearWebcam}
						extensionContent={renderExtensionPanelsForSections("webcam")}
					/>
				);
			default: {
				if (activeEffectSection?.startsWith("ext:")) {
					const panels = extensionPanels.filter(
						(p) =>
							!p.panel.parentSection &&
							`ext:${p.extensionId}/${p.panel.id}` === activeEffectSection,
					);
					if (panels.length > 0) {
						const p = panels[0];
						return (
							<section className="flex flex-col gap-2">
								<SectionLabel>{p.panel.label}</SectionLabel>
								<ExtensionSettingsSection
									extensionId={p.extensionId}
									label={p.panel.label}
									fields={p.panel.fields}
								/>
							</section>
						);
					}
				}
				return sceneSectionContent;
			}
		}
	})();

	return (
		<div className="flex-[2] w-[332px] min-w-[280px] max-w-[332px] bg-editor-panel rounded-2xl flex flex-col shadow-xl h-full overflow-hidden">
			<div
				className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 pb-0"
				style={{ scrollbarGutter: "stable" }}
			>
				<AnimatePresence mode="wait" initial={false}>
					<motion.div
						key={activeEffectSection}
						initial={{ opacity: 0, y: 8 }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: -8 }}
						transition={{ duration: 0.18, ease: "easeOut" }}
					>
						{effectSectionContent}
					</motion.div>
				</AnimatePresence>
			</div>
		</div>
	);
}
