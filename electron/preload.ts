import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	setHudOverlayExpanded: (expanded: boolean) => {
		ipcRenderer.send("set-hud-overlay-expanded", expanded);
	},
	setHudOverlayCompactWidth: (width: number) => {
		ipcRenderer.send("set-hud-overlay-compact-width", width);
	},
	setHudOverlayMeasuredHeight: (height: number, expanded: boolean) => {
		ipcRenderer.send("set-hud-overlay-measured-height", height, expanded);
	},
	getHudOverlayCaptureProtection: () => {
		return ipcRenderer.invoke("get-hud-overlay-capture-protection");
	},
	setHudOverlayCaptureProtection: (enabled: boolean) => {
		return ipcRenderer.invoke("set-hud-overlay-capture-protection", enabled);
	},
	getAssetBasePath: async () => {
		return await ipcRenderer.invoke("get-asset-base-path");
	},
	listAssetDirectory: (relativeDir: string) => {
		return ipcRenderer.invoke("list-asset-directory", relativeDir);
	},
	readLocalFile: (filePath: string) => {
		return ipcRenderer.invoke("read-local-file", filePath);
	},
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	openSourceSelector: () => {
		return ipcRenderer.invoke("open-source-selector");
	},
	selectSource: (source: any) => {
		return ipcRenderer.invoke("select-source", source);
	},
	showSourceHighlight: (source: any) => {
		return ipcRenderer.invoke("show-source-highlight", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	onSelectedSourceChanged: (callback: (source: any) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: any) => callback(payload);
		ipcRenderer.on("selected-source-changed", listener);
		return () => ipcRenderer.removeListener("selected-source-changed", listener);
	},
	startNativeScreenRecording: (
		source: any,
		options?: {
			capturesSystemAudio?: boolean;
			capturesMicrophone?: boolean;
			microphoneDeviceId?: string;
			microphoneLabel?: string;
		},
	) => {
		return ipcRenderer.invoke("start-native-screen-recording", source, options);
	},
	stopNativeScreenRecording: () => {
		return ipcRenderer.invoke("stop-native-screen-recording");
	},
	getLastNativeCaptureDiagnostics: () => {
		return ipcRenderer.invoke("get-last-native-capture-diagnostics");
	},
	pauseNativeScreenRecording: () => {
		return ipcRenderer.invoke("pause-native-screen-recording");
	},
	resumeNativeScreenRecording: () => {
		return ipcRenderer.invoke("resume-native-screen-recording");
	},
	startFfmpegRecording: (source: any) => {
		return ipcRenderer.invoke("start-ffmpeg-recording", source);
	},
	stopFfmpegRecording: () => {
		return ipcRenderer.invoke("stop-ffmpeg-recording");
	},
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},
	setRecordingState: (recording: boolean) => {
		return ipcRenderer.invoke("set-recording-state", recording);
	},
	setCursorScale: (scale: number) => {
		return ipcRenderer.invoke("set-cursor-scale", scale);
	},
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	getSystemCursorAssets: () => {
		return ipcRenderer.invoke("get-system-cursor-assets");
	},
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},
	onRecordingStateChanged: (
		callback: (state: { recording: boolean; sourceName: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { recording: boolean; sourceName: string },
		) => callback(payload);
		ipcRenderer.on("recording-state-changed", listener);
		return () => ipcRenderer.removeListener("recording-state-changed", listener);
	},
	onRecordingInterrupted: (callback: (state: { reason: string; message: string }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { reason: string; message: string },
		) => callback(payload);
		ipcRenderer.on("recording-interrupted", listener);
		return () => ipcRenderer.removeListener("recording-interrupted", listener);
	},
	onCursorStateChanged: (
		callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { cursorType: CursorTelemetryPoint["cursorType"] },
		) => callback(payload);
		ipcRenderer.on("cursor-state-changed", listener);
		return () => ipcRenderer.removeListener("cursor-state-changed", listener);
	},
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	getAccessibilityPermissionStatus: () => {
		return ipcRenderer.invoke("get-accessibility-permission-status");
	},
	requestAccessibilityPermission: () => {
		return ipcRenderer.invoke("request-accessibility-permission");
	},
	getScreenRecordingPermissionStatus: () => {
		return ipcRenderer.invoke("get-screen-recording-permission-status");
	},
	openScreenRecordingPreferences: () => {
		return ipcRenderer.invoke("open-screen-recording-preferences");
	},
	openAccessibilityPreferences: () => {
		return ipcRenderer.invoke("open-accessibility-preferences");
	},
	saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("save-exported-video", videoData, fileName);
	},
	openVideoFilePicker: () => {
		return ipcRenderer.invoke("open-video-file-picker");
	},
	openAudioFilePicker: () => {
		return ipcRenderer.invoke("open-audio-file-picker");
	},
	openWhisperExecutablePicker: () => {
		return ipcRenderer.invoke("open-whisper-executable-picker");
	},
	openWhisperModelPicker: () => {
		return ipcRenderer.invoke("open-whisper-model-picker");
	},
	getWhisperSmallModelStatus: () => {
		return ipcRenderer.invoke("get-whisper-small-model-status");
	},
	downloadWhisperSmallModel: () => {
		return ipcRenderer.invoke("download-whisper-small-model");
	},
	deleteWhisperSmallModel: () => {
		return ipcRenderer.invoke("delete-whisper-small-model");
	},
	onWhisperSmallModelDownloadProgress: (
		callback: (state: { status: "idle" | "downloading" | "downloaded" | "error"; progress: number; path?: string | null; error?: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { status: "idle" | "downloading" | "downloaded" | "error"; progress: number; path?: string | null; error?: string },
		) => callback(payload);
		ipcRenderer.on("whisper-small-model-download-progress", listener);
		return () => ipcRenderer.removeListener("whisper-small-model-download-progress", listener);
	},
	generateAutoCaptions: (options: {
		videoPath: string;
		whisperExecutablePath?: string;
		whisperModelPath: string;
		language?: string;
	}) => {
		return ipcRenderer.invoke("generate-auto-captions", options);
	},
	setCurrentVideoPath: (path: string) => {
		return ipcRenderer.invoke("set-current-video-path", path);
	},
	setCurrentRecordingSession: (session: { videoPath: string; webcamPath?: string | null; timeOffsetMs?: number }) => {
		return ipcRenderer.invoke("set-current-recording-session", session);
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	deleteRecordingFile: (filePath: string) => {
		return ipcRenderer.invoke("delete-recording-file", filePath);
	},
	saveProjectFile: (
		projectData: unknown,
		suggestedName?: string,
		existingProjectPath?: string,
		thumbnailDataUrl?: string | null,
	) => {
		return ipcRenderer.invoke(
			"save-project-file",
			projectData,
			suggestedName,
			existingProjectPath,
			thumbnailDataUrl,
		);
	},
	loadProjectFile: () => {
		return ipcRenderer.invoke("load-project-file");
	},
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},
	getProjectsDirectory: () => {
		return ipcRenderer.invoke("get-projects-directory");
	},
	listProjectFiles: () => {
		return ipcRenderer.invoke("list-project-files");
	},
	openProjectFileAtPath: (filePath: string) => {
		return ipcRenderer.invoke("open-project-file-at-path", filePath);
	},
	openProjectsDirectory: () => {
		return ipcRenderer.invoke("open-projects-directory");
	},
	installDownloadedUpdate: () => {
		return ipcRenderer.invoke("install-downloaded-update");
	},
	deferDownloadedUpdate: (delayMs?: number) => {
		return ipcRenderer.invoke("defer-downloaded-update", delayMs);
	},
	previewUpdateToast: () => {
		return ipcRenderer.invoke("preview-update-toast");
	},
	dismissUpdateToast: () => {
		return ipcRenderer.invoke("dismiss-update-toast");
	},
	skipDownloadedUpdate: (version?: string) => {
		return ipcRenderer.invoke("skip-downloaded-update", version);
	},
	getCurrentUpdateToastPayload: () => {
		return ipcRenderer.invoke("get-current-update-toast-payload");
	},
	onUpdateReadyToast: (
		callback: (payload: {
			version: string;
			detail: string;
			delayMs: number;
			isPreview?: boolean;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { version: string; detail: string; delayMs: number; isPreview?: boolean },
		) => callback(payload);
		ipcRenderer.on("update-ready-toast", listener);
		return () => ipcRenderer.removeListener("update-ready-toast", listener);
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	openRecordingsFolder: () => {
		return ipcRenderer.invoke("open-recordings-folder");
	},
	getRecordingsDirectory: () => {
		return ipcRenderer.invoke("get-recordings-directory");
	},
	chooseRecordingsDirectory: () => {
		return ipcRenderer.invoke("choose-recordings-directory");
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => {
		const listener = async () => {
			let saved = false;
			try {
				saved = await callback();
			} catch {
				saved = false;
			}
			ipcRenderer.send("save-before-close-done", saved);
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	isNativeWindowsCaptureAvailable: () => ipcRenderer.invoke("is-native-windows-capture-available"),
	muxNativeWindowsRecording: () => ipcRenderer.invoke("mux-native-windows-recording"),
	hideOsCursor: () => ipcRenderer.invoke("hide-cursor"),
	getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
	getCountdownDelay: () => ipcRenderer.invoke("get-countdown-delay"),
	setCountdownDelay: (delay: number) => ipcRenderer.invoke("set-countdown-delay", delay),
	startCountdown: (seconds: number) => ipcRenderer.invoke("start-countdown", seconds),
	cancelCountdown: () => ipcRenderer.invoke("cancel-countdown"),
	getActiveCountdown: () => ipcRenderer.invoke("get-active-countdown"),
	onCountdownTick: (callback: (seconds: number) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, seconds: number) => callback(seconds);
		ipcRenderer.on("countdown-tick", listener);
		return () => ipcRenderer.removeListener("countdown-tick", listener);
	},
});
