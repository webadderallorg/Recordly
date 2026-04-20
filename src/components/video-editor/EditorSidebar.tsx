import {
	Cursor,
	Gear,
	Camera as PhCameraRegular,
	ClosedCaptioning,
	PuzzlePiece,
	Sparkle,
	UserCircle as User,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useMemo } from "react";
import { toast } from "sonner";
import { useI18n } from "@/contexts/I18nContext";
import { ExtensionIcon } from "./ExtensionIcon";
import ExtensionManager from "./ExtensionManager";
import { SettingsPanel } from "./SettingsPanel";
import type { EditorEffectSection } from "./types";
import type { useEditorPreferences } from "./hooks/useEditorPreferences";
import type { useEditorRegions } from "./hooks/useEditorRegions";
import type { useEditorCaptions } from "./hooks/useEditorCaptions";

const PhCursorFill = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<Cursor weight="fill" className={props.className} />
);
const PhCamera = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<PhCameraRegular weight={props.weight ?? "regular"} className={props.className} />
);
const PhCaptions = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<ClosedCaptioning weight={props.weight ?? "regular"} className={props.className} />
);
const PhPuzzle = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<PuzzlePiece weight={props.weight ?? "regular"} className={props.className} />
);
const PhSparkle = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<Sparkle weight={props.weight ?? "regular"} className={props.className} />
);
const PhSettings = (props: { className?: string; weight?: "fill" | "regular" }) => (
	<Gear weight={props.weight ?? "regular"} className={props.className} />
);

type Prefs = ReturnType<typeof useEditorPreferences>;
type Regions = ReturnType<typeof useEditorRegions>;
type Captions = ReturnType<typeof useEditorCaptions>;

interface EditorSidebarProps {
	prefs: Prefs;
	regions: Regions;
	captions: Captions;
	extensionSectionButtons: { id: EditorEffectSection; label: string; icon: string }[];
	handleUploadWebcam: () => Promise<void>;
	handleClearWebcam: () => Promise<void>;
}

export function EditorSidebar({
	prefs,
	regions,
	captions,
	extensionSectionButtons,
	handleUploadWebcam,
	handleClearWebcam,
}: EditorSidebarProps) {
	const { t } = useI18n();

	const editorSectionButtons = useMemo(
		() => [
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: PhSparkle },
			{ id: "cursor" as const, label: t("settings.sections.cursor", "Cursor"), icon: PhCursorFill },
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: PhCamera },
			{ id: "captions" as const, label: t("settings.sections.captions", "Captions"), icon: PhCaptions },
			{ id: "settings" as const, label: t("settings.sections.settings", "Settings"), icon: PhSettings },
			...extensionSectionButtons.map((b) => ({
				...b,
				icon: b.icon || (PhPuzzle as typeof PhPuzzle | string),
			})),
			{ id: "extensions" as const, label: t("settings.sections.extensions", "Extensions"), icon: PhPuzzle },
		],
		[t, extensionSectionButtons],
	);

	return (
		<div className="flex flex-shrink-0 gap-1.5">
			{/* Icon rail */}
			<div className="flex flex-shrink-0 flex-col items-center gap-0.5 px-2 py-2">
				{editorSectionButtons.map((section) => {
					const isActive = prefs.activeEffectSection === section.id;
					return (
						<div key={section.id} className="flex items-center">
							<motion.button
								type="button"
								onClick={() => prefs.setActiveEffectSection(section.id)}
								title={section.label}
								className="group relative flex h-9 w-9 items-center justify-center rounded-lg outline-none focus:outline-none focus-visible:outline-none"
								animate={{ opacity: isActive ? 1 : 0.55 }}
								transition={{ duration: 0.14 }}
							>
								{isActive && (
									<motion.span
										layoutId="rail-active-bg"
										className="absolute inset-0 rounded-lg bg-foreground/[0.08]"
										transition={{ type: "spring", stiffness: 450, damping: 35 }}
									/>
								)}
								<motion.span
									className="relative z-10"
									animate={{
										color: isActive ? "#2563EB" : "hsl(var(--foreground))",
									}}
									transition={{ duration: 0.14 }}
								>
									{typeof section.icon === "string" ? (
										<ExtensionIcon icon={section.icon} className="h-[27px] w-[27px]" />
									) : (
										<section.icon
											className="h-[27px] w-[27px]"
											weight={isActive ? "fill" : "regular"}
										/>
									)}
								</motion.span>
							</motion.button>
							<div className="ml-1.5 h-1.5 w-1.5 flex-shrink-0">
								{isActive && (
									<motion.span
										layoutId="rail-active-dot"
										className="block h-1.5 w-1.5 rounded-full bg-[#2563EB]"
										initial={{ opacity: 0, scale: 0.5 }}
										animate={{ opacity: 1, scale: 1 }}
										exit={{ opacity: 0, scale: 0.5 }}
										transition={{ type: "spring", stiffness: 500, damping: 32 }}
									/>
								)}
							</div>
						</div>
					);
				})}
				<div className="mt-auto pt-3">
					<motion.button
						type="button"
						onClick={() => toast.info("Account coming soon")}
						title="Account"
						className="group relative flex h-9 w-9 items-center justify-center rounded-lg text-foreground/55 outline-none transition hover:text-foreground focus:outline-none focus-visible:outline-none"
						whileHover={{ opacity: 1 }}
						initial={{ opacity: 0.55 }}
					>
						<motion.span className="absolute inset-0 rounded-lg bg-foreground/[0.04] opacity-0 transition group-hover:opacity-100" />
						<User className="relative z-10 h-[22px] w-[22px]" />
					</motion.button>
				</div>
			</div>
			{/* Panel */}
			{prefs.activeEffectSection === "extensions" ? (
				<ExtensionManager />
			) : (
				<SettingsPanel
					panelMode="editor"
					activeEffectSection={prefs.activeEffectSection}
					selected={prefs.wallpaper}
					onWallpaperChange={prefs.setWallpaper}
					selectedZoomDepth={
						regions.selectedZoomId
							? regions.zoomRegions.find((z) => z.id === regions.selectedZoomId)?.depth
							: null
					}
					onZoomDepthChange={(depth) =>
						regions.selectedZoomId && regions.handleZoomDepthChange(depth)
					}
					selectedZoomId={regions.selectedZoomId}
					selectedZoomMode={
						regions.selectedZoomId
							? (regions.zoomRegions.find((z) => z.id === regions.selectedZoomId)?.mode ?? "auto")
							: null
					}
					onZoomModeChange={(mode) =>
						regions.selectedZoomId && regions.handleZoomModeChange(mode)
					}
					onZoomDelete={regions.handleZoomDelete}
					selectedClipId={regions.selectedClipId}
					selectedClipSpeed={
						regions.selectedClipId
							? (regions.clipRegions.find((c) => c.id === regions.selectedClipId)?.speed ?? 1)
							: null
					}
					selectedClipMuted={
						regions.selectedClipId
							? (regions.clipRegions.find((c) => c.id === regions.selectedClipId)?.muted ?? false)
							: null
					}
					onClipSpeedChange={(speed) =>
						regions.selectedClipId && regions.handleClipSpeedChange(speed)
					}
					onClipMutedChange={(muted) =>
						regions.selectedClipId && regions.handleClipMutedChange(muted)
					}
					onClipDelete={regions.handleClipDelete}
					shadowIntensity={prefs.shadowIntensity}
					onShadowChange={prefs.setShadowIntensity}
					backgroundBlur={prefs.backgroundBlur}
					onBackgroundBlurChange={prefs.setBackgroundBlur}
					zoomMotionBlur={prefs.zoomMotionBlur}
					onZoomMotionBlurChange={prefs.setZoomMotionBlur}
					autoApplyFreshRecordingAutoZooms={prefs.autoApplyFreshRecordingAutoZooms}
					onAutoApplyFreshRecordingAutoZoomsChange={prefs.setAutoApplyFreshRecordingAutoZooms}
					connectZooms={prefs.connectZooms}
					onConnectZoomsChange={prefs.setConnectZooms}
					zoomInDurationMs={prefs.zoomInDurationMs}
					onZoomInDurationMsChange={prefs.setZoomInDurationMs}
					zoomInOverlapMs={prefs.zoomInOverlapMs}
					onZoomInOverlapMsChange={prefs.setZoomInOverlapMs}
					zoomOutDurationMs={prefs.zoomOutDurationMs}
					onZoomOutDurationMsChange={prefs.setZoomOutDurationMs}
					connectedZoomGapMs={prefs.connectedZoomGapMs}
					onConnectedZoomGapMsChange={prefs.setConnectedZoomGapMs}
					connectedZoomDurationMs={prefs.connectedZoomDurationMs}
					onConnectedZoomDurationMsChange={prefs.setConnectedZoomDurationMs}
					zoomInEasing={prefs.zoomInEasing}
					onZoomInEasingChange={prefs.setZoomInEasing}
					zoomOutEasing={prefs.zoomOutEasing}
					onZoomOutEasingChange={prefs.setZoomOutEasing}
					connectedZoomEasing={prefs.connectedZoomEasing}
					onConnectedZoomEasingChange={prefs.setConnectedZoomEasing}
					showCursor={prefs.showCursor}
					onShowCursorChange={prefs.setShowCursor}
					loopCursor={prefs.loopCursor}
					onLoopCursorChange={prefs.setLoopCursor}
					cursorStyle={prefs.cursorStyle}
					onCursorStyleChange={prefs.setCursorStyle}
					cursorSize={prefs.cursorSize}
					onCursorSizeChange={prefs.setCursorSize}
					cursorSmoothing={prefs.cursorSmoothing}
					onCursorSmoothingChange={prefs.setCursorSmoothing}
					zoomSmoothness={prefs.zoomSmoothness}
					onZoomSmoothnessChange={prefs.setZoomSmoothness}
					zoomClassicMode={prefs.zoomClassicMode}
					onZoomClassicModeChange={prefs.setZoomClassicMode}
					cursorMotionBlur={prefs.cursorMotionBlur}
					onCursorMotionBlurChange={prefs.setCursorMotionBlur}
					cursorClickBounce={prefs.cursorClickBounce}
					onCursorClickBounceChange={prefs.setCursorClickBounce}
					cursorClickBounceDuration={prefs.cursorClickBounceDuration}
					onCursorClickBounceDurationChange={prefs.setCursorClickBounceDuration}
					cursorSway={prefs.cursorSway}
					onCursorSwayChange={prefs.setCursorSway}
					borderRadius={prefs.borderRadius}
					onBorderRadiusChange={prefs.setBorderRadius}
					webcam={prefs.webcam}
					onWebcamChange={prefs.setWebcam}
					onUploadWebcam={handleUploadWebcam}
					onClearWebcam={handleClearWebcam}
					padding={prefs.padding}
					onPaddingChange={prefs.setPadding}
					frame={prefs.frame}
					onFrameChange={prefs.setFrame}
					cropRegion={prefs.cropRegion}
					onCropChange={prefs.setCropRegion}
					aspectRatio={prefs.aspectRatio}
					onAspectRatioChange={prefs.setAspectRatio}
					selectedAnnotationId={regions.selectedAnnotationId}
					annotationRegions={regions.annotationRegions}
					autoCaptions={captions.autoCaptions}
					autoCaptionSettings={captions.autoCaptionSettings}
					whisperExecutablePath={captions.whisperExecutablePath}
					whisperModelPath={captions.whisperModelPath}
					whisperModelDownloadStatus={captions.whisperModelDownloadStatus}
					whisperModelDownloadProgress={captions.whisperModelDownloadProgress}
					isGeneratingCaptions={captions.isGeneratingCaptions}
					onAutoCaptionSettingsChange={captions.setAutoCaptionSettings}
					onPickWhisperExecutable={captions.handlePickWhisperExecutable}
					onPickWhisperModel={captions.handlePickWhisperModel}
					onGenerateAutoCaptions={captions.handleGenerateAutoCaptions}
					onClearAutoCaptions={captions.handleClearAutoCaptions}
					onDownloadWhisperSmallModel={captions.handleDownloadWhisperSmallModel}
					onDeleteWhisperSmallModel={captions.handleDeleteWhisperSmallModel}
					onAnnotationContentChange={regions.handleAnnotationContentChange}
					onAnnotationTypeChange={regions.handleAnnotationTypeChange}
					onAnnotationStyleChange={regions.handleAnnotationStyleChange}
					onAnnotationFigureDataChange={regions.handleAnnotationFigureDataChange}
					onAnnotationBlurIntensityChange={regions.handleAnnotationBlurIntensityChange}
					onAnnotationBlurColorChange={regions.handleAnnotationBlurColorChange}
					onAnnotationDelete={regions.handleAnnotationDelete}
				/>
			)}
		</div>
	);
}
