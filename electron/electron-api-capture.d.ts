interface ElectronAPICapture {
	hudOverlaySetIgnoreMouse: (ignore: boolean) => void;
	hudOverlayDrag: (phase: "start" | "move" | "end", screenX: number, screenY: number) => void;
	hudOverlayHide: () => void;
	hudOverlayClose: () => void;
	setHudOverlayExpanded: (expanded: boolean) => void;
	setHudOverlayCompactWidth: (width: number) => void;
	setHudOverlayMeasuredHeight: (height: number, expanded: boolean) => void;
	getHudOverlayCaptureProtection: () => Promise<{ success: boolean; enabled: boolean }>;
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
	startFfmpegRecording: (
		source: ProcessedDesktopSource,
	) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
	stopFfmpegRecording: () => Promise<{
		success: boolean;
		path?: string;
		message?: string;
		error?: string;
	}>;
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
	isNativeWindowsCaptureAvailable: () => Promise<{ available: boolean }>;
	muxNativeWindowsRecording: (
		pauseSegments?: Array<{ startMs: number; endMs: number }>,
	) => Promise<{
		success: boolean;
		path?: string;
		message?: string;
		error?: string;
	}>;
	hideOsCursor: () => Promise<{ success: boolean }>;
}