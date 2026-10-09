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
	createdAt?: number;
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

/**
 * One keystroke, recorded WITHOUT the character and WITHOUT the raw key code.
 *
 * Storing either would let the telemetry be replayed into text on a known
 * keyboard layout, so both are discarded at capture time. The coarse
 * `keyClass` plus the cursor position is the full set of signals the
 * auto-zoom-on-typing heuristic consumes.
 */
export interface TypingTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	keyClass: TypingKeyClass;
}

export type TypingKeyClass =
	| "printable"
	| "space"
	| "enter"
	| "backspace"
	| "delete"
	| "tab"
	| "escape"
	| "arrow"
	| "navigation"
	| "shortcut"
	| "other";

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

export type HookEventName = "mousedown" | "mouseup" | "mousemove" | "keydown" | "keyup";

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

/**
 * uiohook-napi's keyboard payload is a FLAT object (not nested under `data`,
 * unlike the mouse payload we defensively unwrap). `keycode` is a raw
 * layout-dependent scan code and is consumed transiently by
 * `classifyTypingKey` — it is never persisted.
 */
export type HookKeyboardEvent = {
	type?: number;
	time?: number;
	keycode?: number;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
	data?: {
		keycode?: number;
		altKey?: boolean;
		ctrlKey?: boolean;
		metaKey?: boolean;
		shiftKey?: boolean;
	};
};

export type HookKeyboardEventListener = (event: HookKeyboardEvent) => void;

export type UiohookLike = {
	// The hook is a single native emitter serving both mouse and keyboard
	// events, so the listener is typed as accepting the union of both payloads.
	on: (eventName: HookEventName, listener: HookEventListener | HookKeyboardEventListener) => void;
	off?: (eventName: HookEventName, listener: HookEventListener | HookKeyboardEventListener) => void;
	removeListener?: (
		eventName: HookEventName,
		listener: HookEventListener | HookKeyboardEventListener,
	) => void;
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
