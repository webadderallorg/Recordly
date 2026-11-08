import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { CaptionModelDownloadProgress, CaptionModelId } from "../src/shared/captionModels";
import type { CloudBillingInput } from "../src/types/cloudBilling";
import type { RecordingSessionData } from "./ipc/types";

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
type WindowsGpuExportSummary = {
	success?: boolean;
	width?: number;
	height?: number;
	fps?: number;
	seconds?: number;
	mediaMs?: number;
	frames?: number;
	cursorOverlay?: boolean;
	zoomOverlay?: boolean;
	adapterVendorId?: number;
	adapterDeviceId?: number;
	adapterDedicatedVideoMemoryMB?: number;
	initializeMs?: number;
	initCoInitializeMs?: number;
	initMfStartupMs?: number;
	initD3DDeviceMs?: number;
	initSourceReaderMs?: number;
	initWebcamReaderMs?: number;
	initVideoProcessorMs?: number;
	initTexturesMs?: number;
	initShaderPipelineMs?: number;
	initSinkWriterMs?: number;
	totalMs?: number;
	readMs?: number;
	clearMs?: number;
	videoProcessMs?: number;
	writeSampleMs?: number;
	finalizeMs?: number;
	realtimeMultiplier?: number;
};
type NativeStaticLayoutChunkMetric = {
	index: number;
	startSec: number;
	durationSec: number;
	backend:
		| "cuda-overlay"
		| "cuda-scale-cpu-pad"
		| "cuda-static-composite"
		| "nvidia-cuda-compositor"
		| "windows-d3d11-compositor";
	elapsedMs: number;
	outputBytes: number;
	fallbackReason?: string;
	windowsGpuSummary?: WindowsGpuExportSummary;
};
type NativeStaticLayoutMetrics = NativeVideoAudioMuxMetrics & {
	chunkCount: number;
	chunkDurationSec: number;
	chunkExecMs: number;
	concatExecMs?: number;
	staticAssetExecMs?: number;
	fallbackChunkCount: number;
	videoOnlyBytes?: number;
	chunks: NativeStaticLayoutChunkMetric[];
};
type NativeStaticLayoutProgress = {
	sessionId?: string;
	backend?: NativeStaticLayoutChunkMetric["backend"];
	stage?: "preparing" | "finalizing";
	elapsedMs?: number;
	averageFps?: number;
	currentFrame: number;
	totalFrames: number;
	percentage: number;
};
type NativeVideoMetadataProbe = {
	width: number;
	height: number;
	duration: number;
	mediaStartTime?: number;
	streamStartTime?: number;
	streamDuration?: number;
	frameRate: number;
	frameRateSource?: "metadata" | "fallback";
	codec: string;
	hasAudio: boolean;
	audioCodec?: string;
	audioSampleRate?: number;
};
type NativeExportCapabilities = {
	platform: NodeJS.Platform;
	nvidiaCuda: {
		available: boolean;
		skipReason: string | null;
		hasNvidiaGpu: boolean | null;
		hasWrapper: boolean;
		explicitEnabled: boolean;
		explicitDisabled: boolean;
		userOptInRequired: boolean;
	};
};
type ExportHardwareInfo = {
	platform: NodeJS.Platform;
	release: string;
	arch: string;
	cpuModel: string | null;
	logicalProcessors: number;
	totalMemoryGb: number;
	machineModel: string | null;
	gpus: Array<{
		name: string;
		vendor: string | null;
		active: boolean | null;
	}>;
	gpuFeatures: {
		videoDecode: string | null;
		videoEncode: string | null;
		webgl: string | null;
		webgpu: string | null;
	};
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
	setAppLocale: (locale: string) => ipcRenderer.invoke("set-app-locale", locale),
	optimizeGif: (requestId: string, data: ArrayBuffer) =>
		ipcRenderer.invoke("optimize-gif", requestId, data),
	cancelGifOptimization: (requestId: string) =>
		ipcRenderer.invoke("cancel-gif-optimization", requestId),
	writeClipboardText: (text: string) => ipcRenderer.invoke("clipboard:writeText", text),
	authStorageAvailable: () => ipcRenderer.invoke("auth-storage:available"),
	authStorageMigrate: (items: Record<string, string>) =>
		ipcRenderer.invoke("auth-storage:migrate", items),
	authStorageGetItem: (key: string) => ipcRenderer.invoke("auth-storage:get", key),
	authStorageSetItem: (key: string, value: string) =>
		ipcRenderer.invoke("auth-storage:set", key, value),
	authStorageRemoveItem: (key: string) => ipcRenderer.invoke("auth-storage:remove", key),
	hudOverlaySetIgnoreMouse: (ignore: boolean) => {
		ipcRenderer.send("hud-overlay-set-ignore-mouse", ignore);
	},
	hudOverlaySetSourceSelectionActive: (active: boolean) => {
		ipcRenderer.send("hud-overlay-set-source-selection-active", active);
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
	getEditorMode: () => ipcRenderer.invoke("get-editor-mode"),
	onEditorModeChanged: (callback: (inEditor: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, inEditor: boolean) =>
			callback(inEditor);
		ipcRenderer.on("editor-mode-changed", listener);
		return () => ipcRenderer.removeListener("editor-mode-changed", listener);
	},
	hudOverlayRendererReady: () => {
		ipcRenderer.send("hud-overlay-renderer-ready");
	},
	hudOverlaySetWebcamPreviewVisible: (visible: boolean) => {
		ipcRenderer.send("hud-overlay-set-webcam-preview-visible", visible);
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
	getDesktopWallpaper: () => {
		return ipcRenderer.invoke("get-desktop-wallpaper") as Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
	},
	readLocalFile: (filePath: string) => {
		return ipcRenderer.invoke("read-local-file", filePath);
	},
	generateWallpaperThumbnail: (filePath: string) => {
		return ipcRenderer.invoke("generate-wallpaper-thumbnail", filePath);
	},
	probeNativeVideoMetadata: (filePath: string) => {
		return ipcRenderer.invoke("probe-native-video-metadata", filePath) as Promise<{
			success: boolean;
			metadata?: NativeVideoMetadataProbe;
			error?: string;
		}>;
	},
	getNativeExportCapabilities: () => {
		return ipcRenderer.invoke("get-native-export-capabilities") as Promise<{
			success: boolean;
			capabilities?: NativeExportCapabilities;
			error?: string;
		}>;
	},
	getExportHardwareInfo: () => {
		return ipcRenderer.invoke("get-export-hardware-info") as Promise<{
			success: boolean;
			hardware?: ExportHardwareInfo;
			error?: string;
		}>;
	},
	nativeStaticLayoutExport: (options: {
		sessionId?: string;
		inputPath: string;
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		durationSec: number;
		contentWidth: number;
		contentHeight: number;
		offsetX: number;
		offsetY: number;
		sourceCropX?: number;
		sourceCropY?: number;
		sourceCropWidth?: number;
		sourceCropHeight?: number;
		backgroundColor: string;
		backgroundImagePath?: string | null;
		backgroundBlurPx?: number;
		borderRadius?: number;
		shadowIntensity?: number;
		webcamInputPath?: string | null;
		webcamLeft?: number;
		webcamTop?: number;
		webcamSize?: number;
		webcamRadius?: number;
		webcamShadowIntensity?: number;
		webcamMirror?: boolean;
		webcamTimeOffsetMs?: number;
		cursorTelemetry?: Array<{
			timeMs: number;
			cx: number;
			cy: number;
			cursorTypeIndex?: number;
			bounceScale?: number;
			visible?: boolean;
		}>;
		cursorSize?: number;
		cursorAtlasPngDataUrl?: string | null;
		cursorAtlasEntries?: Array<{
			index: number;
			x: number;
			y: number;
			width: number;
			height: number;
			anchorX: number;
			anchorY: number;
			aspectRatio: number;
		}>;
		zoomTelemetry?: Array<{ timeMs: number; scale: number; x: number; y: number }>;
		timelineSegments?: Array<{
			sourceStartMs: number;
			sourceEndMs: number;
			outputStartMs: number;
			outputEndMs: number;
			speed: number;
		}>;
		chunkDurationSec?: number;
		experimentalWindowsGpuCompositor?: boolean;
		experimentalNvidiaCudaExport?: boolean;
		audioOptions?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
			editedAudioData?: ArrayBuffer;
			editedAudioMimeType?: string | null;
		};
	}) => {
		return ipcRenderer.invoke("native-static-layout-export", options) as Promise<{
			success: boolean;
			tempPath?: string;
			encoderName?: string;
			error?: string;
			metrics?: NativeStaticLayoutMetrics;
		}>;
	},
	nativeStaticLayoutExportCancel: (sessionId: string) => {
		return ipcRenderer.invoke("native-static-layout-export-cancel", sessionId) as Promise<{
			success: boolean;
		}>;
	},
	onNativeStaticLayoutExportProgress: (
		callback: (progress: NativeStaticLayoutProgress) => void,
	) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: NativeStaticLayoutProgress) =>
			callback(payload);
		ipcRenderer.on("native-static-layout-export-progress", listener);
		return () => ipcRenderer.removeListener("native-static-layout-export-progress", listener);
	},
	nativeVideoExportStart: (options: {
		width: number;
		height: number;
		frameRate: number;
		bitrate: number;
		encodingMode: "fast" | "balanced" | "quality";
		inputMode?: "rawvideo" | "h264-stream";
		deliveryProfile?: "cloud";
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
	nativeVideoExportWriteFrames: (sessionId: string, frameDataList: Uint8Array[]) => {
		ensureNativeVideoExportWriteResultListener();

		return new Promise<NativeVideoExportWriteResult>((resolve) => {
			const requestId = nextNativeVideoExportWriteRequestId++;
			nativeVideoExportWriteRequests.set(requestId, {
				sessionId,
				resolve,
			});

			ipcRenderer.send("native-video-export-write-frames-async", {
				sessionId,
				requestId,
				frameDataList,
			});
		});
	},
	nativeVideoExportFinish: (
		sessionId: string,
		options?: {
			audioMode?: "none" | "copy-source" | "trim-source" | "edited-track";
			audioSourcePath?: string | null;
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
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
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
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
			audioSourceCodec?: string | null;
			audioSourceSampleRate?: number;
			outputDurationSec?: number;
			trimSegments?: Array<{ startMs: number; endMs: number }>;
			editedTrackStrategy?: "filtergraph-fast-path" | "offline-render-fallback";
			editedTrackSegments?: Array<{ startMs: number; endMs: number; speed: number }>;
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
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		};
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
	showRecordingPermissions: () => ipcRenderer.invoke("show-recording-permissions"),
	onRecordingPermissionsRequested: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("recording-permissions-requested", listener);
		return () => ipcRenderer.removeListener("recording-permissions-requested", listener);
	},
	showRecordingHud: () => ipcRenderer.invoke("show-recording-hud"),
	showOnboardingWindow: (options?: { preview?: boolean }) =>
		ipcRenderer.invoke("show-onboarding-window", options),
	closeOnboardingWindow: () => ipcRenderer.invoke("close-onboarding-window"),
	createProjectFile: (data: unknown, thumbnail?: string | null) =>
		ipcRenderer.invoke("create-project-file", data, thumbnail),
	renameLibraryProject: (path: string, name: string) =>
		ipcRenderer.invoke("rename-library-project", path, name),
	reviewProjectDeletion: (paths: string[], protectedSources?: string[]) =>
		ipcRenderer.invoke("review-project-deletion", paths, protectedSources),
	trashProjectFiles: (
		paths: string[],
		options?: { includeSources?: boolean; protectedSources?: string[] },
	) => ipcRenderer.invoke("trash-project-files", paths, options),
	showProjectDashboard: () => ipcRenderer.invoke("show-project-dashboard"),
	openLoadingRecordingEditor: () => ipcRenderer.invoke("open-loading-recording-editor"),
	waitForRecordingEditor: () => ipcRenderer.invoke("wait-for-recording-editor"),
	finishRecordingEditor: (error?: string) => ipcRenderer.invoke("finish-recording-editor", error),
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
	pickCaptureTarget: () => {
		return ipcRenderer.invoke("pick-capture-target");
	},
	completeCapturePick: (pick: CapturePick | null) => {
		return ipcRenderer.invoke("complete-capture-pick", pick);
	},
	resizeCaptureWindow: (input: { windowId: string; width: number; height: number }) => {
		return ipcRenderer.invoke("resize-capture-window", input);
	},
	onCapturePickerWindowResized: (callback: (window: CapturePickerWindow) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, window: CapturePickerWindow) =>
			callback(window);
		ipcRenderer.on("capture-picker-window-resized", listener);
		return () => ipcRenderer.removeListener("capture-picker-window-resized", listener);
	},
	getCapturePickerContext: (displayId: number) => {
		return ipcRenderer.invoke("get-capture-picker-context", displayId);
	},
	capturePickerReady: () => {
		ipcRenderer.send("capture-picker-ready");
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
	recoverRecordingOwner: () => ipcRenderer.invoke("recover-recording-owner"),
	reserveRecordingSession: () => ipcRenderer.invoke("reserve-recording-session"),
	releaseRecordingStartup: (token: string) =>
		ipcRenderer.send("recording-startup-finished", token),
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
	pauseCursorCapture: (pausedAtMs?: number) => {
		return ipcRenderer.invoke("pause-cursor-capture", pausedAtMs);
	},
	resumeCursorCapture: (resumedAtMs?: number) => {
		return ipcRenderer.invoke("resume-cursor-capture", resumedAtMs);
	},
	startFfmpegRecording: (source: ProcessedDesktopSource) => {
		return ipcRenderer.invoke("start-ffmpeg-recording", source);
	},
	stopFfmpegRecording: () => {
		return ipcRenderer.invoke("stop-ffmpeg-recording");
	},
	openRecordingFileStream: (fileName: string, mimeType: string) =>
		ipcRenderer.invoke("open-recording-file-stream", fileName, mimeType),
	appendRecordingFileStream: (streamId: string, chunk: ArrayBuffer) =>
		ipcRenderer.invoke("append-recording-file-stream", streamId, chunk),
	closeRecordingFileStream: (streamId: string, durationMs?: number) =>
		ipcRenderer.invoke("close-recording-file-stream", streamId, durationMs),
	discardRecordingFileStream: (streamId: string) =>
		ipcRenderer.invoke("discard-recording-file-stream", streamId),
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeMicrophoneSidecar: (
		audioData: ArrayBuffer,
		videoPath: string,
		options?: {
			startDelayMs?: number;
			browserMicrophoneProfile?: string;
			requestedBrowserMicrophoneProfile?: string | null;
			requestedConstraints?: unknown;
			mediaTrackSettings?: Record<string, boolean | number | string>;
			audioInputDevices?: Array<{
				deviceId: string;
				groupId?: string;
				label: string;
			}>;
			mediaRecorder?: {
				mimeType?: string;
				audioBitsPerSecond?: number;
				timesliceMs?: number;
			};
			chunkEvents?: Array<{
				index: number;
				size: number;
				elapsedMs: number;
				deltaMs: number | null;
			}>;
		},
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
	getMediaPermissionStatus: () => {
		return ipcRenderer.invoke("get-media-permission-status");
	},
	requestMediaPermission: (device: "microphone" | "camera") =>
		ipcRenderer.invoke("request-media-permission", device),
	openMediaPermissionPreferences: (device: "microphone" | "camera") => {
		return ipcRenderer.invoke("open-media-permission-preferences", device);
	},
	openScreenRecordingPreferences: (preview?: boolean) => {
		return ipcRenderer.invoke("open-screen-recording-preferences", preview);
	},
	startPermissionAccessoryDrag: () => ipcRenderer.invoke("start-permission-accessory-drag"),
	closePermissionAccessory: () => ipcRenderer.invoke("close-permission-accessory"),
	openAccessibilityPreferences: (preview?: boolean) => {
		return ipcRenderer.invoke("open-accessibility-preferences", preview);
	},
	saveExportedVideo: (
		videoData: ArrayBuffer,
		fileName: string,
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		},
	) => {
		return ipcRenderer.invoke("save-exported-video", videoData, fileName, captionSidecar);
	},
	writeExportedVideoToPath: (
		videoData: ArrayBuffer,
		outputPath: string,
		captionSidecar?: {
			format: "srt" | "vtt" | "both";
			cues: Array<{
				startMs: number;
				endMs: number;
				text: string;
			}>;
		},
	) => {
		return ipcRenderer.invoke(
			"write-exported-video-to-path",
			videoData,
			outputPath,
			captionSidecar,
		);
	},
	importWallpaperVideo: (file: File) => {
		return ipcRenderer.invoke("import-wallpaper-video", webUtils.getPathForFile(file));
	},
	openVideoFilePicker: (options?: { includeProjects?: boolean }) => {
		return ipcRenderer.invoke("open-video-file-picker", options);
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
	getCaptionModelStatus: (modelId: CaptionModelId) =>
		ipcRenderer.invoke("get-caption-model-status", modelId),
	downloadCaptionModel: (modelId: CaptionModelId) =>
		ipcRenderer.invoke("download-caption-model", modelId),
	deleteCaptionModel: (modelId: CaptionModelId) =>
		ipcRenderer.invoke("delete-caption-model", modelId),
	onCaptionModelDownloadProgress: (callback: (state: CaptionModelDownloadProgress) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: CaptionModelDownloadProgress,
		) => callback(payload);
		ipcRenderer.on("caption-model-download-progress", listener);
		return () => ipcRenderer.removeListener("caption-model-download-progress", listener);
	},

	getParakeetModelStatus: () => {
		return ipcRenderer.invoke("get-parakeet-model-status");
	},
	downloadParakeetModel: () => {
		return ipcRenderer.invoke("download-parakeet-model");
	},
	deleteParakeetModel: () => {
		return ipcRenderer.invoke("delete-parakeet-model");
	},
	onParakeetModelDownloadProgress: (
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
		ipcRenderer.on("parakeet-model-download-progress", listener);
		return () => ipcRenderer.removeListener("parakeet-model-download-progress", listener);
	},
	generateAutoCaptions: (options: {
		captionModelId?: CaptionModelId;
		videoPath: string;
		whisperExecutablePath?: string;
		whisperModelPath?: string;
		engine?: "parakeet" | "whisper";
		parakeetModelPath?: string;
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
	onRecordingSessionChanged: (callback: (session: RecordingSessionData | null) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: RecordingSessionData | null,
		) => callback(payload);
		ipcRenderer.on("recording-session-changed", listener);
		return () => ipcRenderer.removeListener("recording-session-changed", listener);
	},
	getCurrentRecordingSession: () => {
		return ipcRenderer.invoke("get-current-recording-session");
	},
	claimFirstRecordingAutoZooms: (videoPath: string) => {
		return ipcRenderer.invoke("claim-first-recording-auto-zooms", videoPath);
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	getRecordingThumbnail: (filePath: string) =>
		ipcRenderer.invoke("get-recording-thumbnail", filePath),
	finishRecordingImport: (keepPath: string, commit?: boolean) =>
		ipcRenderer.invoke("finish-recording-import", keepPath, commit),
	cancelRecordingImport: () => ipcRenderer.invoke("cancel-recording-import"),
	cacheProjectThumbnail: (projectPath: string, revision: string, dataUrl: string) =>
		ipcRenderer.invoke("cache-project-thumbnail", projectPath, revision, dataUrl),
	getProjectPreview: (projectPath: string) =>
		ipcRenderer.invoke("get-project-preview", projectPath),
	findDuplicateRecordingSources: () => ipcRenderer.invoke("find-duplicate-recording-sources"),
	listRecordings: (includeSources?: boolean) =>
		ipcRenderer.invoke("list-recordings", includeSources),
	setRecordingsRemoved: (paths: string[], removed: boolean) =>
		ipcRenderer.invoke("set-recordings-removed", paths, removed),
	trashRecordingSources: (paths: string[], protectedSources?: string[]) =>
		ipcRenderer.invoke("trash-recording-sources", paths, protectedSources),
	importRecording: (
		currentPath: string,
		recordingPath: string,
		webcam?: import("../src/types/recordingLibrary").RecordingWebcamSource,
	) => ipcRenderer.invoke("import-recording", currentPath, recordingPath, webcam),
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
		mode?: "rename" | "copy",
	) => {
		return ipcRenderer.invoke(
			"save-project-file-named",
			projectData,
			projectName,
			thumbnailDataUrl,
			mode,
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
	onProjectThumbnailReady: (
		callback: (ready: { path: string; thumbnailPath: string; updatedAt: number }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			ready: { path: string; thumbnailPath: string; updatedAt: number },
		) => callback(ready);
		ipcRenderer.on("project-library-thumbnail-ready", listener);
		return () => ipcRenderer.removeListener("project-library-thumbnail-ready", listener);
	},
	listProjectFiles: () => {
		return ipcRenderer.invoke("list-project-files");
	},
	openProjectFileAtPath: (filePath: string) => {
		return ipcRenderer.invoke("open-project-file-at-path", filePath);
	},
	relinkProjectRecording: (filePath: string) => {
		return ipcRenderer.invoke("relink-project-recording", filePath);
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
	getExperimentalUpdatesEnabled: () => {
		return ipcRenderer.invoke("get-experimental-updates-enabled");
	},
	getAutomaticUpdateDownloadsEnabled: () =>
		ipcRenderer.invoke("get-automatic-update-downloads-enabled"),
	setAutomaticUpdateDownloadsEnabled: (enabled: boolean) =>
		ipcRenderer.invoke("set-automatic-update-downloads-enabled", enabled),
	getApplicationPreferences: () => ipcRenderer.invoke("get-application-preferences"),
	setApplicationPreferences: (patch: {
		showInDock?: boolean;
		hideWhileRecording?: boolean;
		launchAtLogin?: boolean;
	}) => ipcRenderer.invoke("set-application-preferences", patch),
	setExperimentalUpdatesEnabled: (enabled: boolean) => {
		return ipcRenderer.invoke("set-experimental-updates-enabled", enabled);
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
	getWindowChrome: () => ipcRenderer.invoke("get-window-chrome"),
	onWindowChromeChanged: (callback: (chrome: { trafficLightsVisible: boolean }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			chrome: { trafficLightsVisible: boolean },
		) => callback(chrome);
		ipcRenderer.on("window-chrome-changed", listener);
		return () => ipcRenderer.removeListener("window-chrome-changed", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	isWindowFullscreen: () => {
		return ipcRenderer.invoke("get-window-fullscreen");
	},
	onWindowFullscreenChanged: (callback: (isFullscreen: boolean) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, isFullscreen: boolean) =>
			callback(isFullscreen);
		ipcRenderer.on("window-fullscreen-changed", listener);
		return () => ipcRenderer.removeListener("window-fullscreen-changed", listener);
	},
	getLinuxWindowSystem: () => {
		return ipcRenderer.invoke("get-linux-window-system");
	},
	ackAuthCallbackUrl: (url: string) => ipcRenderer.invoke("auth:ack-callback", url),
	getPendingAuthCallbackUrl: () => ipcRenderer.invoke("auth:get-pending-callback"),
	onAuthCallbackUrl: (callback: (url: string) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
		ipcRenderer.on("auth:callback", listener);
		return () => ipcRenderer.removeListener("auth:callback", listener);
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	cloudShareBeginExport: (input: {
		endpoint: string;
		token: string;
		title: string;
		uploadId: string;
	}) => ipcRenderer.invoke("cloud-share-begin-export", input),
	cloudShareUpload: (input: {
		filePath: string;
		endpoint: string;
		token?: string;
		title?: string;
		notes?: string;
		uploadId?: string;
	}) => ipcRenderer.invoke("cloud-share-upload", input),
	cloudShareManage: (input: {
		endpoint: string;
		token: string;
		action: "list" | "delete";
		shareCode?: string;
		cursor?: string;
	}) => ipcRenderer.invoke("cloud-share-manage", input),
	cloudBilling: (input: CloudBillingInput) => ipcRenderer.invoke("cloud-billing", input),
	cloudBillingCancel: () => ipcRenderer.invoke("cloud-billing-cancel"),
	cloudShareUpdateToken: (input: { uploadId: string; token: string }) =>
		ipcRenderer.invoke("cloud-share-update-token", input),
	cloudShareCancel: (uploadId: string) => ipcRenderer.invoke("cloud-share-cancel", uploadId),
	onCloudShareProgress: (
		callback: (progress: {
			uploadId: string;
			uploadedBytes: number;
			totalBytes: number;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			progress: { uploadId: string; uploadedBytes: number; totalBytes: number },
		) => callback(progress);
		ipcRenderer.on("cloud-share-progress", listener);
		return () => ipcRenderer.removeListener("cloud-share-progress", listener);
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
	getEditorStartupView: (): "home" | "editor" => ipcRenderer.sendSync("get-editor-startup-view"),
	getAppSetting: (key: string) => {
		const result = ipcRenderer.sendSync("app-settings:get", key) as {
			success?: boolean;
			value?: unknown;
		};
		return result?.success ? (result.value ?? null) : null;
	},
	getAppSettingWithStatus: (key: string) => {
		const result = ipcRenderer.sendSync("app-settings:get", key) as {
			success?: boolean;
			found?: boolean;
			value?: unknown;
		};
		return result?.success === true && typeof result.found === "boolean"
			? { success: true as const, found: result.found, value: result.value ?? null }
			: { success: false as const, value: null };
	},
	setAppSetting: (key: string, value: unknown) => {
		const result = ipcRenderer.sendSync("app-settings:set", key, value) as {
			success?: boolean;
		};
		return result?.success === true;
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	setExportInProgress: (active: boolean) => {
		ipcRenderer.send("set-export-in-progress", active);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<boolean>) => {
		const listener = async (_event: Electron.IpcRendererEvent, requestId: unknown) => {
			let saved = false;
			try {
				saved = await callback();
			} catch {
				saved = false;
			}
			ipcRenderer.send("save-before-close-done", saved, requestId);
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	isNativeWindowsCaptureAvailable: () =>
		ipcRenderer.invoke("is-native-windows-capture-available"),
	muxNativeWindowsRecording: (expectedDurationMs?: number) =>
		ipcRenderer.invoke("mux-native-windows-recording", expectedDurationMs),
	hideOsCursor: () => ipcRenderer.invoke("hide-cursor"),
	appendExportDiagnostic: (entry: string) =>
		ipcRenderer.invoke("export-diagnostics:append", entry),
	getExportDiagnostics: () => ipcRenderer.invoke("export-diagnostics:read"),
	getExportRuntimeInfo: () => ipcRenderer.invoke("export-diagnostics:runtime"),
	getAppVersion: () => ipcRenderer.invoke("app:getVersion"),
	getAnnouncements: () => ipcRenderer.invoke("announcements:get"),
	getRecordingPreferences: () => ipcRenderer.invoke("get-recording-preferences"),
	getRecordingAudioLabConfig: () => ipcRenderer.invoke("get-recording-audio-lab-config"),
	setRecordingPreferences: (prefs: {
		microphoneEnabled?: boolean;
		microphoneDeviceId?: string;
		systemAudioEnabled?: boolean;
		webcamEnabled?: boolean;
		webcamDeviceId?: string;
	}) => ipcRenderer.invoke("set-recording-preferences", prefs),
	getCountdownDelay: () => ipcRenderer.invoke("get-countdown-delay"),
	setCountdownDelay: (delay: number) => ipcRenderer.invoke("set-countdown-delay", delay),
	finishRecordingStartup: () => ipcRenderer.invoke("finish-recording-startup"),
	startCountdown: (seconds: number) => ipcRenderer.invoke("start-countdown", seconds),
	cancelCountdown: () => ipcRenderer.invoke("cancel-countdown"),
	getActiveCountdown: () => ipcRenderer.invoke("get-active-countdown"),
	onCountdownTick: (callback: (seconds: number) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, seconds: number) => callback(seconds);
		ipcRenderer.on("countdown-tick", listener);
		return () => ipcRenderer.removeListener("countdown-tick", listener);
	},
});
