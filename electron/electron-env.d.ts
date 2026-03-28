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

interface Window {
	electronAPI: {
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		setHudOverlayExpanded: (expanded: boolean) => void;
		setHudOverlayCompactWidth: (width: number) => void;
		setHudOverlayMeasuredHeight: (height: number, expanded: boolean) => void;
		getHudOverlayCaptureProtection: () => Promise<{ success: boolean; enabled: boolean }>;
		setHudOverlayCaptureProtection: (
			enabled: boolean,
		) => Promise<{ success: boolean; enabled: boolean }>;
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		switchToEditor: () => Promise<void>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: any) => Promise<any>;
		showSourceHighlight: (source: any) => Promise<{ success: boolean }>;
		getSelectedSource: () => Promise<any>;
		onSelectedSourceChanged: (callback: (source: any) => void) => () => void;
		startNativeScreenRecording: (
			source: any,
			options?: {
				capturesSystemAudio?: boolean;
				capturesMicrophone?: boolean;
				microphoneDeviceId?: string;
				microphoneLabel?: string;
			},
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		stopNativeScreenRecording: () => Promise<{
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
		startFfmpegRecording: (
			source: any,
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
		getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
		listAssetDirectory: (relativeDir: string) => Promise<{
			success: boolean;
			files?: string[];
			error?: string;
		}>;
		readLocalFile: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		setRecordingState: (recording: boolean) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
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
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		setCurrentRecordingSession: (session: {
			videoPath: string;
			webcamPath?: string | null;
			timeOffsetMs?: number;
		}) => Promise<{ success: boolean }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number };
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		deleteRecordingFile: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
			thumbnailDataUrl?: string | null,
		) => Promise<{
			success: boolean;
			path?: string;
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
		deferDownloadedUpdate: (
			delayMs?: number,
		) => Promise<{ success: boolean; message?: string }>;
		previewUpdateToast: () => Promise<{ success: boolean }>;
		dismissUpdateToast: () => Promise<{ success: boolean }>;
		skipDownloadedUpdate: (version?: string) => Promise<{
			success: boolean;
			message?: string;
		}>;
		getCurrentUpdateToastPayload: () => Promise<{
			version: string;
			detail: string;
			delayMs: number;
			isPreview?: boolean;
		} | null>;
		onUpdateReadyToast: (callback: (payload: {
			version: string;
			detail: string;
			delayMs: number;
			isPreview?: boolean;
		}) => void) => () => void;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getPlatform: () => Promise<string>;
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
		muxNativeWindowsRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		/** Returns the app version from package.json */
		getAppVersion: () => Promise<string>;
		/** Hide the OS cursor before browser capture starts. */
		hideOsCursor: () => Promise<{ success: boolean }>;
		/** Countdown timer before recording */
		getCountdownDelay: () => Promise<{ success: boolean; delay: number }>;
		setCountdownDelay: (delay: number) => Promise<{ success: boolean; error?: string }>;
		startCountdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
		cancelCountdown: () => Promise<{ success: boolean }>;
		getActiveCountdown: () => Promise<{ success: boolean; seconds: number | null }>;
		onCountdownTick: (callback: (seconds: number) => void) => () => void;
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
	interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
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
