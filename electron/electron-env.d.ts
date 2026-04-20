/// <reference types="vite-plugin-electron/electron-env" />

// biome-ignore lint/style/noNamespace: NodeJS.ProcessEnv augmentation requires a namespace declaration.
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
	primaryAction?: "download-update" | "install-update" | "retry-check";
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

interface ElectronAPI
	extends ElectronAPICapture,
		ElectronAPIExport,
		ElectronAPIProjects,
		ElectronAPISettings {}

interface Window {
	electronAPI: ElectronAPI;
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id?: string;
	thumbnail?: string | null;
	appIcon?: string | null;
	originalName?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
	[key: string]: unknown;
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
