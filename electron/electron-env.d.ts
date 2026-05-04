/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

// Used in Renderer process, expose in `preload.ts`
interface NativeCaptureDiagnostics {
	backend: "windows-wgc" | "mac-screencapturekit" | "browser-store" | "ffmpeg";
	phase: "availability" | "start" | "stop" | "mux";
	timestamp: string;
	sourceId?: string | null;
	sourceType?: "screen" | "window" | "unknown";
	displayId?: number | null;
	displayBounds?: { x: number; y: number; width: number; height: number } | null;
	windowHandle?: number | null;
	helperPath?: string | null;
	outputPath?: string | null;
	systemAudioPath?: string | null;
	microphonePath?: string | null;
	osRelease?: string;
	supported?: boolean;
	helperExists?: boolean;
	fileSizeBytes?: number | null;
	processOutput?: string;
	error?: string;
}

interface UpdateToastState {
	version: string;
	detail: string;
	phase: "available" | "downloading" | "ready" | "error";
	delayMs: number;
	isPreview?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	remainingBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
}

interface UpdateStatusSummary {
	status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error";
	currentVersion: string;
	availableVersion: string | null;
	detail?: string;
}

type RendererExtensionInfo = import("./extensions/extensionTypes").ExtensionInfo;
type RendererExtensionReview = import("./extensions/extensionTypes").ExtensionReview;
type RendererMarketplaceExtension = import("./extensions/extensionTypes").MarketplaceExtension;
type RendererMarketplaceReviewStatus =
	import("./extensions/extensionTypes").MarketplaceReviewStatus;
type RendererMarketplaceSearchResult =
	import("./extensions/extensionTypes").MarketplaceSearchResult;

interface RendererFfmpegAudioMuxMetrics {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
}

interface Window {
	electronAPI: {
		hudOverlaySetIgnoreMouse: (ignore: boolean) => void;
		hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => void;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		setHudOverlayExpanded: (expanded: boolean) => void;
		setHudOverlayCompactWidth: (width: number) => void;
		setHudOverlayMeasuredHeight: (height: number, expanded: boolean) => void;
		getHudOverlayCaptureProtection: () => Promise<{ success: boolean; enabled: boolean }>;
		getHudOverlayMousePassthroughSupported: () => Promise<{
			success: boolean;
			supported: boolean;
		}>;
		setHudOverlayCaptureProtection: (
			enabled: boolean,
		) => Promise<{ success: boolean; enabled: boolean }>;
		getAssetBasePath: () => Promise<string | null>;
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		switchToEditor: () => Promise<void>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource>;
		showSourceHighlight: (source: ProcessedDesktopSource) => Promise<{ success: boolean }>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		onSelectedSourceChanged: (
			callback: (source: ProcessedDesktopSource | null) => void,
		) => () => void;
		startNativeScreenRecording: (
			source: ProcessedDesktopSource,
			options?: {
				capturesSystemAudio?: boolean;
				capturesMicrophone?: boolean;
				microphoneDeviceId?: string;
				microphoneLabel?: string;
			},
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
			userNotified?: boolean;
			microphoneFallbackRequired?: boolean;
		}>;
		stopNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		recoverNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		getLastNativeCaptureDiagnostics: () => Promise<{
			success: boolean;
			diagnostics?: NativeCaptureDiagnostics | null;
		}>;
		pauseNativeScreenRecording: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		resumeNativeScreenRecording: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		pauseCursorCapture: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		resumeCursorCapture: () => Promise<{
			success: boolean;
			message?: string;
			error?: string;
		}>;
		startFfmpegRecording: (
			source: ProcessedDesktopSource,
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		stopFfmpegRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string }>;
		storeMicrophoneSidecar: (
			audioData: ArrayBuffer,
			videoPath: string,
			options?: {
				startDelayMs?: number;
			},
		) => Promise<{ success: boolean; path?: string; error?: string }>;
		getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
		listAssetDirectory: (relativeDir: string) => Promise<{
			success: boolean;
			files?: string[];
			error?: string;
		}>;
		readLocalFile: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		generateWallpaperThumbnail: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		nativeVideoExportStart: (options: {
			width: number;
			height: number;
			frameRate: number;
			bitrate: number;
			encodingMode: "fast" | "balanced" | "quality";
			inputMode?: "rawvideo" | "h264-stream";
		}) => Promise<{
			success: boolean;
			sessionId?: string;
			encoderName?: string;
			error?: string;
		}>;
		nativeVideoExportWriteFrame: (
			sessionId: string,
			frameData: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		nativeVideoExportFinish: (
			sessionId: string,
			options?: {
				audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
				audioSourcePath?: string | null;
				audioSourceSampleRate?: number;
				trimSegments?: Array<{ startMs: number; endMs: number }>;
				editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
				editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
				editedAudioData?: ArrayBuffer;
				editedAudioMimeType?: string | null;
			},
		) => Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		nativeVideoExportCancel: (
			sessionId: string,
		) => Promise<{ success: boolean; error?: string }>;
		muxExportedVideoAudio: (
			videoData: ArrayBuffer,
			options?: {
				audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
				audioSourcePath?: string | null;
				audioSourceSampleRate?: number;
				trimSegments?: Array<{ startMs: number; endMs: number }>;
				editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
				editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
				editedAudioData?: ArrayBuffer;
				editedAudioMimeType?: string | null;
			},
		) => Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		muxExportedVideoAudioFromPath: (
			videoPath: string,
			options?: {
				audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
				audioSourcePath?: string | null;
				audioSourceSampleRate?: number;
				trimSegments?: Array<{ startMs: number; endMs: number }>;
				editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
				editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
				editedAudioData?: ArrayBuffer;
				editedAudioMimeType?: string | null;
			},
		) => Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: RendererFfmpegAudioMuxMetrics;
		}>;
		openExportStream: (options?: { extension?: string }) => Promise<{
			success: boolean;
			streamId?: string;
			tempPath?: string;
			error?: string;
		}>;
		writeExportStreamChunk: (
			streamId: string,
			position: number,
			chunk: Uint8Array,
		) => Promise<{ success: boolean; error?: string }>;
		closeExportStream: (
			streamId: string,
			options?: { abort?: boolean },
		) => Promise<{
			success: boolean;
			tempPath?: string;
			bytesWritten?: number;
			error?: string;
		}>;
		finalizeExportedVideo: (payload: {
			tempPath: string;
			fileName: string;
			outputPath?: string | null;
		}) => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			message?: string;
			error?: string;
		}>;
		discardExportedTemp: (tempPath: string) => Promise<{ success: boolean; error?: string }>;
		getVideoAudioFallbackPaths: (videoPath: string) => Promise<{
			success: boolean;
			paths: string[];
			startDelayMsByPath?: Record<string, number>;
			error?: string;
		}>;
		setRecordingState: (recording: boolean) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		setCursorTelemetry: (
			videoPath: string | undefined,
			samples: CursorTelemetryPoint[],
		) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		getSystemCursorAssets: () => Promise<{
			success: boolean;
			cursors: Record<string, SystemCursorAsset>;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		onRecordingStateChanged: (
			callback: (state: { recording: boolean; sourceName: string }) => void,
		) => () => void;
		onRecordingInterrupted: (
			callback: (state: { reason: string; message: string }) => void,
		) => () => void;
		onCursorStateChanged: (
			callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
		) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		getAccessibilityPermissionStatus: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		requestAccessibilityPermission: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		getScreenRecordingPermissionStatus: () => Promise<{
			success: boolean;
			status: string;
			error?: string;
		}>;
		openScreenRecordingPreferences: () => Promise<{ success: boolean; error?: string }>;
		openAccessibilityPreferences: () => Promise<{ success: boolean; error?: string }>;
		saveExportedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean }>;
		writeExportedVideoToPath: (
			videoData: ArrayBuffer,
			outputPath: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
			canceled?: boolean;
		}>;
		openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		openAudioFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		openWhisperExecutablePicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openWhisperModelPicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
			error?: string;
		}>;
		getWhisperSmallModelStatus: () => Promise<{
			success: boolean;
			exists: boolean;
			path?: string | null;
			error?: string;
		}>;
		downloadWhisperSmallModel: () => Promise<{
			success: boolean;
			path?: string;
			alreadyDownloaded?: boolean;
			error?: string;
		}>;
		deleteWhisperSmallModel: () => Promise<{ success: boolean; error?: string }>;
		onWhisperSmallModelDownloadProgress: (
			callback: (state: {
				status: "idle" | "downloading" | "downloaded" | "error";
				progress: number;
				path?: string | null;
				error?: string;
			}) => void,
		) => () => void;
		generateAutoCaptions: (options: {
			videoPath: string;
			whisperExecutablePath?: string;
			whisperModelPath: string;
			language?: string;
		}) => Promise<{
			success: boolean;
			cues?: AutoCaptionCue[];
			message?: string;
			error?: string;
		}>;
		setCurrentVideoPath: (
			path: string,
			options?: {
				preserveProjectPath?: boolean;
				hideOverlayCursorByDefault?: boolean;
			},
		) => Promise<{ success: boolean; webcamPath: string | null }>;
		setCurrentRecordingSession: (
			session: {
				videoPath: string;
				webcamPath?: string | null;
				timeOffsetMs?: number;
				hideOverlayCursorByDefault?: boolean;
			},
			options?: { preserveProjectPath?: boolean },
		) => Promise<{ success: boolean }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: {
				videoPath: string;
				webcamPath?: string | null;
				timeOffsetMs?: number;
				hideOverlayCursorByDefault?: boolean;
			};
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		deleteRecordingFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
		getLocalMediaUrl: (
			filePath: string,
		) => Promise<{ success: true; url: string } | { success: false }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
			thumbnailDataUrl?: string | null,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		saveProjectFileNamed: (
			projectData: unknown,
			projectName: string,
			thumbnailDataUrl?: string | null,
		) => Promise<{
			success: boolean;
			path?: string;
			projectId?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		getProjectsDirectory: () => Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
		listProjectFiles: () => Promise<{
			success: boolean;
			projectsDir?: string | null;
			entries: Array<{
				path: string;
				name: string;
				updatedAt: number;
				thumbnailPath: string | null;
				isCurrent: boolean;
				isInProjectsDirectory: boolean;
			}>;
			error?: string;
		}>;
		openProjectFileAtPath: (filePath: string) => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openProjectsDirectory: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		installDownloadedUpdate: () => Promise<{ success: boolean }>;
		downloadAvailableUpdate: (
			installAfterDownload?: boolean,
		) => Promise<{ success: boolean; message?: string }>;
		deferDownloadedUpdate: (delayMs?: number) => Promise<{
			success: boolean;
			message?: string;
		}>;
		dismissUpdateToast: () => Promise<{ success: boolean }>;
		skipUpdateVersion: () => Promise<{ success: boolean; message?: string }>;
		getCurrentUpdateToastPayload: () => Promise<UpdateToastState | null>;
		getUpdateStatusSummary: () => Promise<UpdateStatusSummary>;
		previewUpdateToast: () => Promise<{ success: boolean }>;
		checkForAppUpdates: () => Promise<{ success: boolean; logPath: string }>;
		onUpdateToastStateChanged: (
			callback: (payload: UpdateToastState | null) => void,
		) => () => void;
		onUpdateReadyToast: (
			callback: (payload: {
				version: string;
				detail: string;
				delayMs: number;
				isPreview?: boolean;
			}) => void,
		) => () => void;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getPlatform: () => Promise<string>;
		getLinuxWindowSystem: () => Promise<"wayland" | "x11" | null>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		openRecordingsFolder: () => Promise<{ success: boolean; error?: string; message?: string }>;
		getRecordingsDirectory: () => Promise<{
			success: boolean;
			path: string;
			isDefault: boolean;
			error?: string;
		}>;
		chooseRecordingsDirectory: () => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			isDefault?: boolean;
			message?: string;
			error?: string;
		}>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => () => void;
		isNativeWindowsCaptureAvailable: () => Promise<{ available: boolean }>;
		muxNativeWindowsRecording: (
			pauseSegments?: Array<{ startMs: number; endMs: number }>,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		/** Returns the app version from package.json */
		getAppVersion: () => Promise<string>;
		/** Hide the OS cursor before browser capture starts. */
		hideOsCursor: () => Promise<{ success: boolean }>;
		/** Recording preferences (mic, system audio) */
		getRecordingPreferences: () => Promise<{
			success: boolean;
			microphoneEnabled: boolean;
			microphoneDeviceId?: string;
			systemAudioEnabled: boolean;
		}>;
		setRecordingPreferences: (prefs: {
			microphoneEnabled?: boolean;
			microphoneDeviceId?: string;
			systemAudioEnabled?: boolean;
		}) => Promise<{ success: boolean; error?: string }>;
		/** Countdown timer before recording */
		getCountdownDelay: () => Promise<{ success: boolean; delay: number }>;
		setCountdownDelay: (delay: number) => Promise<{ success: boolean; error?: string }>;
		startCountdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
		cancelCountdown: () => Promise<{ success: boolean }>;
		getActiveCountdown: () => Promise<{ success: boolean; seconds: number | null }>;
		onCountdownTick: (callback: (seconds: number) => void) => () => void;
		extensionsDiscover: () => Promise<RendererExtensionInfo[]>;
		extensionsList: () => Promise<RendererExtensionInfo[]>;
		extensionsGet: (id: string) => Promise<RendererExtensionInfo | null>;
		extensionsEnable: (id: string) => Promise<{ success: boolean; error?: string }>;
		extensionsDisable: (id: string) => Promise<{ success: boolean; error?: string }>;
		extensionsInstallFromFolder: () => Promise<{
			success: boolean;
			extension?: RendererExtensionInfo;
			message?: string;
			error?: string;
			canceled?: boolean;
		}>;
		extensionsUninstall: (id: string) => Promise<{ success: boolean; error?: string }>;
		extensionsGetDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
		extensionsOpenDirectory: () => Promise<{ success: boolean; path?: string; error?: string }>;
		extensionsMarketplaceSearch: (params: {
			query?: string;
			tags?: string[];
			sort?: string;
			page?: number;
			pageSize?: number;
		}) => Promise<RendererMarketplaceSearchResult & { error?: string }>;
		extensionsMarketplaceGet: (id: string) => Promise<RendererMarketplaceExtension | null>;
		extensionsMarketplaceInstall: (
			extensionId: string,
			downloadUrl: string,
		) => Promise<{ success: boolean; error?: string }>;
		extensionsMarketplaceSubmit: (
			extensionId: string,
		) => Promise<{ success: boolean; reviewId?: string; error?: string }>;
		extensionsReviewsList: (params: {
			status?: RendererMarketplaceReviewStatus;
			page?: number;
			pageSize?: number;
		}) => Promise<{ reviews: RendererExtensionReview[]; total: number; error?: string }>;
		extensionsReviewUpdate: (
			reviewId: string,
			status: RendererMarketplaceReviewStatus,
			notes?: string,
		) => Promise<{ success: boolean; error?: string }>;
	};
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
	originalName?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	pressure?: number;
	interactionType?:
		| "move"
		| "click"
		| "double-click"
		| "right-click"
		| "middle-click"
		| "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

interface SystemCursorAsset {
	dataUrl: string;
	hotspotX: number;
	hotspotY: number;
	width: number;
	height: number;
}

interface AutoCaptionCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: Array<{
		text: string;
		startMs: number;
		endMs: number;
		leadingSpace?: boolean;
	}>;
}
