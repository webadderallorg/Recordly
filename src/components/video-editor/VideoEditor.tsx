import type { Span } from "dnd-timeline";
import { Camera, Download, FolderOpen, Languages, MousePointer2, Redo2, Save, Sparkles, Undo2, X } from "lucide-react";
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
import { getAssetPath } from "@/lib/assetPath";
import {
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	VideoExporter,
} from "@/lib/exporter";
import { matchesShortcut } from "@/lib/shortcuts";
import { DEFAULT_WALLPAPER_RELATIVE_PATH } from "@/lib/wallpapers";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { ExportSettingsMenu } from "./ExportSettingsMenu";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import PlaybackControls from "./PlaybackControls";
import { CropControl } from "./CropControl";
import {
	createProjectData,
	deriveNextId,
	fromFileUrl,
	normalizeProjectEditor,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { type EditorEffectSection, SettingsPanel } from "./SettingsPanel";
import { APP_HEADER_ACTION_BUTTON_CLASS, FeedbackDialog, KeyboardShortcutsDialog } from "./TutorialHelp";
import TimelineEditor from "./timeline/TimelineEditor";
import {
	detectInteractionCandidates,
	normalizeCursorTelemetry,
} from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type AudioRegion,
	type CropRegion,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_CROP_REGION,
	DEFAULT_WEBCAM_OVERLAY,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	type PlaybackSpeed,
	type SpeedRegion,
	type TrimRegion,
	type WebcamOverlaySettings,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
} from "./types";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "./videoPlayback/cursorLoopTelemetry";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";

const LOOP_CURSOR_END_WINDOW_MS = 670;

type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	selectedZoomId: string | null;
	selectedTrimId: string | null;
	selectedSpeedId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

type PendingExportSave = {
	fileName: string;
	arrayBuffer: ArrayBuffer;
};

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
	const [showCursor, setShowCursor] = useState(initialEditorPreferences.showCursor);
	const [loopCursor, setLoopCursor] = useState(initialEditorPreferences.loopCursor);
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
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDropdown, setShowExportDropdown] = useState(false);
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
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [showCropModal, setShowCropModal] = useState(false);

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
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
	const [historyVersion, setHistoryVersion] = useState(0);

	const syncHistoryButtons = useCallback(() => {
		setHistoryVersion((version) => version + 1);
	}, []);

	const canUndo = historyPastRef.current.length > 0;
	const canRedo = historyFutureRef.current.length > 0;

	void historyVersion;

	const cloneSnapshot = useCallback((snapshot: EditorHistorySnapshot): EditorHistorySnapshot => {
		return {
			zoomRegions: JSON.parse(JSON.stringify(snapshot.zoomRegions)),
			trimRegions: JSON.parse(JSON.stringify(snapshot.trimRegions)),
			speedRegions: JSON.parse(JSON.stringify(snapshot.speedRegions)),
			annotationRegions: JSON.parse(JSON.stringify(snapshot.annotationRegions)),
			audioRegions: JSON.parse(JSON.stringify(snapshot.audioRegions)),
			selectedZoomId: snapshot.selectedZoomId,
			selectedTrimId: snapshot.selectedTrimId,
			selectedSpeedId: snapshot.selectedSpeedId,
			selectedAnnotationId: snapshot.selectedAnnotationId,
			selectedAudioId: snapshot.selectedAudioId,
		};
	}, []);

	const gifOutputDimensions = useMemo(
		() =>
			calculateOutputDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				gifSizePreset,
				GIF_SIZE_PRESETS,
			),
		[gifSizePreset, videoPath],
	);

	const projectDisplayName = useMemo(() => {
		const fileName = currentProjectPath?.split(/[\\/]/).pop() ?? "";
		const withoutExtension = fileName.replace(/\.recordly$/i, "").replace(/\.[^.]+$/, "");
		return withoutExtension || t("editor.project.untitled", "Untitled");
	}, [currentProjectPath, t]);

	const editorSectionButtons = useMemo(
		() => [
			{ id: "scene" as const, label: t("settings.sections.scene", "Scene"), icon: Sparkles },
			{ id: "cursor" as const, label: t("settings.sections.cursor", "Cursor"), icon: MousePointer2 },
			{ id: "webcam" as const, label: t("settings.sections.webcam", "Webcam"), icon: Camera },
		],
		[t],
	);

	const buildPersistedEditorState = useCallback(
		(
			editor: Partial<{
				wallpaper: string;
				shadowIntensity: number;
				backgroundBlur: number;
				zoomMotionBlur: number;
				connectZooms: boolean;
				showCursor: boolean;
				loopCursor: boolean;
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

	const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
		return {
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			selectedZoomId,
			selectedTrimId,
			selectedSpeedId,
			selectedAnnotationId,
			selectedAudioId,
		};
	}, [
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectedAudioId,
	]);

	const applyHistorySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			applyingHistoryRef.current = true;
			const cloned = cloneSnapshot(snapshot);
			setZoomRegions(cloned.zoomRegions);
			setTrimRegions(cloned.trimRegions);
			setSpeedRegions(cloned.speedRegions);
			setAnnotationRegions(cloned.annotationRegions);
			setAudioRegions(cloned.audioRegions);
			setSelectedZoomId(cloned.selectedZoomId);
			setSelectedTrimId(cloned.selectedTrimId);
			setSelectedSpeedId(cloned.selectedSpeedId);
			setSelectedAnnotationId(cloned.selectedAnnotationId);
			setSelectedAudioId(cloned.selectedAudioId);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				cloned.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				cloned.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				cloned.speedRegions.map((region) => region.id),
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
				cloned.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) + 1;
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

	const applyLoadedProject = useCallback(async (candidate: unknown, path?: string | null) => {
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

		setWallpaper(normalizedEditor.wallpaper);
		setShadowIntensity(normalizedEditor.shadowIntensity);
		setBackgroundBlur(normalizedEditor.backgroundBlur);
		setZoomMotionBlur(normalizedEditor.zoomMotionBlur);
		setConnectZooms(normalizedEditor.connectZooms);
		setShowCursor(normalizedEditor.showCursor);
		setLoopCursor(normalizedEditor.loopCursor);
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
		setAspectRatio(normalizedEditor.aspectRatio);
		setExportQuality(normalizedEditor.exportQuality);
		setExportFormat(normalizedEditor.exportFormat);
		setGifFrameRate(normalizedEditor.gifFrameRate);
		setGifLoop(normalizedEditor.gifLoop);
		setGifSizePreset(normalizedEditor.gifSizePreset);

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
			normalizedEditor.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) +
			1;

		historyPastRef.current = [];
		historyFutureRef.current = [];
		historyCurrentRef.current = null;
		applyingHistoryRef.current = false;
		syncHistoryButtons();

		setLastSavedSnapshot(
			JSON.stringify(createProjectData(sourcePath, buildPersistedEditorState(normalizedEditor))),
		);
		return true;
	}, [buildPersistedEditorState, syncHistoryButtons]);

	const currentProjectSnapshot = useMemo(() => {
		const sourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!sourcePath) {
			return null;
		}
		return JSON.stringify(
			createProjectData(
				sourcePath,
				buildPersistedEditorState({
					wallpaper,
					shadowIntensity,
					backgroundBlur,
					zoomMotionBlur,
					connectZooms,
					showCursor,
					loopCursor,
					cursorSize,
					cursorSmoothing,
					cursorMotionBlur,
					cursorClickBounce,
					cursorClickBounceDuration,
					cursorSway,
					borderRadius,
					padding,
					cropRegion,
					webcam,
					zoomRegions,
					trimRegions,
					speedRegions,
					annotationRegions,
					audioRegions,
					aspectRatio,
					exportQuality,
					exportFormat,
					gifFrameRate,
					gifLoop,
					gifSizePreset,
				}),
			),
		);
	}, [
		videoPath,
		videoSourcePath,
		buildPersistedEditorState,
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		connectZooms,
		showCursor,
		loopCursor,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorClickBounceDuration,
		cursorSway,
		borderRadius,
		padding,
		cropRegion,
		webcam,
		zoomRegions,
		trimRegions,
		speedRegions,
		audioRegions,
		annotationRegions,
		aspectRatio,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		buildPersistedEditorState,
	]);

	const syncRecordingSessionWebcam = useCallback(
		async (webcamPath: string | null) => {
			const sourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
			if (!sourcePath || !window.electronAPI.setCurrentRecordingSession) {
				return;
			}

			await window.electronAPI.setCurrentRecordingSession({
				videoPath: sourcePath,
				webcamPath,
			});
		},
		[videoPath, videoSourcePath],
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
		const snapshot = cloneSnapshot(buildHistorySnapshot());

		if (!historyCurrentRef.current) {
			historyCurrentRef.current = snapshot;
			syncHistoryButtons();
			return;
		}

		if (applyingHistoryRef.current) {
			historyCurrentRef.current = snapshot;
			applyingHistoryRef.current = false;
			syncHistoryButtons();
			return;
		}

		const currentSerialized = JSON.stringify(historyCurrentRef.current);
		const nextSerialized = JSON.stringify(snapshot);
		if (currentSerialized === nextSerialized) {
			return;
		}

		historyPastRef.current.push(cloneSnapshot(historyCurrentRef.current));
		if (historyPastRef.current.length > 100) {
			historyPastRef.current.shift();
		}
		historyCurrentRef.current = snapshot;
		historyFutureRef.current = [];
		syncHistoryButtons();
	}, [buildHistorySnapshot, cloneSnapshot, syncHistoryButtons]);

	const hasUnsavedChanges = Boolean(
		currentProjectPath &&
			currentProjectSnapshot &&
			lastSavedSnapshot &&
			currentProjectSnapshot !== lastSavedSnapshot,
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
			showCursor,
			loopCursor,
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
		});
	}, [
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		connectZooms,
		showCursor,
		loopCursor,
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
	]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return false;
			}

			const sourcePath = videoSourcePath ?? fromFileUrl(videoPath);
			if (!sourcePath) {
				toast.error("Unable to determine source video path");
				return false;
			}

			const projectData = createProjectData(
				sourcePath,
				buildPersistedEditorState({
					wallpaper,
					shadowIntensity,
					backgroundBlur,
					zoomMotionBlur,
					connectZooms,
					showCursor,
					loopCursor,
					cursorSize,
					cursorSmoothing,
					cursorMotionBlur,
					cursorClickBounce,
					cursorClickBounceDuration,
					cursorSway,
					borderRadius,
					padding,
					cropRegion,
					webcam,
					zoomRegions,
					trimRegions,
					speedRegions,
					annotationRegions,
					audioRegions,
					aspectRatio,
					exportQuality,
					exportFormat,
					gifFrameRate,
					gifLoop,
					gifSizePreset,
				}),
			);

			const fileNameBase =
				sourcePath
					.split(/[\\/]/)
					.pop()
					?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			const projectSnapshot = JSON.stringify(projectData);
			let targetProjectPath = forceSaveAs ? undefined : (currentProjectPath ?? undefined);

			if (!forceSaveAs && !targetProjectPath) {
				const activeProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (activeProjectResult.success && activeProjectResult.path) {
					targetProjectPath = activeProjectResult.path;
					setCurrentProjectPath(activeProjectResult.path);
				}
			}

			const result = await window.electronAPI.saveProjectFile(
				projectData,
				fileNameBase,
				targetProjectPath,
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
			setLastSavedSnapshot(projectSnapshot);

			toast.success(`Project saved to ${result.path}`);
			return true;
		},
		[
			videoPath,
			videoSourcePath,
			currentProjectPath,
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			showCursor,
			loopCursor,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorClickBounceDuration,
			cursorSway,
			borderRadius,
			padding,
			cropRegion,
			webcam,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			aspectRatio,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			buildPersistedEditorState,
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
		await saveProject(true);
	}, [saveProject]);

	const handleLoadProject = useCallback(async () => {
		const result = await window.electronAPI.loadProjectFile();

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

		toast.success(`Project loaded from ${result.path}`);
	}, [applyLoadedProject]);

	useEffect(() => {
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleLoadProject, handleSaveProject, handleSaveProjectAs]);

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

	const effectiveZoomRegions = useMemo(() => {
		if (!loopCursor || zoomRegions.length === 0) {
			return zoomRegions;
		}

		if (displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs) {
			return zoomRegions;
		}

		const dominantAtStart = findDominantRegion(zoomRegions, displayedTimelineWindow.startMs, {
			connectZooms,
		}).region;
		if (!dominantAtStart) {
			return zoomRegions;
		}

		const endWindowStartMs = Math.max(
			displayedTimelineWindow.startMs,
			displayedTimelineWindow.endMs - LOOP_CURSOR_END_WINDOW_MS,
		);
		const loopEndRegion: ZoomRegion = {
			id: `${dominantAtStart.id}__loop-end-sync`,
			startMs: endWindowStartMs,
			endMs: displayedTimelineWindow.endMs,
			depth: dominantAtStart.depth,
			focus: {
				cx: dominantAtStart.focus.cx,
				cy: dominantAtStart.focus.cy,
			},
		};

		return [...zoomRegions.filter((region) => region.id !== loopEndRegion.id), loopEndRegion];
	}, [loopCursor, zoomRegions, displayedTimelineWindow, connectZooms]);

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

	// Initialize default wallpaper with resolved asset path
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const resolvedPath = await getAssetPath(DEFAULT_WALLPAPER_RELATIVE_PATH);
				if (mounted) {
					setWallpaper(resolvedPath);
				}
			} catch (err) {
				// If resolution fails, keep the fallback
				console.warn("Failed to resolve default wallpaper path:", err);
			}
		})();
		return () => {
			mounted = false;
		};
	}, []);

	function togglePlayPause() {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		if (isPlaying) {
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
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAudioId(null);
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

	// Audio playback sync: manage Audio elements that play in sync with video
	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

	useEffect(() => {
		const existing = audioElementsRef.current;
		const currentIds = new Set(audioRegions.map((r) => r.id));

		// Remove old audio elements
		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
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
			const expectedSrc = toFileUrl(region.audioPath);
			if (audio.src !== expectedSrc) {
				audio.src = expectedSrc;
			}
			audio.volume = Math.max(0, Math.min(1, region.volume));
		}

		return () => {
			for (const audio of existing.values()) {
				audio.pause();
				audio.src = "";
			}
			existing.clear();
		};
	}, [audioRegions]);

	// Sync audio playback with video currentTime and isPlaying state
	useEffect(() => {
		for (const region of audioRegions) {
			const audio = audioElementsRef.current.get(region.id);
			if (!audio) continue;

			const currentTimeMs = currentTime * 1000;
			const isInRegion = currentTimeMs >= region.startMs && currentTimeMs < region.endMs;

			if (isPlaying && isInRegion) {
				const audioOffset = (currentTimeMs - region.startMs) / 1000;
				// Only seek if significantly out of sync (> 200ms)
				if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
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
	}, [isPlaying, currentTime, audioRegions]);

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
			pendingExportSaveRef.current = null;
			setHasPendingExportSave(false);

			let keepExportDialogOpen = false;

			try {
				const wasPlaying = isPlaying;
				const restoreTime = video.currentTime;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				const sourceWidth = video.videoWidth || 1920;
				const sourceHeight = video.videoHeight || 1080;
				const sourceAspectRatio = sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;
				const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);

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
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						webcam,
						webcamUrl: webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null,
						annotationRegions,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
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
					let exportWidth: number;
					let exportHeight: number;
					let bitrate: number;

					if (quality === "source") {
						// Use source resolution
						exportWidth = sourceWidth;
						exportHeight = sourceHeight;

						if (aspectRatio === "native") {
							exportWidth = Math.floor(sourceWidth / 2) * 2;
							exportHeight = Math.floor(sourceHeight / 2) * 2;
						} else if (aspectRatioValue === 1) {
							// Square (1:1): use smaller dimension to avoid codec limits
							const baseDimension = Math.floor(Math.min(sourceWidth, sourceHeight) / 2) * 2;
							exportWidth = baseDimension;
							exportHeight = baseDimension;
						} else if (aspectRatioValue > 1) {
							// Landscape: find largest even dimensions that exactly match aspect ratio
							const baseWidth = Math.floor(sourceWidth / 2) * 2;
							let found = false;
							for (let w = baseWidth; w >= 100 && !found; w -= 2) {
								const h = Math.round(w / aspectRatioValue);
								if (h % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
									exportWidth = w;
									exportHeight = h;
									found = true;
								}
							}
							if (!found) {
								exportWidth = baseWidth;
								exportHeight = Math.floor(baseWidth / aspectRatioValue / 2) * 2;
							}
						} else {
							// Portrait: find largest even dimensions that exactly match aspect ratio
							const baseHeight = Math.floor(sourceHeight / 2) * 2;
							let found = false;
							for (let h = baseHeight; h >= 100 && !found; h -= 2) {
								const w = Math.round(h * aspectRatioValue);
								if (w % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
									exportWidth = w;
									exportHeight = h;
									found = true;
								}
							}
							if (!found) {
								exportHeight = baseHeight;
								exportWidth = Math.floor((baseHeight * aspectRatioValue) / 2) * 2;
							}
						}

						// Calculate visually lossless bitrate matching screen recording optimization
						const totalPixels = exportWidth * exportHeight;
						bitrate = 30_000_000;
						if (totalPixels > 1920 * 1080 && totalPixels <= 2560 * 1440) {
							bitrate = 50_000_000;
						} else if (totalPixels > 2560 * 1440) {
							bitrate = 80_000_000;
						}
					} else {
						// Use quality-based target resolution
						const targetHeight = quality === "medium" ? 720 : 1080;

						// Calculate dimensions maintaining aspect ratio
						exportHeight = Math.floor(targetHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

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
						frameRate: 60,
						bitrate,
						codec: "avc1.640033",
						wallpaper,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur,
						zoomMotionBlur,
						connectZooms,
						borderRadius,
						padding,
						cropRegion,
						webcam,
						webcamUrl: webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null,
						annotationRegions,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorSize,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorClickBounceDuration,
						cursorSway,
						audioRegions,
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
					await videoPlaybackRef.current?.refreshFrame();
				}
			} catch (error) {
				console.error("Export error:", error);
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				setExportError(errorMessage);
				toast.error(`Export failed: ${errorMessage}`);
			} finally {
				if (!isPlaying) {
					await videoPlaybackRef.current?.refreshFrame().catch(() => undefined);
				}
				setIsExporting(false);
				exporterRef.current = null;
				setShowExportDropdown(keepExportDialogOpen);
				setExportProgress(null);
			}
		},
		[
			videoPath,
			wallpaper,
			trimRegions,
			speedRegions,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			showCursor,
			effectiveCursorTelemetry,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorSway,
			audioRegions,
			borderRadius,
			padding,
			cropRegion,
			webcam,
			annotationRegions,
			isPlaying,
			aspectRatio,
			exportQuality,
			effectiveZoomRegions,
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
	}, [
		videoPath,
		hasPendingExportSave,
	]);

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
			setShowExportDropdown(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(undefined);
		}
	}, []);

	const handleExportDropdownClose = useCallback(() => {
		setShowExportDropdown(false);
		setExportProgress(null);
		setExportError(null);
		setExportedFilePath(undefined);
	}, []);

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

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">Loading video...</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-sm hover:bg-[#2563EB]/90"
					>
						Load Project File
					</button>
				</div>
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
					<span className="text-sm font-semibold tracking-tight text-white/90">{projectDisplayName}</span>
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
						type="button"
						onClick={handleLoadProject}
						className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-white px-4 text-black transition-colors hover:bg-white/92"
					>
						<FolderOpen className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">{t("common.actions.load", "Load")}</span>
					</Button>
					<Button
						type="button"
						onClick={handleSaveProject}
						className="inline-flex h-8 min-w-[96px] items-center justify-center gap-1.5 rounded-[5px] bg-white px-4 text-black transition-colors hover:bg-white/92"
					>
						<Save className="h-4 w-4" />
						<span className="text-sm font-semibold tracking-tight">{t("common.actions.save")}</span>
					</Button>
					<div className="mx-1 h-5 w-px bg-white/10" />
					<DropdownMenu open={showExportDropdown} onOpenChange={setShowExportDropdown} modal={false}>
						<DropdownMenuTrigger asChild>
							<Button
						type="button"
								onClick={handleOpenExportDropdown}
								className="inline-flex h-8 min-w-[112px] items-center justify-center gap-2 rounded-[5px] bg-[#2563EB] px-4.5 text-white transition-colors hover:bg-[#2563EB]/92"
							>
								<Download className="h-4 w-4" />
								<span className="text-sm font-semibold tracking-tight">{t("common.actions.export", "Export")}</span>
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
											<p className="text-sm font-semibold text-white">{t("editor.exportStatus.exporting", "Exporting")}</p>
											<p className="text-xs text-slate-400">{t("editor.exportStatus.renderingFile", "Rendering your file.")}</p>
										</div>
										<Button type="button" variant="outline" onClick={handleCancelExport} className="h-8 border-red-500/20 bg-red-500/10 px-3 text-xs text-red-400 hover:bg-red-500/20">{t("common.actions.cancel")}</Button>
									</div>
									<div className="h-2 overflow-hidden rounded-full border border-white/5 bg-white/5">
										<div
											className="h-full bg-[#2563EB] transition-all duration-300 ease-out"
											style={{ width: `${Math.min(exportProgress?.percentage ?? 8, 100)}%` }}
										/>
									</div>
									<p className="mt-2 text-xs text-slate-400">
										{exportProgress ? t("editor.exportStatus.completePercent", "{{percent}}% complete", { percent: Math.round(exportProgress.percentage) }) : t("editor.exportStatus.preparing", "Preparing export...")}
									</p>
								</div>
							) : exportError ? (
								<div className="rounded-2xl border border-white/10 bg-[#17171a] p-4 text-slate-200 shadow-2xl">
									<p className="text-sm font-semibold text-white">{t("editor.exportStatus.issue", "Export issue")}</p>
									<p className="mt-1 text-xs leading-relaxed text-slate-400">{exportError}</p>
									<div className="mt-4 flex gap-2">
										{hasPendingExportSave ? (
											<Button type="button" onClick={handleRetrySaveExport} className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92">{t("editor.actions.saveAgain", "Save Again")}</Button>
										) : null}
										<Button type="button" variant="outline" onClick={handleExportDropdownClose} className="h-8 flex-1 border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10">{t("common.actions.close", "Close")}</Button>
									</div>
								</div>
							) : exportedFilePath ? (
								<div className="rounded-2xl border border-white/10 bg-[#17171a] p-4 text-slate-200 shadow-2xl">
									<p className="text-sm font-semibold text-white">{t("editor.exportStatus.complete", "Export complete")}</p>
									<p className="mt-1 text-xs text-slate-400">{t("editor.exportStatus.savedSuccessfully", "Your file was saved successfully.")}</p>
									<p className="mt-3 truncate text-xs text-slate-500">{exportedFilePath.split("/").pop()}</p>
									<div className="mt-4 flex gap-2">
										<Button type="button" onClick={revealExportedFile} className="h-8 flex-1 rounded-[5px] bg-[#2563EB] text-xs font-semibold text-white hover:bg-[#2563EB]/92">{t("editor.actions.showInFolder", "Show In Folder")}</Button>
										<Button type="button" variant="outline" onClick={handleExportDropdownClose} className="h-8 flex-1 border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10">Done</Button>
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
															<motion.span animate={{ color: isActive ? "#2563EB" : "rgba(255,255,255,0.75)" }} transition={{ duration: 0.16 }}>
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
											key={videoPath || "no-video"}
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
											borderRadius={borderRadius}
											padding={padding}
											cropRegion={cropRegion}
											webcam={webcam}
											webcamVideoPath={webcam.sourcePath ? toFileUrl(webcam.sourcePath) : null}
											trimRegions={trimRegions}
											speedRegions={speedRegions}
											annotationRegions={annotationRegions}
											selectedAnnotationId={selectedAnnotationId}
											onSelectAnnotation={handleSelectAnnotation}
											onAnnotationPositionChange={handleAnnotationPositionChange}
											onAnnotationSizeChange={handleAnnotationSizeChange}
											cursorTelemetry={effectiveCursorTelemetry}
											showCursor={showCursor}
											cursorSize={cursorSize}
											cursorSmoothing={cursorSmoothing}
											cursorMotionBlur={cursorMotionBlur}
											cursorClickBounce={cursorClickBounce}
											cursorClickBounceDuration={cursorClickBounceDuration}
											cursorSway={cursorSway}
											volume={previewVolume}
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
									currentTime={currentTime}
									onSeek={handleSeek}
									cursorTelemetry={effectiveCursorTelemetry}
									disableSuggestedZooms={loopCursor}
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
									onAspectRatioChange={setAspectRatio}
												onOpenCropEditor={handleOpenCropEditor}
												isCropped={isCropped}
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
					showCursor={showCursor}
					onShowCursorChange={setShowCursor}
					loopCursor={loopCursor}
					onLoopCursorChange={setLoopCursor}
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
					onAnnotationContentChange={handleAnnotationContentChange}
					onAnnotationTypeChange={handleAnnotationTypeChange}
					onAnnotationStyleChange={handleAnnotationStyleChange}
					onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
					onAnnotationDelete={handleAnnotationDelete}
					selectedSpeedId={selectedSpeedId}
					selectedSpeedValue={
						selectedSpeedId
							? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null)
							: null
					}
					onSpeedChange={handleSpeedChange}
					onSpeedDelete={handleSpeedDelete}
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

			<Toaster theme="dark" className="pointer-events-auto" />

		</div>
	);
}
