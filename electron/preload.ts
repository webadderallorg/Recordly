import { contextBridge, ipcRenderer } from "electron";

type NativeVideoExportWriteResult = { success: boolean; error?: string };
type NativeVideoAudioMuxMetrics = {
	tempVideoWriteMs?: number;
	tempEditedAudioWriteMs?: number;
	ffmpegExecMs?: number;
	muxedVideoReadMs?: number;
	tempVideoBytes?: number;
	tempEditedAudioBytes?: number;
	muxedVideoBytes?: number;
};

const nativeVideoExportWriteRequests = new Map<
	number,
	{
		sessionId: string;
		resolve: (result: NativeVideoExportWriteResult) => void;
	}
>();

let nextNativeVideoExportWriteRequestId = 1;
let nativeVideoExportWriteResultListenerAttached = false;

function ensureNativeVideoExportWriteResultListener() {
	if (nativeVideoExportWriteResultListenerAttached) {
		return;
	}

	nativeVideoExportWriteResultListenerAttached = true;
	ipcRenderer.on(
		"native-video-export-write-frame-result",
		(
			_event,
			payload: {
				sessionId?: string;
				requestId?: number;
				success?: boolean;
				error?: string;
			},
		) => {
			if (typeof payload?.requestId !== "number") {
				return;
			}

			const pendingRequest = nativeVideoExportWriteRequests.get(payload.requestId);
			if (!pendingRequest) {
				return;
			}

			nativeVideoExportWriteRequests.delete(payload.requestId);
			pendingRequest.resolve({
				success: payload.success === true,
				error: payload.error,
			});
		},
	);
}

function settleNativeVideoExportPendingRequests(
	sessionId: string,
	result: NativeVideoExportWriteResult,
) {
	for (const [requestId, pendingRequest] of nativeVideoExportWriteRequests.entries()) {
		if (pendingRequest.sessionId !== sessionId) {
			continue;
		}

		nativeVideoExportWriteRequests.delete(requestId);
		pendingRequest.resolve(result);
	}
}

contextBridge.exposeInMainWorld("electronAPI", {
	hudOverlaySetIgnoreMouse: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-set-ignore-mouse", ignore);
	},
	hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => {
		ipcRenderer.send("hud-overlay-drag", phase, screenX, screenY);
	},
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
	getHudOverlayMousePassthroughSupported: () => {
		return ipcRenderer.invoke("get-hud-overlay-mouse-passthrough-supported");
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
	generateWallpaperThumbnail: (filePath: string) => {
		return ipcRenderer.invoke("generate-wallpaper-thumbnail", filePath);
	},
	nativeVideoExportStart: (options: {
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		inputMode?: "rawvideo" | "h264-stream";
	}) => {
		return ipcRenderer.invoke("native-video-export-start", options);
	},
	nativeVideoExportWriteFrame: (sessionId: string, frameData: Uint8Array) => {
		ensureNativeVideoExportWriteResultListener();

		return new Promise<NativeVideoExportWriteResult>((resolve) => {
			const requestId = nextNativeVideoExportWriteRequestId++;
			nativeVideoExportWriteRequests.set(requestId, {
				sessionId,
				resolve,
			});

			ipcRenderer.send("native-video-export-write-frame-async", {
				sessionId,
				requestId,
				frameData,
			});
		});
	},
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
	) => {
		return ipcRenderer
			.invoke("native-video-export-finish", sessionId, options)
			.then((result) => {
				settleNativeVideoExportPendingRequests(
					sessionId,
					result?.success
						? { success: true }
						: {
								success: false,
								error:
									typeof result?.error === "string"
										? result.error
										: "Native video export session finished before all frame writes settled.",
							},
				);

				return result;
			}) as Promise<{
			success: boolean;
			data?: Uint8Array;
			encoderName?: string;
			error?: string;
			metrics?: NativeVideoAudioMuxMetrics;
		}>;
	},
	nativeVideoExportCancel: (sessionId: string) => {
		return ipcRenderer.invoke("native-video-export-cancel", sessionId).finally(() => {
			settleNativeVideoExportPendingRequests(sessionId, {
				success: false,
				error: "Native video export session was cancelled",
			});
		});
	},
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
	) => {
		return ipcRenderer.invoke("mux-exported-video-audio", videoData, options) as Promise<{
			success: boolean;
			tempPath?: string;
			error?: string;
			metrics?: NativeVideoAudioMuxMetrics;
		}>;
	},
	muxExportedVideoAudioFromPath: (
		videoPath: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		},
	) => {
		return ipcRenderer.invoke("mux-exported-video-audio-from-path", videoPath, options);
	},
	openExportStream: (options?: { extension?: string }) => {
		return ipcRenderer.invoke("export-stream-open", options);
	},
	writeExportStreamChunk: (streamId: string, position: number, chunk: Uint8Array) => {
		return ipcRenderer.invoke("export-stream-write", streamId, position, chunk);
	},
	closeExportStream: (streamId: string, options?: { abort?: boolean }) => {
		return ipcRenderer.invoke("export-stream-close", streamId, options);
	},
	finalizeExportedVideo: (payload: {
		tempPath: string;
		fileName: string;
		outputPath?: string | null;
	}) => {
		return ipcRenderer.invoke("finalize-exported-video", payload);
	},
	discardExportedTemp: (tempPath: string) => {
		return ipcRenderer.invoke("discard-exported-temp", tempPath);
	},
	getVideoAudioFallbackPaths: (videoPath: string) => {
		return ipcRenderer.invoke("get-video-audio-fallback-paths", videoPath);
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
	selectSource: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("select-source", source);
	},
	showSourceHighlight: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("show-source-highlight", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	onSelectedSourceChanged: (callback: (source: ProcessedDesktopSource | null) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: ProcessedDesktopSource | null,
		) => callback(payload);
		ipcRenderer.on("selected-source-changed", listener);
		return () => ipcRenderer.removeListener("selected-source-changed", listener);
	},
	startNativeScreenRecording: (
		source: ProcessedDesktopSource,
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
	recoverNativeScreenRecording: () => {
		return ipcRenderer.invoke("recover-native-screen-recording");
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
	pauseCursorCapture: () => {
		return ipcRenderer.invoke("pause-cursor-capture");
	},
	resumeCursorCapture: () => {
		return ipcRenderer.invoke("resume-cursor-capture");
	},
	startFfmpegRecording: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("start-ffmpeg-recording", source);
	},
	stopFfmpegRecording: () => {
		return ipcRenderer.invoke("stop-ffmpeg-recording");
	},
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeMicrophoneSidecar: (
		audioData: ArrayBuffer,
		videoPath: string,
		options?: { startDelayMs?: number },
	) => {
		return ipcRenderer.invoke("store-microphone-sidecar", audioData, videoPath, options);
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
	setCursorTelemetry: (videoPath: string | undefined, samples: CursorTelemetryPoint[]) => {
		return ipcRenderer.invoke("set-cursor-telemetry", videoPath, samples);
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
	writeExportedVideoToPath: (videoData: ArrayBuffer, outputPath: string) => {
		return ipcRenderer.invoke("write-exported-video-to-path", videoData, outputPath);
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
		callback: (state: {
			status: "idle" | "downloading" | "downloaded" | "error";
			progress: number;
			path?: string | null;
			error?: string;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
				status: "idle" | "downloading" | "downloaded" | "error";
				progress: number;
				path?: string | null;
				error?: string;
			},
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
	setCurrentVideoPath: (
		path: string,
		options?: {
			preserveProjectPath?: boolean;
			hideOverlayCursorByDefault?: boolean;
		},
	) => {
		return ipcRenderer.invoke("set-current-video-path", path, options);
	},
	setCurrentRecordingSession: (
		session: {
			videoPath: string;
			webcamPath?: string | null;
			timeOffsetMs?: number;
			hideOverlayCursorByDefault?: boolean;
		},
		options?: { preserveProjectPath?: boolean },
	) => {
		return ipcRenderer.invoke("set-current-recording-session", session, options);
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
	getLocalMediaUrl: (filePath: string) => {
		return ipcRenderer.invoke("get-local-media-url", filePath) as Promise<
			{ success: true; url: string } | { success: false }
		>;
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
	saveProjectFileNamed: (
		projectData: unknown,
		projectName: string,
		thumbnailDataUrl?: string | null,
	) => {
		return ipcRenderer.invoke(
			"save-project-file-named",
			projectData,
			projectName,
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
	downloadAvailableUpdate: (installAfterDownload?: boolean) => {
		return ipcRenderer.invoke("download-available-update", installAfterDownload);
	},
	deferDownloadedUpdate: (delayMs?: number) => {
		return ipcRenderer.invoke("defer-downloaded-update", delayMs);
	},
	dismissUpdateToast: () => {
		return ipcRenderer.invoke("dismiss-update-toast");
	},
	skipUpdateVersion: () => {
		return ipcRenderer.invoke("skip-update-version");
	},
	getCurrentUpdateToastPayload: () => {
		return ipcRenderer.invoke("get-current-update-toast-payload");
	},
	getUpdateStatusSummary: () => {
		return ipcRenderer.invoke("get-update-status-summary");
	},
	previewUpdateToast: () => {
		return ipcRenderer.invoke("preview-update-toast");
	},
	checkForAppUpdates: () => {
		return ipcRenderer.invoke("check-for-app-updates");
	},
	onUpdateToastStateChanged: (
		callback: (
			payload: {
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
			} | null,
		) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: {
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
			} | null,
		) => callback(payload);
		ipcRenderer.on("update-toast-state", listener);
		return () => ipcRenderer.removeListener("update-toast-state", listener);
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
	getLinuxWindowSystem: () => {
		return ipcRenderer.invoke("get-linux-window-system");
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
	isNativeWindowsCaptureAvailable: () =>
		ipcRenderer.invoke("is-native-windows-capture-available"),
	muxNativeWindowsRecording: (pauseSegments?: Array<{ startMs: number; endMs: number }>) =>
		ipcRenderer.invoke("mux-native-windows-recording", pauseSegments),
	hideOsCursor: () => ipcRenderer.invoke("hide-cursor"),
	getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
	getRecordingPreferences: () => ipcRenderer.invoke("get-recording-preferences"),
	setRecordingPreferences: (prefs: {
		microphoneEnabled?: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled?: boolean;
	}) => ipcRenderer.invoke("set-recording-preferences", prefs),
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

	// ── Extensions ──────────────────────────────────────────────────────
	extensionsDiscover: () => ipcRenderer.invoke("extensions:discover"),
	extensionsList: () => ipcRenderer.invoke("extensions:list"),
	extensionsGet: (id: string) => ipcRenderer.invoke("extensions:get", id),
	extensionsEnable: (id: string) => ipcRenderer.invoke("extensions:enable", id),
	extensionsDisable: (id: string) => ipcRenderer.invoke("extensions:disable", id),
	extensionsInstallFromFolder: () => ipcRenderer.invoke("extensions:install-from-folder"),
	extensionsUninstall: (id: string) => ipcRenderer.invoke("extensions:uninstall", id),
	extensionsGetDirectory: () => ipcRenderer.invoke("extensions:get-directory"),
	extensionsOpenDirectory: () => ipcRenderer.invoke("extensions:open-directory"),

	// ── Extensions — Marketplace ────────────────────────────────────────
	extensionsMarketplaceSearch: (params: {
		query?: string;
		tags?: string[];
		sort?: string;
		page?: number;
		pageSize?: number;
	}) => ipcRenderer.invoke("extensions:marketplace-search", params),
	extensionsMarketplaceGet: (id: string) => ipcRenderer.invoke("extensions:marketplace-get", id),
	extensionsMarketplaceInstall: (extensionId: string, downloadUrl: string) =>
		ipcRenderer.invoke("extensions:marketplace-install", extensionId, downloadUrl),
	extensionsMarketplaceSubmit: (extensionId: string) =>
		ipcRenderer.invoke("extensions:marketplace-submit", extensionId),

	// ── Extensions — Admin Review ───────────────────────────────────────
	extensionsReviewsList: (params: { status?: string; page?: number; pageSize?: number }) =>
		ipcRenderer.invoke("extensions:reviews-list", params),
	extensionsReviewUpdate: (reviewId: string, status: string, notes?: string) =>
		ipcRenderer.invoke("extensions:review-update", reviewId, status, notes),
});
