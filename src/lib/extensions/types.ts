/**
 * Recordly Extension System — Core Types
 *
 * Extensions are renderer-loaded modules that can hook into the render pipeline,
 * bundle assets, register UI panels, and respond to playback/timeline events.
 */

// ---------------------------------------------------------------------------
// Extension Manifest (recordly-extension.json)
// ---------------------------------------------------------------------------

export interface ExtensionManifest {
	/** Unique identifier, e.g. "com.example.click-sparkles" */
	id: string;
	/** Human-readable name */
	name: string;
	/** Semver version string */
	version: string;
	/** Short one-line description */
	description: string;
	/** Author name or organisation */
	author?: string;
	/** Homepage / repository URL */
	homepage?: string;
	/** License identifier (SPDX) */
	license?: string;
	/** Minimum Recordly version required */
	engine?: string;
	/** Icon path relative to extension root */
	icon?: string;
	/** Entry point file relative to extension root (JS module) */
	main: string;
	/** APIs this extension requires — used for permission gating */
	permissions: ExtensionPermission[];
	/** Asset categories this extension provides */
	contributes?: ExtensionContributions;
}

export type ExtensionPermission =
	| "render" // Hook into the frame render pipeline
	| "cursor" // Access cursor telemetry & register cursor effects
	| "audio" // Provide or manipulate audio
	| "timeline" // Observe timeline lifecycle events
	| "ui" // Register settings panels and frames
	| "assets" // Resolve bundled asset paths
	| "export"; // Hook into export lifecycle

/**
 * Optional manifest metadata for packaged assets.
 *
 * Recordly does not auto-register these entries at runtime today.
 * Extensions still need to wire behavior from activate() via host APIs like
 * registerFrame(), registerSettingsPanel(), resolveAsset(), and playSound().
 */
export interface ExtensionContributions {
	/** Cursor style packs: array of cursor style definitions */
	cursorStyles?: ContributedCursorStyle[];
	/** Sound packs: click sounds, transition sounds, etc. */
	sounds?: ContributedSound[];
	/** Wallpaper/background images or videos */
	wallpapers?: ContributedWallpaper[];
	/** Webcam frames/overlays */
	webcamFrames?: ContributedWebcamFrame[];
	/** Device frames (browser chrome, laptop bezels, phone frames, etc.) */
	frames?: ContributedFrame[];
}

export interface ContributedCursorStyle {
	id: string;
	label: string;
	/** Path to cursor image relative to extension root */
	defaultImage: string;
	/** Optional click state image */
	clickImage?: string;
	/** Hotspot offset from top-left (normalized 0-1) */
	hotspot?: { x: number; y: number };
}

export interface ContributedSound {
	id: string;
	label: string;
	/** Sound category */
	category: "click" | "transition" | "ambient" | "notification";
	/** Path to audio file relative to extension root */
	file: string;
	/** Duration in ms (auto-detected if omitted) */
	durationMs?: number;
}

export interface ContributedWallpaper {
	id: string;
	label: string;
	/** Path to image/video file relative to extension root */
	file: string;
	/** Thumbnail for the picker */
	thumbnail?: string;
	/** Whether this is a video wallpaper */
	isVideo?: boolean;
}

export interface ContributedWebcamFrame {
	id: string;
	label: string;
	/** Path to frame overlay image (PNG with transparency) */
	file: string;
	thumbnail?: string;
}

export interface ContributedFrame {
	id: string;
	label: string;
	/** Category for grouping in the picker */
	category: "browser" | "laptop" | "phone" | "tablet" | "desktop" | "custom";
	/** Path to frame overlay image (PNG or SVG with transparency) relative to extension root */
	file?: string;
	/** Alternative: a data URL (e.g. from Canvas.toDataURL) for runtime-generated frames */
	dataUrl?: string;
	/** Thumbnail for the picker */
	thumbnail?: string;
	/**
	 * Insets defining where the screen content sits inside the frame image,
	 * as fractions (0-1) of the frame image dimensions.
	 * { top, right, bottom, left }
	 */
	screenInsets: { top: number; right: number; bottom: number; left: number };
	/** Whether the frame has a dark or light appearance (for wallpaper matching) */
	appearance?: "light" | "dark";
	/**
	 * Resolution-independent draw function. Called at the target dimensions
	 * to draw the frame chrome, leaving the screen area transparent.
	 * Preferred over file/dataUrl — avoids bitmap scaling artifacts.
	 */
	draw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}

// ---------------------------------------------------------------------------
// Extension Runtime State
// ---------------------------------------------------------------------------

export type ExtensionStatus = "installed" | "active" | "disabled" | "error";

export interface ExtensionInfo {
	manifest: ExtensionManifest;
	status: ExtensionStatus;
	/** Absolute path to extension directory */
	path: string;
	/** Error message if status is 'error' */
	error?: string;
	/** Whether this is a built-in extension */
	builtin?: boolean;
}

// ---------------------------------------------------------------------------
// Marketplace Types
// ---------------------------------------------------------------------------

export type MarketplaceReviewStatus = "pending" | "approved" | "rejected" | "flagged";

export interface MarketplaceExtension {
	/** Same as ExtensionManifest.id */
	id: string;
	name: string;
	version: string;
	description: string;
	author: string;
	/** Download URL for the extension archive (.zip) */
	downloadUrl: string;
	/** Icon URL */
	iconUrl?: string;
	/** Screenshots */
	screenshots?: string[];
	/** Number of downloads */
	downloads: number;
	/** Average rating (0-5) */
	rating: number;
	/** Number of ratings */
	ratingCount: number;
	/** Category tags */
	tags: string[];
	/** Permissions required */
	permissions: ExtensionPermission[];
	/** Whether this extension has been reviewed and approved */
	reviewStatus: MarketplaceReviewStatus;
	/** When the extension was published */
	publishedAt: string;
	/** When last updated */
	updatedAt: string;
	/** Author homepage URL */
	homepage?: string;
	/** Whether this version is already installed locally */
	installed?: boolean;
}

export interface MarketplaceSearchResult {
	extensions: MarketplaceExtension[];
	total: number;
	page: number;
	pageSize: number;
}

export interface ExtensionReview {
	id: string;
	extensionId: string;
	extensionName: string;
	version: string;
	author: string;
	submittedAt: string;
	status: MarketplaceReviewStatus;
	reviewNotes?: string;
	manifest: ExtensionManifest;
	downloadUrl: string;
}

// ---------------------------------------------------------------------------
// Extension API — Render Hooks
// ---------------------------------------------------------------------------

/** Context passed to render hooks each frame */
export interface RenderHookContext {
	/** Output canvas width */
	width: number;
	/** Output canvas height */
	height: number;
	/** Current playback time in ms */
	timeMs: number;
	/** Total video duration in ms */
	durationMs: number;
	/** Current cursor position (normalized 0-1, null if no cursor) */
	cursor: { cx: number; cy: number; interactionType?: string } | null;
	/** Current smoothed cursor state and trailing path (normalized 0-1) */
	smoothedCursor?: {
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null;
	/** The 2D rendering context to draw on */
	ctx: CanvasRenderingContext2D;
	/** Current video content layout (position & size inside the canvas) */
	videoLayout?: {
		/** Position & size of the masked video content area (in canvas pixels) */
		maskRect: { x: number; y: number; width: number; height: number };
		/** Border radius applied to the video (in canvas pixels) */
		borderRadius: number;
		/** Padding around the video (in canvas pixels). Can be a number (global) or an object with individual sides. */
		padding: number | { top: number; right: number; bottom: number; left: number };
	};
	/** Current zoom state */
	zoom?: {
		/** 1 = no zoom, >1 = zoomed in */
		scale: number;
		/** Normalized focus point (0-1) */
		focusX: number;
		focusY: number;
		/** 0 = idle, 1 = fully zoomed in */
		progress: number;
	};
	/** Current scene transform (motion animation offset & scale).
	 * Hooks that run outside the built-in transform (post-webcam, post-annotations, final)
	 * can apply this manually to follow zoom/pan motion:
	 *   ctx.save(); ctx.translate(t.x, t.y); ctx.scale(t.scale, t.scale); … ctx.restore();
	 */
	sceneTransform?: {
		scale: number;
		x: number;
		y: number;
	};
	/** Current shadow settings */
	shadow?: {
		enabled: boolean;
		intensity: number;
	};

	// ------------------------------------------------------------------
	// Scene pixel helpers (sample from the current canvas)
	// ------------------------------------------------------------------

	/**
	 * Get the RGBA color at a specific pixel (canvas coords).
	 * Returns { r, g, b, a } with values 0–255.
	 */
	getPixelColor(x: number, y: number): { r: number; g: number; b: number; a: number };

	/**
	 * Average RGBA color across the entire video content area (maskRect).
	 * Samples a grid for performance.
	 */
	getAverageSceneColor(): { r: number; g: number; b: number; a: number };

	/**
	 * Average RGBA color along the edges of the video content area.
	 * Useful for matching wallpapers/frames to scene content.
	 * @param edgeWidth — thickness of edge band in pixels (default 4)
	 */
	getEdgeAverageColor(edgeWidth?: number): { r: number; g: number; b: number; a: number };

	/**
	 * Get dominant colors in the video content area.
	 * Returns up to `count` colors sorted by frequency.
	 */
	getDominantColors(
		count?: number,
	): Array<{ r: number; g: number; b: number; frequency: number }>;
}

/** Render hook phases — extensions draw in the registered phase */
export type RenderHookPhase =
	| "background" // Before video frame (custom backgrounds)
	| "post-video" // After video frame, before zoom transform
	| "post-zoom" // After zoom transform
	| "post-cursor" // After cursor is drawn (click effects, trails)
	| "post-webcam" // After webcam overlay
	| "post-annotations" // After annotations
	| "final"; // Last pass (watermarks, HUD overlays)

export type RenderHookFn = (ctx: RenderHookContext) => void;

// ---------------------------------------------------------------------------
// Extension API — Cursor Effect Hooks
// ---------------------------------------------------------------------------

export interface CursorEffectContext {
	/** Current time in ms */
	timeMs: number;
	/** Cursor position (normalized 0-1) */
	cx: number;
	cy: number;
	/** Interaction type that triggered this effect */
	interactionType: "click" | "double-click" | "right-click" | "mouseup";
	/** Canvas dimensions */
	width: number;
	height: number;
	/** 2D context to draw the effect */
	ctx: CanvasRenderingContext2D;
	/** Milliseconds since the interaction occurred */
	elapsedMs: number;
	/** Current zoom state (same as RenderHookContext.zoom) */
	zoom?: {
		scale: number;
		focusX: number;
		focusY: number;
		progress: number;
	};
	/** Current scene transform applied to the canvas */
	sceneTransform?: {
		scale: number;
		x: number;
		y: number;
	};
	/** Video content layout inside the canvas */
	videoLayout?: {
		maskRect: { x: number; y: number; width: number; height: number };
		borderRadius: number;
		padding: number | { top: number; right: number; bottom: number; left: number };
	};
}

export type CursorEffectFn = (ctx: CursorEffectContext) => boolean; // return false to stop animation

// ---------------------------------------------------------------------------
// Extension API — Event System
// ---------------------------------------------------------------------------

export type ExtensionEventType =
	| "playback:timeupdate"
	| "playback:play"
	| "playback:pause"
	| "cursor:click"
	| "cursor:move"
	| "timeline:region-added"
	| "timeline:region-removed"
	| "export:start"
	| "export:frame"
	| "export:complete";

export interface ExtensionEvent {
	type: ExtensionEventType;
	timeMs?: number;
	data?: unknown;
}

export type ExtensionEventHandler = (event: ExtensionEvent) => void;

// ---------------------------------------------------------------------------
// Extension API — Settings UI
// ---------------------------------------------------------------------------

export interface ExtensionSettingField {
	id: string;
	label: string;
	type: "toggle" | "slider" | "select" | "color" | "text";
	defaultValue: unknown;
	/** For sliders */
	min?: number;
	max?: number;
	step?: number;
	/** For select */
	options?: { label: string; value: string }[];
}

export interface ExtensionSettingsPanel {
	/** Unique panel ID */
	id: string;
	/** Display label in settings */
	label: string;
	/** Icon name (lucide icon) */
	icon?: string;
	/** If set, renders inside this existing section (e.g. 'cursor', 'scene').
	 *  Otherwise, creates a new standalone section. */
	parentSection?: string;
	/** Setting fields */
	fields: ExtensionSettingField[];
}

// ---------------------------------------------------------------------------
// Extension API — The API object passed to extension activate()
// ---------------------------------------------------------------------------

export interface RecordlyExtensionAPI {
	/** Register a render hook at a specific pipeline phase */
	registerRenderHook(phase: RenderHookPhase, hook: RenderHookFn): () => void;

	/** Register a cursor click effect */
	registerCursorEffect(effect: CursorEffectFn): () => void;

	/** Register a device frame (browser chrome, laptop bezel, etc.) */
	registerFrame(frame: ContributedFrame): () => void;

	/** Register a wallpaper/background image or video */
	registerWallpaper(wallpaper: ContributedWallpaper): () => void;

	/** Register a cursor style pack */
	registerCursorStyle(cursorStyle: ContributedCursorStyle): () => void;

	/** Listen to extension events */
	on(event: ExtensionEventType, handler: ExtensionEventHandler): () => void;

	/** Register a settings panel for this extension */
	registerSettingsPanel(panel: ExtensionSettingsPanel): () => void;

	/** Get the current value of an extension setting */
	getSetting(settingId: string): unknown;

	/** Set an extension setting value */
	setSetting(settingId: string, value: unknown): void;

	/** Resolve an asset path relative to the extension root */
	resolveAsset(relativePath: string): string;

	/**
	 * Play a sound from a bundled audio file (relative to extension root).
	 * Returns a stop function to cancel playback early.
	 * Optional volume (0-1, default 1).
	 */
	playSound(relativePath: string, options?: { volume?: number }): () => void;

	/** Log a message (visible in dev tools, prefixed with extension ID) */
	log(message: string, ...args: unknown[]): void;

	// ------------------------------------------------------------------
	// Query APIs — read-only access to project / playback state
	// ------------------------------------------------------------------

	/** Get video info (resolution, duration, fps) */
	getVideoInfo(): {
		width: number;
		height: number;
		durationMs: number;
		fps: number;
	} | null;

	/** Get the current video content layout (mask rect, padding, etc.) */
	getVideoLayout(): {
		maskRect: { x: number; y: number; width: number; height: number };
		canvasWidth: number;
		canvasHeight: number;
		borderRadius: number;
		padding: number | { top: number; right: number; bottom: number; left: number };
	} | null;

	/**
	 * Query cursor telemetry at a given time (nearest point).
	 * Returns null if no telemetry is available.
	 */
	getCursorAt(timeMs: number): {
		cx: number;
		cy: number;
		timeMs: number;
		interactionType?: string;
		pressure?: number;
	} | null;

	/** Get the latest smoothed cursor position and trail for the active renderer. */
	getSmoothedCursor(): {
		cx: number;
		cy: number;
		timeMs: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null;

	/** Get the current zoom state */
	getZoomState(): {
		scale: number;
		focusX: number;
		focusY: number;
		progress: number;
	} | null;

	/** Get the current shadow configuration */
	getShadowConfig(): {
		enabled: boolean;
		intensity: number;
	};

	/**
	 * Get keystroke events in a time range.
	 * Returns an array of keystroke events within [startMs, endMs].
	 */
	getKeystrokesInRange(
		startMs: number,
		endMs: number,
	): Array<{
		timeMs: number;
		key: string;
		modifiers: string[];
	}>;

	/**
	 * Get the current aspect ratio of the output canvas (width / height).
	 */
	getAspectRatio(): number | null;

	/**
	 * Get the active device frame ID, or null if none is selected.
	 */
	getActiveFrame(): string | null;

	/**
	 * Check whether a specific extension is currently active.
	 */
	isExtensionActive(extensionId: string): boolean;

	/**
	 * Get the current playback state (time, duration, playing status).
	 */
	getPlaybackState(): {
		currentTimeMs: number;
		durationMs: number;
		isPlaying: boolean;
	} | null;

	/**
	 * Get the output canvas dimensions in pixels.
	 */
	getCanvasDimensions(): { width: number; height: number } | null;

	/**
	 * Subscribe to changes in this extension's settings.
	 * The callback receives the setting ID that changed and its new value.
	 * Returns a dispose function.
	 */
	onSettingChange(callback: (settingId: string, value: unknown) => void): () => void;

	/**
	 * Get ALL settings for this extension as a key-value map.
	 * Useful for bulk-reading initial state on activation.
	 */
	getAllSettings(): Record<string, unknown>;

	/**
	 * Draw a Phosphor icon from the project's library onto the canvas.
	 * @param ctx The 2D rendering context
	 * @param name The name of the icon (e.g. "CaretLeft", "ArrowClockwise")
	 * @param x X coordinate (center)
	 * @param y Y coordinate (center)
	 * @param size Icon size in pixels
	 * @param color Icon color (CSS color string)
	 * @param weight Icon weight (optional: 'thin' | 'light' | 'regular' | 'bold' | 'fill', default 'regular')
	 */
	drawIcon(
		ctx: CanvasRenderingContext2D,
		name: string,
		x: number,
		y: number,
		size: number,
		color: string,
		weight?: "thin" | "light" | "regular" | "bold" | "fill",
	): void;
}

// ---------------------------------------------------------------------------
// Extension Module — what the extension's main JS file must export
// ---------------------------------------------------------------------------

export interface RecordlyExtensionModule {
	/** Called when the extension is activated */
	activate(api: RecordlyExtensionAPI): void | Promise<void>;
	/** Called when the extension is deactivated */
	deactivate?(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Device Frame — Runtime Instance (resolved paths)
// ---------------------------------------------------------------------------

export interface FrameInstance {
	/** Unique id: extensionId + '/' + frame.id */
	id: string;
	/** Extension that contributed this frame */
	extensionId: string;
	label: string;
	category: ContributedFrame["category"];
	/** Resolved absolute file:// URL to the frame overlay (PNG, SVG, or data URL) */
	filePath: string;
	/** Resolved absolute file:// URL to the thumbnail (or filePath if absent) */
	thumbnailPath: string;
	/** Screen insets (fraction 0-1 of frame image) */
	screenInsets: { top: number; right: number; bottom: number; left: number };
	appearance?: "light" | "dark";
	/** Resolution-independent draw function (if provided by the extension) */
	draw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}
