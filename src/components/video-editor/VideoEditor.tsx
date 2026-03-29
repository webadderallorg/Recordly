import type { Span } from "dnd-timeline";
import {
	Camera,
	Captions,
	Download,
	FolderOpen,
	Languages,
	MousePointer2,
	Music,
	Redo2,
	Save,
	Sparkles,
	Undo2,
	X,
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import {
	calculateOutputDimensions,
	DEFAULT_MP4_CODEC,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	FrameRenderer,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	probeSupportedMp4Dimensions,
	type SupportedMp4Dimensions,
	VideoExporter,
} from "@/lib/exporter";
import { matchesShortcut } from "@/lib/shortcuts";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { resolveAutoCaptionSourcePath } from "./autoCaptionSource";
import { CropControl } from "./CropControl";
import { ExportSettingsMenu } from "./ExportSettingsMenu";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import PlaybackControls from "./PlaybackControls";
import ProjectBrowserDialog, { type ProjectLibraryEntry } from "./ProjectBrowserDialog";
import {
	createProjectData,
	deriveNextId,
	type EditorProjectData,
	fromFileUrl,
	normalizeProjectEditor,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { type EditorEffectSection, SettingsPanel } from "./SettingsPanel";
import {
	APP_HEADER_ACTION_BUTTON_CLASS,
	FeedbackDialog,
	KeyboardShortcutsDialog,
} from "./TutorialHelp";
import TimelineEditor from "./timeline/TimelineEditor";
import {
	detectInteractionCandidates,
	normalizeCursorTelemetry,
} from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type AudioRegion,
	type AutoCaptionSettings,
	type CaptionCue,
	type CropRegion,
	type CursorStyle,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_BLUR_INTENSITY,
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_WEBCAM_OVERLAY,
	DEFAULT_ZOOM_DEPTH,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
	type FigureData,
	type PlaybackSpeed,
	type SpeedRegion,
	type TrimRegion,
	type WebcamOverlaySettings,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
	type ZoomTransitionEasing,
} from "./types";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "./videoPlayback/cursorLoopTelemetry";

type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	selectedZoomId: string | null;
	selectedTrimId: string | null;
	selectedSpeedId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
	selectedCaptionId: string | null;
	masterAudioMuted: boolean;
	masterAudioSoloed: boolean;
	masterAudioVolume: number;
	audioTrackVolume: number;
	isMasterSelected: boolean;
};

type PendingExportSave = {
	fileName: string;
	arrayBuffer: ArrayBuffer;
};

const MP4_EXPORT_FRAME_RATE = 60;

function cloneStructured<T>(value: T): T {
	return globalThis.structuredClone(value);
}

function isComparableObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function areDeepEqual(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}

	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}

		for (let index = 0; index < left.length; index += 1) {
			if (!areDeepEqual(left[index], right[index])) {
				return false;
			}
		}

		return true;
	}

	if (!isComparableObject(left) || !isComparableObject(right)) {
		return false;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (!(key in right) || !areDeepEqual(left[key], right[key])) {
			return false;
		}
	}

	return true;
}

function calculateMp4SourceDimensions(
	sourceWidth: number,
	sourceHeight: number,
	aspectRatio: AspectRatio,
): { width: number; height: number } {
	const safeSourceWidth = Math.max(2, Math.floor(sourceWidth / 2) * 2);
	const safeSourceHeight = Math.max(2, Math.floor(sourceHeight / 2) * 2);
	const sourceAspectRatio = safeSourceHeight > 0 ? safeSourceWidth / safeSourceHeight : 16 / 9;
	const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);

	if (aspectRatio === "native") {
		return { width: safeSourceWidth, height: safeSourceHeight };
	}

	if (aspectRatioValue === 1) {
		const baseDimension = Math.max(
			2,
			Math.floor(Math.min(safeSourceWidth, safeSourceHeight) / 2) * 2,
		);
		return { width: baseDimension, height: baseDimension };
	}

	if (aspectRatioValue > 1) {
		const baseWidth = safeSourceWidth;
		for (let width = baseWidth; width >= 100; width -= 2) {
			const height = Math.round(width / aspectRatioValue);
			if (height % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
				return { width, height };
			}
		}

		return {
			width: baseWidth,
			height: Math.max(2, Math.floor(baseWidth / aspectRatioValue / 2) * 2),
		};
	}

	const baseHeight = safeSourceHeight;
	for (let height = baseHeight; height >= 100; height -= 2) {
		const width = Math.round(height * aspectRatioValue);
		if (width % 2 === 0 && Math.abs(width / height - aspectRatioValue) < 0.0001) {
			return { width, height };
		}
	}

	return {
		height: baseHeight,
		width: Math.max(2, Math.floor((baseHeight * aspectRatioValue) / 2) * 2),
	};
}

function calculateMp4ExportDimensions(
	baseWidth: number,
	baseHeight: number,
	quality: ExportQuality,
): { width: number; height: number } {
	if (quality === "source") {
		return {
			width: Math.max(2, Math.floor(baseWidth / 2) * 2),
			height: Math.max(2, Math.floor(baseHeight / 2) * 2),
		};
	}

	const qualityScale = quality === "medium" ? 0.6 : quality === "good" ? 0.75 : 0.9;
	return {
		width: Math.max(2, Math.floor((baseWidth * qualityScale) / 2) * 2),
		height: Math.max(2, Math.floor((baseHeight * qualityScale) / 2) * 2),
	};
}

function getSourceQualityBitrate(width: number, height: number): number {
	const totalPixels = width * height;
	if (totalPixels > 2560 * 1440) {
		return 80_000_000;
	}
	if (totalPixels > 1920 * 1080) {
		return 50_000_000;
	}
	return 30_000_000;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === "string") {
		return error.replace(/^Error:\s*/i, "");
	}

	return "Something went wrong";
}

function LanguageSwitcher() {
	const { locale, setLocale, t } = useI18n();
	const idx = SUPPORTED_LOCALES.indexOf(locale as (typeof SUPPORTED_LOCALES)[number]);
	const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length] as AppLocale;
	const labels: Record<string, string> = {
		en: "EN",
		es: "ES",
		"zh-CN": "中文",
	};
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onClick={() => setLocale(next)}
			className={APP_HEADER_ACTION_BUTTON_CLASS}
			title={t("common.app.language", "Language")}
			aria-label={t("common.app.language", "Language")}
		>
			<Languages className="h-4 w-4" />
			<span className="font-medium">{labels[locale] ?? locale.toUpperCase()}</span>
		</Button>
	);
}

export default function VideoEditor() {
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [wallpaper, setWallpaper] = useState<string>(initialEditorPreferences.wallpaper);
	const [shadowIntensity, setShadowIntensity] = useState(initialEditorPreferences.shadowIntensity);
	const [backgroundBlur, setBackgroundBlur] = useState(initialEditorPreferences.backgroundBlur);
	const [zoomMotionBlur, setZoomMotionBlur] = useState(initialEditorPreferences.zoomMotionBlur);
	const [connectZooms, setConnectZooms] = useState(initialEditorPreferences.connectZooms);
	const [zoomInDurationMs, setZoomInDurationMs] = useState(
		initialEditorPreferences.zoomInDurationMs ?? DEFAULT_ZOOM_IN_DURATION_MS,
	);
	const [zoomInOverlapMs, setZoomInOverlapMs] = useState(
		initialEditorPreferences.zoomInOverlapMs ?? DEFAULT_ZOOM_IN_OVERLAP_MS,
	);
	const [zoomOutDurationMs, setZoomOutDurationMs] = useState(
		initialEditorPreferences.zoomOutDurationMs ?? DEFAULT_ZOOM_OUT_DURATION_MS,
	);
	const [connectedZoomGapMs, setConnectedZoomGapMs] = useState(
		initialEditorPreferences.connectedZoomGapMs ?? DEFAULT_CONNECTED_ZOOM_GAP_MS,
	);
	const [connectedZoomDurationMs, setConnectedZoomDurationMs] = useState(
		initialEditorPreferences.connectedZoomDurationMs ?? DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	);
	const [zoomInEasing, setZoomInEasing] = useState<ZoomTransitionEasing>(
		initialEditorPreferences.zoomInEasing ?? DEFAULT_ZOOM_IN_EASING,
	);
	const [zoomOutEasing, setZoomOutEasing] = useState<ZoomTransitionEasing>(
		initialEditorPreferences.zoomOutEasing ?? DEFAULT_ZOOM_OUT_EASING,
	);
	const [connectedZoomEasing, setConnectedZoomEasing] = useState<ZoomTransitionEasing>(
		initialEditorPreferences.connectedZoomEasing ?? DEFAULT_CONNECTED_ZOOM_EASING,
	);
	const [showCursor, setShowCursor] = useState(initialEditorPreferences.showCursor);
	const [loopCursor, setLoopCursor] = useState(initialEditorPreferences.loopCursor);
	const [cursorStyle, setCursorStyle] = useState<CursorStyle>(
		initialEditorPreferences.cursorStyle ?? DEFAULT_CURSOR_STYLE,
	);
	const [cursorSize, setCursorSize] = useState(initialEditorPreferences.cursorSize);
	const [cursorSmoothing, setCursorSmoothing] = useState(initialEditorPreferences.cursorSmoothing);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(
		initialEditorPreferences.cursorMotionBlur,
	);
	const [cursorClickBounce, setCursorClickBounce] = useState(
		initialEditorPreferences.cursorClickBounce,
	);
	const [cursorClickBounceDuration, setCursorClickBounceDuration] = useState(
		initialEditorPreferences.cursorClickBounceDuration,
	);
	const [cursorSway, setCursorSway] = useState(initialEditorPreferences.cursorSway);
	const [borderRadius, setBorderRadius] = useState(initialEditorPreferences.borderRadius);
	const [padding, setPadding] = useState(initialEditorPreferences.padding);
	const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
	const [webcam, setWebcam] = useState<WebcamOverlaySettings>(
		initialEditorPreferences.webcam ?? DEFAULT_WEBCAM_OVERLAY,
	);
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
	const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(null);
	const [autoCaptionSettings, setAutoCaptionSettings] = useState<AutoCaptionSettings>(() => ({
		...DEFAULT_AUTO_CAPTION_SETTINGS,
		selectedModel: (initialEditorPreferences.whisperSelectedModel as any) || "small",
	}));
	const [whisperExecutablePath, setWhisperExecutablePath] = useState<string | null>(
		initialEditorPreferences.whisperExecutablePath,
	);
	const [whisperModelPath, setWhisperModelPath] = useState<string | null>(
		initialEditorPreferences.whisperModelPath,
	);
	const [whisperModelDownloadStatus, setWhisperModelDownloadStatus] = useState<
		"idle" | "downloading" | "downloaded" | "error"
	>(initialEditorPreferences.whisperModelPath ? "downloaded" : "idle");
	const [whisperModelDownloadProgress, setWhisperModelDownloadProgress] = useState(0);
	const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
	const [autoCaptionProgress, setAutoCaptionProgress] = useState(0);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [masterAudioMuted, setMasterAudioMuted] = useState(false);
	const [masterAudioSoloed, setMasterAudioSoloed] = useState(false);
	const [masterAudioVolume, setMasterAudioVolume] = useState(1);
	const [audioTrackVolume, setAudioTrackVolume] = useState(1);
	const [isMasterSelected, setIsMasterSelected] = useState(false);
	const [previewVolume, setPreviewVolume] = useState(1);
	const [aspectRatio, setAspectRatio] = useState<AspectRatio>(initialEditorPreferences.aspectRatio);
	const [activeEffectSection, setActiveEffectSection] = useState<EditorEffectSection>("scene");
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		initialEditorPreferences.exportQuality,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(
		initialEditorPreferences.exportFormat,
	);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(
		initialEditorPreferences.gifFrameRate,
	);
	const [gifLoop, setGifLoop] = useState(initialEditorPreferences.gifLoop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
		initialEditorPreferences.gifSizePreset,
	);
	const [exportedFilePath, setExportedFilePath] = useState<string | undefined>(undefined);
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<EditorProjectData | null>(null);
	const [showCropModal, setShowCropModal] = useState(false);
	const [previewVersion, setPreviewVersion] = useState(0);
	const [isAudioEngineReady, setIsAudioEngineReady] = useState(false);

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const masterGainRef = useRef<GainNode | null>(null);
	const audioRegionNodesRef = useRef<Map<string, { source: MediaElementAudioSourceNode; gain: GainNode }>>(new Map());
	const videoAudioNodeRef = useRef<{ source: MediaElementAudioSourceNode; gain: GainNode } | null>(null);
	
	const projectBrowserTriggerRef = useRef<HTMLButtonElement | null>(null);
	const projectBrowserFallbackTriggerRef = useRef<HTMLButtonElement | null>(null);
	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);
	const nextAudioIdRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
	const exporterRef = useRef<VideoExporter | null>(null);
	const autoSuggestedVideoPathRef = useRef<string | null>(null);
	const historyPastRef = useRef<EditorHistorySnapshot[]>([]);
	const historyFutureRef = useRef<EditorHistorySnapshot[]>([]);
	const historyCurrentRef = useRef<EditorHistorySnapshot | null>(null);
	const applyingHistoryRef = useRef(false);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);
	const cropSnapshotRef = useRef<CropRegion | null>(null);
	const mp4SupportRequestRef = useRef(0);
	const [historyVersion, setHistoryVersion] = useState(0);
	const [supportedMp4SourceDimensions, setSupportedMp4SourceDimensions] =
		useState<SupportedMp4Dimensions>({
			width: 1920,
			height: 1080,
			capped: false,
			encoderPath: null,
		});

	const syncHistoryButtons = useCallback(() => {
		setHistoryVersion((version) => version + 1);
	}, []);

	const clearPendingExportSave = useCallback(() => {
		pendingExportSaveRef.current = null;
		setHasPendingExportSave(false);
	}, []);

	const refreshProjectLibrary = useCallback(async () => {
		try {
			const result = await window.electronAPI.listProjectFiles();
			if (!result.success) {
				throw new Error(result.error || "Failed to load project library");
			}

			setProjectLibraryEntries(result.entries);
		} catch (projectLibraryError) {
			console.warn("Unable to refresh project library:", projectLibraryError);
		}
	}, []);

	const captureProjectThumbnail = useCallback(async () => {
		const previewHandle = videoPlaybackRef.current;
		const previewVideo = previewHandle?.video ?? null;
		const previewCanvas = previewHandle?.app?.canvas ?? null;

		if (previewHandle && previewVideo && previewVideo.paused) {
			try {
				await previewHandle.refreshFrame();
				await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
			} catch (thumbnailRefreshError) {
				console.warn(
					"Unable to refresh preview frame before thumbnail capture:",
					thumbnailRefreshError,
				);
			}
		}

		const canvas = document.createElement("canvas");
		const targetWidth = 320;
		const targetHeight = 180;
		canvas.width = targetWidth;
		canvas.height = targetHeight;

		const context = canvas.getContext("2d");
		if (!context) {
			return null;
		}
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = "high";
		context.fillStyle = "#111113";
		context.fillRect(0, 0, targetWidth, targetHeight);

		const previewWidth = previewHandle?.containerRef.current?.clientWidth || 1920;
		const previewHeight = previewHandle?.containerRef.current?.clientHeight || 1080;
		const frameTimestampUs = Math.max(0, Math.round(currentTime * 1_000_000));

		if (previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0) {
			let videoFrame: VideoFrame | null = null;
			let frameRenderer: FrameRenderer | null = null;

			try {
				videoFrame = new VideoFrame(previewVideo, { timestamp: frameTimestampUs });
				frameRenderer = new FrameRenderer({
					width: targetWidth,
					height: targetHeight,
					wallpaper,
					zoomRegions,
					showShadow: shadowIntensity > 0,
					shadowIntensity,
					backgroundBlur,
					zoomMotionBlur,
					connectZooms,
					zoomInDurationMs,
					zoomInOverlapMs,
					zoomOutDurationMs,
					connectedZoomGapMs,
					connectedZoomDurationMs,
					zoomInEasing,
					zoomOutEasing,
					connectedZoomEasing,
					borderRadius,
					padding,
					cropRegion,
					webcam,
					webcamUrl: webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null,
					videoWidth: previewVideo.videoWidth,
					videoHeight: previewVideo.videoHeight,
					annotationRegions,
					autoCaptions,
					autoCaptionSettings,
					speedRegions,
					previewWidth,
					previewHeight,
					cursorTelemetry,
					showCursor,
					cursorStyle,
					cursorSize,
					cursorSmoothing,
					cursorMotionBlur,
					cursorClickBounce,
					cursorClickBounceDuration,
					cursorSway,
				});
				await frameRenderer.initialize();
				await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
				return frameRenderer.getCanvas().toDataURL("image/png");
			} catch (thumbnailRenderError) {
				console.warn("Unable to render thumbnail from composed frame:", thumbnailRenderError);
			} finally {
				videoFrame?.close();
				frameRenderer?.destroy();
			}
		}

		const drawableSource =
			previewCanvas && previewCanvas.width > 0 && previewCanvas.height > 0
				? previewCanvas
				: previewVideo && previewVideo.videoWidth > 0 && previewVideo.videoHeight > 0
					? previewVideo
					: null;

		if (!drawableSource) {
			return null;
		}

		const sourceWidth =
			drawableSource instanceof HTMLVideoElement ? drawableSource.videoWidth : drawableSource.width;
		const sourceHeight =
			drawableSource instanceof HTMLVideoElement
				? drawableSource.videoHeight
				: drawableSource.height;

		if (sourceWidth <= 0 || sourceHeight <= 0) {
			return null;
		}

		const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
		const drawWidth = Math.round(sourceWidth * scale);
		const drawHeight = Math.round(sourceHeight * scale);
		const offsetX = Math.round((targetWidth - drawWidth) / 2);
		const offsetY = Math.round((targetHeight - drawHeight) / 2);

		try {
			context.drawImage(drawableSource, offsetX, offsetY, drawWidth, drawHeight);
			return canvas.toDataURL("image/png");
		} catch (thumbnailError) {
			console.warn("Unable to capture project thumbnail:", thumbnailError);
			return null;
		}
	}, [
		annotationRegions,
		autoCaptionSettings,
		autoCaptions,
		backgroundBlur,
		borderRadius,
		connectZooms,
		connectedZoomDurationMs,
		connectedZoomEasing,
		connectedZoomGapMs,
		cropRegion,
		currentTime,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorMotionBlur,
		cursorSize,
		cursorSmoothing,
		cursorStyle,
		cursorSway,
		cursorTelemetry,
		padding,
		shadowIntensity,
		showCursor,
		speedRegions,
		wallpaper,
		webcam,
		zoomInDurationMs,
		zoomInEasing,
		zoomInOverlapMs,
		zoomMotionBlur,
		zoomOutDurationMs,
		zoomOutEasing,
		zoomRegions,
	]);

	const markExportAsSaving = useCallback(() => {
		setExportProgress((previous) => ({
			currentFrame: previous?.totalFrames ?? previous?.currentFrame ?? 1,
			totalFrames: previous?.totalFrames ?? previous?.currentFrame ?? 1,
			percentage: 100,
			estimatedTimeRemaining: 0,
			phase: "saving",
		}));
	}, []);

	useEffect(() => {
		return () => {
			exporterRef.current?.cancel();
			exporterRef.current = null;
			pendingExportSaveRef.current = null;
		};
	}, []);

	useEffect(() => {
		void refreshProjectLibrary();
	}, [refreshProjectLibrary]);

	const canUndo = historyPastRef.current.length > 0;
	const canRedo = historyFutureRef.current.length > 0;

	void historyVersion;

	const cloneSnapshot = useCallback((snapshot: EditorHistorySnapshot): EditorHistorySnapshot => {
		return cloneStructured(snapshot);
	}, []);

	const gifOutputDimensions = useMemo(
		() =>
			calculateOutputDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				gifSizePreset,
				GIF_SIZE_PRESETS,
			),
		[gifSizePreset],
	);

	const desiredMp4SourceDimensions = useMemo(
		() =>
			calculateMp4SourceDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				aspectRatio,
			),
		[aspectRatio],
	);

	const mp4OutputDimensions = useMemo(() => {
		const baseWidth = supportedMp4SourceDimensions.encoderPath
			? supportedMp4SourceDimensions.width
			: desiredMp4SourceDimensions.width;
		const baseHeight = supportedMp4SourceDimensions.encoderPath
			? supportedMp4SourceDimensions.height
			: desiredMp4SourceDimensions.height;

		return {
			medium: calculateMp4ExportDimensions(baseWidth, baseHeight, "medium"),
			good: calculateMp4ExportDimensions(baseWidth, baseHeight, "good"),
			high: calculateMp4ExportDimensions(baseWidth, baseHeight, "high"),
			source: calculateMp4ExportDimensions(baseWidth, baseHeight, "source"),
		};
	}, [
		desiredMp4SourceDimensions.height,
		desiredMp4SourceDimensions.width,
		supportedMp4SourceDimensions.encoderPath,
		supportedMp4SourceDimensions.height,
		supportedMp4SourceDimensions.width,
	]);

	const ensureSupportedMp4SourceDimensions = useCallback(async () => {
		const result = await probeSupportedMp4Dimensions({
			width: desiredMp4SourceDimensions.width,
			height: desiredMp4SourceDimensions.height,
			frameRate: MP4_EXPORT_FRAME_RATE,
			codec: DEFAULT_MP4_CODEC,
			getBitrate: getSourceQualityBitrate,
		});

		if (!result.encoderPath) {
			throw new Error(
				`Video encoding not supported on this system. Tried codec ${DEFAULT_MP4_CODEC} at up to ${desiredMp4SourceDimensions.width}x${desiredMp4SourceDimensions.height}.`,
			);
		}

		setSupportedMp4SourceDimensions((current) => {
			if (
				current.width === result.width &&
				current.height === result.height &&
				current.capped === result.capped &&
				current.encoderPath?.codec === result.encoderPath?.codec &&
				current.encoderPath?.hardwareAcceleration === result.encoderPath?.hardwareAcceleration
			) {
				return current;
			}

			return result;
		});

		return result;
	}, [desiredMp4SourceDimensions.height, desiredMp4SourceDimensions.width]);

	useEffect(() => {
		let cancelled = false;
		const requestId = mp4SupportRequestRef.current + 1;
		mp4SupportRequestRef.current = requestId;
		setSupportedMp4SourceDimensions({
			width: desiredMp4SourceDimensions.width,
			height: desiredMp4SourceDimensions.height,
			capped: false,
			encoderPath: null,
		});

		void ensureSupportedMp4SourceDimensions()
			.then((result) => {
				if (cancelled || requestId !== mp4SupportRequestRef.current) {
					return;
				}
				setSupportedMp4SourceDimensions(result);
			})
			.catch(() => {
				if (cancelled || requestId !== mp4SupportRequestRef.current) {
					return;
				}
				setSupportedMp4SourceDimensions({
					width: desiredMp4SourceDimensions.width,
					height: desiredMp4SourceDimensions.height,
					capped: false,
					encoderPath: null,
				});
			});

		return () => {
			cancelled = true;
		};
	}, [
		desiredMp4SourceDimensions.height,
		desiredMp4SourceDimensions.width,
		ensureSupportedMp4SourceDimensions,
	]);

	const editorSectionButtons = useMemo(
		() => [
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: Sparkles },
			{
				id: "cursor" as const,
				label: t("settings.sections.cursor", "Cursor"),
				icon: MousePointer2,
			},
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: Camera },
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: Captions,
			},
			{ id: "audio" as const, label: t("settings.sections.audio", "Audio"), icon: Music },
		],
		[t],
	);

	useEffect(() => {
		if (
			activeEffectSection === "zoom" ||
			activeEffectSection === "frame" ||
			activeEffectSection === "crop"
		) {
			setActiveEffectSection("scene");
		}
	}, [activeEffectSection]);

	const buildPersistedEditorState = useCallback(
		(
			editor: Partial<{
				wallpaper: string;
				shadowIntensity: number;
				backgroundBlur: number;
				zoomMotionBlur: number;
				connectZooms: boolean;
				zoomInDurationMs: number;
				zoomInOverlapMs: number;
				zoomOutDurationMs: number;
				connectedZoomGapMs: number;
				connectedZoomDurationMs: number;
				zoomInEasing: ZoomTransitionEasing;
				zoomOutEasing: ZoomTransitionEasing;
				connectedZoomEasing: ZoomTransitionEasing;
				showCursor: boolean;
				loopCursor: boolean;
				cursorStyle: CursorStyle;
				cursorSize: number;
				cursorSmoothing: number;
				cursorMotionBlur: number;
				cursorClickBounce: number;
				cursorClickBounceDuration: number;
				cursorSway: number;
				borderRadius: number;
				padding: number;
				cropRegion: CropRegion;
				webcam: WebcamOverlaySettings;
				zoomRegions: ZoomRegion[];
				trimRegions: TrimRegion[];
				speedRegions: SpeedRegion[];
				annotationRegions: AnnotationRegion[];
				audioRegions: AudioRegion[];
				autoCaptions: CaptionCue[];
				autoCaptionSettings: AutoCaptionSettings;
				aspectRatio: AspectRatio;
				exportQuality: ExportQuality;
				exportFormat: ExportFormat;
				gifFrameRate: GifFrameRate;
				gifLoop: boolean;
				gifSizePreset: GifSizePreset;
			}>,
		) => {
			const { cropRegion: _cropRegion, ...persistedEditor } = editor;
			return persistedEditor;
		},
		[],
	);

	const currentSourcePath = useMemo(
		() => videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null),
		[videoPath, videoSourcePath],
	);

	const projectDisplayName = useMemo(() => {
		const fileName =
			currentProjectPath?.split(/[\\/]/).pop() ?? currentSourcePath?.split(/[\\/]/).pop() ?? "";
		const withoutExtension = fileName.replace(/\.recordly$/i, "").replace(/\.[^.]+$/, "");
		return withoutExtension || t("editor.project.untitled", "Untitled");
	}, [currentProjectPath, currentSourcePath, t]);

	const currentPersistedEditorState = useMemo(
		() =>
			buildPersistedEditorState({
				wallpaper,
				shadowIntensity,
				backgroundBlur,
				zoomMotionBlur,
				connectZooms,
				zoomInDurationMs,
				zoomInOverlapMs,
				zoomOutDurationMs,
				connectedZoomGapMs,
				connectedZoomDurationMs,
				zoomInEasing,
				zoomOutEasing,
				connectedZoomEasing,
				showCursor,
				loopCursor,
				cursorStyle,
				cursorSize,
				cursorSmoothing,
				cursorMotionBlur,
				cursorClickBounce,
				cursorClickBounceDuration,
				cursorSway,
				borderRadius,
				padding,
				webcam,
				zoomRegions,
				trimRegions,
				speedRegions,
				annotationRegions,
				audioRegions,
				autoCaptions,
				autoCaptionSettings,
				aspectRatio,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
			}),
		[
			buildPersistedEditorState,
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			zoomInDurationMs,
			zoomInOverlapMs,
			zoomOutDurationMs,
			connectedZoomGapMs,
			connectedZoomDurationMs,
			zoomInEasing,
			zoomOutEasing,
			connectedZoomEasing,
			showCursor,
			loopCursor,
			cursorStyle,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			borderRadius,
			padding,
			webcam,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			autoCaptionSettings,
			aspectRatio,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
		],
	);

	const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
		return {
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			selectedZoomId,
			selectedTrimId,
			selectedSpeedId,
			selectedAnnotationId,
			selectedAudioId,
			selectedCaptionId,
			masterAudioMuted,
			masterAudioSoloed,
			masterAudioVolume,
			audioTrackVolume,
			isMasterSelected,
		};
	}, [
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		autoCaptions,
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectedAudioId,
		selectedCaptionId,
		masterAudioMuted,
		masterAudioSoloed,
		masterAudioVolume,
		audioTrackVolume,
		isMasterSelected,
	]);

	const applyHistorySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			applyingHistoryRef.current = true;
			setZoomRegions(cloneStructured(snapshot.zoomRegions));
			setTrimRegions(cloneStructured(snapshot.trimRegions));
			setSpeedRegions(cloneStructured(snapshot.speedRegions));
			setAnnotationRegions(cloneStructured(snapshot.annotationRegions));
			setAudioRegions(cloneStructured(snapshot.audioRegions));
			setAutoCaptions(cloneStructured(snapshot.autoCaptions));
			setSelectedZoomId(snapshot.selectedZoomId);
			setSelectedTrimId(snapshot.selectedTrimId);
			setSelectedSpeedId(snapshot.selectedSpeedId);
			setSelectedAnnotationId(snapshot.selectedAnnotationId);
			setSelectedAudioId(snapshot.selectedAudioId);
			setSelectedCaptionId(snapshot.selectedCaptionId);
			setMasterAudioMuted(snapshot.masterAudioMuted);
			setMasterAudioSoloed(snapshot.masterAudioSoloed);
			setMasterAudioVolume(snapshot.masterAudioVolume);
			setAudioTrackVolume(snapshot.audioTrackVolume);
			setIsMasterSelected(snapshot.isMasterSelected);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				snapshot.zoomRegions.map((region: ZoomRegion) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				snapshot.trimRegions.map((region: TrimRegion) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				snapshot.speedRegions.map((region: SpeedRegion) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				snapshot.annotationRegions.map((region: AnnotationRegion) => region.id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				snapshot.audioRegions.map((region: AudioRegion) => region.id),
			);
			nextAnnotationZIndexRef.current =
				snapshot.annotationRegions.reduce((max: number, region: AnnotationRegion) => Math.max(max, region.zIndex), 0) + 1;
		},
		[cloneSnapshot],
	);

	const handleUndo = useCallback(() => {
		if (historyPastRef.current.length === 0) return;

		const current = historyCurrentRef.current ?? cloneSnapshot(buildHistorySnapshot());
		const previous = historyPastRef.current.pop();
		if (!previous) return;

		historyFutureRef.current.push(cloneSnapshot(current));
		historyCurrentRef.current = cloneSnapshot(previous);
		applyHistorySnapshot(previous);
		syncHistoryButtons();
	}, [applyHistorySnapshot, buildHistorySnapshot, cloneSnapshot, syncHistoryButtons]);

	const handleRedo = useCallback(() => {
		if (historyFutureRef.current.length === 0) return;

		const current = historyCurrentRef.current ?? cloneSnapshot(buildHistorySnapshot());
		const next = historyFutureRef.current.pop();
		if (!next) return;

		historyPastRef.current.push(cloneSnapshot(current));
		historyCurrentRef.current = cloneSnapshot(next);
		applyHistorySnapshot(next);
		syncHistoryButtons();
	}, [applyHistorySnapshot, buildHistorySnapshot, cloneSnapshot, syncHistoryButtons]);

	const applyLoadedProject = useCallback(
		async (candidate: unknown, path?: string | null) => {
			if (!validateProjectData(candidate)) {
				return false;
			}

			const project = candidate;
			const sourcePath = fromFileUrl(project.videoPath);
			const normalizedEditor = normalizeProjectEditor(project.editor);

			try {
				videoPlaybackRef.current?.pause();
			} catch {
				// no-op
			}
			setIsPlaying(false);
			setCurrentTime(0);
			setDuration(0);

			setError(null);
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
			setCurrentProjectPath(path ?? null);
			if (normalizedEditor.webcam.sourcePath) {
				await window.electronAPI.setCurrentRecordingSession?.({
					videoPath: sourcePath,
					webcamPath: normalizedEditor.webcam.sourcePath,
				});
			} else {
				await window.electronAPI.setCurrentVideoPath(sourcePath);
			}

			setWallpaper(normalizedEditor.wallpaper);
			setShadowIntensity(normalizedEditor.shadowIntensity);
			setBackgroundBlur(normalizedEditor.backgroundBlur);
			setZoomMotionBlur(normalizedEditor.zoomMotionBlur);
			setConnectZooms(normalizedEditor.connectZooms);
			setZoomInDurationMs(normalizedEditor.zoomInDurationMs);
			setZoomInOverlapMs(normalizedEditor.zoomInOverlapMs);
			setZoomOutDurationMs(normalizedEditor.zoomOutDurationMs);
			setConnectedZoomGapMs(normalizedEditor.connectedZoomGapMs);
			setConnectedZoomDurationMs(normalizedEditor.connectedZoomDurationMs);
			setZoomInEasing(normalizedEditor.zoomInEasing);
			setZoomOutEasing(normalizedEditor.zoomOutEasing);
			setConnectedZoomEasing(normalizedEditor.connectedZoomEasing);
			setShowCursor(normalizedEditor.showCursor);
			setLoopCursor(normalizedEditor.loopCursor);
			setCursorStyle(normalizedEditor.cursorStyle);
			setCursorSize(normalizedEditor.cursorSize);
			setCursorSmoothing(normalizedEditor.cursorSmoothing);
			setCursorMotionBlur(normalizedEditor.cursorMotionBlur);
			setCursorClickBounce(normalizedEditor.cursorClickBounce);
			setCursorClickBounceDuration(normalizedEditor.cursorClickBounceDuration);
			setCursorSway(normalizedEditor.cursorSway);
			setBorderRadius(normalizedEditor.borderRadius);
			setPadding(normalizedEditor.padding);
			setCropRegion(DEFAULT_CROP_REGION);
			setWebcam(normalizedEditor.webcam);
			setZoomRegions(normalizedEditor.zoomRegions);
			setTrimRegions(normalizedEditor.trimRegions);
			setSpeedRegions(normalizedEditor.speedRegions);
			setAnnotationRegions(normalizedEditor.annotationRegions);
			setAudioRegions(normalizedEditor.audioRegions);
			setAutoCaptions(normalizedEditor.autoCaptions);
			setAutoCaptionSettings(normalizedEditor.autoCaptionSettings);
			setAspectRatio(normalizedEditor.aspectRatio);
			setExportQuality(normalizedEditor.exportQuality);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);
			setMasterAudioMuted(normalizedEditor.masterAudioMuted);
			setMasterAudioSoloed(normalizedEditor.masterAudioSoloed);
			setMasterAudioVolume(normalizedEditor.masterAudioVolume);
			setAudioTrackVolume(normalizedEditor.audioTrackVolume);
			setIsMasterSelected(normalizedEditor.isMasterSelected ?? false);

			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				normalizedEditor.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				normalizedEditor.speedRegions.map((region) => region.id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				normalizedEditor.audioRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				normalizedEditor.annotationRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				normalizedEditor.annotationRegions.reduce(
					(max, region) => Math.max(max, region.zIndex),
					0,
				) + 1;

			historyPastRef.current = [];
			historyFutureRef.current = [];
			historyCurrentRef.current = null;
			applyingHistoryRef.current = false;
			syncHistoryButtons();

			setLastSavedSnapshot(
				cloneStructured(createProjectData(sourcePath, buildPersistedEditorState(normalizedEditor))),
			);
			await refreshProjectLibrary();
			return true;
		},
		[buildPersistedEditorState, refreshProjectLibrary, syncHistoryButtons],
	);

	const currentProjectSnapshot = useMemo(() => {
		if (!currentSourcePath) {
			return null;
		}
		return createProjectData(currentSourcePath, currentPersistedEditorState);
	}, [currentPersistedEditorState, currentSourcePath]);

	const syncRecordingSessionWebcam = useCallback(
		async (webcamPath: string | null) => {
			if (!currentSourcePath || !window.electronAPI.setCurrentRecordingSession) {
				return;
			}

			await window.electronAPI.setCurrentRecordingSession({
				videoPath: currentSourcePath,
				webcamPath,
			});
		},
		[currentSourcePath],
	);

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

	const handleUploadWebcam = useCallback(async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (!result.success || !result.path) {
			return;
		}

		setWebcam((prev) => ({
			...prev,
			enabled: true,
			sourcePath: result.path ?? null,
		}));

		await syncRecordingSessionWebcam(result.path);
		toast.success(t("settings.effects.webcamFootageAdded"));
	}, [syncRecordingSessionWebcam, t]);

	const handleClearWebcam = useCallback(async () => {
		setWebcam((prev) => ({
			...prev,
			enabled: false,
			sourcePath: null,
		}));

		await syncRecordingSessionWebcam(null);
		toast.success(t("settings.effects.webcamFootageRemoved"));
	}, [syncRecordingSessionWebcam, t]);

	useEffect(() => {
		const snapshot = buildHistorySnapshot();

		if (!historyCurrentRef.current) {
			historyCurrentRef.current = cloneSnapshot(snapshot);
			syncHistoryButtons();
			return;
		}

		if (applyingHistoryRef.current) {
			historyCurrentRef.current = cloneSnapshot(snapshot);
			applyingHistoryRef.current = false;
			syncHistoryButtons();
			return;
		}

		if (areDeepEqual(historyCurrentRef.current, snapshot)) {
			return;
		}

		historyPastRef.current.push(cloneSnapshot(historyCurrentRef.current));
		if (historyPastRef.current.length > 100) {
			historyPastRef.current.shift();
		}
		historyCurrentRef.current = cloneSnapshot(snapshot);
		historyFutureRef.current = [];
		syncHistoryButtons();
	}, [buildHistorySnapshot, cloneSnapshot, syncHistoryButtons]);

	const hasUnsavedChanges = useMemo(
		() =>
			Boolean(
				currentProjectPath &&
				currentProjectSnapshot &&
				lastSavedSnapshot &&
				!areDeepEqual(currentProjectSnapshot, lastSavedSnapshot),
			),
		[currentProjectPath, currentProjectSnapshot, lastSavedSnapshot],
	);

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setCurrentProjectPath(null);
					setLastSavedSnapshot(null);
					setWebcam((prev) => ({
						...prev,
						enabled: Boolean(sessionResult.session?.webcamPath),
						sourcePath: sessionResult.session?.webcamPath ?? null,
					}));
					return;
				}

				const result = await window.electronAPI.getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setCurrentProjectPath(null);
					setLastSavedSnapshot(null);
					setWebcam((prev) => ({
						...prev,
						enabled: false,
						sourcePath: null,
					}));
				} else {
					setError("No video to load. Please record or select a video.");
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	useEffect(() => {
		saveEditorPreferences({
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			zoomInDurationMs,
			zoomInOverlapMs,
			zoomOutDurationMs,
			connectedZoomGapMs,
			connectedZoomDurationMs,
			zoomInEasing,
			zoomOutEasing,
			connectedZoomEasing,
			showCursor,
			loopCursor,
			cursorStyle,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			borderRadius,
			padding,
			webcam,
			aspectRatio,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			masterAudioMuted,
			masterAudioSoloed,
			whisperExecutablePath,
			whisperModelPath,
			whisperSelectedModel: autoCaptionSettings.selectedModel,
		});
	}, [
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		connectZooms,
		zoomInDurationMs,
		zoomInOverlapMs,
		zoomOutDurationMs,
		connectedZoomGapMs,
		connectedZoomDurationMs,
		zoomInEasing,
		zoomOutEasing,
		connectedZoomEasing,
		showCursor,
		loopCursor,
		cursorStyle,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		borderRadius,
		padding,
		webcam,
		aspectRatio,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		whisperExecutablePath,
		whisperModelPath,
		autoCaptionSettings.selectedModel,
	]);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onWhisperModelDownloadProgress((state) => {
			if (state.model === autoCaptionSettings.selectedModel) {
				setWhisperModelDownloadStatus(state.status);
				setWhisperModelDownloadProgress(state.progress);
			}

			if (state.status === "downloaded") {
				if (state.model === autoCaptionSettings.selectedModel) {
					setWhisperModelPath(state.path ?? null);
				}
			}

			if (state.status === "idle") {
				if (state.model === autoCaptionSettings.selectedModel) {
					setWhisperModelPath(null);
				}
			}

			if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		return () => unsubscribe?.();
	}, [autoCaptionSettings.selectedModel]);

	useEffect(() => {
		const unlistenProgress = window.electronAPI.onAutoCaptionProgress((payload: { progress: number }) => {
			setAutoCaptionProgress(payload.progress);
		});
		const unlistenChunk = window.electronAPI.onAutoCaptionChunk(({ cues }) => {
			setAutoCaptions((prev) => {
				const existingIds = new Set(prev.map((c) => c.id));
				const newCues = cues.filter((c) => !existingIds.has(c.id));
				if (newCues.length === 0) return prev;
				return [...prev, ...newCues].sort((a, b) => a.startMs - b.startMs);
			});
		});
		return () => {
			unlistenProgress();
			unlistenChunk();
		};
	}, []);

	useEffect(() => {
		void (async () => {
			const result = await window.electronAPI.getWhisperModelStatus(
				autoCaptionSettings.selectedModel,
			);
			if (!result.success) {
				return;
			}

			if (result.exists && result.path) {
				setWhisperModelPath((currentPath) => currentPath ?? result.path ?? null);
				setWhisperModelDownloadStatus("downloaded");
				setWhisperModelDownloadProgress(100);
			} else {
				setWhisperModelDownloadStatus("idle");
				setWhisperModelDownloadProgress(0);
			}
		})();
	}, [autoCaptionSettings.selectedModel]);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) {
			return;
		}

		setWhisperExecutablePath(result.path);
		toast.success("Whisper executable selected");
	}, []);

	const handleSelectMaster = useCallback((selected: boolean) => {
		setIsMasterSelected(selected);
		if (selected) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			setSelectedCaptionId(null);
			setActiveEffectSection("audio");
		}
	}, []);

	const handleDownloadWhisperModel = useCallback(async () => {
		if (whisperModelDownloadStatus === "downloading") {
			return;
		}

		setWhisperModelDownloadStatus("downloading");
		setWhisperModelDownloadProgress(0);
		const result = await window.electronAPI.downloadWhisperModel(
			autoCaptionSettings.selectedModel,
		);
		if (!result.success) {
			setWhisperModelDownloadStatus("error");
			toast.error(
				result.error ||
				`Failed to download Whisper ${autoCaptionSettings.selectedModel} model`,
			);
			return;
		}

		if (result.path) {
			setWhisperModelPath(result.path);
		}
	}, [whisperModelDownloadStatus, autoCaptionSettings.selectedModel]);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) {
			return;
		}

		setWhisperModelPath(result.path);
		toast.success("Whisper model selected");
	}, []);

	const handleDeleteWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.deleteWhisperModel(
			autoCaptionSettings.selectedModel,
		);
		if (!result.success) {
			toast.error(
				result.error ||
				`Failed to delete Whisper ${autoCaptionSettings.selectedModel} model`,
			);
			return;
		}

		setWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
		toast.success(`Whisper ${autoCaptionSettings.selectedModel} model deleted`);
	}, [autoCaptionSettings.selectedModel]);

	const handleGenerateAutoCaptions = useCallback(async () => {
		if (isGeneratingCaptions) {
			return;
		}

		let sourcePath = resolveAutoCaptionSourcePath({
			videoSourcePath,
			videoPath,
		});

		if (!sourcePath) {
			const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
			const currentVideoResult = await window.electronAPI.getCurrentVideoPath();
			sourcePath = resolveAutoCaptionSourcePath({
				recordingSessionVideoPath:
					sessionResult?.success && sessionResult.session?.videoPath
						? sessionResult.session.videoPath
						: null,
				currentVideoPath: currentVideoResult.success ? (currentVideoResult.path ?? null) : null,
			});
		}

		if (!sourcePath) {
			toast.error("No source video is loaded");
			return;
		}

		if (sourcePath !== videoSourcePath) {
			setVideoSourcePath(sourcePath);
			setVideoPath(toFileUrl(sourcePath));
		}

		await syncActiveVideoSource(sourcePath, webcam.sourcePath ?? null);

		if (!whisperModelPath) {
			toast.error("Select a Whisper model or download the small model first");
			return;
		}

		console.log("[VideoEditor] handleGenerateAutoCaptions: starting", {
			sourcePath,
			whisperExecutablePath,
			whisperModelPath,
			language: autoCaptionSettings.language,
		});

		setIsGeneratingCaptions(true);
		setAutoCaptionProgress(0);

		const startTimeMs = 0;
		const rangeDurationMs = duration * 1000;

		try {
			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath,
				language: autoCaptionSettings.language,
				durationMs: rangeDurationMs,
				startTimeMs,
			});

			console.log("[VideoEditor] handleGenerateAutoCaptions: result", result);

			if (result.success && result.cues) {
				const cuesWithIds = result.cues.map((cue: CaptionCue) => ({
					...cue,
					id: cue.id || uuidv4(),
				}));
				// Sort cues by time
				cuesWithIds.sort((a, b) => a.startMs - b.startMs);
				setAutoCaptions(cuesWithIds);
				setAutoCaptionSettings((prev) => ({ ...prev, enabled: true }));
				toast.success(`Generated ${cuesWithIds.length} captions`);
			} else if (!result.success) {
				toast.error(
					result.message || getErrorMessage(result.error) || "Failed to generate captions",
				);
			} else {
				toast.error("No captions were generated");
			}
		} catch (error) {
			toast.error(getErrorMessage(error));
		} finally {
			setIsGeneratingCaptions(false);
			setAutoCaptionProgress(0);
		}
	}, [
		autoCaptionSettings.language,
		isGeneratingCaptions,
		videoSourcePath,
		videoPath,
		duration,
		whisperModelPath,
		syncActiveVideoSource,
		webcam.sourcePath,
	]);

	const handleClearAutoCaptions = useCallback(() => {
		setAutoCaptions([]);
		setAutoCaptionSettings((prev) => ({ ...prev, enabled: false }));
	}, []);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!currentSourcePath) {
				toast.error("No video loaded");
				return false;
			}

			const projectData =
				currentProjectSnapshot?.videoPath === currentSourcePath
					? currentProjectSnapshot
					: createProjectData(currentSourcePath, currentPersistedEditorState);

			const fileNameBase =
				currentSourcePath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			let targetProjectPath = forceSaveAs ? undefined : (currentProjectPath ?? undefined);

			if (!forceSaveAs && !targetProjectPath) {
				const activeProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (activeProjectResult.success && activeProjectResult.path) {
					targetProjectPath = activeProjectResult.path;
					setCurrentProjectPath(activeProjectResult.path);
				}
			}

			const thumbnailDataUrl = await captureProjectThumbnail();

			const result = await window.electronAPI.saveProjectFile(
				projectData,
				fileNameBase,
				targetProjectPath,
				thumbnailDataUrl,
			);

			if (result.canceled) {
				toast.info("Project save canceled");
				return false;
			}

			if (!result.success) {
				toast.error(result.message || "Failed to save project");
				return false;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(cloneStructured(projectData));
			await refreshProjectLibrary();

			toast.success(`Project saved to ${result.path}`);
			return true;
		},
		[
			captureProjectThumbnail,
			currentSourcePath,
			currentProjectPath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			refreshProjectLibrary,
		],
	);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			return saveProject(false);
		});

		return () => cleanup?.();
	}, [saveProject]);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		const saved = await saveProject(true);
		if (saved) {
			setProjectBrowserOpen(false);
		}
	}, [saveProject]);

	const handleOpenProjectFromLibrary = useCallback(
		async (projectPath: string) => {
			const result = await window.electronAPI.openProjectFileAtPath(projectPath);

			if (result.canceled) {
				return;
			}

			if (!result.success) {
				toast.error(result.message || "Failed to load project");
				return;
			}

			const restored = await applyLoadedProject(result.project, result.path ?? null);
			if (!restored) {
				toast.error("Invalid project file format");
				return;
			}

			setProjectBrowserOpen(false);
			await refreshProjectLibrary();
			toast.success(`Project loaded from ${result.path}`);
		},
		[applyLoadedProject, refreshProjectLibrary],
	);

	const handleOpenProjectBrowser = useCallback(async () => {
		if (projectBrowserOpen) {
			setProjectBrowserOpen(false);
			return;
		}

		await refreshProjectLibrary();
		setProjectBrowserOpen(true);
	}, [projectBrowserOpen, refreshProjectLibrary]);

	useEffect(() => {
		const removeLoadListener = window.electronAPI.onMenuLoadProject(() => {
			void handleOpenProjectBrowser();
		});
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleOpenProjectBrowser, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		const video = videoPlaybackRef.current?.video;
		if (!video || !audioContextRef.current || (videoAudioNodeRef.current && videoAudioNodeRef.current.source.mediaElement === video)) {
			return;
		}

		try {
			// If we had an old source node for a different video, disconnect it
			if (videoAudioNodeRef.current) {
				videoAudioNodeRef.current.source.disconnect();
				videoAudioNodeRef.current.gain.disconnect();
			}

			const source = audioContextRef.current.createMediaElementSource(video);
			const gain = audioContextRef.current.createGain();
			source.connect(gain);
			gain.connect(masterGainRef.current!);
			videoAudioNodeRef.current = { source, gain };
			console.log("[VideoEditor] Video audio routed through Web Audio API");
		} catch (e) {
			console.warn("[VideoEditor] Could not route video audio", e);
		}
	}, [videoPlaybackRef.current?.video, previewVersion, isAudioEngineReady]);

	useEffect(() => {
		let mounted = true;

		async function loadCursorTelemetry() {
			if (!videoPath) {
				if (mounted) {
					setCursorTelemetry([]);
				}
				return;
			}

			try {
				const result = await window.electronAPI.getCursorTelemetry(fromFileUrl(videoPath));
				if (mounted) {
					setCursorTelemetry(result.success ? result.samples : []);
				}
			} catch (telemetryError) {
				console.warn("Unable to load cursor telemetry:", telemetryError);
				if (mounted) {
					setCursorTelemetry([]);
				}
			}
		}

		loadCursorTelemetry();

		return () => {
			mounted = false;
		};
	}, [videoPath]);

	// Apply master volume to the master gain node
	useEffect(() => {
		if (masterGainRef.current) {
			masterGainRef.current.gain.setTargetAtTime(masterAudioVolume * previewVolume, 0, 0.03);
		}
	}, [masterAudioVolume, previewVolume]);

	// Handle video master solo/mute
	useEffect(() => {
		if (videoAudioNodeRef.current) {
			const hasGlobalSolo = masterAudioSoloed || audioRegions.some((r) => r.soloed);
			let vol = 1;
			if (masterAudioMuted || (hasGlobalSolo && !masterAudioSoloed)) {
				vol = 0;
			}
			videoAudioNodeRef.current.gain.gain.setTargetAtTime(vol, 0, 0.03);
		}
	}, [masterAudioMuted, masterAudioSoloed, audioRegions]);

	const normalizedCursorTelemetry = useMemo(() => {
		if (cursorTelemetry.length === 0) {
			return [] as CursorTelemetryPoint[];
		}

		const totalMs = Math.max(0, Math.round(duration * 1000));
		return normalizeCursorTelemetry(
			cursorTelemetry,
			totalMs > 0 ? totalMs : Number.MAX_SAFE_INTEGER,
		);
	}, [cursorTelemetry, duration]);

	const displayedTimelineWindow = useMemo(() => {
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return getDisplayedTimelineWindowMs(totalMs, trimRegions);
	}, [duration, trimRegions]);

	const effectiveCursorTelemetry = useMemo(() => {
		if (!loopCursor) {
			return normalizedCursorTelemetry;
		}

		if (
			normalizedCursorTelemetry.length < 2 ||
			displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs
		) {
			return normalizedCursorTelemetry;
		}

		return buildLoopedCursorTelemetry(
			normalizedCursorTelemetry,
			displayedTimelineWindow.endMs,
			displayedTimelineWindow.startMs,
		);
	}, [loopCursor, normalizedCursorTelemetry, displayedTimelineWindow]);

	const effectiveZoomRegions = zoomRegions;

	useEffect(() => {
		const suggestionTelemetry = effectiveCursorTelemetry;
		if (
			!videoPath ||
			duration <= 0 ||
			loopCursor ||
			zoomRegions.length > 0 ||
			suggestionTelemetry.length < 2
		) {
			return;
		}

		if (autoSuggestedVideoPathRef.current === videoPath) {
			return;
		}

		const totalMs = Math.max(0, Math.round(duration * 1000));
		if (totalMs <= 0) {
			return;
		}

		const candidates = detectInteractionCandidates(suggestionTelemetry);
		if (candidates.length === 0) {
			autoSuggestedVideoPathRef.current = videoPath;
			return;
		}

		const DEFAULT_DURATION_MS = 1100;
		const MIN_SPACING_MS = 1800;
		const sortedCandidates = [...candidates].sort((a, b) => b.strength - a.strength);
		const acceptedCenters: number[] = [];

		setZoomRegions((prev) => {
			if (prev.length > 0) {
				return prev;
			}

			const reservedSpans: Array<{ start: number; end: number }> = [];
			const additions: ZoomRegion[] = [];
			let nextId = nextZoomIdRef.current;

			sortedCandidates.forEach((candidate) => {
				const tooCloseToAccepted = acceptedCenters.some(
					(center) => Math.abs(center - candidate.centerTimeMs) < MIN_SPACING_MS,
				);
				if (tooCloseToAccepted) {
					return;
				}

				const centeredStart = Math.round(candidate.centerTimeMs - DEFAULT_DURATION_MS / 2);
				const startMs = Math.max(0, Math.min(centeredStart, totalMs - DEFAULT_DURATION_MS));
				const endMs = Math.min(totalMs, startMs + DEFAULT_DURATION_MS);

				const hasOverlap = reservedSpans.some((span) => endMs > span.start && startMs < span.end);
				if (hasOverlap) {
					return;
				}

				additions.push({
					id: `zoom-${nextId++}`,
					startMs,
					endMs,
					depth: DEFAULT_ZOOM_DEPTH,
					focus: clampFocusToDepth(candidate.focus, DEFAULT_ZOOM_DEPTH),
				});
				reservedSpans.push({ start: startMs, end: endMs });
				acceptedCenters.push(candidate.centerTimeMs);
			});

			if (additions.length === 0) {
				return prev;
			}

			nextZoomIdRef.current = nextId;
			return [...prev, ...additions];
		});

		autoSuggestedVideoPathRef.current = videoPath;
	}, [videoPath, duration, effectiveCursorTelemetry, loopCursor, zoomRegions.length]);

	const initAudioContext = useCallback(() => {
		if (audioContextRef.current) {
			if (audioContextRef.current.state === 'suspended') {
				audioContextRef.current.resume().then(() => setIsAudioEngineReady(true));
			}
			return;
		}
		
		try {
			const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
			const masterGain = ctx.createGain();
			masterGain.connect(ctx.destination);
			audioContextRef.current = ctx;
			masterGainRef.current = masterGain;
			setIsAudioEngineReady(true);
			console.log("[VideoEditor] Web Audio API context initialized");
		} catch (e) {
			console.error("[VideoEditor] Failed to initialize AudioContext", e);
		}
	}, []);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		initAudioContext();

		if (!video.paused && !video.ended) {
			playback.pause();
		} else {
			playback.play().catch((err) => console.error("Video play failed:", err));
		}
	}


	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = time;
	}

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setSelectedTrimId(null);
			setSelectedAudioId(null);
			setSelectedSpeedId(null);
			setSelectedAnnotationId(null);
			setSelectedCaptionId(null);
			setIsMasterSelected(false);
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			setSelectedSpeedId(null);
			setSelectedCaptionId(null);
			setIsMasterSelected(false);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAudioId(null);
			setSelectedSpeedId(null);
			setSelectedCaptionId(null);
			setIsMasterSelected(false);
		}
	}, []);

	const handleZoomAdded = useCallback((span: Span) => {
		const id = `zoom-${nextZoomIdRef.current++}`;
		const newRegion: ZoomRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			depth: DEFAULT_ZOOM_DEPTH,
			focus: { cx: 0.5, cy: 0.5 },
		};
		setZoomRegions((prev) => [...prev, newRegion]);
		setSelectedZoomId(id);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
		setSelectedCaptionId(null);
	}, []);

	const handleZoomSuggested = useCallback((span: Span, focus: ZoomFocus) => {
		const id = `zoom-${nextZoomIdRef.current++}`;
		const newRegion: ZoomRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			depth: DEFAULT_ZOOM_DEPTH,
			focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH),
		};
		setZoomRegions((prev) => [...prev, newRegion]);
		setSelectedZoomId(id);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
		setSelectedCaptionId(null);
	}, []);

	const handleTrimAdded = useCallback((span: Span) => {
		const id = `trim-${nextTrimIdRef.current++}`;
		const newRegion: TrimRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
		};
		setTrimRegions((prev) => [...prev, newRegion]);
		setSelectedTrimId(id);
		setSelectedZoomId(null);
		setSelectedAnnotationId(null);
		setSelectedCaptionId(null);
		setIsMasterSelected(false);
	}, []);

	const handleZoomSpanChange = useCallback((id: string, span: Span) => {
		setZoomRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
						...region,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					}
					: region,
			),
		);
	}, []);

	const handleTrimSpanChange = useCallback((id: string, span: Span) => {
		setTrimRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
						...region,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					}
					: region,
			),
		);
	}, []);

	const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
		setZoomRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
						...region,
						focus: clampFocusToDepth(focus, region.depth),
					}
					: region,
			),
		);
	}, []);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			setZoomRegions((prev) =>
				prev.map((region) =>
					region.id === selectedZoomId
						? {
							...region,
							depth,
							focus: clampFocusToDepth(region.focus, depth),
						}
						: region,
				),
			);
		},
		[selectedZoomId],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			setZoomRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			setTrimRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId],
	);

	const handleSelectSpeed = useCallback((id: string | null) => {
		setSelectedSpeedId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
			setSelectedCaptionId(null);
			setIsMasterSelected(false);
		}
	}, []);

	const handleSpeedAdded = useCallback((span: Span) => {
		const id = `speed-${nextSpeedIdRef.current++}`;
		const newRegion: SpeedRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			speed: DEFAULT_PLAYBACK_SPEED,
		};
		setSpeedRegions((prev) => [...prev, newRegion]);
		setSelectedSpeedId(id);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
		setSelectedCaptionId(null);
	}, []);

	const handleSpeedSpanChange = useCallback((id: string, span: Span) => {
		setSpeedRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
						...region,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					}
					: region,
			),
		);
	}, []);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			setSpeedRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId],
	);

	const handleSelectAudio = useCallback((id: string | null) => {
		setSelectedAudioId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
			setSelectedCaptionId(null);
			setIsMasterSelected(false);
			setActiveEffectSection("audio");
		}
	}, []);

	const handleAudioAdded = useCallback((span: Span, audioPath: string) => {
		const id = `audio-${nextAudioIdRef.current++}`;
		const newRegion: AudioRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			audioPath,
			volume: 1,
		};
		setAudioRegions((prev) => [...prev, newRegion]);
		setSelectedAudioId(id);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
		setSelectedSpeedId(null);
		setSelectedCaptionId(null);
		setIsMasterSelected(false);
	}, []);

	const handleAudioSpanChange = useCallback((id: string, span: Span) => {
		setAudioRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
						...region,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					}
					: region,
			),
		);
	}, []);

	const handleAudioDelete = useCallback(
		(id: string) => {
			setAudioRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedAudioId === id) {
				setSelectedAudioId(null);
			}
		},
		[selectedAudioId],
	);

	const handleAudioVolumeChange = useCallback((id: string, volume: number) => {
		setAudioRegions((prev) => prev.map((r) => (r.id === id ? { ...r, volume } : r)));
	}, []);

	const handleAudioMutedChange = useCallback((id: string, muted: boolean) => {
		setAudioRegions((prev) => prev.map((r) => (r.id === id ? { ...r, muted } : r)));
	}, []);

	const handleMasterAudioSoloedChange = useCallback((soloed: boolean) => {
		setMasterAudioSoloed(soloed);
		if (soloed) {
			setAudioRegions((prev) => prev.map((r) => ({ ...r, soloed: false })));
		}
	}, []);

	const handleAudioSoloedChange = useCallback((id: string, soloed: boolean) => {
		if (soloed) {
			setMasterAudioSoloed(false);
			setAudioRegions((prev) =>
				prev.map((r) => (r.id === id ? { ...r, soloed: true } : { ...r, soloed: false })),
			);
		} else {
			setAudioRegions((prev) => prev.map((r) => (r.id === id ? { ...r, soloed: false } : r)));
		}
	}, []);

	const handleAudioFadeInMsChange = useCallback((id: string, fadeInMs: number) => {
		setAudioRegions((prev) => prev.map((r) => (r.id === id ? { ...r, fadeInMs } : r)));
	}, []);

	const handleAudioFadeOutMsChange = useCallback((id: string, fadeOutMs: number) => {
		setAudioRegions((prev) => prev.map((r) => (r.id === id ? { ...r, fadeOutMs } : r)));
	}, []);

	const handleCaptionSpanChange = useCallback((id: string, span: Span) => {
		setAutoCaptions((prev) =>
			prev.map((caption) =>
				caption.id === id
					? {
						...caption,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					}
					: caption,
			),
		);
	}, []);

	const handleSelectCaption = useCallback((id: string | null) => {
		setSelectedCaptionId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
			setSelectedAudioId(null);
			setIsMasterSelected(false);
		}
	}, []);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			setSpeedRegions((prev) =>
				prev.map((region) => (region.id === selectedSpeedId ? { ...region, speed } : region)),
			);
		},
		[selectedSpeedId],
	);

	const handleAnnotationAdded = useCallback((span: Span) => {
		const id = `annotation-${nextAnnotationIdRef.current++}`;
		const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
		const newRegion: AnnotationRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			type: "text",
			content: "Enter text...",
			position: { ...DEFAULT_ANNOTATION_POSITION },
			size: { ...DEFAULT_ANNOTATION_SIZE },
			style: { ...DEFAULT_ANNOTATION_STYLE },
			zIndex,
		};
		setAnnotationRegions((prev) => [...prev, newRegion]);
		setSelectedAnnotationId(id);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedCaptionId(null);
		setIsMasterSelected(false);
	}, []);

	const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
		setAnnotationRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
						...region,
						startMs: Math.round(span.start),
						endMs: Math.round(span.end),
					}
					: region,
			),
		);
	}, []);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
		},
		[selectedAnnotationId],
	);

	const handleAnnotationContentChange = useCallback((id: string, content: string) => {
		setAnnotationRegions((prev) => {
			const updated = prev.map((region) => {
				if (region.id !== id) return region;

				// Store content in type-specific fields
				if (region.type === "text") {
					return { ...region, content, textContent: content };
				} else if (region.type === "image") {
					return { ...region, content, imageContent: content };
				} else {
					return { ...region, content };
				}
			});
			return updated;
		});
	}, []);

	const handleAnnotationTypeChange = useCallback((id: string, type: AnnotationRegion["type"]) => {
		setAnnotationRegions((prev) => {
			const updated = prev.map((region) => {
				if (region.id !== id) return region;

				const updatedRegion = { ...region, type };

				// Restore content from type-specific storage
				if (type === "text") {
					updatedRegion.content = region.textContent || "Enter text...";
				} else if (type === "image") {
					updatedRegion.content = region.imageContent || "";
				} else if (type === "figure") {
					updatedRegion.content = "";
					if (!region.figureData) {
						updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
					}
				} else if (type === "blur") {
					updatedRegion.content = "";
					if (updatedRegion.blurIntensity === undefined) {
						updatedRegion.blurIntensity = DEFAULT_BLUR_INTENSITY;
					}
				}

				return updatedRegion;
			});
			return updated;
		});
	}, []);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			setAnnotationRegions((prev) =>
				prev.map((region) =>
					region.id === id ? { ...region, style: { ...region.style, ...style } } : region,
				),
			);
		},
		[],
	);

	const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, figureData } : region)),
		);
	}, []);

	const handleAnnotationBlurIntensityChange = useCallback((id: string, blurIntensity: number) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, blurIntensity } : region)),
		);
	}, []);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => (region.id === id ? { ...region, position } : region)),
			);
		},
		[],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => (region.id === id ? { ...region, size } : region)),
			);
		},
		[],
	);

	// Global Tab prevention
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable;

			const usesPrimaryModifier = isMac ? e.metaKey : e.ctrlKey;
			const key = e.key.toLowerCase();

			if (usesPrimaryModifier && !e.altKey && key === "z") {
				if (!isEditableTarget) {
					e.preventDefault();
					if (e.shiftKey) {
						handleRedo();
					} else {
						handleUndo();
					}
				}
				return;
			}

			if (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && key === "y") {
				if (!isEditableTarget) {
					e.preventDefault();
					handleRedo();
				}
				return;
			}

			if (e.key === "Tab") {
				// Allow tab only in inputs/textareas
				if (isEditableTarget) {
					return;
				}
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Allow space only in inputs/textareas
				if (isEditableTarget) {
					return;
				}
				e.preventDefault();

				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					if (playback.video.paused) {
						playback.play().catch(console.error);
					} else {
						playback.pause();
					}
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [shortcuts, isMac, handleUndo, handleRedo]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
	}, [selectedAnnotationId, annotationRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	useEffect(() => {
		if (selectedAudioId && !audioRegions.some((region) => region.id === selectedAudioId)) {
			setSelectedAudioId(null);
		}
	}, [selectedAudioId, audioRegions]);

	useEffect(() => {
		if (selectedCaptionId && !autoCaptions.some((cue) => cue.id === selectedCaptionId)) {
			setSelectedCaptionId(null);
		}
	}, [selectedCaptionId, autoCaptions]);

	// Audio playback sync: manage Audio elements that play in sync with video
	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

	useEffect(() => {
		const existing = audioElementsRef.current;
		const unused = new Set(existing.keys());

		const hasAudioContext = !!(audioContextRef.current && masterGainRef.current && isAudioEngineReady);

		for (const region of audioRegions) {
			unused.delete(region.id);
			let audio = existing.get(region.id);
			if (!audio) {
				audio = new Audio();
				// Ensure cross-origin is handled to avoid CORS issues with AudioContext
				audio.crossOrigin = "anonymous";
				existing.set(region.id, audio);
			}
			const expectedSrc = toFileUrl(region.audioPath);
			if (audio.src !== expectedSrc) {
				audio.src = expectedSrc;
			}

			// Route through Web Audio API if ready
			if (hasAudioContext && !audioRegionNodesRef.current.has(region.id)) {
				try {
					const source = audioContextRef.current!.createMediaElementSource(audio);
					const gain = audioContextRef.current!.createGain();
					source.connect(gain);
					gain.connect(masterGainRef.current!);
					audioRegionNodesRef.current.set(region.id, { source, gain });
					console.log(`[VideoEditor] Audio region ${region.id} routed through GainNode`);
				} catch (e) {
					console.warn(`[VideoEditor] Failed to route audio ${region.id}:`, e);
				}
			}

			// Initial volume setup — masterAudioMuted only affects the video element, not audio regions
			const hasGlobalSolo = masterAudioSoloed || audioRegions.some((r) => r.soloed);
			let baseVolume = region.volume * audioTrackVolume * previewVolume * masterAudioVolume;
			if (region.muted || (hasGlobalSolo && !region.soloed)) {
				baseVolume = 0;
			}

			const nodeEntry = audioRegionNodesRef.current.get(region.id);
			if (nodeEntry) {
				audio.volume = 1;
				nodeEntry.gain.gain.setTargetAtTime(baseVolume, 0, 0.03);
			} else {
				// Fallback to native volume (limited to 100%)
				audio.volume = Math.max(0, Math.min(1, baseVolume));
			}
		}

		return () => {
			for (const id of unused) {
				const audio = existing.get(id);
				if (audio) {
					audio.pause();
					audio.src = "";
				}
				existing.delete(id);

				const nodeEntry = audioRegionNodesRef.current.get(id);
				if (nodeEntry) {
					try {
						nodeEntry.source.disconnect();
						nodeEntry.gain.disconnect();
					} catch (e) { /* ignore */ }
					audioRegionNodesRef.current.delete(id);
				}
			}
		};
	}, [audioRegions, previewVolume, masterAudioVolume, audioTrackVolume, isAudioEngineReady]);

	// Sync audio playback with video currentTime and isPlaying state
	useEffect(() => {
		for (const region of audioRegions) {
			const audio = audioElementsRef.current.get(region.id);
			if (!audio) continue;

			const currentTimeMs = currentTime * 1000;
			const isInRegion = currentTimeMs >= region.startMs && currentTimeMs < region.endMs;

			if (isPlaying && isInRegion) {
				// Calculate fade multiplier
				let fadeMultiplier = 1;
				if (region.fadeInMs && currentTimeMs < region.startMs + region.fadeInMs) {
					fadeMultiplier = (currentTimeMs - region.startMs) / region.fadeInMs;
				} else if (region.fadeOutMs && currentTimeMs > region.endMs - region.fadeOutMs) {
					fadeMultiplier = (region.endMs - currentTimeMs) / region.fadeOutMs;
				}
				fadeMultiplier = Math.max(0, Math.min(1, fadeMultiplier));

				// masterAudioMuted only affects the video element — not audio regions
				const hasGlobalSolo = masterAudioSoloed || audioRegions.some((r) => r.soloed);
				let baseVolume = region.volume * audioTrackVolume * previewVolume * masterAudioVolume;
				if (region.muted || (hasGlobalSolo && !region.soloed)) {
					baseVolume = 0;
				}

				const targetVolume = baseVolume * fadeMultiplier;
				const nodeEntry = audioRegionNodesRef.current.get(region.id);

				if (nodeEntry) {
					// Use Web Audio gain automation for smooth high-precision fade
					nodeEntry.gain.gain.setTargetAtTime(targetVolume, 0, 0.03);
				} else {
					// Fallback to native volume (limited to 1.0)
					const fallbackValue = Math.max(0, Math.min(1, targetVolume));
					if (Math.abs(audio.volume - fallbackValue) > 0.01) {
						audio.volume = fallbackValue;
					}
				}

				const audioOffset = (currentTimeMs - region.startMs) / 1000;
				// Only seek if significantly out of sync (> 20ms) - tightened for Web Audio era
				if (Math.abs(audio.currentTime - audioOffset) > 0.02) {
					audio.currentTime = audioOffset;
				}
				if (audio.paused) {
					audio.play().catch(() => undefined);
				}
			} else {
				if (!audio.paused) {
					audio.pause();
				}
			}
		}
	}, [isPlaying, currentTime, audioRegions, previewVolume, masterAudioVolume, audioTrackVolume]);

	const showExportSuccessToast = useCallback((filePath: string) => {
		toast.success(`Exported successfully to ${filePath}`, {
			action: {
				label: "Show in Folder",
				onClick: async () => {
					try {
						const result = await window.electronAPI.revealInFolder(filePath);
						if (!result.success) {
							const errorMessage =
								result.error || result.message || "Failed to reveal item in folder.";
							toast.error(errorMessage);
						}
					} catch (err) {
						toast.error(`Error revealing in folder: ${String(err)}`);
					}
				},
			},
		});
	}, []);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			clearPendingExportSave();

			let keepExportDialogOpen = false;

			try {
				const wasPlaying = isPlaying;
				const restoreTime = video.currentTime;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				// Get preview CONTAINER dimensions for scaling
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur,
						zoomMotionBlur,
						connectZooms,
						zoomInDurationMs,
						zoomInOverlapMs,
						zoomOutDurationMs,
						connectedZoomGapMs,
						connectedZoomDurationMs,
						zoomInEasing,
						zoomOutEasing,
						connectedZoomEasing,
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						webcam,
						webcamUrl: webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null,
						annotationRegions,
						autoCaptions,
						autoCaptionSettings,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorStyle,
						cursorSize,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClickBounceDuration,
						cursorSway,
						previewWidth,
						previewHeight,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.gif`;
						markExportAsSaving();

						const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							pendingExportSaveRef.current = { arrayBuffer, fileName };
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
						} else {
							setExportError(saveResult.message || "Failed to save GIF");
							toast.error(saveResult.message || "Failed to save GIF");
						}
					} else {
						setExportError(result.error || "GIF export failed");
						toast.error(result.error || "GIF export failed");
					}
				} else {
					// MP4 Export
					const quality = settings.quality || exportQuality;
					const supportedSourceDimensions = await ensureSupportedMp4SourceDimensions();
					const { width: exportWidth, height: exportHeight } = calculateMp4ExportDimensions(
						supportedSourceDimensions.width,
						supportedSourceDimensions.height,
						quality,
					);
					let bitrate: number;

					if (quality === "source") {
						// Calculate visually lossless bitrate matching screen recording optimization
						const totalPixels = exportWidth * exportHeight;
						bitrate = 30_000_000;
						if (totalPixels > 1920 * 1080 && totalPixels <= 2560 * 1440) {
							bitrate = 50_000_000;
						} else if (totalPixels > 2560 * 1440) {
							bitrate = 80_000_000;
						}
					} else {
						// Adjust bitrate for lower resolutions
						const totalPixels = exportWidth * exportHeight;
						if (totalPixels <= 1280 * 720) {
							bitrate = 10_000_000;
						} else if (totalPixels <= 1920 * 1080) {
							bitrate = 20_000_000;
						} else {
							bitrate = 30_000_000;
						}
					}

					const exporter = new VideoExporter({
						videoUrl: videoPath,
						width: exportWidth,
						height: exportHeight,
						frameRate: MP4_EXPORT_FRAME_RATE,
						bitrate,
						codec: DEFAULT_MP4_CODEC,
						wallpaper,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur,
						zoomMotionBlur,
						connectZooms,
						zoomInDurationMs,
						zoomInOverlapMs,
						zoomOutDurationMs,
						connectedZoomGapMs,
						connectedZoomDurationMs,
						zoomInEasing,
						zoomOutEasing,
						connectedZoomEasing,
						borderRadius,
						padding,
						cropRegion,
						webcam,
						webcamUrl: webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null,
						annotationRegions,
						autoCaptions,
						autoCaptionSettings,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorStyle,
						cursorSize,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClickBounceDuration,
						cursorSway,
						audioRegions,
						masterAudioVolume: masterAudioVolume ?? 1,
						audioTrackVolume: audioTrackVolume ?? 1,
						masterAudioMuted: masterAudioMuted ?? false,
						masterAudioSoloed: masterAudioSoloed ?? false,
						previewWidth,
						previewHeight,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = exporter;
					const result = await exporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.mp4`;
						markExportAsSaving();

						const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							pendingExportSaveRef.current = { arrayBuffer, fileName };
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
						} else {
							setExportError(saveResult.message || "Failed to save video");
							toast.error(saveResult.message || "Failed to save video");
						}
					} else {
						setExportError(result.error || "Export failed");
						toast.error(result.error || "Export failed");
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				} else {
					video.currentTime = restoreTime;
				}
			} catch (error) {
				console.error("Export error:", error);
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				setExportError(errorMessage);
				toast.error(`Export failed: ${errorMessage}`);
			} finally {
				setIsExporting(false);
				exporterRef.current = null;
				setShowExportDropdown(keepExportDialogOpen);
				setExportProgress(null);
				setPreviewVersion((version) => version + 1);
			}
		},
		[
			clearPendingExportSave,
			videoPath,
			wallpaper,
			trimRegions,
			speedRegions,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			zoomInDurationMs,
			zoomInOverlapMs,
			zoomOutDurationMs,
			connectedZoomGapMs,
			connectedZoomDurationMs,
			zoomInEasing,
			zoomOutEasing,
			connectedZoomEasing,
			showCursor,
			cursorStyle,
			effectiveCursorTelemetry,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			audioRegions,
			borderRadius,
			padding,
			cropRegion,
			webcam,
			annotationRegions,
			autoCaptions,
			autoCaptionSettings,
			isPlaying,
			exportQuality,
			effectiveZoomRegions,
			ensureSupportedMp4SourceDimensions,
			markExportAsSaving,
			showExportSuccessToast,
		],
	);

	const handleOpenExportDropdown = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		if (hasPendingExportSave) {
			setShowExportDropdown(true);
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			return;
		}
		setShowExportDropdown(true);
		setExportProgress(null);
		setExportError(null);
	}, [videoPath, hasPendingExportSave]);

	const handleStartExportFromDropdown = useCallback(() => {
		const video = videoPlaybackRef.current?.video;
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		const sourceWidth = video.videoWidth || 1920;
		const sourceHeight = video.videoHeight || 1080;
		const gifDimensions = calculateOutputDimensions(
			sourceWidth,
			sourceHeight,
			gifSizePreset,
			GIF_SIZE_PRESETS,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
						frameRate: gifFrameRate,
						loop: gifLoop,
						sizePreset: gifSizePreset,
						width: gifDimensions.width,
						height: gifDimensions.height,
					}
					: undefined,
		};

		setExportError(null);
		setExportedFilePath(undefined);
		setShowExportDropdown(true);
		handleExport(settings);
	}, [videoPath, exportFormat, exportQuality, gifFrameRate, gifLoop, gifSizePreset, handleExport]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			clearPendingExportSave();
			setShowExportDropdown(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(undefined);
		}
	}, [clearPendingExportSave]);

	const handleExportDropdownClose = useCallback(() => {
		clearPendingExportSave();
		setShowExportDropdown(false);
		setExportProgress(null);
		setExportError(null);
		setExportedFilePath(undefined);
	}, [clearPendingExportSave]);

	const handleRetrySaveExport = useCallback(async () => {
		const pendingSave = pendingExportSaveRef.current;
		if (!pendingSave) {
			return;
		}

		const saveResult = await window.electronAPI.saveExportedVideo(
			pendingSave.arrayBuffer,
			pendingSave.fileName,
		);

		if (saveResult.canceled) {
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			toast.info("Save canceled. You can try again.");
			return;
		}

		if (saveResult.success && saveResult.path) {
			clearPendingExportSave();
			setExportError(null);
			setExportedFilePath(saveResult.path);
			showExportSuccessToast(saveResult.path);
			setShowExportDropdown(true);
			return;
		}

		const errorMessage = saveResult.message || "Failed to save video";
		setExportError(errorMessage);
		toast.error(errorMessage);
	}, [clearPendingExportSave, showExportSuccessToast]);

	const handleOpenCropEditor = useCallback(() => {
		cropSnapshotRef.current = { ...cropRegion };
		setShowCropModal(true);
	}, [cropRegion]);

	const handleCloseCropEditor = useCallback(() => {
		setShowCropModal(false);
	}, []);

	const handleCancelCropEditor = useCallback(() => {
		if (cropSnapshotRef.current) {
			setCropRegion(cropSnapshotRef.current);
		}
		setShowCropModal(false);
	}, []);

	const isCropped = useMemo(() => {
		const top = Math.round(cropRegion.y * 100);
		const left = Math.round(cropRegion.x * 100);
		const bottom = Math.round((1 - cropRegion.y - cropRegion.height) * 100);
		const right = Math.round((1 - cropRegion.x - cropRegion.width) * 100);
		return top > 0 || left > 0 || bottom > 0 || right > 0;
	}, [cropRegion]);

	const openRecordingsFolder = useCallback(async () => {
		try {
			const result = await window.electronAPI.openRecordingsFolder();
			if (!result.success) {
				toast.error(result.message || result.error || "Failed to open recordings folder.");
			}
		} catch (error) {
			toast.error(`Failed to open recordings folder: ${String(error)}`);
		}
	}, []);

	const revealExportedFile = useCallback(async () => {
		if (!exportedFilePath) return;

		try {
			const result = await window.electronAPI.revealInFolder(exportedFilePath);
			if (!result.success) {
				toast.error(result.error || result.message || "Failed to reveal item in folder.");
			}
		} catch (error) {
			toast.error(`Failed to reveal item in folder: ${String(error)}`);
		}
	}, [exportedFilePath]);

	const isExportSaving = exportProgress?.phase === "saving";
	const isExportFinalizing = exportProgress?.phase === "finalizing";
	const exportPercentLabel = exportProgress
		? isExportSaving
			? t("editor.exportStatus.saving", "Opening save dialog...")
			: isExportFinalizing && typeof exportProgress.renderProgress === "number"
				? t("editor.exportStatus.finalizingPercent", "Finalizing {{percent}}%", {
					percent: Math.round(exportProgress.renderProgress),
				})
				: t("editor.exportStatus.completePercent", "{{percent}}% complete", {
					percent: Math.round(exportProgress.percentage),
				})
		: t("editor.exportStatus.preparing", "Preparing export...");

	const projectBrowser = (
		<ProjectBrowserDialog
			open={projectBrowserOpen}
			onOpenChange={setProjectBrowserOpen}
			entries={projectLibraryEntries}
			anchorRef={error ? projectBrowserFallbackTriggerRef : projectBrowserTriggerRef}
			onOpenProject={(projectPath) => {
				void handleOpenProjectFromLibrary(projectPath);
			}}
		/>
	);

	if (loading) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<div className="text-foreground">Loading video...</div>
				{projectBrowser}
				<Toaster theme="dark" className="pointer-events-auto" />
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
						onClick={handleOpenProjectBrowser}
						className="rounded-[5px] bg-white px-3 py-1.5 text-sm font-semibold text-black shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-white/92"
					>
						Open Projects
					</button>
				</div>
				{projectBrowser}
				<Toaster theme="dark" className="pointer-events-auto" />
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-[#111113] text-slate-200 overflow-hidden selection:bg-[#2563EB]/30">
			<div
				className="relative h-11 flex-shrink-0 bg-[#151518]/88 backdrop-blur-md border-b border-white/10 flex items-center justify-center px-8 z-50"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div className="flex items-baseline gap-0">
					<span className="text-sm font-semibold tracking-tight text-white/90">
						{projectDisplayName}
					</span>
					<span className="text-xs font-medium tracking-tight text-slate-500">.recordly</span>
				</div>
				<div
					className="absolute left-[88px] flex items-center gap-2"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<LanguageSwitcher />
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => void openRecordingsFolder()}
						className={`${APP_HEADER_ACTION_BUTTON_CLASS} px-2.5`}
						title={t("common.app.manageRecordings", "Open recordings folder")}
						aria-label={t("common.app.manageRecordings", "Open recordings folder")}
					>
						<FolderOpen className="h-4 w-4" />
					</Button>
					<KeyboardShortcutsDialog />
					<FeedbackDialog />
					<div className="ml-1 h-5 w-px bg-white/10" />
				</div>
				<div
					className="absolute right-5 flex items-center gap-2 pr-3"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<Button
						type="button"
						variant="ghost"
						onClick={handleUndo}
						disabled={!canUndo}
						className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/10 bg-white/5 p-0 text-slate-200 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
						title={t("common.actions.undo", "Undo")}
						aria-label={t("common.actions.undo", "Undo")}
					>
						<Undo2 className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						onClick={handleRedo}
						disabled={!canRedo}
						className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-white/10 bg-white/5 p-0 text-slate-200 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
						title={t("common.actions.redo", "Redo")}
						aria-label={t("common.actions.redo", "Redo")}
					>
						<Redo2 className="h-4 w-4" />
					</Button>
					<div className="mx-1 h-5 w-px bg-white/10" />
					<Button
						ref={projectBrowserTriggerRef}
						type="button"
						onClick={handleOpenProjectBrowser}
						className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-white px-4 text-black shadow-[0_14px_32px_rgba(0,0,0,0.18)] transition-colors hover:bg-white/92"
					>
						<FolderOpen className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">
							{t("editor.project.projects", "Projects")}
						</span>
					</Button>
					<Button
						type="button"
						onClick={handleSaveProject}
						className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-white px-4 text-black transition-colors hover:bg-white/92"
					>
						<span className={`${hasUnsavedChanges ? "flex" : "hidden"} size-2 relative`}>
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2563EB] opacity-75"></span>
							<span className="relative inline-flex size-2 rounded-full bg-[#2563EB]"></span>
						</span>
						<Save className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">{t("common.actions.save")}</span>
					</Button>
					<div className="mx-1 h-5 w-px bg-white/10" />
					<DropdownMenu
						open={showExportDropdown}
						onOpenChange={setShowExportDropdown}
						modal={false}
					>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								onClick={handleOpenExportDropdown}
								className="inline-flex h-8 min-w-[112px] items-center justify-center gap-2 rounded-[5px] bg-[#2563EB] px-4.5 text-white transition-colors hover:bg-[#2563EB]/92"
							>
								<Download className="h-4 w-4" />
								<span className="text-sm font-semibold tracking-tight">
									{t("common.actions.export", "Export")}
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							sideOffset={10}
							className="w-[360px] border-none bg-transparent p-0 shadow-none"
						>
							{isExporting ? (
								<div className="rounded-2xl border border-white/10 bg-[#17171a] p-4 text-slate-200 shadow-2xl">
									<div className="mb-3 flex items-center justify-between gap-3">
										<div>
											<p className="text-sm font-semibold text-white">
												{t("editor.exportStatus.exporting", "Exporting")}
											</p>
											<p className="text-xs text-slate-400">
												{t("editor.exportStatus.renderingFile", "Rendering your file.")}
											</p>
										</div>
										<Button
											type="button"
											variant="outline"
											onClick={handleCancelExport}
											className="h-8 border-red-500/20 bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20"
										>
											{t("common.actions.cancel")}
										</Button>
									</div>
									<div className="h-2 overflow-hidden rounded-full border border-white/5 bg-white/5">
										{isExportSaving ? (
											<div className="indeterminate-progress h-full rounded-full bg-transparent" />
										) : (
											<div
												className="h-full bg-[#2563EB] transition-all duration-300 ease-out"
												style={{
													width: `${Math.min(isExportFinalizing && typeof exportProgress?.renderProgress === "number" ? exportProgress.renderProgress : (exportProgress?.percentage ?? 8), 100)}%`,
												}}
											/>
										)}
									</div>
									<p className="mt-2 text-xs text-slate-400">{exportPercentLabel}</p>
								</div>
							) : exportError ? (
								<div className="rounded-2xl border border-white/10 bg-[#17171a] p-4 text-slate-200 shadow-2xl">
									<p className="text-sm font-semibold text-white">
										{t("editor.exportStatus.issue", "Export issue")}
									</p>
									<p className="mt-1 text-xs leading-relaxed text-slate-400">{exportError}</p>
									<div className="mt-4 flex gap-2">
										{hasPendingExportSave ? (
											<Button
												type="button"
												onClick={handleRetrySaveExport}
												className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
											>
												{t("editor.actions.saveAgain", "Save Again")}
											</Button>
										) : null}
										<Button
											type="button"
											variant="outline"
											onClick={handleExportDropdownClose}
											className="h-8 flex-1 border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10"
										>
											{t("common.actions.close", "Close")}
										</Button>
									</div>
								</div>
							) : exportedFilePath ? (
								<div className="rounded-2xl border border-white/10 bg-[#17171a] p-4 text-slate-200 shadow-2xl">
									<p className="text-sm font-semibold text-white">
										{t("editor.exportStatus.complete", "Export complete")}
									</p>
									<p className="mt-1 text-xs text-slate-400">
										{t(
											"editor.exportStatus.savedSuccessfully",
											"Your file was saved successfully.",
										)}
									</p>
									<p className="mt-3 truncate text-xs text-slate-500">
										{exportedFilePath.split("/").pop()}
									</p>
									<div className="mt-4 flex gap-2">
										<Button
											type="button"
											onClick={revealExportedFile}
											className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92"
										>
											{t("editor.actions.showInFolder", "Show In Folder")}
										</Button>
										<Button
											type="button"
											variant="outline"
											onClick={handleExportDropdownClose}
											className="h-8 flex-1 border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10"
										>
											Done
										</Button>
									</div>
								</div>
							) : (
								<ExportSettingsMenu
									exportFormat={exportFormat}
									onExportFormatChange={setExportFormat}
									exportQuality={exportQuality}
									onExportQualityChange={setExportQuality}
									gifFrameRate={gifFrameRate}
									onGifFrameRateChange={setGifFrameRate}
									gifLoop={gifLoop}
									onGifLoopChange={setGifLoop}
									gifSizePreset={gifSizePreset}
									onGifSizePresetChange={setGifSizePreset}
									mp4OutputDimensions={mp4OutputDimensions}
									gifOutputDimensions={gifOutputDimensions}
									onExport={handleStartExportFromDropdown}
									className="shadow-2xl"
								/>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<div className="relative flex min-h-0 flex-1 gap-3 p-4">
				{/* Left Column - Video & Timeline */}
				<div className="order-2 flex h-full min-w-0 flex-[7] flex-col gap-3">
					<PanelGroup direction="vertical" className="gap-3">
						{/* Top section: video preview and controls */}
						<Panel defaultSize={67} minSize={40}>
							<div className="relative flex h-full flex-col overflow-hidden">
								{/* Video preview */}
								<div
									className="flex w-full min-h-0 flex-1 items-stretch"
									style={{ flex: "1 1 auto", margin: "6px 0 0" }}
								>
									<div className="flex w-11 flex-shrink-0 items-center justify-center pl-1">
										<LayoutGroup id="preview-icon-rail">
											<div className="flex flex-col items-center gap-3">
												{editorSectionButtons.map((section) => {
													const Icon = section.icon;
													const isActive = activeEffectSection === section.id;
													return (
														<motion.button
															key={section.id}
															type="button"
															onClick={() => setActiveEffectSection(section.id)}
															title={section.label}
															className="group relative flex h-8 w-8 items-center justify-center text-white/75 outline-none transition-colors hover:text-white focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
															animate={{ scale: isActive ? 1.06 : 1, opacity: isActive ? 1 : 0.82 }}
															transition={{ type: "spring", stiffness: 420, damping: 28 }}
														>
															<motion.span
																animate={{ color: isActive ? "#2563EB" : "rgba(255,255,255,0.75)" }}
																transition={{ duration: 0.16 }}
															>
																<Icon className="h-4 w-4" />
															</motion.span>
															<AnimatePresence initial={false}>
																{isActive ? (
																	<motion.span
																		layoutId="preview-active-dot"
																		className="absolute -left-1 h-1.5 w-1.5 rounded-full bg-[#2563EB]"
																		initial={{ opacity: 0, scale: 0.6 }}
																		animate={{ opacity: 1, scale: 1 }}
																		exit={{ opacity: 0, scale: 0.6 }}
																		transition={{ type: "spring", stiffness: 500, damping: 32 }}
																	/>
																) : null}
															</AnimatePresence>
														</motion.button>
													);
												})}
											</div>
										</LayoutGroup>
									</div>
									<div className="flex min-w-0 flex-1 items-center justify-center pl-2 pr-1">
										<div
											className="relative overflow-hidden rounded-[30px]"
											style={{
												width: "auto",
												height: "100%",
												aspectRatio: getAspectRatioValue(
													aspectRatio,
													(() => {
														const previewVideo = videoPlaybackRef.current?.video;
														if (previewVideo && previewVideo.videoHeight > 0) {
															return previewVideo.videoWidth / previewVideo.videoHeight;
														}
														return 16 / 9;
													})(),
												),
												maxWidth: "100%",
												margin: "0 auto",
												boxSizing: "border-box",
											}}
										>
											<VideoPlayback
												key={`${videoPath || "no-video"}:${previewVersion}`}
												volume={(() => {
													const hasGlobalSolo = masterAudioSoloed || audioRegions.some((r) => r.soloed);
													if (masterAudioMuted || (hasGlobalSolo && !masterAudioSoloed)) {
														return 0;
													}
													return previewVolume * masterAudioVolume;
												})()}
												aspectRatio={aspectRatio}
												ref={videoPlaybackRef}
												videoPath={videoPath || ""}
												onDurationChange={setDuration}
												onTimeUpdate={setCurrentTime}
												currentTime={currentTime}
												onPlayStateChange={setIsPlaying}
												onError={setError}
												wallpaper={wallpaper}
												zoomRegions={effectiveZoomRegions}
												selectedZoomId={selectedZoomId}
												onSelectZoom={handleSelectZoom}
												onZoomFocusChange={handleZoomFocusChange}
												isPlaying={isPlaying}
												showShadow={shadowIntensity > 0}
												shadowIntensity={shadowIntensity}
												backgroundBlur={backgroundBlur}
												zoomMotionBlur={zoomMotionBlur}
												connectZooms={connectZooms}
												zoomInDurationMs={zoomInDurationMs}
												zoomInOverlapMs={zoomInOverlapMs}
												zoomOutDurationMs={zoomOutDurationMs}
												connectedZoomGapMs={connectedZoomGapMs}
												connectedZoomDurationMs={connectedZoomDurationMs}
												zoomInEasing={zoomInEasing}
												zoomOutEasing={zoomOutEasing}
												connectedZoomEasing={connectedZoomEasing}
												borderRadius={borderRadius}
												padding={padding}
												cropRegion={cropRegion}
												webcam={webcam}
												webcamVideoPath={webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null}
												trimRegions={trimRegions}
												speedRegions={speedRegions}
												annotationRegions={annotationRegions}
												autoCaptions={autoCaptions}
												autoCaptionSettings={autoCaptionSettings}
												selectedAnnotationId={selectedAnnotationId}
												onSelectAnnotation={handleSelectAnnotation}
												onAnnotationPositionChange={handleAnnotationPositionChange}
												onAnnotationSizeChange={handleAnnotationSizeChange}
												cursorTelemetry={effectiveCursorTelemetry}
												showCursor={showCursor}
												cursorStyle={cursorStyle}
												cursorSize={cursorSize}
												cursorSmoothing={cursorSmoothing}
												cursorMotionBlur={cursorMotionBlur}
												cursorClickBounce={cursorClickBounce}
												cursorClickBounceDuration={cursorClickBounceDuration}
												cursorSway={cursorSway}
											/>

										</div>
									</div>
								</div>
								{/* Playback controls */}
								<div
									className="w-full flex justify-center items-center"
									style={{
										height: "48px",
										flexShrink: 0,
										padding: "6px 12px",
										margin: "6px 0 6px 0",
									}}
								>
									<div style={{ width: "100%", maxWidth: "700px" }}>
										<PlaybackControls
											isPlaying={isPlaying}
											currentTime={currentTime}
											duration={duration}
											onTogglePlayPause={togglePlayPause}
											onSeek={handleSeek}
											volume={previewVolume}
											onVolumeChange={setPreviewVolume}
										/>
									</div>
								</div>
							</div>
						</Panel>

						<PanelResizeHandle className="h-3 bg-transparent transition-colors mx-4 flex items-center justify-center">
							<div className="w-8 h-1 bg-white/20 rounded-full"></div>
						</PanelResizeHandle>

						{/* Timeline section */}
						<Panel defaultSize={33} minSize={20}>
							<div className="h-full min-h-0 bg-[#17171a] rounded-2xl border border-white/10 shadow-lg overflow-auto flex flex-col">
								<TimelineEditor
									videoDuration={duration}
									videoPath={videoPath || undefined}
									masterAudioMuted={masterAudioMuted}
									onMasterAudioMutedChange={setMasterAudioMuted}
									masterAudioSoloed={masterAudioSoloed}
									onMasterAudioSoloedChange={handleMasterAudioSoloedChange}
									masterAudioVolume={masterAudioVolume}
									onMasterAudioVolumeChange={setMasterAudioVolume}
									audioTrackVolume={audioTrackVolume}
									onAudioTrackVolumeChange={setAudioTrackVolume}
									currentTime={currentTime}
									onSeek={handleSeek}
									cursorTelemetry={normalizedCursorTelemetry}
									zoomRegions={effectiveZoomRegions}
									onZoomAdded={handleZoomAdded}
									onZoomSuggested={handleZoomSuggested}
									onZoomSpanChange={handleZoomSpanChange}
									onZoomDelete={handleZoomDelete}
									selectedZoomId={selectedZoomId}
									onSelectZoom={handleSelectZoom}
									trimRegions={trimRegions}
									onTrimAdded={handleTrimAdded}
									onTrimSpanChange={handleTrimSpanChange}
									onTrimDelete={handleTrimDelete}
									selectedTrimId={selectedTrimId}
									onSelectTrim={handleSelectTrim}
									speedRegions={speedRegions}
									onSpeedAdded={handleSpeedAdded}
									onSpeedSpanChange={handleSpeedSpanChange}
									onSpeedDelete={handleSpeedDelete}
									selectedSpeedId={selectedSpeedId}
									onSelectSpeed={handleSelectSpeed}
									audioRegions={audioRegions}
									onAudioAdded={handleAudioAdded}
									onAudioSpanChange={handleAudioSpanChange}
									onAudioMutedChange={handleAudioMutedChange}
									onAudioSoloedChange={handleAudioSoloedChange}
									onAudioDelete={handleAudioDelete}
									selectedAudioId={selectedAudioId}
									onSelectAudio={handleSelectAudio}
									annotationRegions={annotationRegions}
									onAnnotationAdded={handleAnnotationAdded}
									onAnnotationSpanChange={handleAnnotationSpanChange}
									onAnnotationDelete={handleAnnotationDelete}
									selectedAnnotationId={selectedAnnotationId}
									onSelectAnnotation={handleSelectAnnotation}
									autoCaptions={autoCaptions}
									onCaptionSpanChange={handleCaptionSpanChange}
									selectedCaptionId={selectedCaptionId}
									onSelectCaption={handleSelectCaption}
									onClearAutoCaptions={handleClearAutoCaptions}
									aspectRatio={aspectRatio}
									onAspectRatioChange={setAspectRatio}
									onOpenCropEditor={handleOpenCropEditor}
									isCropped={isCropped}
									isMasterSelected={isMasterSelected}
									onSelectMaster={handleSelectMaster}
								/>
							</div>
						</Panel>
					</PanelGroup>
				</div>

				{/* Left section: settings panel */}
				<div className="order-1 flex">
					<SettingsPanel
						panelMode="editor"
						activeEffectSection={activeEffectSection}
						selected={wallpaper}
						onWallpaperChange={setWallpaper}
						selectedZoomDepth={
							selectedZoomId ? zoomRegions.find((z) => z.id === selectedZoomId)?.depth : null
						}
						onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
						selectedZoomId={selectedZoomId}
						onZoomDelete={handleZoomDelete}
						selectedTrimId={selectedTrimId}
						onTrimDelete={handleTrimDelete}
						shadowIntensity={shadowIntensity}
						onShadowChange={setShadowIntensity}
						backgroundBlur={backgroundBlur}
						onBackgroundBlurChange={setBackgroundBlur}
						zoomMotionBlur={zoomMotionBlur}
						onZoomMotionBlurChange={setZoomMotionBlur}
						connectZooms={connectZooms}
						onConnectZoomsChange={setConnectZooms}
						zoomInDurationMs={zoomInDurationMs}
						onZoomInDurationMsChange={setZoomInDurationMs}
						zoomInOverlapMs={zoomInOverlapMs}
						onZoomInOverlapMsChange={setZoomInOverlapMs}
						zoomOutDurationMs={zoomOutDurationMs}
						onZoomOutDurationMsChange={setZoomOutDurationMs}
						connectedZoomGapMs={connectedZoomGapMs}
						onConnectedZoomGapMsChange={setConnectedZoomGapMs}
						connectedZoomDurationMs={connectedZoomDurationMs}
						onConnectedZoomDurationMsChange={setConnectedZoomDurationMs}
						zoomInEasing={zoomInEasing}
						onZoomInEasingChange={setZoomInEasing}
						zoomOutEasing={zoomOutEasing}
						onZoomOutEasingChange={setZoomOutEasing}
						connectedZoomEasing={connectedZoomEasing}
						onConnectedZoomEasingChange={setConnectedZoomEasing}
						showCursor={showCursor}
						onShowCursorChange={setShowCursor}
						loopCursor={loopCursor}
						onLoopCursorChange={setLoopCursor}
						cursorStyle={cursorStyle}
						onCursorStyleChange={setCursorStyle}
						cursorSize={cursorSize}
						onCursorSizeChange={setCursorSize}
						cursorSmoothing={cursorSmoothing}
						onCursorSmoothingChange={setCursorSmoothing}
						cursorMotionBlur={cursorMotionBlur}
						onCursorMotionBlurChange={setCursorMotionBlur}
						cursorClickBounce={cursorClickBounce}
						onCursorClickBounceChange={setCursorClickBounce}
						cursorClickBounceDuration={cursorClickBounceDuration}
						onCursorClickBounceDurationChange={setCursorClickBounceDuration}
						cursorSway={cursorSway}
						onCursorSwayChange={setCursorSway}
						borderRadius={borderRadius}
						onBorderRadiusChange={setBorderRadius}
						webcam={webcam}
						onWebcamChange={setWebcam}
						onUploadWebcam={handleUploadWebcam}
						onClearWebcam={handleClearWebcam}
						padding={padding}
						onPaddingChange={setPadding}
						cropRegion={cropRegion}
						onCropChange={setCropRegion}
						aspectRatio={aspectRatio}
						onAspectRatioChange={setAspectRatio}
						selectedAnnotationId={selectedAnnotationId}
						annotationRegions={annotationRegions}
						onSeek={(time) => videoPlaybackRef.current?.seek(time)}
						autoCaptions={autoCaptions}
						onAutoCaptionsChange={setAutoCaptions}
						autoCaptionSettings={autoCaptionSettings}
						whisperExecutablePath={whisperExecutablePath}
						whisperModelPath={whisperModelPath}
						whisperModelDownloadStatus={whisperModelDownloadStatus}
						whisperModelDownloadProgress={whisperModelDownloadProgress}
						isGeneratingCaptions={isGeneratingCaptions}
						autoCaptionProgress={autoCaptionProgress}
						onAutoCaptionSettingsChange={setAutoCaptionSettings}
						onPickWhisperExecutable={handlePickWhisperExecutable}
						onPickWhisperModel={handlePickWhisperModel}
						onGenerateAutoCaptions={handleGenerateAutoCaptions}
						onClearAutoCaptions={handleClearAutoCaptions}
						onDownloadWhisperModel={handleDownloadWhisperModel}
						onDeleteWhisperModel={handleDeleteWhisperModel}
						onAnnotationContentChange={handleAnnotationContentChange}
						onAnnotationTypeChange={handleAnnotationTypeChange}
						onAnnotationStyleChange={handleAnnotationStyleChange}
						onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
						onAnnotationBlurIntensityChange={handleAnnotationBlurIntensityChange}
						onAnnotationDelete={handleAnnotationDelete}
						selectedSpeedId={selectedSpeedId}
						selectedSpeedValue={
							selectedSpeedId
								? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
								: null
						}
						onSpeedChange={handleSpeedChange}
						onSpeedDelete={handleSpeedDelete}
						audioRegions={audioRegions}
						selectedAudioId={selectedAudioId}
						onAudioVolumeChange={handleAudioVolumeChange}
						onAudioMutedChange={handleAudioMutedChange}
						onAudioSoloedChange={handleAudioSoloedChange}
						onAudioFadeInMsChange={handleAudioFadeInMsChange}
						onAudioFadeOutMsChange={handleAudioFadeOutMsChange}
						onAudioDelete={handleAudioDelete}
						selectedCaptionId={selectedCaptionId}
						onSelectCaption={handleSelectCaption}
						isMasterSelected={isMasterSelected}
						masterAudioVolume={masterAudioVolume}
						masterAudioMuted={masterAudioMuted}
						masterAudioSoloed={masterAudioSoloed}
						videoDuration={duration}
						videoPath={videoPath || undefined}
						onMasterAudioVolumeChange={setMasterAudioVolume}
						onMasterAudioMutedChange={setMasterAudioMuted}
						onMasterAudioSoloedChange={handleMasterAudioSoloedChange}
					/>
				</div>
			</div>

			{showCropModal ? (
				<>
					<div
						className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
						onClick={handleCancelCropEditor}
					/>
					<div className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[90vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-white/10 bg-[#09090b] p-8 shadow-2xl animate-in zoom-in-95 duration-200">
						<div className="mb-6 flex items-center justify-between">
							<div>
								<span className="text-xl font-bold text-slate-200">{t("settings.crop.title")}</span>
								<p className="mt-2 text-sm text-slate-400">{t("settings.crop.instruction")}</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancelCropEditor}
								className="text-slate-400 hover:bg-white/10 hover:text-white"
							>
								<X className="h-5 w-5" />
							</Button>
						</div>
						<CropControl
							videoElement={videoPlaybackRef.current?.video || null}
							cropRegion={cropRegion}
							onCropChange={setCropRegion}
							aspectRatio={aspectRatio}
						/>
						<div className="mt-6 flex justify-end">
							<Button
								onClick={handleCloseCropEditor}
								size="lg"
								className="bg-[#2563EB] text-white hover:bg-[#2563EB]/90"
							>
								{t("common.actions.done")}
							</Button>
						</div>
					</div>
				</>
			) : null}

			{projectBrowser}

			<Toaster theme="dark" className="pointer-events-auto" />
		</div>
	);
}
