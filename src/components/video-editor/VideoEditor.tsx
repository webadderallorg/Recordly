import {
	Check,
	CaretDown as ChevronDown,
	CaretUp as ChevronUp,
	ClosedCaptioning,
	Crop,
	Cursor,
	DownloadSimple as Download,
	FolderOpen,
	Gear,
	Pause,
	Camera as PhCameraRegular,
	Play,
	Plus,
	PuzzlePiece,
	ArrowClockwise as Redo2,
	Scissors,
	SkipBack,
	SkipForward,
	Sparkle,
	ArrowCounterClockwise as Undo2,
	UserCircle as User,
	SpeakerLow as Volume1,
	SpeakerHigh as Volume2,
	SpeakerX as VolumeX,
	MagicWand as WandSparkles,
	X,
	MagnifyingGlassPlus as ZoomIn,
} from "@phosphor-icons/react";
import type { Span } from "dnd-timeline";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import {
	calculateOutputDimensions,
	DEFAULT_MP4_CODEC,
	type ExportBackendPreference,
	type ExportEncodingMode,
	type ExportFormat,
	type ExportMp4FrameRate,
	type ExportPipelineModel,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	FrameRenderer,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	isValidMp4FrameRate,
	ModernVideoExporter,
	probeSupportedMp4Dimensions,
	type SupportedMp4Dimensions,
	VideoExporter,
} from "@/lib/exporter";
import { resolveMediaElementSource } from "@/lib/exporter/localMediaSource";
import { resolveSourceAudioFallbackPaths } from "@/lib/exporter/sourceAudioFallback";
import {
	clampMediaTimeToDuration,
	estimateCompanionAudioStartDelaySeconds,
	getMediaSyncPlaybackRate,
} from "@/lib/mediaTiming";
import { matchesShortcut } from "@/lib/shortcuts";
import {
	ASPECT_RATIOS,
	type AspectRatio,
	getAspectRatioLabel,
	getAspectRatioValue,
} from "@/utils/aspectRatioUtils";
import { ExtensionIcon } from "./ExtensionIcon";

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

import { extensionHost } from "@/lib/extensions";
import { resolveAutoCaptionSourcePath } from "./autoCaptionSource";
import { CropControl } from "./CropControl";
import { ExportSettingsMenu } from "./ExportSettingsMenu";
import ExtensionManager from "./ExtensionManager";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import ProjectBrowserDialog, { type ProjectLibraryEntry } from "./ProjectBrowserDialog";
import {
	createProjectData,
	deriveNextId,
	type EditorProjectData,
	fromFileUrl,
	normalizeProjectEditor,
	resolveVideoUrl,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import {
	APP_HEADER_ICON_BUTTON_CLASS,
	DiscordLinkButton,
	FeedbackDialog,
	openExternalLink,
	RECORDLY_ISSUES_URL,
} from "./TutorialHelp";
import TimelineEditor, { type TimelineEditorHandle } from "./timeline/TimelineEditor";
import { normalizeCursorTelemetry } from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type AudioRegion,
	type AutoCaptionSettings,
	type CaptionCue,
	type ClipRegion,
	type CropRegion,
	type CursorStyle,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	clipsToTrims,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_AUTO_CAPTION_SETTINGS,
	DEFAULT_AUTO_ZOOM_DEPTH,
	DEFAULT_CONNECTED_ZOOM_DURATION_MS,
	DEFAULT_CONNECTED_ZOOM_EASING,
	DEFAULT_CONNECTED_ZOOM_GAP_MS,
	DEFAULT_CROP_REGION,
	DEFAULT_CURSOR_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_WEBCAM_OVERLAY,
	DEFAULT_WEBCAM_TIME_OFFSET_MS,
	DEFAULT_ZOOM_IN_DURATION_MS,
	DEFAULT_ZOOM_IN_EASING,
	DEFAULT_ZOOM_IN_OVERLAP_MS,
	DEFAULT_ZOOM_OUT_DURATION_MS,
	DEFAULT_ZOOM_OUT_EASING,
	type EditorEffectSection,
	extendAutoFullTrackClip,
	type FigureData,
	getClipSourceEndMs,
	mapSourceTimeToTimelineTime as resolveSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime as resolveTimelineTimeToSourceTime,
	type Padding,
	type SpeedRegion,
	type TrimRegion,
	trimsToClips,
	type WebcamOverlaySettings,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomMode,
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
	clipRegions: ClipRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	autoCaptions: CaptionCue[];
	selectedZoomId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

type PendingExportSave = {
	fileName: string;
	// Exactly one of these is populated. `tempFilePath` is the preferred form
	// for MP4 exports — the main process holds the finished file on disk, so
	// "Save Again" just renames it instead of round-tripping through the
	// renderer's ArrayBuffer heap.
	arrayBuffer?: ArrayBuffer;
	tempFilePath?: string;
};

type CancelableExporter = {
	cancel(): void;
};

type SmokeExportConfig = {
	enabled: boolean;
	inputPath: string | null;
	outputPath: string | null;
	useNativeExport: boolean;
	encodingMode?: ExportEncodingMode;
	shadowIntensity?: number;
	webcamInputPath?: string | null;
	webcamShadow?: number;
	webcamSize?: number;
	pipelineModel?: ExportPipelineModel;
	backendPreference?: ExportBackendPreference;
	maxEncodeQueue?: number;
	maxDecodeQueue?: number;
	maxPendingFrames?: number;
	projectPath?: string | null;
	quality?: ExportQuality;
	fps?: ExportMp4FrameRate;
};

type SaveProjectOptions = {
	silent?: boolean;
	remountPreviewAfterSave?: boolean;
	refreshLibraryAfterSave?: boolean;
	captureThumbnail?: boolean;
};

async function writeSmokeExportReport(
	outputPath: string | null,
	report: Record<string, unknown>,
): Promise<void> {
	if (!outputPath || typeof window === "undefined") {
		return;
	}

	try {
		const reportBytes = new TextEncoder().encode(JSON.stringify(report, null, 2));
		const reportBuffer = reportBytes.buffer.slice(
			reportBytes.byteOffset,
			reportBytes.byteOffset + reportBytes.byteLength,
		) as ArrayBuffer;
		await window.electronAPI.writeExportedVideoToPath(
			reportBuffer,
			`${outputPath}.report.json`,
		);
	} catch (error) {
		console.error("[smoke-export] Failed to write report", error);
	}
}

const DEFAULT_MP4_EXPORT_FRAME_RATE: ExportMp4FrameRate = 30;
const SOURCE_AUDIO_FALLBACK_TOAST_ID = "source-audio-fallback-error";
const PROJECT_AUTOSAVE_DELAY_MS = 1000;

function getEncodingModeBitrateMultiplier(encodingMode: ExportEncodingMode): number {
	switch (encodingMode) {
		case "fast":
			return 0.1;
		case "quality":
			return 0.9;
		case "balanced":
		default:
			return 0.5;
	}
}

function summarizeErrorMessage(message: string): string {
	const firstLine = message
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);

	return firstLine ?? message;
}

function cloneStructured<T>(value: T): T {
	return globalThis.structuredClone(value);
}

function parseSmokeExportNumber(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseSmokeExportNonNegativeNumber(value: string | null): number | undefined {
	if (value === null) {
		return undefined;
	}

	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseSmokeExportQuality(value: string | null): ExportQuality | undefined {
	if (value === "medium" || value === "good" || value === "high" || value === "source") {
		return value;
	}
	return undefined;
}

function parseSmokeExportFps(value: string | null): ExportMp4FrameRate | undefined {
	if (value === null) return undefined;
	const parsed = Number.parseInt(value, 10);
	return isValidMp4FrameRate(parsed) ? parsed : undefined;
}

function getSmokeExportConfig(search: string): SmokeExportConfig {
	const params = new URLSearchParams(search);
	const enabled = params.get("smokeExport") === "1";

	return {
		enabled,
		inputPath: enabled ? params.get("smokeInput") : null,
		outputPath: enabled ? params.get("smokeOutput") : null,
		useNativeExport: enabled ? params.get("smokeUseNativeExport") === "1" : false,
		encodingMode:
			enabled && params.get("smokeEncodingMode") === "fast"
				? "fast"
				: enabled && params.get("smokeEncodingMode") === "balanced"
					? "balanced"
					: enabled && params.get("smokeEncodingMode") === "quality"
						? "quality"
						: undefined,
		shadowIntensity: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeShadowIntensity"))
			: undefined,
		webcamInputPath: enabled ? params.get("smokeWebcamInput") : null,
		webcamShadow: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamShadow"))
			: undefined,
		webcamSize: enabled
			? parseSmokeExportNonNegativeNumber(params.get("smokeWebcamSize"))
			: undefined,
		pipelineModel:
			enabled && params.get("smokePipelineModel") === "modern"
				? "modern"
				: enabled && params.get("smokePipelineModel") === "legacy"
					? "legacy"
					: undefined,
		backendPreference:
			enabled && params.get("smokeBackendPreference") === "auto"
				? "auto"
				: enabled && params.get("smokeBackendPreference") === "webcodecs"
					? "webcodecs"
					: enabled && params.get("smokeBackendPreference") === "breeze"
						? "breeze"
						: undefined,
		maxEncodeQueue: enabled
			? parseSmokeExportNumber(params.get("smokeMaxEncodeQueue"))
			: undefined,
		maxDecodeQueue: enabled
			? parseSmokeExportNumber(params.get("smokeMaxDecodeQueue"))
			: undefined,
		maxPendingFrames: enabled
			? parseSmokeExportNumber(params.get("smokeMaxPendingFrames"))
			: undefined,
		projectPath: enabled ? params.get("smokeProject") : null,
		quality: enabled ? parseSmokeExportQuality(params.get("smokeQuality")) : undefined,
		fps: enabled ? parseSmokeExportFps(params.get("smokeFps")) : undefined,
	};
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

export default function VideoEditor() {
	const { t } = useI18n();
	const smokeExportConfig = useMemo(
		() => getSmokeExportConfig(typeof window === "undefined" ? "" : window.location.search),
		[],
	);
	const [appPlatform, setAppPlatform] = useState<string>(
		typeof navigator !== "undefined" && /Mac/i.test(navigator.platform) ? "darwin" : "",
	);
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [projectLibraryEntries, setProjectLibraryEntries] = useState<ProjectLibraryEntry[]>([]);
	const [projectBrowserOpen, setProjectBrowserOpen] = useState(false);
	const [isEditingProjectName, setIsEditingProjectName] = useState(false);
	const [projectNameDraft, setProjectNameDraft] = useState("");
	const [isSavingProjectName, setIsSavingProjectName] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [wallpaper, setWallpaper] = useState<string>(initialEditorPreferences.wallpaper);
	const [shadowIntensity, setShadowIntensity] = useState(
		initialEditorPreferences.shadowIntensity,
	);
	const [backgroundBlur, setBackgroundBlur] = useState(initialEditorPreferences.backgroundBlur);
	const [zoomMotionBlur, setZoomMotionBlur] = useState(initialEditorPreferences.zoomMotionBlur);
	const [autoApplyFreshRecordingAutoZooms, setAutoApplyFreshRecordingAutoZooms] = useState(
		initialEditorPreferences.autoApplyFreshRecordingAutoZooms,
	);
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
	const [cursorSmoothing, setCursorSmoothing] = useState(
		initialEditorPreferences.cursorSmoothing,
	);
	const [zoomSmoothness, setZoomSmoothness] = useState(0.5);
	const [zoomClassicMode, setZoomClassicMode] = useState(false);
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
	const [frame, setFrame] = useState<string | null>(initialEditorPreferences.frame);
	const [cropRegion, setCropRegion] = useState<CropRegion>(DEFAULT_CROP_REGION);
	const [webcam, setWebcam] = useState<WebcamOverlaySettings>(
		initialEditorPreferences.webcam ?? DEFAULT_WEBCAM_OVERLAY,
	);
	const [resolvedWebcamVideoUrl, setResolvedWebcamVideoUrl] = useState<string | null>(null);
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	// Tracks the videoSourcePath for which the cursor telemetry IPC has already
	// resolved. The smoke-export auto-trigger waits on this so long recordings
	// still bake cursor/zoom animations into the output — without it, the
	// auto-export fires as soon as the video loads and the telemetry arrives
	// after encoding has started.
	const [cursorTelemetrySourcePath, setCursorTelemetrySourcePath] = useState<string | null>(null);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
	const [clipRegions, setClipRegions] = useState<ClipRegion[]>([]);
	const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
	const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [autoCaptions, setAutoCaptions] = useState<CaptionCue[]>([]);
	const [autoCaptionSettings, setAutoCaptionSettings] = useState<AutoCaptionSettings>(
		DEFAULT_AUTO_CAPTION_SETTINGS,
	);
	const [whisperExecutablePath, setWhisperExecutablePath] = useState<string | null>(
		initialEditorPreferences.whisperExecutablePath,
	);
	const [whisperModelPath, setWhisperModelPath] = useState<string | null>(
		initialEditorPreferences.whisperModelPath,
	);
	const [downloadedWhisperModelPath, setDownloadedWhisperModelPath] = useState<string | null>(
		null,
	);
	const [whisperModelDownloadStatus, setWhisperModelDownloadStatus] = useState<
		"idle" | "downloading" | "downloaded" | "error"
	>(initialEditorPreferences.whisperModelPath ? "downloaded" : "idle");
	const [whisperModelDownloadProgress, setWhisperModelDownloadProgress] = useState(0);
	const [isGeneratingCaptions, setIsGeneratingCaptions] = useState(false);
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
	const [previewVolume, setPreviewVolume] = useState(1);
	const [sourceAudioFallbackPaths, setSourceAudioFallbackPaths] = useState<string[]>([]);
	const [sourceAudioFallbackStartDelayMsByPath, setSourceAudioFallbackStartDelayMsByPath] =
		useState<Record<string, number>>({});
	const [aspectRatio, setAspectRatio] = useState<AspectRatio>(
		initialEditorPreferences.aspectRatio,
	);
	const [activeEffectSection, setActiveEffectSection] = useState<EditorEffectSection>("scene");
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		initialEditorPreferences.exportQuality,
	);
	const [exportEncodingMode, setExportEncodingMode] = useState<ExportEncodingMode>(
		initialEditorPreferences.exportEncodingMode,
	);
	const [exportBackendPreference, setExportBackendPreference] = useState<ExportBackendPreference>(
		initialEditorPreferences.exportBackendPreference,
	);
	const [exportPipelineModel, setExportPipelineModel] = useState<ExportPipelineModel>(
		initialEditorPreferences.exportPipelineModel,
	);
	const [mp4FrameRate, setMp4FrameRate] = useState<ExportMp4FrameRate>(
		initialEditorPreferences.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE,
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
	const [isPreviewReady, setIsPreviewReady] = useState(false);
	const [autoSuggestZoomsTrigger, setAutoSuggestZoomsTrigger] = useState(0);
	const headerLeftControlsPaddingClass = appPlatform === "darwin" ? "pl-[76px]" : "";

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
	const projectBrowserTriggerRef = useRef<HTMLButtonElement | null>(null);
	const projectBrowserFallbackTriggerRef = useRef<HTMLButtonElement | null>(null);
	const projectNameInputRef = useRef<HTMLInputElement | null>(null);
	const nextZoomIdRef = useRef(1);
	const nextClipIdRef = useRef(1);
	const nextAudioIdRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
	const exporterRef = useRef<CancelableExporter | null>(null);
	const autoSuggestedVideoPathRef = useRef<string | null>(null);
	const pendingFreshRecordingAutoZoomPathRef = useRef<string | null>(null);
	const historyPastRef = useRef<EditorHistorySnapshot[]>([]);
	const historyFutureRef = useRef<EditorHistorySnapshot[]>([]);
	const historyCurrentRef = useRef<EditorHistorySnapshot | null>(null);
	const applyingHistoryRef = useRef(false);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);
	const pendingTelemetryRetryTimeoutRef = useRef<number | null>(null);
	const pendingFreshRecordingAutoSuggestTimeoutRef = useRef<number | null>(null);
	const pendingFreshRecordingAutoSuggestTelemetryCountRef = useRef(0);
	const cropSnapshotRef = useRef<CropRegion | null>(null);
	const mp4SupportRequestRef = useRef(0);
	const smokeExportStartedRef = useRef(false);
	const projectAutosaveTimeoutRef = useRef<number | null>(null);
	const projectSaveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
	const [historyVersion, setHistoryVersion] = useState(0);
	const timelineRef = useRef<TimelineEditorHandle>(null);

	function formatTime(seconds: number) {
		if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	const [timelineCollapsed, setTimelineCollapsed] = useState(false);

	useEffect(() => {
		void window.electronAPI?.getPlatform?.()?.then((platform) => {
			setAppPlatform(platform);
		});
	}, []);

	useEffect(() => {
		autoSuggestedVideoPathRef.current = null;
		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = 0;
		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}
	}, []);

	// Auto-activate builtin extensions at editor startup (idempotent)
	useEffect(() => {
		extensionHost.autoActivateBuiltins();
	}, []);

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
		const pending = pendingExportSaveRef.current;
		pendingExportSaveRef.current = null;
		setHasPendingExportSave(false);
		if (pending?.tempFilePath && typeof window !== "undefined") {
			// Best-effort cleanup — main-process also reaps stale temp files on
			// before-quit, so we ignore failures here.
			void window.electronAPI.discardExportedTemp?.(pending.tempFilePath);
		}
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
		const editorBgHsl = getComputedStyle(document.documentElement)
			.getPropertyValue("--editor-bg")
			.trim();
		context.fillStyle = editorBgHsl ? `hsl(${editorBgHsl})` : "#111113";
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
					webcamUrl:
						resolvedWebcamVideoUrl ??
						(webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
					videoWidth: previewVideo.videoWidth,
					videoHeight: previewVideo.videoHeight,
					annotationRegions,
					autoCaptions,
					autoCaptionSettings,
					speedRegions: (() => {
						const clipDerived: SpeedRegion[] = clipRegions
							.filter((clip) => clip.speed !== 1)
							.map((clip) => ({
								id: `clip-speed-${clip.id}`,
								startMs: clip.startMs,
								endMs: getClipSourceEndMs(clip),
								speed: clip.speed as SpeedRegion["speed"],
							}));
						if (clipDerived.length === 0) return speedRegions;
						const result = [...speedRegions];
						for (const cs of clipDerived) {
							const overlaps = speedRegions.some(
								(sr) => sr.endMs > cs.startMs && sr.startMs < cs.endMs,
							);
							if (!overlaps) {
								result.push(cs);
							}
						}
						return result;
					})(),
					previewWidth,
					previewHeight,
					cursorTelemetry,
					showCursor,
					cursorStyle,
					cursorSize,
					cursorSmoothing,
					zoomSmoothness,
					zoomClassicMode,
					cursorMotionBlur,
					cursorClickBounce,
					cursorClickBounceDuration,
					cursorSway,
				});
				await frameRenderer.initialize();
				await frameRenderer.renderFrame(videoFrame, frameTimestampUs);
				return frameRenderer.getCanvas().toDataURL("image/png");
			} catch (thumbnailRenderError) {
				console.warn(
					"Unable to render thumbnail from composed frame:",
					thumbnailRenderError,
				);
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
			drawableSource instanceof HTMLVideoElement
				? drawableSource.videoWidth
				: drawableSource.width;
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
		zoomSmoothness,
		cursorStyle,
		cursorSway,
		cursorTelemetry,
		clipRegions,
		padding,
		resolvedWebcamVideoUrl,
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
		zoomClassicMode,
	]);

	const markExportAsSaving = useCallback(() => {
		setExportProgress((previous) => ({
			currentFrame: previous?.totalFrames ?? previous?.currentFrame ?? 1,
			totalFrames: previous?.totalFrames ?? previous?.currentFrame ?? 1,
			percentage: 100,
			estimatedTimeRemaining: 0,
			renderFps: previous?.renderFps,
			renderBackend: previous?.renderBackend,
			encodeBackend: previous?.encodeBackend,
			encoderName: previous?.encoderName,
			phase: "saving",
		}));
	}, []);

	const remountPreview = useCallback(() => {
		setIsPreviewReady(false);
		setPreviewVersion((version) => version + 1);
	}, []);

	const clearPendingProjectAutosave = useCallback(() => {
		if (projectAutosaveTimeoutRef.current !== null) {
			window.clearTimeout(projectAutosaveTimeoutRef.current);
			projectAutosaveTimeoutRef.current = null;
		}
	}, []);

	const queueProjectSave = useCallback((task: () => Promise<boolean>) => {
		const run = projectSaveQueueRef.current.catch(() => undefined).then(task);
		projectSaveQueueRef.current = run.catch(() => undefined);
		return run;
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
			if (pendingTelemetryRetryTimeoutRef.current !== null) {
				window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
				pendingTelemetryRetryTimeoutRef.current = null;
			}
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
			if (projectAutosaveTimeoutRef.current !== null) {
				window.clearTimeout(projectAutosaveTimeoutRef.current);
				projectAutosaveTimeoutRef.current = null;
			}
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

	const ensureSupportedMp4SourceDimensions = useCallback(
		async (frameRate: ExportMp4FrameRate) => {
			const result = await probeSupportedMp4Dimensions({
				width: desiredMp4SourceDimensions.width,
				height: desiredMp4SourceDimensions.height,
				frameRate,
				codec: DEFAULT_MP4_CODEC,
				getBitrate: getSourceQualityBitrate,
			});

			if (!result.encoderPath) {
				throw new Error(
					`Video encoding not supported on this system. Tried codec ${DEFAULT_MP4_CODEC} at ${frameRate} FPS up to ${desiredMp4SourceDimensions.width}x${desiredMp4SourceDimensions.height}.`,
				);
			}

			setSupportedMp4SourceDimensions((current) => {
				if (
					current.width === result.width &&
					current.height === result.height &&
					current.capped === result.capped &&
					current.encoderPath?.codec === result.encoderPath?.codec &&
					current.encoderPath?.hardwareAcceleration ===
						result.encoderPath?.hardwareAcceleration
				) {
					return current;
				}

				return result;
			});

			return result;
		},
		[desiredMp4SourceDimensions.height, desiredMp4SourceDimensions.width],
	);

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

		void ensureSupportedMp4SourceDimensions(mp4FrameRate)
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
		mp4FrameRate,
	]);

	// Extension-contributed standalone section pages (no parentSection)
	const [extensionSectionButtons, setExtensionSectionButtons] = useState<
		{ id: EditorEffectSection; label: string; icon: typeof PhPuzzle | string }[]
	>([]);
	useEffect(() => {
		const update = () => {
			const panels = extensionHost.getSettingsPanels();
			const standalone = panels
				.filter((p) => !p.panel.parentSection)
				.map((p) => ({
					id: `ext:${p.extensionId}/${p.panel.id}` as EditorEffectSection,
					label: p.panel.label,
					icon: p.panel.icon || (PhPuzzle as typeof PhPuzzle | string),
				}));
			setExtensionSectionButtons(standalone);
		};
		update();
		return extensionHost.onChange(update);
	}, []);

	const editorSectionButtons = useMemo(
		() => [
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: PhSparkle },
			{
				id: "cursor" as const,
				label: t("settings.sections.cursor", "Cursor"),
				icon: PhCursorFill,
			},
			{
				id: "webcam" as const,
				label: t("settings.sections.webcam", "Webcam"),
				icon: PhCamera,
			},
			{
				id: "captions" as const,
				label: t("settings.sections.captions", "Captions"),
				icon: PhCaptions,
			},
			{
				id: "settings" as const,
				label: t("settings.sections.settings", "Settings"),
				icon: PhSettings,
			},
			...extensionSectionButtons,
			{
				id: "extensions" as const,
				label: t("settings.sections.extensions", "Extensions"),
				icon: PhPuzzle,
			},
		],
		[t, extensionSectionButtons],
	);

	useEffect(() => {
		if (activeEffectSection === "frame" || activeEffectSection === "crop") {
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
				zoomSmoothness: number;
				zoomClassicMode: boolean;
				cursorMotionBlur: number;
				cursorClickBounce: number;
				cursorClickBounceDuration: number;
				cursorSway: number;
				borderRadius: number;
				padding: Padding;
				frame: string | null;
				cropRegion: CropRegion;
				webcam: WebcamOverlaySettings;
				zoomRegions: ZoomRegion[];
				trimRegions: TrimRegion[];
				clipRegions: ClipRegion[];
				speedRegions: SpeedRegion[];
				annotationRegions: AnnotationRegion[];
				audioRegions: AudioRegion[];
				autoCaptions: CaptionCue[];
				autoCaptionSettings: AutoCaptionSettings;
				aspectRatio: AspectRatio;
				exportEncodingMode: ExportEncodingMode;
				exportBackendPreference: ExportBackendPreference;
				exportPipelineModel: ExportPipelineModel;
				exportQuality: ExportQuality;
				mp4FrameRate: ExportMp4FrameRate;
				exportFormat: ExportFormat;
				gifFrameRate: GifFrameRate;
				gifLoop: boolean;
				gifSizePreset: GifSizePreset;
			}>,
		) => {
			return editor;
		},
		[],
	);

	const currentSourcePath = useMemo(
		() => videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null),
		[videoPath, videoSourcePath],
	);
	const { hasEmbeddedSourceAudio, externalAudioPaths: previewSourceAudioFallbackPaths } = useMemo(
		() => resolveSourceAudioFallbackPaths(currentSourcePath, sourceAudioFallbackPaths),
		[currentSourcePath, sourceAudioFallbackPaths],
	);
	const shouldMutePreviewVideo =
		!hasEmbeddedSourceAudio && previewSourceAudioFallbackPaths.length > 0;

	useEffect(() => {
		let cancelled = false;
		setSourceAudioFallbackPaths([]);
		setSourceAudioFallbackStartDelayMsByPath({});

		if (!currentSourcePath) {
			return () => {
				cancelled = true;
			};
		}

		void (async () => {
			try {
				const result =
					await window.electronAPI.getVideoAudioFallbackPaths(currentSourcePath);
				if (cancelled) {
					return;
				}
				if (!result.success) {
					setSourceAudioFallbackPaths([]);
					setSourceAudioFallbackStartDelayMsByPath({});
					toast.warning(
						result.error
							? `Could not load companion audio sources: ${summarizeErrorMessage(result.error)}`
							: "Could not load companion audio sources. Playback and export may miss microphone audio.",
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
					return;
				}

				toast.dismiss(SOURCE_AUDIO_FALLBACK_TOAST_ID);
				setSourceAudioFallbackPaths(result.paths ?? []);
				setSourceAudioFallbackStartDelayMsByPath(result.startDelayMsByPath ?? {});
			} catch (error) {
				if (!cancelled) {
					setSourceAudioFallbackPaths([]);
					setSourceAudioFallbackStartDelayMsByPath({});
					toast.warning(
						`Could not load companion audio sources: ${summarizeErrorMessage(String(error))}`,
						{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
					);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [currentSourcePath]);

	const projectDisplayName = useMemo(() => {
		const fileName =
			currentProjectPath?.split(/[\\/]/).pop() ??
			currentSourcePath?.split(/[\\/]/).pop() ??
			"";
		const withoutExtension = fileName.replace(/\.recordly$/i, "").replace(/\.[^.]+$/, "");
		return withoutExtension || t("editor.project.untitled", "Untitled");
	}, [currentProjectPath, currentSourcePath, t]);

	useEffect(() => {
		if (!isEditingProjectName) {
			setProjectNameDraft(projectDisplayName);
		}
	}, [isEditingProjectName, projectDisplayName]);

	useEffect(() => {
		if (!isEditingProjectName) {
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			projectNameInputRef.current?.focus();
			projectNameInputRef.current?.select();
		});

		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [isEditingProjectName]);

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
				zoomSmoothness,
				zoomClassicMode,
				cursorMotionBlur,
				cursorClickBounce,
				cursorClickBounceDuration,
				cursorSway,
				borderRadius,
				padding,
				frame,
				webcam,
				zoomRegions,
				trimRegions,
				clipRegions,
				speedRegions,
				annotationRegions,
				audioRegions,
				autoCaptions,
				autoCaptionSettings,
				aspectRatio,
				exportEncodingMode,
				exportBackendPreference,
				exportPipelineModel,
				exportQuality,
				mp4FrameRate,
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
			zoomSmoothness,
			zoomClassicMode,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			borderRadius,
			padding,
			webcam,
			zoomRegions,
			trimRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			autoCaptionSettings,
			aspectRatio,
			exportEncodingMode,
			exportBackendPreference,
			exportPipelineModel,
			exportQuality,
			mp4FrameRate,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			frame,
		],
	);

	const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
		return {
			zoomRegions,
			clipRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			autoCaptions,
			selectedZoomId,
			selectedClipId,
			selectedAnnotationId,
			selectedAudioId,
		};
	}, [
		zoomRegions,
		clipRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		autoCaptions,
		selectedZoomId,
		selectedClipId,
		selectedAnnotationId,
		selectedAudioId,
	]);

	const applyHistorySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			applyingHistoryRef.current = true;
			const cloned = cloneSnapshot(snapshot);
			setZoomRegions(cloned.zoomRegions);
			setClipRegions(cloned.clipRegions);
			setSpeedRegions(cloned.speedRegions);
			setAnnotationRegions(cloned.annotationRegions);
			setAudioRegions(cloned.audioRegions);
			setAutoCaptions(cloned.autoCaptions);
			setSelectedZoomId(cloned.selectedZoomId);
			setSelectedClipId(cloned.selectedClipId);
			setSelectedAnnotationId(cloned.selectedAnnotationId);
			setSelectedAudioId(cloned.selectedAudioId);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				cloned.zoomRegions.map((region) => region.id),
			);
			nextClipIdRef.current = deriveNextId(
				"clip",
				cloned.clipRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				cloned.annotationRegions.map((region) => region.id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				cloned.audioRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				cloned.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) +
				1;
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
				setVideoPath(await resolveVideoUrl(sourcePath));
				setCurrentProjectPath(path ?? null);
				pendingFreshRecordingAutoZoomPathRef.current = null;
				if (normalizedEditor.webcam.sourcePath) {
					await window.electronAPI.setCurrentRecordingSession?.({
						videoPath: sourcePath,
						webcamPath: normalizedEditor.webcam.sourcePath,
						timeOffsetMs: normalizedEditor.webcam.timeOffsetMs,
					}, {
						preserveProjectPath: Boolean(path),
					});
				} else {
					await window.electronAPI.setCurrentVideoPath(sourcePath, {
						preserveProjectPath: Boolean(path),
					});
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
			setZoomSmoothness(normalizedEditor.zoomSmoothness);
			setZoomClassicMode(normalizedEditor.zoomClassicMode);
			setCursorMotionBlur(normalizedEditor.cursorMotionBlur);
			setCursorClickBounce(normalizedEditor.cursorClickBounce);
			setCursorClickBounceDuration(normalizedEditor.cursorClickBounceDuration);
			setCursorSway(normalizedEditor.cursorSway);
			setBorderRadius(normalizedEditor.borderRadius);
			setPadding(normalizedEditor.padding);
			setFrame(normalizedEditor.frame);
			setCropRegion(normalizedEditor.cropRegion);
			setWebcam(normalizedEditor.webcam);
			setZoomRegions(normalizedEditor.zoomRegions);
			setTrimRegions(normalizedEditor.trimRegions);
			setClipRegions(normalizedEditor.clipRegions);
			clipInitializedRef.current = normalizedEditor.clipRegions.length > 0;
			autoFullTrackClipIdRef.current = null;
			autoFullTrackClipEndMsRef.current = null;
			setSpeedRegions(normalizedEditor.speedRegions);
			setAnnotationRegions(normalizedEditor.annotationRegions);
			setAudioRegions(normalizedEditor.audioRegions);
			setAutoCaptions(normalizedEditor.autoCaptions);
			setAutoCaptionSettings(normalizedEditor.autoCaptionSettings);
			setAspectRatio(normalizedEditor.aspectRatio);
			setExportEncodingMode(normalizedEditor.exportEncodingMode);
			setExportBackendPreference(normalizedEditor.exportBackendPreference);
			setExportPipelineModel(normalizedEditor.exportPipelineModel);
			setExportQuality(normalizedEditor.exportQuality);
			setMp4FrameRate(normalizedEditor.mp4FrameRate);
			setExportFormat(normalizedEditor.exportFormat);
			setGifFrameRate(normalizedEditor.gifFrameRate);
			setGifLoop(normalizedEditor.gifLoop);
			setGifSizePreset(normalizedEditor.gifSizePreset);

			setSelectedZoomId(null);
			setSelectedClipId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				normalizedEditor.zoomRegions.map((region) => region.id),
			);
			nextClipIdRef.current = deriveNextId(
				"clip",
				normalizedEditor.clipRegions.map((region: ClipRegion) => region.id),
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
				cloneStructured(
					createProjectData(
						sourcePath,
						buildPersistedEditorState(normalizedEditor),
						project.projectId ?? null,
					),
				),
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
		return createProjectData(
			currentSourcePath,
			currentPersistedEditorState,
			lastSavedSnapshot?.projectId ?? null,
		);
	}, [currentPersistedEditorState, currentSourcePath, lastSavedSnapshot?.projectId]);

	const syncRecordingSessionWebcam = useCallback(
		async (webcamPath: string | null, timeOffsetMs?: number) => {
			if (!currentSourcePath || !window.electronAPI.setCurrentRecordingSession) {
				return;
			}

			await window.electronAPI.setCurrentRecordingSession({
				videoPath: currentSourcePath,
				webcamPath,
				timeOffsetMs:
					webcamPath && Number.isFinite(timeOffsetMs)
						? (timeOffsetMs ?? DEFAULT_WEBCAM_TIME_OFFSET_MS)
						: webcamPath
							? webcam.timeOffsetMs
							: DEFAULT_WEBCAM_TIME_OFFSET_MS,
			}, {
				preserveProjectPath: Boolean(currentProjectPath),
			});
		},
		[currentProjectPath, currentSourcePath, webcam.timeOffsetMs],
	);

	const syncActiveVideoSource = useCallback(
		async (sourcePath: string, webcamPath?: string | null) => {
			if (webcamPath) {
				await window.electronAPI.setCurrentRecordingSession?.({
					videoPath: sourcePath,
					webcamPath,
					timeOffsetMs: webcam.timeOffsetMs,
				}, {
					preserveProjectPath: Boolean(currentProjectPath),
				});
				return;
			}

			await window.electronAPI.setCurrentVideoPath(sourcePath, {
				preserveProjectPath: Boolean(currentProjectPath),
			});
		},
		[currentProjectPath, webcam.timeOffsetMs],
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
			timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
		}));

		await syncRecordingSessionWebcam(result.path, DEFAULT_WEBCAM_TIME_OFFSET_MS);
		toast.success(t("settings.effects.webcamFootageAdded"));
	}, [syncRecordingSessionWebcam, t]);

	const handleClearWebcam = useCallback(async () => {
		setWebcam((prev) => ({
			...prev,
			enabled: false,
			sourcePath: null,
			timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
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
				currentProjectSnapshot &&
					(!lastSavedSnapshot ||
						!areDeepEqual(currentProjectSnapshot, lastSavedSnapshot)),
			),
		[currentProjectSnapshot, lastSavedSnapshot],
	);

	useEffect(() => {
		async function loadInitialData() {
			try {
				if (smokeExportConfig.enabled && smokeExportConfig.projectPath) {
					const projectResult = await window.electronAPI.openProjectFileAtPath(
						smokeExportConfig.projectPath,
					);
					if (!projectResult.success || !projectResult.project) {
						setError(
							`Smoke export failed to load project ${smokeExportConfig.projectPath}: ${
								projectResult.error || projectResult.message || "unknown error"
							}`,
						);
						return;
					}
					const restored = await applyLoadedProject(
						projectResult.project,
						projectResult.path ?? smokeExportConfig.projectPath,
					);
					if (!restored) {
						setError(
							`Smoke export could not apply project ${smokeExportConfig.projectPath}`,
						);
						return;
					}
					setError(null);
					return;
				}

				if (smokeExportConfig.enabled) {
					if (!smokeExportConfig.inputPath) {
						setError("Smoke export input path is missing.");
						return;
					}

					const sourcePath = fromFileUrl(smokeExportConfig.inputPath);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					const smokeWebcamSourcePath = smokeExportConfig.webcamInputPath
						? fromFileUrl(smokeExportConfig.webcamInputPath)
						: null;
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(null);
					pendingFreshRecordingAutoZoomPathRef.current = null;
					setWebcam((prev) => ({
						...prev,
						enabled: !!smokeWebcamSourcePath,
						sourcePath: smokeWebcamSourcePath,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
						shadow:
							smokeExportConfig.webcamShadow === undefined
								? prev.shadow
								: smokeExportConfig.webcamShadow,
						size:
							smokeExportConfig.webcamSize === undefined
								? prev.size
								: smokeExportConfig.webcamSize,
					}));
					setError(null);
					return;
				}

				const currentProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						// Re-apply user preferences so stale project data does not
						// overwrite the last-used padding, aspect ratio, export
						// settings, etc. that were saved to localStorage.
						setPadding(initialEditorPreferences.padding);
						setBorderRadius(initialEditorPreferences.borderRadius);
						setAspectRatio(initialEditorPreferences.aspectRatio);
						setExportFormat(initialEditorPreferences.exportFormat);
						setMp4FrameRate(
							initialEditorPreferences.mp4FrameRate ?? DEFAULT_MP4_EXPORT_FRAME_RATE,
						);
						setExportQuality(initialEditorPreferences.exportQuality);
						setExportEncodingMode(initialEditorPreferences.exportEncodingMode);
						setExportBackendPreference(
							initialEditorPreferences.exportBackendPreference,
						);
						setExportPipelineModel(initialEditorPreferences.exportPipelineModel);
						setGifFrameRate(initialEditorPreferences.gifFrameRate);
						setGifLoop(initialEditorPreferences.gifLoop);
						setGifSizePreset(initialEditorPreferences.gifSizePreset);
						return;
					}
				}

				const sessionResult = await window.electronAPI.getCurrentRecordingSession?.();
				if (sessionResult?.success && sessionResult.session?.videoPath) {
					const sourcePath = fromFileUrl(sessionResult.session.videoPath);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(null);
					pendingFreshRecordingAutoZoomPathRef.current = autoApplyFreshRecordingAutoZooms
						? sourceVideoUrl
						: null;
					if (sessionResult.session.hideOverlayCursorByDefault) {
						setShowCursor(false);
					}
					setWebcam((prev) => ({
						...prev,
						enabled: Boolean(sessionResult.session?.webcamPath),
						sourcePath: sessionResult.session?.webcamPath ?? null,
						timeOffsetMs:
							sessionResult.session?.timeOffsetMs ?? DEFAULT_WEBCAM_TIME_OFFSET_MS,
					}));
					return;
				}

				const result = await window.electronAPI.getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					const sourceVideoUrl = await resolveVideoUrl(sourcePath);
					setVideoSourcePath(sourcePath);
					setVideoPath(sourceVideoUrl);
					setCurrentProjectPath(null);
					setLastSavedSnapshot(null);
					pendingFreshRecordingAutoZoomPathRef.current = null;
					setWebcam((prev) => ({
						...prev,
						enabled: false,
						sourcePath: null,
						timeOffsetMs: DEFAULT_WEBCAM_TIME_OFFSET_MS,
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
	}, [
		applyLoadedProject,
		autoApplyFreshRecordingAutoZooms,
		initialEditorPreferences,
		smokeExportConfig.enabled,
		smokeExportConfig.inputPath,
		smokeExportConfig.projectPath,
		smokeExportConfig.webcamInputPath,
		smokeExportConfig.webcamShadow,
		smokeExportConfig.webcamSize,
	]);

	useEffect(() => {
		let cancelled = false;
		if (!webcam.sourcePath) {
			setResolvedWebcamVideoUrl(null);
			return;
		}
		void resolveVideoUrl(webcam.sourcePath).then((url) => {
			if (!cancelled) setResolvedWebcamVideoUrl(url);
		});
		return () => {
			cancelled = true;
		};
	}, [webcam.sourcePath]);

	useEffect(() => {
		if (!autoApplyFreshRecordingAutoZooms) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
		}
	}, [autoApplyFreshRecordingAutoZooms]);

	useEffect(() => {
		saveEditorPreferences({
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			autoApplyFreshRecordingAutoZooms,
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
			frame,
			webcam,
			aspectRatio,
			exportEncodingMode,
			exportBackendPreference,
			exportPipelineModel,
			exportQuality,
			mp4FrameRate,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			whisperExecutablePath,
			whisperModelPath,
		});
	}, [
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		autoApplyFreshRecordingAutoZooms,
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
		frame,
		webcam,
		aspectRatio,
		exportEncodingMode,
		exportBackendPreference,
		exportPipelineModel,
		exportQuality,
		mp4FrameRate,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		whisperExecutablePath,
		whisperModelPath,
	]);

	useEffect(() => {
		const unsubscribe = window.electronAPI.onWhisperSmallModelDownloadProgress((state) => {
			setWhisperModelDownloadStatus(state.status);
			setWhisperModelDownloadProgress(state.progress);
			if (state.status === "downloaded") {
				setDownloadedWhisperModelPath(state.path ?? null);
				setWhisperModelPath((currentPath) => currentPath ?? state.path ?? null);
			}
			if (state.status === "idle") {
				setDownloadedWhisperModelPath(null);
			}
			if (state.status === "error" && state.error) {
				toast.error(state.error);
			}
		});

		void (async () => {
			const result = await window.electronAPI.getWhisperSmallModelStatus();
			if (!result.success) {
				return;
			}

			if (result.exists && result.path) {
				setDownloadedWhisperModelPath(result.path);
				setWhisperModelPath((currentPath) => currentPath ?? result.path ?? null);
				setWhisperModelDownloadStatus("downloaded");
				setWhisperModelDownloadProgress(100);
				return;
			}

			setDownloadedWhisperModelPath(null);
			setWhisperModelDownloadStatus("idle");
			setWhisperModelDownloadProgress(0);
		})();

		return () => unsubscribe?.();
	}, []);

	const handlePickWhisperExecutable = useCallback(async () => {
		const result = await window.electronAPI.openWhisperExecutablePicker();
		if (!result.success || !result.path) {
			return;
		}

		setWhisperExecutablePath(result.path);
		toast.success("Whisper executable selected");
	}, []);

	const handleDownloadWhisperSmallModel = useCallback(async () => {
		if (whisperModelDownloadStatus === "downloading") {
			return;
		}

		setWhisperModelDownloadStatus("downloading");
		setWhisperModelDownloadProgress(0);
		const result = await window.electronAPI.downloadWhisperSmallModel();
		if (!result.success) {
			setWhisperModelDownloadStatus("error");
			toast.error(result.error || "Failed to download Whisper small model");
			return;
		}

		if (result.path) {
			setDownloadedWhisperModelPath(result.path);
			setWhisperModelPath(result.path);
		}
	}, [whisperModelDownloadStatus]);

	const handlePickWhisperModel = useCallback(async () => {
		const result = await window.electronAPI.openWhisperModelPicker();
		if (!result.success || !result.path) {
			return;
		}

		setWhisperModelPath(result.path);
		toast.success("Whisper model selected");
	}, []);

	const handleDeleteWhisperSmallModel = useCallback(async () => {
		const result = await window.electronAPI.deleteWhisperSmallModel();
		if (!result.success) {
			toast.error(result.error || "Failed to delete Whisper small model");
			// Reset download state so re-download is not blocked
			setWhisperModelDownloadStatus("idle");
			setWhisperModelDownloadProgress(0);
			return;
		}

		setWhisperModelPath((currentPath) =>
			currentPath === downloadedWhisperModelPath ? null : currentPath,
		);
		setDownloadedWhisperModelPath(null);
		setWhisperModelDownloadStatus("idle");
		setWhisperModelDownloadProgress(0);
		toast.success("Whisper small model deleted");
	}, [downloadedWhisperModelPath]);

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
				currentVideoPath: currentVideoResult.success
					? (currentVideoResult.path ?? null)
					: null,
			});
		}

		if (!sourcePath) {
			toast.error("No source video is loaded");
			return;
		}

		if (sourcePath !== videoSourcePath) {
			setVideoSourcePath(sourcePath);
			setVideoPath(await resolveVideoUrl(sourcePath));
		}

		await syncActiveVideoSource(sourcePath, webcam.sourcePath ?? null);

		if (!whisperModelPath) {
			toast.error("Select a Whisper model or download the small model first");
			return;
		}

		setIsGeneratingCaptions(true);
		try {
			const result = await window.electronAPI.generateAutoCaptions({
				videoPath: sourcePath,
				whisperExecutablePath: whisperExecutablePath ?? undefined,
				whisperModelPath,
				language: autoCaptionSettings.language,
			});

			if (!result.success || !result.cues) {
				toast.error(
					result.message ||
						getErrorMessage(result.error) ||
						"Failed to generate captions",
				);
				return;
			}

			setAutoCaptions(result.cues);
			setAutoCaptionSettings((prev) => ({ ...prev, enabled: true }));
			toast.success(result.message || `Generated ${result.cues.length} captions`);
		} catch (error) {
			toast.error(getErrorMessage(error));
		} finally {
			setIsGeneratingCaptions(false);
		}
	}, [
		autoCaptionSettings.language,
		isGeneratingCaptions,
		webcam.sourcePath,
		syncActiveVideoSource,
		videoPath,
		videoSourcePath,
		whisperExecutablePath,
		whisperModelPath,
	]);

	const handleClearAutoCaptions = useCallback(() => {
		setAutoCaptions([]);
		setAutoCaptionSettings((prev) => ({ ...prev, enabled: false }));
	}, []);

	const saveProject = useCallback(
		async (forceSaveAs: boolean, options?: SaveProjectOptions) => {
			clearPendingProjectAutosave();
			return queueProjectSave(async () => {
				if (!currentSourcePath) {
					if (!options?.silent) {
						toast.error("No video loaded");
					}
					return false;
				}

				const shouldCaptureThumbnail = options?.captureThumbnail ?? true;
				const shouldRefreshLibrary = options?.refreshLibraryAfterSave ?? true;
				const shouldRemountPreview = options?.remountPreviewAfterSave ?? true;

				try {
					const projectData =
						currentProjectSnapshot?.videoPath === currentSourcePath
							? currentProjectSnapshot
							: createProjectData(
									currentSourcePath,
									currentPersistedEditorState,
									lastSavedSnapshot?.projectId ?? null,
								);

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

					const thumbnailDataUrl = shouldCaptureThumbnail
						? await captureProjectThumbnail()
						: undefined;

					const result = await window.electronAPI.saveProjectFile(
						projectData,
						fileNameBase,
						targetProjectPath,
						thumbnailDataUrl,
					);

					if (result.canceled) {
						if (!options?.silent) {
							toast.info("Project save canceled");
						}
						return false;
					}

					if (!result.success) {
						if (!options?.silent) {
							toast.error(result.message || "Failed to save project");
						}
						return false;
					}

					if (result.path) {
						setCurrentProjectPath(result.path);
					}
					setLastSavedSnapshot(
						cloneStructured(
							createProjectData(
								projectData.videoPath,
								projectData.editor,
								result.projectId ?? projectData.projectId ?? null,
							),
						),
					);
					if (shouldRefreshLibrary) {
						await refreshProjectLibrary();
					}

					if (!options?.silent) {
						toast.success(`Project saved to ${result.path}`);
					}
					return true;
				} finally {
					if (shouldRemountPreview) {
						remountPreview();
					}
				}
			});
		},
		[
			captureProjectThumbnail,
			clearPendingProjectAutosave,
			currentSourcePath,
			currentProjectPath,
			currentProjectSnapshot,
			currentPersistedEditorState,
			lastSavedSnapshot?.projectId,
			queueProjectSave,
			refreshProjectLibrary,
			remountPreview,
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

	useEffect(() => {
		if (!currentProjectPath || !hasUnsavedChanges) {
			clearPendingProjectAutosave();
			return;
		}

		projectAutosaveTimeoutRef.current = window.setTimeout(() => {
			projectAutosaveTimeoutRef.current = null;
			void saveProject(false, {
				silent: true,
				remountPreviewAfterSave: false,
				refreshLibraryAfterSave: false,
				captureThumbnail: false,
			});
		}, PROJECT_AUTOSAVE_DELAY_MS);

		return () => {
			clearPendingProjectAutosave();
		};
	}, [clearPendingProjectAutosave, currentProjectPath, hasUnsavedChanges, saveProject]);

	/**
	 * Saves the current project directly into the projects library under a chosen name.
	 */
	const saveProjectWithName = useCallback(
		async (projectName: string) => {
			const trimmedProjectName = projectName.trim();
			if (!trimmedProjectName) {
				toast.error("Project name is required");
				return false;
			}

			if (!currentSourcePath) {
				toast.error("No video loaded");
				return false;
			}

			try {
				const projectData =
					currentProjectSnapshot?.videoPath === currentSourcePath
						? currentProjectSnapshot
						: createProjectData(
								currentSourcePath,
								currentPersistedEditorState,
								lastSavedSnapshot?.projectId ?? null,
							);
				const thumbnailDataUrl = await captureProjectThumbnail();
				const result = await window.electronAPI.saveProjectFileNamed(
					projectData,
					trimmedProjectName,
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
				setLastSavedSnapshot(
					cloneStructured(
						createProjectData(
							projectData.videoPath,
							projectData.editor,
							result.projectId ?? projectData.projectId ?? null,
						),
					),
				);
				await refreshProjectLibrary();
				toast.success(result.path ? `Project saved to ${result.path}` : "Project saved");
				return true;
			} finally {
				remountPreview();
			}
		},
		[
			captureProjectThumbnail,
			currentPersistedEditorState,
			currentProjectSnapshot,
			currentSourcePath,
			lastSavedSnapshot?.projectId,
			refreshProjectLibrary,
			remountPreview,
		],
	);

	/**
	 * Resets the inline project-name editor back to the current saved display name.
	 */
	const closeProjectNameEditor = useCallback(() => {
		setProjectNameDraft(projectDisplayName);
		setIsEditingProjectName(false);
	}, [projectDisplayName]);

	/**
	 * Commits the inline project-name editor and persists the project under that name.
	 */
	const handleProjectNameSubmit = useCallback(
		async (event?: React.FormEvent<HTMLFormElement>) => {
			event?.preventDefault();
			const trimmedProjectName = projectNameDraft.trim();
			if (!trimmedProjectName) {
				closeProjectNameEditor();
				return;
			}

			setIsSavingProjectName(true);
			let saved = false;
			try {
				saved = await saveProjectWithName(trimmedProjectName);
			} catch (error) {
				toast.error(getErrorMessage(error));
			} finally {
				setIsSavingProjectName(false);
			}

			if (saved) {
				setIsEditingProjectName(false);
				return;
			}

			projectNameInputRef.current?.focus();
			projectNameInputRef.current?.select();
		},
		[closeProjectNameEditor, projectNameDraft, saveProjectWithName],
	);

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
		let mounted = true;
		let retryAttempts = 0;

		async function loadCursorTelemetry() {
			if (!videoPath || !videoSourcePath) {
				if (mounted) {
					setCursorTelemetry([]);
					setCursorTelemetrySourcePath(null);
				}
				return;
			}

			try {
				const result = await window.electronAPI.getCursorTelemetry(videoSourcePath);
				if (mounted) {
					const samples = result.success ? result.samples : [];
					setCursorTelemetry(samples);
					setCursorTelemetrySourcePath(videoSourcePath);

					const shouldRetryFreshRecordingTelemetry =
						pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
						autoSuggestedVideoPathRef.current !== videoPath &&
						retryAttempts < 12;

					if (shouldRetryFreshRecordingTelemetry) {
						retryAttempts += 1;
						pendingTelemetryRetryTimeoutRef.current = window.setTimeout(() => {
							pendingTelemetryRetryTimeoutRef.current = null;
							if (mounted) {
								void loadCursorTelemetry();
							}
						}, 350);
					}
				}
			} catch (telemetryError) {
				console.warn("Unable to load cursor telemetry:", telemetryError);
				if (mounted) {
					setCursorTelemetry([]);
					setCursorTelemetrySourcePath(videoSourcePath);
					if (
						pendingFreshRecordingAutoZoomPathRef.current === videoPath &&
						autoSuggestedVideoPathRef.current !== videoPath &&
						retryAttempts < 12
					) {
						retryAttempts += 1;
						pendingTelemetryRetryTimeoutRef.current = window.setTimeout(() => {
							pendingTelemetryRetryTimeoutRef.current = null;
							if (mounted) {
								void loadCursorTelemetry();
							}
						}, 350);
					}
				}
			}
		}

		if (pendingTelemetryRetryTimeoutRef.current !== null) {
			window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
			pendingTelemetryRetryTimeoutRef.current = null;
		}

		loadCursorTelemetry();

		return () => {
			mounted = false;
			if (pendingTelemetryRetryTimeoutRef.current !== null) {
				window.clearTimeout(pendingTelemetryRetryTimeoutRef.current);
				pendingTelemetryRetryTimeoutRef.current = null;
			}
		};
	}, [videoPath, videoSourcePath]);

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

	// Initialize a full-track clip when duration is first known
	const clipInitializedRef = useRef(false);
	const autoFullTrackClipIdRef = useRef<string | null>(null);
	const autoFullTrackClipEndMsRef = useRef<number | null>(null);
	useEffect(() => {
		const totalMs = Math.round(duration * 1000);
		if (totalMs <= 0) return;
		if (!clipInitializedRef.current) {
			if (clipRegions.length === 0) {
				if (trimRegions.length > 0) {
					setClipRegions(trimsToClips(trimRegions, totalMs));
					clipInitializedRef.current = true;
					return;
				}
				const id = `clip-${nextClipIdRef.current++}`;
				autoFullTrackClipIdRef.current = id;
				autoFullTrackClipEndMsRef.current = totalMs;
				setClipRegions([{ id, startMs: 0, endMs: totalMs, speed: 1 }]);
			}
			clipInitializedRef.current = true;
			return;
		}

		const extendedClipRegions = extendAutoFullTrackClip(
			clipRegions,
			autoFullTrackClipIdRef.current,
			autoFullTrackClipEndMsRef.current,
			totalMs,
		);
		if (!extendedClipRegions) return;

		autoFullTrackClipEndMsRef.current = totalMs;
		setClipRegions(extendedClipRegions);
	}, [duration, clipRegions, trimRegions]);

	// Derive trimRegions from clipRegions so export/playback pipelines stay unchanged
	useEffect(() => {
		const totalMs = Math.round(duration * 1000);
		if (totalMs <= 0 || clipRegions.length === 0) return;
		setTrimRegions(clipsToTrims(clipRegions, totalMs));
	}, [clipRegions, duration]);

	const mapTimelineTimeToSourceTime = useCallback(
		(timeMs: number) => resolveTimelineTimeToSourceTime(timeMs, clipRegions),
		[clipRegions],
	);

	const mapSourceTimeToTimelineTime = useCallback(
		(timeMs: number) => resolveSourceTimeToTimelineTime(timeMs, clipRegions),
		[clipRegions],
	);

	const effectiveZoomRegions = useMemo<ZoomRegion[]>(
		() =>
			zoomRegions.map((region) => ({
				...region,
				startMs: mapTimelineTimeToSourceTime(region.startMs),
				endMs: mapTimelineTimeToSourceTime(region.endMs),
			})),
		[zoomRegions, mapTimelineTimeToSourceTime],
	);

	const timelinePlayheadTime = useMemo(
		() => mapSourceTimeToTimelineTime(currentTime * 1000) / 1000,
		[currentTime, mapSourceTimeToTimelineTime],
	);

	// Merge clip speeds into speed regions so playback + export respect per-clip speed
	const effectiveSpeedRegions = useMemo<SpeedRegion[]>(() => {
		const clipDerived: SpeedRegion[] = clipRegions
			.filter((clip) => clip.speed !== 1)
			.map((clip) => ({
				id: `clip-speed-${clip.id}`,
				startMs: clip.startMs,
				endMs: getClipSourceEndMs(clip),
				speed: clip.speed as SpeedRegion["speed"],
			}));
		if (clipDerived.length === 0) return speedRegions;
		const result = [...speedRegions];
		for (const cs of clipDerived) {
			const overlaps = speedRegions.some(
				(sr) => sr.endMs > cs.startMs && sr.startMs < cs.endMs,
			);
			if (!overlaps) {
				result.push(cs);
			}
		}
		return result;
	}, [clipRegions, speedRegions]);

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

	const handleAutoSuggestZoomsConsumed = useCallback(() => {
		setAutoSuggestZoomsTrigger(0);
	}, []);

	function handleSeek(time: number) {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = mapTimelineTimeToSourceTime(time * 1000) / 1000;
	}

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setActiveEffectSection("zoom");
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
		} else {
			setActiveEffectSection((s) => (s === "zoom" ? "scene" : s));
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleZoomAdded = useCallback(
		(span: Span) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const defaultDepth: ZoomDepth = 2;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: defaultDepth,
				focus: clampFocusToDepth({ cx: 0.5, cy: 0.5 }, defaultDepth),
				mode: "auto",
			};
			if (videoPath && pendingFreshRecordingAutoZoomPathRef.current === videoPath) {
				autoSuggestedVideoPathRef.current = videoPath;
				pendingFreshRecordingAutoZoomPathRef.current = null;
			}
			setZoomRegions((prev) => [...prev, newRegion]);
			setSelectedZoomId(id);
			setSelectedAnnotationId(null);
			extensionHost.emitEvent({
				type: "timeline:region-added",
				data: { id, startMs: newRegion.startMs, endMs: newRegion.endMs },
			});
		},
		[videoPath],
	);

	const handleZoomSuggested = useCallback(
		(span: Span, focus: ZoomFocus) => {
			const id = `zoom-${nextZoomIdRef.current++}`;
			const newRegion: ZoomRegion = {
				id,
				startMs: Math.round(span.start),
				endMs: Math.round(span.end),
				depth: DEFAULT_AUTO_ZOOM_DEPTH,
				focus: clampFocusToDepth(focus, DEFAULT_AUTO_ZOOM_DEPTH),
				mode: "auto",
			};
			if (videoPath && pendingFreshRecordingAutoZoomPathRef.current === videoPath) {
				autoSuggestedVideoPathRef.current = videoPath;
				pendingFreshRecordingAutoZoomPathRef.current = null;
			}
			setZoomRegions((prev) => [...prev, newRegion]);
			// Don't auto-select suggested zooms — they follow cursor and don't need user interaction
			extensionHost.emitEvent({
				type: "timeline:region-added",
				data: { id, startMs: newRegion.startMs, endMs: newRegion.endMs },
			});
		},
		[videoPath],
	);

	useEffect(() => {
		if (
			!videoPath ||
			loading ||
			!isPreviewReady ||
			duration <= 0 ||
			zoomRegions.length > 0 ||
			normalizedCursorTelemetry.length < 2
		) {
			if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
				window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
				pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			}
			return;
		}

		if (pendingFreshRecordingAutoZoomPathRef.current !== videoPath) {
			return;
		}

		if (autoSuggestedVideoPathRef.current === videoPath) {
			pendingFreshRecordingAutoZoomPathRef.current = null;
			return;
		}

		const telemetryPointCount = cursorTelemetry.length;
		if (pendingFreshRecordingAutoSuggestTelemetryCountRef.current === telemetryPointCount) {
			return;
		}

		pendingFreshRecordingAutoSuggestTelemetryCountRef.current = telemetryPointCount;

		if (pendingFreshRecordingAutoSuggestTimeoutRef.current !== null) {
			window.clearTimeout(pendingFreshRecordingAutoSuggestTimeoutRef.current);
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
		}

		pendingFreshRecordingAutoSuggestTimeoutRef.current = window.setTimeout(() => {
			pendingFreshRecordingAutoSuggestTimeoutRef.current = null;
			if (
				pendingFreshRecordingAutoZoomPathRef.current !== videoPath ||
				autoSuggestedVideoPathRef.current === videoPath ||
				zoomRegions.length > 0
			) {
				return;
			}

			setAutoSuggestZoomsTrigger((value) => value + 1);
		}, 500);
	}, [
		videoPath,
		loading,
		isPreviewReady,
		duration,
		cursorTelemetry.length,
		normalizedCursorTelemetry,
		zoomRegions,
	]);

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

	const handleZoomModeChange = useCallback(
		(mode: ZoomMode) => {
			if (!selectedZoomId) return;
			setZoomRegions((prev) =>
				prev.map((region) => (region.id === selectedZoomId ? { ...region, mode } : region)),
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
			extensionHost.emitEvent({ type: "timeline:region-removed", data: { id } });
		},
		[selectedZoomId],
	);

	const handleSelectClip = useCallback((id: string | null) => {
		setSelectedClipId(id);
		if (id) {
			setActiveEffectSection("clip");
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
		} else {
			setActiveEffectSection((s) => (s === "clip" ? "scene" : s));
		}
	}, []);

	const handleClipSplit = useCallback(
		(splitMs: number) => {
			setClipRegions((prev) => {
				const target = prev.find((c) => splitMs > c.startMs && splitMs < c.endMs);
				if (!target) return prev;
				const leftId = `clip-${nextClipIdRef.current++}`;
				const rightId = `clip-${nextClipIdRef.current++}`;
				const left: ClipRegion = {
					id: leftId,
					startMs: target.startMs,
					endMs: Math.round(splitMs),
					speed: target.speed,
					muted: target.muted,
				};
				const right: ClipRegion = {
					id: rightId,
					startMs: Math.round(splitMs),
					endMs: target.endMs,
					speed: target.speed,
					muted: target.muted,
				};
				if (selectedClipId === target.id) {
					setSelectedClipId(leftId);
				}
				return prev.flatMap((c) => (c.id === target.id ? [left, right] : [c]));
			});
		},
		[selectedClipId],
	);

	const handleClipSpanChange = useCallback(
		(id: string, span: Span) => {
			const oldClip = clipRegions.find((c) => c.id === id);
			const newStart = Math.round(span.start);
			const newEnd = Math.round(span.end);
			const removedSegments = oldClip
				? [
						...(newStart > oldClip.startMs
							? [{ startMs: oldClip.startMs, endMs: newStart }]
							: []),
						...(newEnd < oldClip.endMs
							? [{ startMs: newEnd, endMs: oldClip.endMs }]
							: []),
					]
				: [];

			if (oldClip) {
				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				const isMove = Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0;

				if (isMove) {
					const delta = startDelta;
					setZoomRegions((prev) =>
						prev.map((zoom) => {
							const overlaps =
								zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs;
							if (overlaps) {
								return {
									...zoom,
									startMs: zoom.startMs + delta,
									endMs: zoom.endMs + delta,
								};
							}
							return zoom;
						}),
					);
				}
			}

			if (removedSegments.length > 0) {
				const removeTrimmedRegions = <T extends { startMs: number; endMs: number }>(
					regions: T[],
				): T[] =>
					regions.filter(
						(region) =>
							!removedSegments.some(
								(segment) =>
									region.startMs < segment.endMs &&
									region.endMs > segment.startMs,
							),
					);
				setZoomRegions((prev) => removeTrimmedRegions(prev));
				setAnnotationRegions((prev) => removeTrimmedRegions(prev));
				setSpeedRegions((prev) => removeTrimmedRegions(prev));
				setAudioRegions((prev) => removeTrimmedRegions(prev));
			}

			setClipRegions((prev) =>
				prev.map((clip) =>
					clip.id === id ? { ...clip, startMs: newStart, endMs: newEnd } : clip,
				),
			);
		},
		[clipRegions],
	);

	const handleClipSpeedChange = useCallback(
		(speed: number) => {
			if (!selectedClipId) return;
			if (!Number.isFinite(speed) || speed <= 0) {
				return;
			}
			const clip = clipRegions.find((c) => c.id === selectedClipId);
			if (!clip) return;
			const oldSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
			const sourceDurationMs = (clip.endMs - clip.startMs) * oldSpeed;
			const newEndMs = Math.round(clip.startMs + sourceDurationMs / speed);
			const scaleFactor = oldSpeed / speed;

			setClipRegions((prev) =>
				prev.map((c) => (c.id === selectedClipId ? { ...c, speed, endMs: newEndMs } : c)),
			);
			// Scale zoom regions that lie within this clip proportionally
			setZoomRegions((prev) =>
				prev.map((zoom) => {
					if (zoom.startMs < clip.startMs || zoom.startMs >= clip.endMs) return zoom;
					return {
						...zoom,
						startMs: Math.round(
							clip.startMs + (zoom.startMs - clip.startMs) * scaleFactor,
						),
						endMs: Math.round(clip.startMs + (zoom.endMs - clip.startMs) * scaleFactor),
					};
				}),
			);
		},
		[selectedClipId, clipRegions],
	);

	const handleClipMutedChange = useCallback(
		(muted: boolean) => {
			if (!selectedClipId) return;
			setClipRegions((prev) =>
				prev.map((clip) => (clip.id === selectedClipId ? { ...clip, muted } : clip)),
			);
		},
		[selectedClipId],
	);

	const handleClipDelete = useCallback(
		(id: string) => {
			const deletedClip = clipRegions.find((clip) => clip.id === id);
			setClipRegions((prev) => prev.filter((clip) => clip.id !== id));
			if (deletedClip) {
				const { startMs, endMs } = deletedClip;
				setZoomRegions((prev) =>
					prev.filter((region) => region.endMs <= startMs || region.startMs >= endMs),
				);
				setAnnotationRegions((prev) =>
					prev.filter((region) => region.endMs <= startMs || region.startMs >= endMs),
				);
				setSpeedRegions((prev) =>
					prev.filter((region) => region.endMs <= startMs || region.startMs >= endMs),
				);
				setAudioRegions((prev) =>
					prev.filter((region) => region.endMs <= startMs || region.startMs >= endMs),
				);
			}
			if (selectedClipId === id) {
				setSelectedClipId(null);
			}
		},
		[clipRegions, selectedClipId],
	);

	const handleSelectAudio = useCallback((id: string | null) => {
		setSelectedAudioId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
		}
	}, []);

	const handleAudioAdded = useCallback((span: Span, audioPath: string, trackIndex?: number) => {
		const id = `audio-${nextAudioIdRef.current++}`;
		const newRegion: AudioRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			audioPath,
			volume: 1,
			trackIndex,
		};
		setAudioRegions((prev) => [...prev, newRegion]);
		setSelectedAudioId(id);
		setSelectedZoomId(null);
		setSelectedAnnotationId(null);
	}, []);

	const handleAudioSpanChange = useCallback((id: string, span: Span, trackIndex?: number) => {
		const normalizedTrackIndex =
			typeof trackIndex === "number" && Number.isFinite(trackIndex)
				? Math.max(0, Math.floor(trackIndex))
				: undefined;

		setAudioRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							startMs: Math.round(span.start),
							endMs: Math.round(span.end),
							...(normalizedTrackIndex === undefined
								? {}
								: { trackIndex: normalizedTrackIndex }),
						}
					: region,
			),
		);
	}, []);

	const handleAudioVolumeChange = useCallback((volume: number) => {
		if (!selectedAudioId) {
			return;
		}

		if (!Number.isFinite(volume)) {
			return;
		}

		const nextVolume = Math.max(0, Math.min(1, volume));
		setAudioRegions((prev) =>
			prev.map((region) =>
				region.id === selectedAudioId ? { ...region, volume: nextVolume } : region,
			),
		);
	}, [selectedAudioId]);

	const handleAudioDelete = useCallback(
		(id: string) => {
			setAudioRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedAudioId === id) {
				setSelectedAudioId(null);
			}
		},
		[selectedAudioId],
	);

	const handleAnnotationAdded = useCallback((span: Span, trackIndex = 0) => {
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
			trackIndex,
		};
		setAnnotationRegions((prev) => [...prev, newRegion]);
		setSelectedAnnotationId(id);
		setSelectedZoomId(null);
	}, []);

	const handleAnnotationSpanChange = useCallback(
		(id: string, span: Span, trackIndex?: number) => {
			const normalizedTrackIndex =
				typeof trackIndex === "number" && Number.isFinite(trackIndex)
					? Math.max(0, Math.floor(trackIndex))
					: undefined;

			setAnnotationRegions((prev) =>
				prev.map((region) =>
					region.id === id
						? {
								...region,
								startMs: Math.round(span.start),
								endMs: Math.round(span.end),
								...(normalizedTrackIndex === undefined
									? {}
									: { trackIndex: normalizedTrackIndex }),
							}
						: region,
				),
			);
		},
		[],
	);

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
					if (region.blurIntensity === undefined) {
						updatedRegion.blurIntensity = 20;
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

	const handleAnnotationBlurColorChange = useCallback((id: string, blurColor: string) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, blurColor } : region)),
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
		if (
			selectedAnnotationId &&
			!annotationRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
	}, [selectedAnnotationId, annotationRegions]);

	useEffect(() => {
		if (selectedAudioId && !audioRegions.some((region) => region.id === selectedAudioId)) {
			setSelectedAudioId(null);
		}
	}, [selectedAudioId, audioRegions]);

	// Audio playback sync: manage Audio elements that play in sync with video
	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const audioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const audioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const sourceAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
	const sourceAudioElementRevokersRef = useRef<Map<string, () => void>>(new Map());
	const sourceAudioElementResourcesRef = useRef<Map<string, string>>(new Map());
	const lastSourceAudioSyncTimeRef = useRef<number | null>(null);

	useEffect(() => {
		let cancelled = false;
		const existing = audioElementsRef.current;
		const currentIds = new Set(audioRegions.map((r) => r.id));

		// Remove old audio elements
		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(id)?.();
				audioElementRevokersRef.current.delete(id);
				audioElementResourcesRef.current.delete(id);
				existing.delete(id);
			}
		}

		// Create/update audio elements
		for (const region of audioRegions) {
			let audio = existing.get(region.id);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(region.id, audio);
			}

			if (audioElementResourcesRef.current.get(region.id) !== region.audioPath) {
				audio.pause();
				audio.src = "";
				audioElementRevokersRef.current.get(region.id)?.();
				audioElementRevokersRef.current.delete(region.id);
				audioElementResourcesRef.current.set(region.id, region.audioPath);

				void (async () => {
					const resolved = await resolveMediaElementSource(region.audioPath);
					const latestAudio = existing.get(region.id);

					if (
						cancelled ||
						latestAudio !== audio ||
						audioElementResourcesRef.current.get(region.id) !== region.audioPath
					) {
						resolved.revoke();
						return;
					}

					audioElementRevokersRef.current.set(region.id, resolved.revoke);
					latestAudio.src = resolved.src;
				})();
			}

			audio.volume = Math.max(0, Math.min(1, region.volume * previewVolume));
		}

		return () => {
			cancelled = true;
		};
	}, [audioRegions, previewVolume]);

	useEffect(() => {
		let cancelled = false;
		const existing = sourceAudioElementsRef.current;
		const currentIds = new Set(previewSourceAudioFallbackPaths);

		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				sourceAudioElementRevokersRef.current.get(id)?.();
				sourceAudioElementRevokersRef.current.delete(id);
				sourceAudioElementResourcesRef.current.delete(id);
				existing.delete(id);
			}
		}

		for (const audioPath of previewSourceAudioFallbackPaths) {
			let audio = existing.get(audioPath);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(audioPath, audio);
			}
			audio.dataset.sourceAudioPath = audioPath;

			if (sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath) {
				audio.pause();
				audio.src = "";
				sourceAudioElementRevokersRef.current.get(audioPath)?.();
				sourceAudioElementRevokersRef.current.delete(audioPath);
				sourceAudioElementResourcesRef.current.set(audioPath, audioPath);

				void (async () => {
					try {
						const resolved = await resolveMediaElementSource(audioPath);
						const latestAudio = existing.get(audioPath);

						if (
							cancelled ||
							latestAudio !== audio ||
							sourceAudioElementResourcesRef.current.get(audioPath) !== audioPath
						) {
							resolved.revoke();
							return;
						}

						sourceAudioElementRevokersRef.current.set(audioPath, resolved.revoke);
						latestAudio.src = resolved.src;
					} catch (error) {
						if (cancelled) {
							return;
						}

						sourceAudioElementRevokersRef.current.get(audioPath)?.();
						sourceAudioElementRevokersRef.current.delete(audioPath);
						sourceAudioElementResourcesRef.current.delete(audioPath);
						const latestAudio = existing.get(audioPath);
						if (latestAudio === audio) {
							latestAudio.pause();
							latestAudio.src = "";
						}
						toast.warning(
							`Could not load companion audio source: ${summarizeErrorMessage(getErrorMessage(error))}`,
							{ id: SOURCE_AUDIO_FALLBACK_TOAST_ID, duration: 10000 },
						);
					}
				})();
			}

			audio.volume = Math.max(0, Math.min(1, previewVolume));
		}

		if (previewSourceAudioFallbackPaths.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
		}

		return () => {
			cancelled = true;
		};
	}, [previewSourceAudioFallbackPaths, previewVolume]);

	useEffect(() => {
		return () => {
			for (const audio of audioElementsRef.current.values()) {
				audio.pause();
				audio.src = "";
			}
			for (const revoke of audioElementRevokersRef.current.values()) {
				revoke();
			}
			audioElementsRef.current.clear();
			audioElementRevokersRef.current.clear();
			audioElementResourcesRef.current.clear();
			for (const audio of sourceAudioElementsRef.current.values()) {
				audio.pause();
				audio.src = "";
			}
			for (const revoke of sourceAudioElementRevokersRef.current.values()) {
				revoke();
			}
			sourceAudioElementsRef.current.clear();
			sourceAudioElementRevokersRef.current.clear();
			sourceAudioElementResourcesRef.current.clear();
			lastSourceAudioSyncTimeRef.current = null;
		};
	}, []);

	// Sync audio playback with video currentTime and isPlaying state
	useEffect(() => {
		const currentTimeMs = currentTime * 1000;
		const activeSpeedRegion = effectiveSpeedRegions.find(
			(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
		);
		const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;

		for (const region of audioRegions) {
			const audio = audioElementsRef.current.get(region.id);
			if (!audio) continue;

			const isInRegion = currentTimeMs >= region.startMs && currentTimeMs < region.endMs;

			if (isPlaying && isInRegion) {
				const audioOffset = (currentTimeMs - region.startMs) / 1000;
				// Only seek if significantly out of sync (> 200ms)
				if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
					audio.currentTime = audioOffset;
				}
				const syncedPlaybackRate = getMediaSyncPlaybackRate({
					basePlaybackRate: targetPlaybackRate,
					currentTime: audio.currentTime,
					targetTime: audioOffset,
				});
				if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
					audio.playbackRate = syncedPlaybackRate;
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
	}, [isPlaying, currentTime, audioRegions, effectiveSpeedRegions]);

	useEffect(() => {
		if (previewSourceAudioFallbackPaths.length === 0) {
			lastSourceAudioSyncTimeRef.current = null;
			return;
		}

		const activeSpeedRegion = effectiveSpeedRegions.find(
			(region) => currentTime * 1000 >= region.startMs && currentTime * 1000 < region.endMs,
		);
		const targetPlaybackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
		const previousTimelineTime = lastSourceAudioSyncTimeRef.current;
		const timelineJumped =
			previousTimelineTime === null || Math.abs(currentTime - previousTimelineTime) > 0.25;
		const driftThreshold = isPlaying ? 0.35 : 0.01;

		for (const audio of sourceAudioElementsRef.current.values()) {
			const audioDuration = Number.isFinite(audio.duration) ? audio.duration : null;
			const startDelaySeconds = estimateCompanionAudioStartDelaySeconds(
				duration,
				audioDuration,
				sourceAudioFallbackStartDelayMsByPath[audio.dataset.sourceAudioPath ?? ""],
			);
			const beforeAudioStart = currentTime + 0.001 < startDelaySeconds;
			const targetTime = clampMediaTimeToDuration(
				currentTime - startDelaySeconds,
				audioDuration,
			);

			if (timelineJumped || Math.abs(audio.currentTime - targetTime) > driftThreshold) {
				try {
					audio.currentTime = targetTime;
				} catch {
					// no-op
				}
			}

			const syncedPlaybackRate = getMediaSyncPlaybackRate({
				basePlaybackRate: targetPlaybackRate,
				currentTime: audio.currentTime,
				targetTime,
			});
			if (Math.abs(audio.playbackRate - syncedPlaybackRate) > 0.001) {
				audio.playbackRate = syncedPlaybackRate;
			}

			const atEnd = audioDuration !== null && targetTime >= audioDuration;
			if (isPlaying && !beforeAudioStart && !atEnd) {
				audio.play().catch(() => undefined);
			} else if (!audio.paused) {
				audio.pause();
			}
		}

		lastSourceAudioSyncTimeRef.current = currentTime;
	}, [
		currentTime,
		duration,
		isPlaying,
		previewSourceAudioFallbackPaths,
		sourceAudioFallbackStartDelayMsByPath,
			effectiveSpeedRegions,
		]);

	const showExportSuccessToast = useCallback((filePath: string) => {
		toast.success(`Exported successfully to ${filePath}`, {
			action: {
				label: "Show in Folder",
				onClick: async () => {
					try {
						const result = await window.electronAPI.revealInFolder(filePath);
						if (!result.success) {
							const errorMessage =
								result.error ||
								result.message ||
								"Failed to reveal item in folder.";
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
			extensionHost.emitEvent({ type: "export:start" });
			const smokeExportStartedAt = smokeExportConfig.enabled ? performance.now() : null;

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
				const effectiveShadowIntensity =
					smokeExportConfig.enabled && smokeExportConfig.shadowIntensity !== undefined
						? smokeExportConfig.shadowIntensity
						: shadowIntensity;
				const smokeProgressSamples: Array<Record<string, unknown>> = [];
				let lastSmokeProgressSampleAt = 0;
				let lastSmokeProgressPhase: ExportProgress["phase"] | undefined;
				const recordSmokeProgress = (progress: ExportProgress) => {
					if (!smokeExportConfig.enabled || smokeExportStartedAt === null) {
						return;
					}

					const now = performance.now();
					const phase = progress.phase ?? "extracting";
					const shouldSample =
						smokeProgressSamples.length === 0 ||
						phase !== lastSmokeProgressPhase ||
						now - lastSmokeProgressSampleAt >= 1000 ||
						progress.currentFrame >= progress.totalFrames;

					if (!shouldSample) {
						return;
					}

					smokeProgressSamples.push({
						elapsedMs: Math.round(now - smokeExportStartedAt),
						phase,
						currentFrame: progress.currentFrame,
						totalFrames: progress.totalFrames,
						percentage: progress.percentage,
						estimatedTimeRemaining: progress.estimatedTimeRemaining,
						renderFps: progress.renderFps,
						renderBackend: progress.renderBackend,
						encodeBackend: progress.encodeBackend,
						encoderName: progress.encoderName,
					});
					lastSmokeProgressSampleAt = now;
					lastSmokeProgressPhase = phase;
				};

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
						speedRegions: effectiveSpeedRegions,
						showShadow: effectiveShadowIntensity > 0,
						shadowIntensity: effectiveShadowIntensity,
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
						webcamUrl:
							resolvedWebcamVideoUrl ??
							(webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
						annotationRegions,
						autoCaptions,
						autoCaptionSettings,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorStyle,
						cursorSize,
						cursorSmoothing,
						zoomSmoothness,
						zoomClassicMode,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClickBounceDuration,
						cursorSway,
						frame,
						previewWidth,
						previewHeight,
						maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
						maxPendingFrames: smokeExportConfig.maxPendingFrames,
						onProgress: (progress: ExportProgress) => {
							recordSmokeProgress(progress);
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

						const saveResult =
							smokeExportConfig.enabled && smokeExportConfig.outputPath
								? await window.electronAPI.writeExportedVideoToPath(
										arrayBuffer,
										smokeExportConfig.outputPath,
									)
								: await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							pendingExportSaveRef.current = { arrayBuffer, fileName };
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							if (smokeExportStartedAt !== null) {
								console.log(
									`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
								);
							}
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						} else {
							setExportError(saveResult.message || "Failed to save GIF");
							toast.error(saveResult.message || "Failed to save GIF");
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						}
					} else {
						setExportError(result.error || "GIF export failed");
						toast.error(result.error || "GIF export failed");
						if (smokeExportConfig.enabled) {
							window.close();
							return;
						}
					}
				} else {
					// MP4 Export
					const quality = smokeExportConfig.enabled
						? (smokeExportConfig.quality ?? settings.quality ?? exportQuality)
						: (settings.quality ?? exportQuality);
					const encodingMode = smokeExportConfig.enabled
						? (smokeExportConfig.encodingMode ??
							settings.encodingMode ??
							exportEncodingMode)
						: (settings.encodingMode ?? exportEncodingMode);
					const selectedMp4FrameRate = smokeExportConfig.enabled
						? (smokeExportConfig.fps ?? settings.mp4FrameRate ?? mp4FrameRate)
						: (settings.mp4FrameRate ?? mp4FrameRate);
					const pipelineModel = smokeExportConfig.enabled
						? (smokeExportConfig.pipelineModel ??
							(smokeExportConfig.useNativeExport ? "modern" : "legacy"))
						: (settings.pipelineModel ?? exportPipelineModel);
					const backendPreference =
						pipelineModel === "legacy"
							? "webcodecs"
							: smokeExportConfig.enabled
								? (smokeExportConfig.backendPreference ??
									(smokeExportConfig.useNativeExport ? "breeze" : "webcodecs"))
								: (settings.backendPreference ?? exportBackendPreference);
					const supportedSourceDimensions =
						await ensureSupportedMp4SourceDimensions(selectedMp4FrameRate);
					const { width: exportWidth, height: exportHeight } =
						calculateMp4ExportDimensions(
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

					bitrate = Math.max(
						2_000_000,
						Math.round(bitrate * getEncodingModeBitrateMultiplier(encodingMode)),
					);

					const exporterConfig = {
						videoUrl: videoPath,
						width: exportWidth,
						height: exportHeight,
						frameRate: selectedMp4FrameRate,
						bitrate,
						codec: DEFAULT_MP4_CODEC,
						encodingMode,
						preferredEncoderPath: supportedSourceDimensions.encoderPath,
						experimentalNativeExport: smokeExportConfig.useNativeExport,
						maxEncodeQueue: smokeExportConfig.maxEncodeQueue,
						maxDecodeQueue: smokeExportConfig.maxDecodeQueue,
						maxPendingFrames: smokeExportConfig.maxPendingFrames,
						wallpaper,
						trimRegions,
						speedRegions: effectiveSpeedRegions,
						showShadow: effectiveShadowIntensity > 0,
						shadowIntensity: effectiveShadowIntensity,
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
						webcamUrl:
							resolvedWebcamVideoUrl ??
							(webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null),
						annotationRegions,
						autoCaptions,
						autoCaptionSettings,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorStyle,
						cursorSize,
						cursorSmoothing,
						zoomSmoothness,
						zoomClassicMode,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClickBounceDuration,
						cursorSway,
						frame,
						audioRegions,
						sourceAudioFallbackPaths,
						sourceAudioFallbackStartDelayMsByPath,
						previewWidth,
						previewHeight,
						onProgress: (progress: ExportProgress) => {
							recordSmokeProgress(progress);
							setExportProgress(progress);
						},
					};

					const exporter =
						pipelineModel === "modern"
							? new ModernVideoExporter({
									...exporterConfig,
									backendPreference,
								})
							: new VideoExporter(exporterConfig);

					exporterRef.current = exporter;
					const result = await exporter.export();
					const smokeExportElapsedMs =
						smokeExportStartedAt !== null
							? Math.round(performance.now() - smokeExportStartedAt)
							: undefined;

					if (result.success && (result.blob || result.tempFilePath)) {
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.mp4`;
						markExportAsSaving();

						let saveResult: {
							success: boolean;
							path?: string;
							message?: string;
							canceled?: boolean;
						};
						let pendingOnCancel: PendingExportSave;

						if (result.tempFilePath) {
							// Preferred path: main process already holds the finished MP4 on
							// disk, so we just ask it to move the temp file into place. This
							// avoids ever allocating a multi-GiB ArrayBuffer in the renderer.
							saveResult = await window.electronAPI.finalizeExportedVideo({
								tempPath: result.tempFilePath,
								fileName,
								outputPath:
									smokeExportConfig.enabled && smokeExportConfig.outputPath
										? smokeExportConfig.outputPath
										: null,
							});
							pendingOnCancel = { fileName, tempFilePath: result.tempFilePath };
						} else if (result.blob) {
							// Legacy fallback: small exports may still surface a Blob (GIF,
							// smoke tests in non-Electron environments, etc.).
							const arrayBuffer = await result.blob.arrayBuffer();
							saveResult =
								smokeExportConfig.enabled && smokeExportConfig.outputPath
									? await window.electronAPI.writeExportedVideoToPath(
											arrayBuffer,
											smokeExportConfig.outputPath,
										)
									: await window.electronAPI.saveExportedVideo(
											arrayBuffer,
											fileName,
										);
							pendingOnCancel = { fileName, arrayBuffer };
						} else {
							saveResult = { success: false, message: "Export produced no output" };
							pendingOnCancel = { fileName };
						}

						if (saveResult.canceled) {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: false,
									phase: "save",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									error: "Save canceled",
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							pendingExportSaveRef.current = pendingOnCancel;
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: true,
									phase: "saved",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									outputPath: saveResult.path,
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							if (smokeExportStartedAt !== null) {
								console.log(
									`[smoke-export] Completed in ${Math.round(performance.now() - smokeExportStartedAt)}ms (${saveResult.path})`,
								);
							}
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						} else {
							if (smokeExportConfig.enabled) {
								await writeSmokeExportReport(smokeExportConfig.outputPath, {
									success: false,
									phase: "save",
									format: "mp4",
									pipelineModel,
									backendPreference,
									encodingMode,
									shadowIntensity: effectiveShadowIntensity,
									elapsedMs: smokeExportElapsedMs,
									error: saveResult.message || "Failed to save video",
									progressSamples: smokeProgressSamples,
									metrics: result.metrics,
								});
							}
							setExportError(saveResult.message || "Failed to save video");
							toast.error(saveResult.message || "Failed to save video");
							// Keep the pending-save entry so the user can retry without
							// re-rendering. The temp file is still on disk (the main
							// process only moves/deletes it on success) and the
							// ArrayBuffer fallback still references its in-memory blob.
							if (pendingOnCancel.tempFilePath || pendingOnCancel.arrayBuffer) {
								pendingExportSaveRef.current = pendingOnCancel;
								setHasPendingExportSave(true);
								keepExportDialogOpen = true;
							}
							if (smokeExportConfig.enabled) {
								window.close();
								return;
							}
						}
					} else {
						if (smokeExportConfig.enabled) {
							await writeSmokeExportReport(smokeExportConfig.outputPath, {
								success: false,
								phase: "export",
								format: "mp4",
								pipelineModel,
								backendPreference,
								encodingMode,
								shadowIntensity: effectiveShadowIntensity,
								elapsedMs: smokeExportElapsedMs,
								error: result.error || "Export failed",
								progressSamples: smokeProgressSamples,
								metrics: result.metrics,
							});
						}
						setExportError(result.error || "Export failed");
						toast.error(summarizeErrorMessage(result.error || "Export failed"));
						if (smokeExportConfig.enabled) {
							window.close();
							return;
						}
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
				if (smokeExportConfig.enabled) {
					await writeSmokeExportReport(smokeExportConfig.outputPath, {
						success: false,
						phase: "exception",
						format: settings.format,
						elapsedMs:
							smokeExportStartedAt !== null
								? Math.round(performance.now() - smokeExportStartedAt)
								: undefined,
						error: errorMessage,
					});
				}
				setExportError(errorMessage);
				toast.error(`Export failed: ${summarizeErrorMessage(errorMessage)}`);
				if (smokeExportConfig.enabled) {
					window.close();
				}
			} finally {
				extensionHost.emitEvent({ type: "export:complete" });
				setIsExporting(false);
				exporterRef.current = null;
				setShowExportDropdown(keepExportDialogOpen);
				remountPreview();
			}
		},
		[
			clearPendingExportSave,
			videoPath,
			wallpaper,
			trimRegions,
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
			zoomSmoothness,
			zoomClassicMode,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			audioRegions,
			sourceAudioFallbackPaths,
			sourceAudioFallbackStartDelayMsByPath,
			exportEncodingMode,
			exportBackendPreference,
			exportPipelineModel,
			borderRadius,
			padding,
			cropRegion,
			webcam,
			resolvedWebcamVideoUrl,
			annotationRegions,
			autoCaptions,
			autoCaptionSettings,
			isPlaying,
			exportQuality,
			effectiveZoomRegions,
			ensureSupportedMp4SourceDimensions,
			markExportAsSaving,
			mp4FrameRate,
			remountPreview,
			showExportSuccessToast,
			smokeExportConfig.backendPreference,
			smokeExportConfig.enabled,
			smokeExportConfig.useNativeExport,
			smokeExportConfig.maxDecodeQueue,
			smokeExportConfig.maxEncodeQueue,
			smokeExportConfig.maxPendingFrames,
			smokeExportConfig.outputPath,
			smokeExportConfig.pipelineModel,
			smokeExportConfig.shadowIntensity,
			effectiveSpeedRegions,
			frame,
			smokeExportConfig.encodingMode,
			smokeExportConfig.fps,
			smokeExportConfig.quality,
		],
	);

	useEffect(() => {
		if (!smokeExportConfig.enabled || smokeExportStartedRef.current) {
			return;
		}

		if (error) {
			smokeExportStartedRef.current = true;
			console.error(`[smoke-export] ${error}`);
			window.close();
			return;
		}

		if (!videoPath || loading) {
			return;
		}

		// When smoke-export opens a .recordly project, the cursor telemetry
		// sidecar is loaded asynchronously after the editor state applies.
		// Without this gate the auto-export fires before telemetry arrives and
		// produces a video with no cursor/zoom animations.
		if (
			smokeExportConfig.projectPath &&
			videoSourcePath &&
			cursorTelemetrySourcePath !== videoSourcePath
		) {
			return;
		}

		smokeExportStartedRef.current = true;
		void handleExport({
			format: "mp4",
			quality: "good",
			encodingMode: smokeExportConfig.encodingMode ?? "balanced",
		});
	}, [
		cursorTelemetrySourcePath,
		error,
		handleExport,
		loading,
		smokeExportConfig.enabled,
		smokeExportConfig.encodingMode,
		smokeExportConfig.projectPath,
		videoPath,
		videoSourcePath,
	]);

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
			encodingMode: exportFormat === "mp4" ? exportEncodingMode : undefined,
			mp4FrameRate: exportFormat === "mp4" ? mp4FrameRate : undefined,
			backendPreference: exportFormat === "mp4" ? exportBackendPreference : undefined,
			pipelineModel: exportFormat === "mp4" ? exportPipelineModel : undefined,
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
	}, [
		videoPath,
		exportFormat,
		exportEncodingMode,
		exportQuality,
		mp4FrameRate,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		exportBackendPreference,
		exportPipelineModel,
		handleExport,
	]);

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

		let saveResult: {
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
		};

		if (pendingSave.tempFilePath) {
			saveResult = await window.electronAPI.finalizeExportedVideo({
				tempPath: pendingSave.tempFilePath,
				fileName: pendingSave.fileName,
				outputPath: null,
			});
		} else if (pendingSave.arrayBuffer) {
			saveResult = await window.electronAPI.saveExportedVideo(
				pendingSave.arrayBuffer,
				pendingSave.fileName,
			);
		} else {
			saveResult = { success: false, message: "No pending export to save" };
		}

		if (saveResult.canceled) {
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			toast.info("Save canceled. You can try again.");
			return;
		}

		if (saveResult.success && saveResult.path) {
			// finalizeExportedVideo already moved the temp file into place, so the
			// pending-save entry no longer refers to a file on disk. Flip the flag
			// directly to avoid clearPendingExportSave issuing a spurious discard.
			pendingExportSaveRef.current = null;
			setHasPendingExportSave(false);
			setExportError(null);
			setExportedFilePath(saveResult.path);
			showExportSuccessToast(saveResult.path);
			setShowExportDropdown(true);
			return;
		}

		const errorMessage = saveResult.message || "Failed to save video";
		setExportError(errorMessage);
		toast.error(errorMessage);
	}, [showExportSuccessToast]);

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

	const openLightningIssues = useCallback(async () => {
		await openExternalLink(
			RECORDLY_ISSUES_URL,
			t("editor.feedback.openFailed", "Failed to open link."),
		);
	}, [t]);

	const isExportSaving = exportProgress?.phase === "saving";
	const isExportFinalizing = exportProgress?.phase === "finalizing";
	const isRenderingAudio =
		isExportFinalizing && typeof exportProgress?.audioProgress === "number";
	const exportFinalizingProgress = isExportFinalizing
		? Math.min(
				typeof exportProgress?.renderProgress === "number"
					? exportProgress.renderProgress
					: (exportProgress?.percentage ?? 100),
				100,
			)
		: null;
	const isLightningExportInProgress =
		exportFormat === "mp4" &&
		exportPipelineModel === "modern" &&
		(isExporting || exportProgress !== null);
	const isLegacyExportInProgress =
		exportFormat === "mp4" &&
		exportPipelineModel === "legacy" &&
		(isExporting || exportProgress !== null);
	const exportRenderSpeedLabel =
		typeof exportProgress?.renderFps === "number" &&
		Number.isFinite(exportProgress.renderFps) &&
		exportProgress.renderFps > 0
			? t("editor.exportStatus.renderSpeed", "Render speed {{fps}} FPS", {
					fps: exportProgress.renderFps.toFixed(1),
				})
			: null;
	const exportRuntimeLabel = useMemo(() => {
		const renderBackend = exportProgress?.renderBackend;
		const encodeBackend = exportProgress?.encodeBackend;
		const encoderName = exportProgress?.encoderName;

		if (!renderBackend && !encodeBackend && !encoderName) {
			return null;
		}

		const rendererLabel =
			renderBackend === "webgpu" ? "WebGPU" : renderBackend === "webgl" ? "WebGL" : null;
		const encoderLabel =
			encodeBackend === "ffmpeg"
				? "Breeze"
				: encodeBackend === "webcodecs"
					? "WebCodecs"
					: null;
		const pathLabel =
			rendererLabel && encoderLabel
				? `${rendererLabel} + ${encoderLabel}`
				: (rendererLabel ?? encoderLabel);

		if (!pathLabel) {
			return encoderName ?? null;
		}

		return encoderName ? `${pathLabel} (${encoderName})` : pathLabel;
	}, [exportProgress]);
	const exportPercentLabel = exportProgress
		? isExportSaving
			? t("editor.exportStatus.saving", "Opening save dialog...")
			: isRenderingAudio
				? t("editor.exportStatus.renderingAudio", "Rendering audio {{percent}}%", {
						percent: Math.round((exportProgress.audioProgress ?? 0) * 100),
					})
				: isExportFinalizing
					? t("editor.exportStatus.finalizingPercent", "Finalizing {{percent}}%", {
							percent: Math.round(exportFinalizingProgress ?? 100),
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
						onClick={handleOpenProjectBrowser}
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
			<div
				className="relative flex h-11 flex-shrink-0 items-center justify-between bg-editor-header/88 px-5 backdrop-blur-md border-b border-foreground/10 z-50"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div
					className={`flex items-center gap-1.5 justify-self-start ${headerLeftControlsPaddingClass}`}
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<Button
						ref={projectBrowserTriggerRef}
						type="button"
						variant="ghost"
						size="sm"
						onClick={handleOpenProjectBrowser}
						className={APP_HEADER_ICON_BUTTON_CLASS}
						title={t("editor.project.projects", "Open projects")}
						aria-label={t("editor.project.projects", "Open projects")}
					>
						<FolderOpen className="h-4 w-4" />
					</Button>
					<DiscordLinkButton />
					<FeedbackDialog />
					<div className="ml-1 h-5 w-px bg-foreground/10" />
					<Button
						type="button"
						variant="ghost"
						onClick={handleUndo}
						disabled={!canUndo}
						className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-foreground/10 bg-foreground/5 p-0 text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
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
						className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-foreground/10 bg-foreground/5 p-0 text-foreground transition-colors hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
						title={t("common.actions.redo", "Redo")}
						aria-label={t("common.actions.redo", "Redo")}
					>
						<Redo2 className="h-4 w-4" />
					</Button>
				</div>
				<div
					className="absolute left-1/2 flex min-w-0 -translate-x-1/2 items-center justify-center"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					{isEditingProjectName ? (
						<form
							onSubmit={(event) => void handleProjectNameSubmit(event)}
							className="flex max-w-[min(52vw,460px)] items-baseline gap-1 rounded-[7px] border border-foreground/10 bg-editor-panel/[0.88] px-2.5 py-1 shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
						>
							{hasUnsavedChanges ? (
								<span className="mt-[1px] size-2 shrink-0 rounded-full bg-[#2563EB]" />
							) : null}
							<input
								ref={projectNameInputRef}
								type="text"
								value={projectNameDraft}
								onChange={(event) => setProjectNameDraft(event.target.value)}
								onBlur={() => {
									if (!isSavingProjectName) {
										closeProjectNameEditor();
									}
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") {
										event.preventDefault();
										closeProjectNameEditor();
									}
								}}
								disabled={isSavingProjectName}
								className="min-w-[10ch] max-w-[min(40vw,360px)] bg-transparent text-sm font-semibold tracking-tight text-foreground/95 outline-none placeholder:text-muted-foreground/60 disabled:cursor-wait"
								style={{ width: `${Math.max(projectNameDraft.length, 10)}ch` }}
								aria-label={t("editor.project.renameInput", "Project name")}
							/>
							<span className="shrink-0 text-xs font-medium tracking-tight text-muted-foreground/70">
								.recordly
							</span>
						</form>
					) : (
						<button
							type="button"
							onClick={() => setIsEditingProjectName(true)}
							className="inline-flex max-w-[min(52vw,460px)] items-baseline gap-1 rounded-[7px] px-2.5 py-1 transition-colors hover:bg-foreground/5"
							title={t("editor.project.renameTitle", "Rename project")}
							aria-label={t("editor.project.renameTitle", "Rename project")}
						>
							{hasUnsavedChanges ? (
								<span className="mt-[1px] size-2 shrink-0 rounded-full bg-[#2563EB]" />
							) : null}
							<span className="truncate text-sm font-semibold tracking-tight text-foreground/90">
								{projectDisplayName}
							</span>
							<span className="shrink-0 text-xs font-medium tracking-tight text-muted-foreground/70">
								.recordly
							</span>
						</button>
					)}
				</div>
				<div
					className="flex items-center gap-2 justify-self-end pr-3"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
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
								<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
									<div className="mb-3 flex items-center justify-between gap-3">
										<div>
											<p className="text-sm font-semibold text-foreground">
												{t("editor.exportStatus.exporting", "Exporting")}
											</p>
											<p className="text-xs text-muted-foreground">
												{t(
													"editor.exportStatus.renderingFile",
													"Rendering your file.",
												)}
											</p>
											{isLightningExportInProgress ? (
												<p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground/70">
													PLEASE
													<button
														type="button"
														onClick={() => void openLightningIssues()}
														className="underline decoration-slate-500/70 underline-offset-2 transition-colors hover:text-foreground"
													>
														report bugs
													</button>
													with Lightning export
													<span aria-hidden="true">{"\u{1F64F}"}</span>
												</p>
											) : null}
											{isLegacyExportInProgress ? (
												<p className="mt-1 text-[11px] text-muted-foreground/70">
													Export too slow? Cancel and try Lightning
													export!
												</p>
											) : null}
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
									<div className="h-2 overflow-hidden rounded-full border border-foreground/5 bg-foreground/5">
										{isExportSaving ? (
											<div className="indeterminate-progress h-full rounded-full bg-transparent" />
										) : (
											<div
												className="h-full bg-[#2563EB] transition-all duration-300 ease-out"
												style={{
													width: `${Math.min(isRenderingAudio ? (exportProgress.audioProgress ?? 0) * 100 : (exportFinalizingProgress ?? exportProgress?.percentage ?? 8), 100)}%`,
												}}
											/>
										)}
									</div>
									<p className="mt-2 text-xs text-muted-foreground">
										{exportPercentLabel}
									</p>
									{isRenderingAudio ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											{t(
												"editor.export.processingAudioEdits",
												"Processing audio with speed/overlay edits",
											)}
										</p>
									) : exportRenderSpeedLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											{exportRenderSpeedLabel}
										</p>
									) : null}
									{exportRuntimeLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Path: {exportRuntimeLabel}
										</p>
									) : null}
								</div>
							) : exportError ? (
								<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
									<p className="text-sm font-semibold text-foreground">
										{t("editor.exportStatus.issue", "Export issue")}
									</p>
									{exportRuntimeLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Path: {exportRuntimeLabel}
										</p>
									) : null}
									<p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
										{exportError}
									</p>
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
											className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
										>
											{t("common.actions.close", "Close")}
										</Button>
									</div>
								</div>
							) : exportedFilePath ? (
								<div className="rounded-2xl border border-foreground/10 bg-editor-surface p-4 text-foreground shadow-2xl">
									<p className="text-sm font-semibold text-foreground">
										{t("editor.exportStatus.complete", "Export complete")}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{t(
											"editor.exportStatus.savedSuccessfully",
											"Your file was saved successfully.",
										)}
									</p>
									{exportRuntimeLabel ? (
										<p className="mt-1 text-[11px] text-muted-foreground/70">
											Path: {exportRuntimeLabel}
										</p>
									) : null}
									<p className="mt-3 truncate text-xs text-muted-foreground/70">
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
											className="h-8 flex-1 border-foreground/10 bg-foreground/5 text-xs text-muted-foreground hover:bg-foreground/10"
										>
											Done
										</Button>
									</div>
								</div>
							) : (
								<ExportSettingsMenu
									exportFormat={exportFormat}
									onExportFormatChange={setExportFormat}
									exportEncodingMode={exportEncodingMode}
									onExportEncodingModeChange={setExportEncodingMode}
									mp4FrameRate={mp4FrameRate}
									onMp4FrameRateChange={setMp4FrameRate}
									exportPipelineModel={exportPipelineModel}
									onExportPipelineModelChange={setExportPipelineModel}
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

			<div className="relative flex min-h-0 flex-1 flex-col gap-3 p-4">
				<div className="flex min-h-0 flex-1 gap-3 relative z-10">
					{/* Settings sidebar */}
					<div className="flex flex-shrink-0 gap-1.5">
						{/* Icon rail */}
						<div className="flex flex-shrink-0 flex-col items-center gap-0.5 px-2 py-2">
							{editorSectionButtons.map((section) => {
								const isActive = activeEffectSection === section.id;
								return (
									<div key={section.id} className="flex items-center">
										<motion.button
											type="button"
											onClick={() => setActiveEffectSection(section.id)}
											title={section.label}
											className="group relative flex h-9 w-9 items-center justify-center rounded-lg outline-none focus:outline-none focus-visible:outline-none"
											animate={{ opacity: isActive ? 1 : 0.55 }}
											transition={{ duration: 0.14 }}
										>
											{isActive && (
												<motion.span
													layoutId="rail-active-bg"
													className="absolute inset-0 rounded-lg bg-foreground/[0.08]"
													transition={{
														type: "spring",
														stiffness: 450,
														damping: 35,
													}}
												/>
											)}
											<motion.span
												className="relative z-10"
												animate={{
													color: isActive
														? "#2563EB"
														: "hsl(var(--foreground))",
												}}
												transition={{ duration: 0.14 }}
											>
												{typeof section.icon === "string" ? (
													<ExtensionIcon
														icon={section.icon}
														className="h-[27px] w-[27px]"
													/>
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
													transition={{
														type: "spring",
														stiffness: 500,
														damping: 32,
													}}
												/>
											)}
										</div>
									</div>
								);
							})}
							<div className="mt-auto flex flex-col items-center gap-0.5 pt-3">
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
						{activeEffectSection === "extensions" ? (
							<ExtensionManager />
						) : (
							<SettingsPanel
								panelMode="editor"
								activeEffectSection={activeEffectSection}
								selected={wallpaper}
								onWallpaperChange={setWallpaper}
								selectedZoomDepth={
									selectedZoomId
										? zoomRegions.find((z) => z.id === selectedZoomId)?.depth
										: null
								}
								onZoomDepthChange={(depth) =>
									selectedZoomId && handleZoomDepthChange(depth)
								}
								selectedZoomId={selectedZoomId}
								selectedZoomMode={
									selectedZoomId
										? (zoomRegions.find((z) => z.id === selectedZoomId)?.mode ??
											"auto")
										: null
								}
								onZoomModeChange={(mode) =>
									selectedZoomId && handleZoomModeChange(mode)
								}
								onZoomDelete={handleZoomDelete}
								selectedClipId={selectedClipId}
								selectedClipSpeed={
									selectedClipId
										? (clipRegions.find((c) => c.id === selectedClipId)
												?.speed ?? 1)
										: null
								}
								selectedClipMuted={
									selectedClipId
										? (clipRegions.find((c) => c.id === selectedClipId)
												?.muted ?? false)
										: null
								}
								onClipSpeedChange={(speed) =>
									selectedClipId && handleClipSpeedChange(speed)
								}
								onClipMutedChange={(muted) =>
									selectedClipId && handleClipMutedChange(muted)
								}
								onClipDelete={handleClipDelete}
								selectedAudioId={selectedAudioId}
								selectedAudioVolume={
									selectedAudioId
										? (audioRegions.find((r) => r.id === selectedAudioId)
												?.volume ?? null)
										: null
								}
								onAudioVolumeChange={handleAudioVolumeChange}
								onAudioDelete={handleAudioDelete}
								shadowIntensity={shadowIntensity}
								onShadowChange={setShadowIntensity}
								backgroundBlur={backgroundBlur}
								onBackgroundBlurChange={setBackgroundBlur}
								autoApplyFreshRecordingAutoZooms={autoApplyFreshRecordingAutoZooms}
								onAutoApplyFreshRecordingAutoZoomsChange={
									setAutoApplyFreshRecordingAutoZooms
								}
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
								zoomClassicMode={zoomClassicMode}
								onZoomClassicModeChange={setZoomClassicMode}
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
								frame={frame}
								onFrameChange={setFrame}
								cropRegion={cropRegion}
								onCropChange={setCropRegion}
								aspectRatio={aspectRatio}
								onAspectRatioChange={setAspectRatio}
								selectedAnnotationId={selectedAnnotationId}
								annotationRegions={annotationRegions}
								autoCaptions={autoCaptions}
								autoCaptionSettings={autoCaptionSettings}
								whisperExecutablePath={whisperExecutablePath}
								whisperModelPath={whisperModelPath}
								whisperModelDownloadStatus={whisperModelDownloadStatus}
								whisperModelDownloadProgress={whisperModelDownloadProgress}
								isGeneratingCaptions={isGeneratingCaptions}
								onAutoCaptionSettingsChange={setAutoCaptionSettings}
								onPickWhisperExecutable={handlePickWhisperExecutable}
								onPickWhisperModel={handlePickWhisperModel}
								onGenerateAutoCaptions={handleGenerateAutoCaptions}
								onClearAutoCaptions={handleClearAutoCaptions}
								onDownloadWhisperSmallModel={handleDownloadWhisperSmallModel}
								onDeleteWhisperSmallModel={handleDeleteWhisperSmallModel}
								onAnnotationContentChange={handleAnnotationContentChange}
								onAnnotationTypeChange={handleAnnotationTypeChange}
								onAnnotationStyleChange={handleAnnotationStyleChange}
								onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
								onAnnotationBlurIntensityChange={
									handleAnnotationBlurIntensityChange
								}
								onAnnotationBlurColorChange={handleAnnotationBlurColorChange}
								onAnnotationDelete={handleAnnotationDelete}
							/>
						)}
					</div>
					{/* Right column: preview + timeline */}
					<div className="flex min-h-0 flex-1 flex-col gap-3">
						{/* Preview */}
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="relative flex flex-1 min-h-0 flex-col overflow-hidden">
								{/* Aspect ratio + crop controls above preview */}
								<div className="flex items-center justify-center gap-2 py-1.5 flex-shrink-0">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1"
											>
												<span className="font-medium">
													{getAspectRatioLabel(aspectRatio)}
												</span>
												<ChevronDown className="w-3 h-3" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											align="center"
											className="bg-editor-surface-alt border-foreground/10"
										>
											{ASPECT_RATIOS.map((ratio) => (
												<DropdownMenuItem
													key={ratio}
													onClick={() => setAspectRatio(ratio)}
													className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer flex items-center justify-between gap-3"
												>
													<span>{getAspectRatioLabel(ratio)}</span>
													{aspectRatio === ratio && (
														<Check className="w-3 h-3 text-[#2563EB]" />
													)}
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
									<div className="w-[1px] h-4 bg-foreground/20" />
									<Button
										variant="ghost"
										size="sm"
										onClick={handleOpenCropEditor}
										className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/10 transition-all gap-1.5"
									>
										<Crop className="w-3.5 h-3.5" />
										<span className="font-medium">
											{t("settings.crop.title")}
										</span>
										{isCropped ? (
											<span className="h-1.5 w-1.5 rounded-full bg-[#2563EB]" />
										) : null}
									</Button>
								</div>
								{/* Video preview */}
								<div
									className="flex w-full min-h-0 flex-1 items-stretch"
									style={{ flex: "1 1 auto", margin: "6px 0 0" }}
								>
									<div className="flex min-w-0 flex-1 items-center justify-center px-1">
										<div
											className="relative overflow-hidden rounded-[30px]"
											style={{
												width: "auto",
												height: "100%",
												aspectRatio: getAspectRatioValue(
													aspectRatio,
													(() => {
														const previewVideo =
															videoPlaybackRef.current?.video;
														if (
															previewVideo &&
															previewVideo.videoHeight > 0
														) {
															return (
																previewVideo.videoWidth /
																previewVideo.videoHeight
															);
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
												aspectRatio={aspectRatio}
												ref={videoPlaybackRef}
												videoPath={videoPath || ""}
												onDurationChange={setDuration}
												onPreviewReadyChange={setIsPreviewReady}
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
												frame={frame}
												cropRegion={cropRegion}
												webcam={webcam}
												webcamVideoPath={
													webcam.sourcePath
														? resolvedWebcamVideoUrl
														: null
												}
												trimRegions={trimRegions}
												speedRegions={effectiveSpeedRegions}
												annotationRegions={annotationRegions}
												autoCaptions={autoCaptions}
												autoCaptionSettings={autoCaptionSettings}
												selectedAnnotationId={selectedAnnotationId}
												onSelectAnnotation={handleSelectAnnotation}
												onAnnotationPositionChange={
													handleAnnotationPositionChange
												}
												onAnnotationSizeChange={handleAnnotationSizeChange}
												cursorTelemetry={effectiveCursorTelemetry}
												showCursor={showCursor}
												cursorStyle={cursorStyle}
												cursorSize={cursorSize}
												cursorSmoothing={cursorSmoothing}
												zoomSmoothness={zoomSmoothness}
												zoomClassicMode={zoomClassicMode}
												cursorMotionBlur={cursorMotionBlur}
												cursorClickBounce={cursorClickBounce}
												cursorClickBounceDuration={
													cursorClickBounceDuration
												}
												cursorSway={cursorSway}
												volume={shouldMutePreviewVideo ? 0 : previewVolume}
											/>
										</div>
									</div>
								</div>
							</div>
						</div>
						{/* Toolbar - sits at bottom of right column, only spans preview width */}
						<div className="relative flex flex-shrink-0 items-center px-1 py-1">
							{/* Left tools */}
							<div className="z-10 flex min-w-0 flex-1 items-center gap-1.5">
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="h-7 gap-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.04] px-2.5 text-[11px] text-foreground/65 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)] transition-all hover:bg-foreground/[0.08] hover:text-foreground"
										>
											<Plus className="w-3.5 h-3.5" />
											<span className="font-medium">
												{t("editor.toolbar.addLayer")}
											</span>
											<ChevronDown className="w-3 h-3" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="start"
										className="bg-editor-surface-alt border-foreground/10"
									>
										<DropdownMenuItem
											onClick={() => {
												const nextTrackIndex =
													annotationRegions.length > 0
														? Math.max(
																...annotationRegions.map(
																	(r) => r.trackIndex ?? 0,
																),
															) + 1
														: 0;
												timelineRef.current?.addAnnotation(nextTrackIndex);
											}}
											className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
										>
											{t("timeline.annotation.label")}
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => {
												const nextTrackIndex =
													audioRegions.length > 0
														? Math.max(
																...audioRegions.map(
																	(region) =>
																		region.trackIndex ?? 0,
																),
															) + 1
														: 0;
												timelineRef.current?.addAudio(nextTrackIndex);
											}}
											className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 cursor-pointer"
										>
											{t("timeline.audio.label")}
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<div className="w-[1px] h-4 bg-foreground/10 mx-1" />
								<Button
									onClick={() => timelineRef.current?.addZoom()}
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
									title={t("timeline.zoom.addZoom")}
								>
									<ZoomIn className="w-4 h-4" />
								</Button>
								<Button
									onClick={() => timelineRef.current?.suggestZooms()}
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-[#2563EB]/10 hover:text-[#2563EB]"
									title={t("timeline.zoom.suggestZooms")}
								>
									<WandSparkles className="w-4 h-4" />
								</Button>
								<Button
									onClick={() => timelineRef.current?.splitClip()}
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
									title={t("editor.toolbar.splitClip")}
								>
									<Scissors className="w-4 h-4" />
								</Button>
							</div>
							{/* Playback controls - centered */}
							<div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
								<div className="flex items-center gap-1.5 pointer-events-auto">
									<span className="mr-1 text-[10px] font-medium tabular-nums text-muted-foreground">
										{formatTime(timelinePlayheadTime)}
									</span>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
										title={t("editor.playback.skipBack")}
										onClick={() => {
											const currentMs = timelinePlayheadTime * 1000;
											const kfs = timelineRef.current?.keyframes ?? [];
											const prev = [...kfs]
												.reverse()
												.find((k) => k.time < currentMs - 50);
											handleSeek(
												prev
													? prev.time / 1000
													: Math.max(0, timelinePlayheadTime - 5),
											);
										}}
									>
										<SkipBack className="w-3.5 h-3.5" weight="fill" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className={`h-7 w-7 rounded-full border border-foreground/10 transition-all shadow-[0_8px_18px_rgba(0,0,0,0.18)] ${isPlaying ? "bg-foreground/10 text-foreground hover:bg-foreground/20" : "bg-neutral-800 text-white hover:bg-neutral-700 dark:bg-white dark:text-black dark:hover:bg-white/90"}`}
										onClick={togglePlayPause}
										title={isPlaying ? "Pause" : "Play"}
									>
										{isPlaying ? (
											<Pause className="w-3.5 h-3.5" weight="fill" />
										) : (
											<Play className="w-3.5 h-3.5" weight="fill" />
										)}
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
										title={t("editor.playback.skipForward")}
										onClick={() => {
											const currentMs = timelinePlayheadTime * 1000;
											const kfs = timelineRef.current?.keyframes ?? [];
											const next = kfs.find((k) => k.time > currentMs + 50);
											handleSeek(
												next
													? next.time / 1000
													: Math.min(duration, timelinePlayheadTime + 5),
											);
										}}
									>
										<SkipForward className="w-3.5 h-3.5" weight="fill" />
									</Button>
									<span className="text-[10px] font-medium text-muted-foreground/70 tabular-nums ml-1">
										{formatTime(duration)}
									</span>
								</div>
							</div>
							{/* Right: collapse + volume */}
							<div className="z-10 ml-auto flex items-center gap-2">
								<Button
									variant="ghost"
									size="icon"
									title={
										timelineCollapsed
											? t("editor.timeline.expand")
											: t("editor.timeline.collapse")
									}
									className="h-7 w-7 rounded-full text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground"
									onClick={() => {
										setTimelineCollapsed((p) => !p);
									}}
								>
									{timelineCollapsed ? (
										<ChevronUp className="w-3.5 h-3.5" />
									) : (
										<ChevronDown className="w-3.5 h-3.5" />
									)}
								</Button>
								<div className="flex items-center gap-1.5">
									<button
										type="button"
										className="text-muted-foreground hover:text-foreground transition-colors"
										title={t("editor.playback.muteUnmute")}
										onClick={() =>
											setPreviewVolume(previewVolume <= 0.001 ? 1 : 0)
										}
									>
										{previewVolume <= 0.001 ? (
											<VolumeX className="w-3.5 h-3.5" />
										) : previewVolume < 0.5 ? (
											<Volume1 className="w-3.5 h-3.5" />
										) : (
											<Volume2 className="w-3.5 h-3.5" />
										)}
									</button>
									<div className="relative flex h-7 w-24 select-none items-center overflow-hidden rounded-full border border-foreground/[0.06] bg-editor-bg/80 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.06)]">
										<div
											className="absolute inset-y-[3px] left-[3px] right-auto rounded-[10px] bg-foreground/[0.08]"
											style={{
												width:
													previewVolume > 0
														? `max(calc(${previewVolume * 100}% - 6px), 1.2rem)`
														: 0,
											}}
										/>
										<div
											className="pointer-events-none absolute bottom-[18%] top-[18%] z-10 w-[2px] rounded-full bg-foreground/95 shadow-[0_0_10px_rgba(37,99,235,0.28)]"
											style={{ left: `calc(${previewVolume * 100}% - 8px)` }}
										/>
										<span className="pointer-events-none relative z-10 pl-2 text-[10px] font-medium text-muted-foreground">
											{Math.round(previewVolume * 100)}%
										</span>
										<input
											type="range"
											min="0"
											max="1"
											step="0.01"
											value={previewVolume}
											onChange={(e) =>
												setPreviewVolume(Number(e.target.value))
											}
											className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
										/>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
				<div
					className="flex-shrink-0 flex flex-col"
					style={{
						height: timelineCollapsed ? undefined : "15%",
						minHeight: timelineCollapsed ? 0 : 160,
					}}
				>
					<TimelineEditor
						ref={timelineRef}
						hideToolbar
						videoDuration={duration}
						currentTime={currentTime}
						playheadTime={timelinePlayheadTime}
						onSeek={handleSeek}
						videoPath={videoPath}
						cursorTelemetry={normalizedCursorTelemetry}
						autoSuggestZoomsTrigger={autoSuggestZoomsTrigger}
						onAutoSuggestZoomsConsumed={handleAutoSuggestZoomsConsumed}
						zoomRegions={zoomRegions}
						onZoomAdded={handleZoomAdded}
						onZoomSuggested={handleZoomSuggested}
						onZoomSpanChange={handleZoomSpanChange}
						onZoomDelete={handleZoomDelete}
						selectedZoomId={selectedZoomId}
						onSelectZoom={handleSelectZoom}
						trimRegions={trimRegions}
						clipRegions={clipRegions}
						onClipSplit={handleClipSplit}
						onClipSpanChange={handleClipSpanChange}
						selectedClipId={selectedClipId}
						onSelectClip={handleSelectClip}
						audioRegions={audioRegions}
						onAudioAdded={handleAudioAdded}
						onAudioSpanChange={handleAudioSpanChange}
						onAudioDelete={handleAudioDelete}
						selectedAudioId={selectedAudioId}
						onSelectAudio={handleSelectAudio}
						annotationRegions={annotationRegions}
						onAnnotationAdded={handleAnnotationAdded}
						onAnnotationSpanChange={handleAnnotationSpanChange}
						onAnnotationDelete={handleAnnotationDelete}
						selectedAnnotationId={selectedAnnotationId}
						onSelectAnnotation={handleSelectAnnotation}
						aspectRatio={aspectRatio}
					/>
				</div>
			</div>

			{showCropModal ? (
				<>
					<div
						className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
						onClick={handleCancelCropEditor}
					/>
					<div className="fixed left-1/2 top-1/2 z-[60] max-h-[90vh] w-[90vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-foreground/10 bg-editor-dialog p-8 shadow-2xl animate-in zoom-in-95 duration-200">
						<div className="mb-6 flex items-center justify-between">
							<div>
								<span className="text-xl font-bold text-foreground">
									{t("settings.crop.title")}
								</span>
								<p className="mt-2 text-sm text-muted-foreground">
									{t("settings.crop.instruction")}
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCancelCropEditor}
								className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
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

			<Toaster className="pointer-events-auto" />
		</div>
	);
}
