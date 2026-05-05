export type SelectedSource = {
	id?: string;
	name: string;
	display_id?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
	[key: string]: unknown;
};

export type NativeMacRecordingOptions = {
	capturesSystemAudio?: boolean;
	capturesMicrophone?: boolean;
	microphoneDeviceId?: string;
	microphoneLabel?: string;
};

export type WindowBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type NativeCaptureDiagnostics = {
	backend: "windows-wgc" | "mac-screencapturekit" | "browser-store" | "ffmpeg";
	phase: "availability" | "start" | "stop" | "mux";
	timestamp: string;
	sourceId?: string | null;
	sourceType?: SelectedSource["sourceType"] | "unknown";
	displayId?: number | null;
	displayBounds?: WindowBounds | null;
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
};

export type RecordingSessionData = {
	videoPath: string;
	webcamPath?: string | null;
	timeOffsetMs?: number;
	hideOverlayCursorByDefault?: boolean;
};

export type PauseSegment = {
	startMs: number;
	endMs: number;
};

export type RecordingSessionManifest = {
	version: 1 | 2;
	videoFileName: string;
	webcamFileName?: string | null;
	timeOffsetMs?: number;
};

export type ProjectLibraryEntry = {
	path: string;
	name: string;
	updatedAt: number;
	thumbnailPath: string | null;
	isCurrent: boolean;
	isInProjectsDirectory: boolean;
};

export type SystemCursorAsset = {
	dataUrl: string;
	hotspotX: number;
	hotspotY: number;
	width: number;
	height: number;
};

export type CursorVisualType =
	| "arrow"
	| "text"
	| "pointer"
	| "crosshair"
	| "open-hand"
	| "closed-hand"
	| "resize-ew"
	| "resize-ns"
	| "not-allowed";

export type CursorInteractionType =
	| "move"
	| "click"
	| "double-click"
	| "right-click"
	| "middle-click"
	| "mouseup";

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	interactionType?: CursorInteractionType;
	cursorType?: CursorVisualType;
}

export type NativeMacWindowSource = {
	id: string;
	name: string;
	display_id?: string;
	appName?: string;
	windowTitle?: string;
	bundleId?: string;
	appIcon?: string | null;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

export type HookEventName = "mousedown" | "mouseup" | "mousemove";

export type HookMouseEvent = {
	button?: number;
	mouseButton?: number;
	x?: number;
	y?: number;
	screenX?: number;
	screenY?: number;
	data?: {
		button?: number;
		mouseButton?: number;
		x?: number;
		y?: number;
		screenX?: number;
		screenY?: number;
	};
};

export type HookEventListener = (event: HookMouseEvent) => void;

export type UiohookLike = {
	on: (eventName: HookEventName, listener: HookEventListener) => void;
	off?: (eventName: HookEventName, listener: HookEventListener) => void;
	removeListener?: (eventName: HookEventName, listener: HookEventListener) => void;
	start: () => void;
	stop?: () => void;
};

export type UiohookModuleNamespace = {
	uIOhook?: UiohookLike;
	uiohook?: UiohookLike;
	Uiohook?: UiohookLike;
	default?: UiohookLike | UiohookModuleNamespace;
};

export type AudioSyncAdjustment = {
	mode: "none" | "tempo" | "delay" | "pad";
	delayMs: number;
	tempoRatio: number;
	durationDeltaMs: number;
};

export type CompanionAudioCandidate = {
	platform: "mac" | "win";
	systemPath: string;
	micPath: string;
	usablePaths: string[];
};

export type CaptionWordPayload = {
	text: string;
	startMs: number;
	endMs: number;
	leadingSpace?: boolean;
};

export type CaptionCuePayload = {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: CaptionWordPayload[];
};

export type WhisperJsonToken = {
	text?: unknown;
	offsets?: {
		from?: unknown;
		to?: unknown;
	};
};

export type WhisperJsonSegment = {
	text?: unknown;
	offsets?: {
		from?: unknown;
		to?: unknown;
	};
	tokens?: unknown;
};
