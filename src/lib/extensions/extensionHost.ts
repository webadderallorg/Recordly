/**
 * Extension Host — Renderer Process
 *
 * Manages the lifecycle of extensions in the renderer. Loads extension
 * modules, provides the permission-gated host API, and coordinates render hooks.
 */

import { createExtensionModuleUrl, resolveExtensionRelativeFileUrl } from "./fileUrls";
import { resolveIconPath } from "./iconDraw";
import type {
	ContributedCursorStyle,
	ContributedFrame,
	ContributedWallpaper,
	CursorEffectContext,
	CursorEffectFn,
	ExtensionEvent,
	ExtensionEventHandler,
	ExtensionEventType,
	ExtensionInfo,
	ExtensionSettingsPanel,
	FrameInstance,
	RecordlyExtensionAPI,
	RecordlyExtensionModule,
	RenderHookContext,
	RenderHookFn,
	RenderHookPhase,
} from "./types";

const EXTENSION_SETTINGS_STORAGE_KEY = "recordly.extension-settings.v1";

// ---------------------------------------------------------------------------
// Security: Hide electronAPI from extension code
// ---------------------------------------------------------------------------
// Extensions run via dynamic import() in the renderer's main world. Since
// contextBridge.exposeInMainWorld puts electronAPI on window in the same
// world, extensions could abuse it to read arbitrary files, open URLs, etc.
// We replace the global with a Proxy that blocks access while extension code
// is executing (import + activate). The reference is stashed so that only
// app code (which runs outside of extension activation) can reach it.
// ---------------------------------------------------------------------------

let _extensionActivationDepth = 0;
let _realElectronAPI: typeof window.electronAPI | undefined;

function installElectronAPIGuard(): void {
	if (typeof window === "undefined" || _realElectronAPI !== undefined) return;

	const real = window.electronAPI;
	if (!real) return;

	_realElectronAPI = real;

	const proxy = new Proxy(real, {
		get(target, prop, receiver) {
			if (_extensionActivationDepth > 0) {
				console.warn(
					`[extensions] Blocked extension access to electronAPI.${String(prop)}`,
				);
				return undefined;
			}
			return Reflect.get(target, prop, receiver);
		},
	});

	// contextBridge.exposeInMainWorld creates a non-configurable property on
	// window.  Attempting Object.defineProperty on it throws "Cannot redefine
	// property: electronAPI" which crashes the renderer (and makes the
	// transparent HUD window invisible).  Only redefine when the descriptor
	// allows it; otherwise the proxy is still used internally via
	// _realElectronAPI so app code keeps working.
	const desc = Object.getOwnPropertyDescriptor(window, "electronAPI");
	if (!desc || desc.configurable) {
		Object.defineProperty(window, "electronAPI", {
			value: proxy,
			writable: false,
			configurable: false,
		});
	}
}

installElectronAPIGuard();

interface RegisteredRenderHook {
	extensionId: string;
	phase: RenderHookPhase;
	hook: RenderHookFn;
}

interface RegisteredCursorEffect {
	extensionId: string;
	effect: CursorEffectFn;
}

interface RegisteredSettingsPanel {
	extensionId: string;
	panel: ExtensionSettingsPanel;
}

interface RegisteredWallpaper {
	id: string;
	extensionId: string;
	wallpaper: ContributedWallpaper;
	/** Resolved absolute URL to the wallpaper file */
	resolvedUrl: string;
	/** Resolved absolute URL to the thumbnail (or resolvedUrl if absent) */
	resolvedThumbnailUrl: string;
}

interface RegisteredCursorStyle {
	id: string;
	extensionId: string;
	cursorStyle: ContributedCursorStyle;
	/** Resolved absolute URL to the default cursor image */
	resolvedDefaultUrl: string;
	/** Resolved absolute URL to the click image (if provided) */
	resolvedClickUrl?: string;
}

interface ActiveExtension {
	info: ExtensionInfo;
	module: RecordlyExtensionModule;
	disposables: (() => void)[];
}

/**
 * The Extension Host manages all loaded extensions and provides
 * access to their registered hooks, effects, and settings.
 */
export class ExtensionHost {
	private activeExtensions = new Map<string, ActiveExtension>();
	private renderHooks: RegisteredRenderHook[] = [];
	private cursorEffects: RegisteredCursorEffect[] = [];
	private frames: FrameInstance[] = [];
	private eventHandlers = new Map<
		ExtensionEventType,
		{ extensionId: string; handler: ExtensionEventHandler }[]
	>();
	private settingsPanels: RegisteredSettingsPanel[] = [];
	private wallpapers: RegisteredWallpaper[] = [];
	private cursorStyles: RegisteredCursorStyle[] = [];
	private extensionSettings = new Map<string, Record<string, unknown>>();
	private settingChangeCallbacks = new Map<
		string,
		Set<(settingId: string, value: unknown) => void>
	>();
	private listeners = new Set<() => void>();
	private fullSettingsStore: Record<string, Record<string, unknown>> | null = null;
	private persistTimeout: ReturnType<typeof setTimeout> | null = null;
	private iconPathCache = new Map<string, Path2D>();

	// Shared playback/project state — set by the app, queried by extensions
	private _videoInfo: { width: number; height: number; durationMs: number; fps: number } | null =
		null;
	private _videoLayout: {
		maskRect: { x: number; y: number; width: number; height: number };
		canvasWidth: number;
		canvasHeight: number;
		borderRadius: number;
		padding: number | { top: number; right: number; bottom: number; left: number };
	} | null = null;
	private _zoomState: { scale: number; focusX: number; focusY: number; progress: number } | null =
		null;
	private _shadowConfig: { enabled: boolean; intensity: number } = {
		enabled: false,
		intensity: 0,
	};
	private _cursorTelemetry: Array<{
		timeMs: number;
		cx: number;
		cy: number;
		interactionType?: string;
		pressure?: number;
	}> = [];
	private _smoothedCursor: {
		timeMs: number;
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null = null;
	private _keystrokeEvents: Array<{ timeMs: number; key: string; modifiers: string[] }> = [];
	private _activeFrame: string | null = null;
	private _playbackState: {
		currentTimeMs: number;
		durationMs: number;
		isPlaying: boolean;
	} | null = null;

	constructor() {
		if (typeof window !== "undefined") {
			window.addEventListener("beforeunload", () => {
				this.flushPersistedSettings();
			});
		}
	}

	/**
	 * Activate an extension given its info and resolved module URL.
	 */
	async activateExtension(info: ExtensionInfo, moduleUrl: string): Promise<void> {
		if (this.activeExtensions.has(info.manifest.id)) {
			// Deactivate stale instance first so reinstall/reload works
			await this.deactivateExtension(info.manifest.id);
		}

		const disposables: (() => void)[] = [];
		let mod: RecordlyExtensionModule | null = null;
		try {
			this.ensureExtensionSettingsLoaded(info.manifest.id);

			// Block electronAPI access while extension code executes
			_extensionActivationDepth++;
			try {
				const loaded: RecordlyExtensionModule = await import(/* @vite-ignore */ moduleUrl);
				mod = loaded;
				const api = this.createAPI(
					info.manifest.id,
					info.path,
					info.manifest.permissions ?? [],
					disposables,
				);

				await loaded.activate(api);
			} finally {
				_extensionActivationDepth--;
			}

			if (!mod) {
				throw new Error("Extension module failed to load");
			}

			this.activeExtensions.set(info.manifest.id, {
				info,
				module: mod,
				disposables,
			});

			this.notifyListeners();
			console.log(`[extensions] Activated: ${info.manifest.name} v${info.manifest.version}`);
		} catch (err) {
			for (const dispose of disposables.reverse()) {
				try {
					dispose();
				} catch {
					/* ignore */
				}
			}

			if (mod) {
				try {
					await mod.deactivate?.();
				} catch {
					/* ignore */
				}
			}

			this.notifyListeners();
			console.error(`[extensions] Failed to activate ${info.manifest.id}:`, err);
			throw err;
		}
	}

	/**
	 * Deactivate an extension by ID.
	 */
	async deactivateExtension(extensionId: string): Promise<void> {
		const active = this.activeExtensions.get(extensionId);
		if (!active) return;

		try {
			await active.module.deactivate?.();
		} catch (err) {
			console.warn(`[extensions] Error during deactivate of ${extensionId}:`, err);
		}

		// Clean up all disposables (unregister hooks, effects, handlers)
		for (const dispose of active.disposables) {
			try {
				dispose();
			} catch {
				/* ignore */
			}
		}

		this.activeExtensions.delete(extensionId);
		this.flushPersistedSettings();
		this.notifyListeners();
		console.log(`[extensions] Deactivated: ${extensionId}`);
	}

	/**
	 * Deactivate all extensions.
	 */
	async deactivateAll(): Promise<void> {
		const ids = Array.from(this.activeExtensions.keys());
		for (const id of ids) {
			await this.deactivateExtension(id);
		}
		this.flushPersistedSettings();
	}

	// ---------------------------------------------------------------------------
	// Render Pipeline Integration
	// ---------------------------------------------------------------------------

	/**
	 * Execute all render hooks for a given phase.
	 */
	executeRenderHooks(phase: RenderHookPhase, context: RenderHookContext): void {
		const hooks = this.renderHooks.filter((h) => h.phase === phase);
		for (const hook of hooks) {
			context.ctx.save();
			try {
				hook.hook(context);
			} catch (err) {
				console.warn(
					`[extensions] Render hook error (${hook.extensionId}, ${phase}):`,
					err,
				);
			} finally {
				context.ctx.restore();
			}
		}
	}

	/**
	 * Execute all cursor effects. Returns true if any effect is still animating.
	 */
	executeCursorEffects(context: CursorEffectContext): boolean {
		let anyActive = false;
		for (const effect of this.cursorEffects) {
			context.ctx.save();
			try {
				const stillActive = effect.effect(context);
				if (stillActive) anyActive = true;
			} catch (err) {
				console.warn(`[extensions] Cursor effect error (${effect.extensionId}):`, err);
			} finally {
				context.ctx.restore();
			}
		}
		return anyActive;
	}

	/**
	 * Emit an event to all registered handlers.
	 */
	emitEvent(event: ExtensionEvent): void {
		const handlers = this.eventHandlers.get(event.type);
		if (!handlers) return;

		for (const { handler } of handlers) {
			try {
				handler(event);
			} catch (err) {
				console.warn(`[extensions] Event handler error (${event.type}):`, err);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Queries
	// ---------------------------------------------------------------------------

	getActiveExtensions(): ExtensionInfo[] {
		return Array.from(this.activeExtensions.values()).map((a) => a.info);
	}

	/** Quick snapshot of video info for callers that need durationMs etc. */
	getVideoInfoSnapshot(): {
		width: number;
		height: number;
		durationMs: number;
		fps: number;
	} | null {
		return this._videoInfo;
	}

	getSettingsPanels(): RegisteredSettingsPanel[] {
		return [...this.settingsPanels];
	}

	hasRenderHooks(phase: RenderHookPhase): boolean {
		return this.renderHooks.some((h) => h.phase === phase);
	}

	hasCursorEffects(): boolean {
		return this.cursorEffects.length > 0;
	}

	getExtensionSetting(extensionId: string, settingId: string): unknown {
		this.ensureExtensionSettingsLoaded(extensionId);
		return this.extensionSettings.get(extensionId)?.[settingId];
	}

	setExtensionSetting(extensionId: string, settingId: string, value: unknown): void {
		this.ensureExtensionSettingsLoaded(extensionId);
		this.extensionSettings.get(extensionId)![settingId] = value;
		this.persistExtensionSettings(extensionId);
		// Notify per-extension setting change listeners
		const cbs = this.settingChangeCallbacks.get(extensionId);
		if (cbs) {
			for (const cb of cbs) {
				try {
					cb(settingId, value);
				} catch {
					/* ignore */
				}
			}
		}
		this.notifyListeners();
	}

	/**
	 * Get all registered device frames from active extensions.
	 */
	getFrames(): FrameInstance[] {
		return [...this.frames];
	}

	/**
	 * Get all contributed wallpapers from active extensions.
	 */
	getContributedWallpapers(): RegisteredWallpaper[] {
		return [...this.wallpapers];
	}

	/**
	 * Get all contributed cursor styles from active extensions.
	 */
	getContributedCursorStyles(): RegisteredCursorStyle[] {
		return [...this.cursorStyles];
	}

	/**
	 * Subscribe to changes in extensions (activation/deactivation).
	 */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	// ---------------------------------------------------------------------------
	// Shared State — set by the app, read by extensions via API
	// ---------------------------------------------------------------------------

	setVideoInfo(
		info: { width: number; height: number; durationMs: number; fps: number } | null,
	): void {
		this._videoInfo = info;
	}

	setVideoLayout(
		layout: {
			maskRect: { x: number; y: number; width: number; height: number };
			canvasWidth: number;
			canvasHeight: number;
			borderRadius: number;
			padding: number | { top: number; right: number; bottom: number; left: number };
		} | null,
	): void {
		if (!layout) {
			this._videoLayout = null;
			return;
		}

		// Normalize and deep clone padding to exclude UI-only fields like 'linked'
		const p = layout.padding;
		const normalizedPadding =
			typeof p === "number"
				? p
				: {
						top: Number(p.top) || 0,
						right: Number(p.right) || 0,
						bottom: Number(p.bottom) || 0,
						left: Number(p.left) || 0,
					};

		this._videoLayout = {
			maskRect: { ...layout.maskRect },
			canvasWidth: layout.canvasWidth,
			canvasHeight: layout.canvasHeight,
			borderRadius: layout.borderRadius,
			padding: normalizedPadding,
		};
	}

	setZoomState(
		state: { scale: number; focusX: number; focusY: number; progress: number } | null,
	): void {
		this._zoomState = state;
	}

	setShadowConfig(config: { enabled: boolean; intensity: number }): void {
		this._shadowConfig = config;
	}

	setCursorTelemetry(
		telemetry: Array<{
			timeMs: number;
			cx: number;
			cy: number;
			interactionType?: string;
			pressure?: number;
		}>,
	): void {
		this._cursorTelemetry = telemetry;
	}

	setSmoothedCursor(
		cursor: {
			timeMs: number;
			cx: number;
			cy: number;
			trail: Array<{ cx: number; cy: number }>;
		} | null,
	): void {
		this._smoothedCursor = cursor
			? {
					timeMs: cursor.timeMs,
					cx: cursor.cx,
					cy: cursor.cy,
					trail: cursor.trail.map((point) => ({ ...point })),
				}
			: null;
	}

	setKeystrokeEvents(events: Array<{ timeMs: number; key: string; modifiers: string[] }>): void {
		this._keystrokeEvents = events;
	}

	setActiveFrame(frameId: string | null): void {
		this._activeFrame = frameId;
	}

	setPlaybackState(
		state: { currentTimeMs: number; durationMs: number; isPlaying: boolean } | null,
	): void {
		this._playbackState = state;
	}

	// ---------------------------------------------------------------------------
	// Private
	// ---------------------------------------------------------------------------

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				/* ignore */
			}
		}
	}

	private readPersistedSettingsStore(): Record<string, Record<string, unknown>> {
		if (typeof window === "undefined" || !window.localStorage) {
			return {};
		}

		try {
			const raw = window.localStorage.getItem(EXTENSION_SETTINGS_STORAGE_KEY);
			if (!raw) {
				return {};
			}

			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				return {};
			}

			return parsed as Record<string, Record<string, unknown>>;
		} catch {
			return {};
		}
	}

	private writePersistedSettingsStore(store: Record<string, Record<string, unknown>>): void {
		if (typeof window === "undefined" || !window.localStorage) {
			return;
		}

		try {
			window.localStorage.setItem(EXTENSION_SETTINGS_STORAGE_KEY, JSON.stringify(store));
		} catch {
			// Ignore storage quota / privacy mode failures.
		}
	}

	private getFullSettingsStore(): Record<string, Record<string, unknown>> {
		if (this.fullSettingsStore) {
			return this.fullSettingsStore;
		}
		this.fullSettingsStore = this.readPersistedSettingsStore();
		return this.fullSettingsStore;
	}

	private ensureExtensionSettingsLoaded(extensionId: string): void {
		if (this.extensionSettings.has(extensionId)) {
			return;
		}

		const store = this.getFullSettingsStore();
		const persisted = store[extensionId];
		const normalized =
			persisted && typeof persisted === "object" && !Array.isArray(persisted)
				? { ...persisted }
				: {};

		this.extensionSettings.set(extensionId, normalized);
	}

	private persistExtensionSettings(extensionId: string): void {
		const store = this.getFullSettingsStore();
		const settings = this.extensionSettings.get(extensionId) ?? {};

		if (Object.keys(settings).length === 0) {
			delete store[extensionId];
		} else {
			store[extensionId] = { ...settings };
		}

		// Debounce the actual write to localStorage to avoid blocking the UI thread during rapid changes
		if (this.persistTimeout) {
			clearTimeout(this.persistTimeout);
		}
		this.persistTimeout = setTimeout(() => {
			this.writePersistedSettingsStore(store);
			this.persistTimeout = null;
		}, 500);
	}

	private flushPersistedSettings(): void {
		if (this.persistTimeout) {
			clearTimeout(this.persistTimeout);
			this.persistTimeout = null;
		}
		this.writePersistedSettingsStore(this.getFullSettingsStore());
	}

	/**
	 * Create the permission-gated API object for an extension.
	 */
	private createAPI(
		extensionId: string,
		extensionPath: string,
		permissions: string[],
		disposables: (() => void)[],
	): RecordlyExtensionAPI {
		const host = this;
		const perms = new Set(permissions);

		function requirePermission(perm: string, method: string): void {
			if (!perms.has(perm)) {
				throw new Error(
					`Extension '${extensionId}' lacks '${perm}' permission required for ${method}()`,
				);
			}
		}

		function getEventPermission(
			event: ExtensionEventType,
		): "cursor" | "timeline" | "export" | null {
			if (event.startsWith("cursor:")) {
				return "cursor";
			}

			if (event.startsWith("playback:") || event.startsWith("timeline:")) {
				return "timeline";
			}

			if (event.startsWith("export:")) {
				return "export";
			}

			return null;
		}

		return {
			registerRenderHook(phase: RenderHookPhase, hook: RenderHookFn): () => void {
				requirePermission("render", "registerRenderHook");
				const entry: RegisteredRenderHook = { extensionId, phase, hook };
				host.renderHooks.push(entry);

				const dispose = () => {
					const index = host.renderHooks.indexOf(entry);
					if (index >= 0) host.renderHooks.splice(index, 1);
				};
				disposables.push(dispose);
				return dispose;
			},

			registerCursorEffect(effect: CursorEffectFn): () => void {
				requirePermission("cursor", "registerCursorEffect");
				const entry: RegisteredCursorEffect = { extensionId, effect };
				host.cursorEffects.push(entry);

				const dispose = () => {
					const index = host.cursorEffects.indexOf(entry);
					if (index >= 0) host.cursorEffects.splice(index, 1);
				};
				disposables.push(dispose);
				return dispose;
			},

			registerFrame(frame: ContributedFrame): () => void {
				requirePermission("ui", "registerFrame");
				const resolveFramePath = (relativePath: string): string =>
					resolveExtensionRelativeFileUrl(extensionPath, relativePath);

				let filePath: string;
				if (frame.draw) {
					// Generate a small thumbnail for the picker UI
					const thumbW = 192;
					const thumbH = 108;
					const c = document.createElement("canvas");
					c.width = thumbW;
					c.height = thumbH;
					const ctx = c.getContext("2d");
					if (ctx) frame.draw(ctx, thumbW, thumbH);
					filePath = c.toDataURL("image/png");
				} else if (frame.dataUrl) {
					filePath = frame.dataUrl;
				} else if (frame.file) {
					filePath = resolveFramePath(frame.file);
				} else {
					throw new Error("Device frame must provide either draw, file, or dataUrl");
				}

				let thumbnailPath = filePath;
				if (frame.thumbnail) {
					thumbnailPath = resolveFramePath(frame.thumbnail);
				}

				const instance: FrameInstance = {
					id: `${extensionId}/${frame.id}`,
					extensionId,
					label: frame.label,
					category: frame.category,
					filePath,
					thumbnailPath,
					screenInsets: frame.screenInsets,
					appearance: frame.appearance,
					draw: frame.draw,
				};
				host.frames.push(instance);
				host.notifyListeners();

				const dispose = () => {
					const index = host.frames.indexOf(instance);
					if (index >= 0) host.frames.splice(index, 1);
					host.notifyListeners();
				};
				disposables.push(dispose);
				return dispose;
			},

			registerWallpaper(wallpaper: ContributedWallpaper): () => void {
				requirePermission("assets", "registerWallpaper");
				const resolvedUrl = resolveExtensionRelativeFileUrl(extensionPath, wallpaper.file);
				const resolvedThumbnailUrl = wallpaper.thumbnail
					? resolveExtensionRelativeFileUrl(extensionPath, wallpaper.thumbnail)
					: resolvedUrl;
				const entry: RegisteredWallpaper = {
					id: `${extensionId}/${wallpaper.id}`,
					extensionId,
					wallpaper,
					resolvedUrl,
					resolvedThumbnailUrl,
				};
				host.wallpapers.push(entry);
				host.notifyListeners();

				const dispose = () => {
					const index = host.wallpapers.indexOf(entry);
					if (index >= 0) host.wallpapers.splice(index, 1);
					host.notifyListeners();
				};
				disposables.push(dispose);
				return dispose;
			},

			registerCursorStyle(cursorStyle: ContributedCursorStyle): () => void {
				requirePermission("assets", "registerCursorStyle");
				const resolvedDefaultUrl = resolveExtensionRelativeFileUrl(
					extensionPath,
					cursorStyle.defaultImage,
				);
				const resolvedClickUrl = cursorStyle.clickImage
					? resolveExtensionRelativeFileUrl(extensionPath, cursorStyle.clickImage)
					: undefined;
				const entry: RegisteredCursorStyle = {
					id: `${extensionId}/${cursorStyle.id}`,
					extensionId,
					cursorStyle,
					resolvedDefaultUrl,
					resolvedClickUrl,
				};
				host.cursorStyles.push(entry);
				host.notifyListeners();

				const dispose = () => {
					const index = host.cursorStyles.indexOf(entry);
					if (index >= 0) host.cursorStyles.splice(index, 1);
					host.notifyListeners();
				};
				disposables.push(dispose);
				return dispose;
			},

			on(event: ExtensionEventType, handler: ExtensionEventHandler): () => void {
				const requiredPermission = getEventPermission(event);
				if (requiredPermission) {
					requirePermission(requiredPermission, `on(${event})`);
				}

				if (!host.eventHandlers.has(event)) {
					host.eventHandlers.set(event, []);
				}
				const entry = { extensionId, handler };
				host.eventHandlers.get(event)!.push(entry);

				const dispose = () => {
					const list = host.eventHandlers.get(event);
					if (!list) return;
					const index = list.indexOf(entry);
					if (index >= 0) list.splice(index, 1);
				};
				disposables.push(dispose);
				return dispose;
			},

			registerSettingsPanel(panel: ExtensionSettingsPanel): () => void {
				requirePermission("ui", "registerSettingsPanel");
				const entry: RegisteredSettingsPanel = { extensionId, panel };
				host.settingsPanels.push(entry);
				host.notifyListeners();

				const dispose = () => {
					const index = host.settingsPanels.indexOf(entry);
					if (index >= 0) host.settingsPanels.splice(index, 1);
					host.notifyListeners();
				};
				disposables.push(dispose);
				return dispose;
			},

			getSetting(settingId: string): unknown {
				host.ensureExtensionSettingsLoaded(extensionId);
				return host.extensionSettings.get(extensionId)?.[settingId];
			},

			setSetting(settingId: string, value: unknown): void {
				host.ensureExtensionSettingsLoaded(extensionId);
				host.extensionSettings.get(extensionId)![settingId] = value;
				host.persistExtensionSettings(extensionId);
				// Notify per-extension setting change listeners
				const cbs = host.settingChangeCallbacks.get(extensionId);
				if (cbs) {
					for (const cb of cbs) {
						try {
							cb(settingId, value);
						} catch {
							/* ignore */
						}
					}
				}
				host.notifyListeners();
			},

			resolveAsset(relativePath: string): string {
				requirePermission("assets", "resolveAsset");
				return resolveExtensionRelativeFileUrl(extensionPath, relativePath);
			},

			playSound(relativePath: string, options?: { volume?: number }): () => void {
				requirePermission("audio", "playSound");
				const audio = new Audio(
					resolveExtensionRelativeFileUrl(extensionPath, relativePath),
				);
				audio.volume = Math.max(0, Math.min(1, options?.volume ?? 1));
				audio.play().catch((err) => {
					console.warn(`[ext:${extensionId}] Failed to play sound:`, err);
				});
				return () => {
					audio.pause();
					audio.src = "";
				};
			},

			log(message: string, ...args: unknown[]): void {
				console.log(`[ext:${extensionId}]`, message, ...args);
			},

			// ----------------------------------------------------------------
			// Query APIs
			// ----------------------------------------------------------------

			getVideoInfo() {
				return host._videoInfo ? { ...host._videoInfo } : null;
			},

			getVideoLayout() {
				if (!host._videoLayout) return null;
				const p = host._videoLayout.padding;
				return {
					maskRect: { ...host._videoLayout.maskRect },
					canvasWidth: host._videoLayout.canvasWidth,
					canvasHeight: host._videoLayout.canvasHeight,
					borderRadius: host._videoLayout.borderRadius,
					padding: typeof p === "number" ? p : { ...p },
				};
			},

			getCursorAt(timeMs: number) {
				const t = host._cursorTelemetry;
				if (!t || t.length === 0) return null;

				if (timeMs <= t[0].timeMs) return { ...t[0], timeMs };
				if (timeMs >= t[t.length - 1].timeMs) return { ...t[t.length - 1], timeMs };

				let lo = 0;
				let hi = t.length - 1;
				while (lo < hi - 1) {
					const mid = (lo + hi) >> 1;
					if (t[mid].timeMs <= timeMs) {
						lo = mid;
					} else {
						hi = mid;
					}
				}

				const a = t[lo];
				const b = t[hi];
				const span = b.timeMs - a.timeMs;
				const frac = span > 0 ? (timeMs - a.timeMs) / span : 0;

				return {
					...a,
					cx: a.cx + (b.cx - a.cx) * frac,
					cy: a.cy + (b.cy - a.cy) * frac,
					timeMs,
				};
			},

			getSmoothedCursor() {
				if (!host._smoothedCursor) {
					return null;
				}

				return {
					timeMs: host._smoothedCursor.timeMs,
					cx: host._smoothedCursor.cx,
					cy: host._smoothedCursor.cy,
					trail: host._smoothedCursor.trail.map((point) => ({ ...point })),
				};
			},

			getZoomState() {
				return host._zoomState ? { ...host._zoomState } : null;
			},

			getShadowConfig() {
				return { ...host._shadowConfig };
			},

			getKeystrokesInRange(startMs: number, endMs: number) {
				return host._keystrokeEvents
					.filter((e) => e.timeMs >= startMs && e.timeMs <= endMs)
					.map((e) => ({ ...e }));
			},

			getAspectRatio() {
				if (!host._videoLayout) return null;
				return host._videoLayout.canvasWidth / host._videoLayout.canvasHeight;
			},

			getActiveFrame() {
				return host._activeFrame;
			},

			isExtensionActive(extId: string) {
				return host.activeExtensions.has(extId);
			},

			getPlaybackState() {
				return host._playbackState ? { ...host._playbackState } : null;
			},

			getCanvasDimensions() {
				if (!host._videoLayout) return null;
				return {
					width: host._videoLayout.canvasWidth,
					height: host._videoLayout.canvasHeight,
				};
			},

			drawIcon(
				ctx: CanvasRenderingContext2D,
				name: string,
				x: number,
				y: number,
				size: number,
				color: string,
				weight: "thin" | "light" | "regular" | "bold" | "fill" = "regular",
			): void {
				const path = resolveIconPath(name, weight, host.iconPathCache);

				if (path) {
					ctx.save();
					ctx.translate(x, y);
					const scale = size / 256; // Phosphor icons use a 256x256 grid
					ctx.scale(scale, scale);
					ctx.translate(-128, -128); // Center the icon
					ctx.fillStyle = color;
					ctx.fill(path);
					ctx.restore();
				}
			},

			onSettingChange(callback: (settingId: string, value: unknown) => void): () => void {
				if (!host.settingChangeCallbacks.has(extensionId)) {
					host.settingChangeCallbacks.set(extensionId, new Set());
				}
				host.settingChangeCallbacks.get(extensionId)!.add(callback);

				const dispose = () => {
					const cbs = host.settingChangeCallbacks.get(extensionId);
					if (cbs) {
						cbs.delete(callback);
						if (cbs.size === 0) host.settingChangeCallbacks.delete(extensionId);
					}
				};
				disposables.push(dispose);
				return dispose;
			},

			getAllSettings(): Record<string, unknown> {
				host.ensureExtensionSettingsLoaded(extensionId);
				return { ...(host.extensionSettings.get(extensionId) ?? {}) };
			},
		};
	}

	async syncConfiguredExtensions(discovered: ExtensionInfo[]): Promise<void> {
		const desired = new Map(
			discovered
				.filter((ext) => ext.status === "active")
				.map((ext) => [ext.manifest.id, ext]),
		);

		for (const activeId of Array.from(this.activeExtensions.keys())) {
			if (!desired.has(activeId)) {
				await this.deactivateExtension(activeId);
			}
		}

		for (const ext of discovered) {
			if (ext.status !== "active" || this.activeExtensions.has(ext.manifest.id)) {
				continue;
			}

			try {
				const moduleUrl = createExtensionModuleUrl(ext.path, ext.manifest.main);
				await this.activateExtension(ext, moduleUrl);
			} catch (err) {
				console.error(
					`[extensions] Failed to activate configured extension ${ext.manifest.id}:`,
					err,
				);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Auto-Activation (idempotent — safe to call from multiple places)
	// ---------------------------------------------------------------------------

	private _autoActivatePromise: Promise<void> | null = null;

	/**
	 * Discover and activate all builtin extensions. Idempotent — only runs
	 * the discovery/activation sequence once no matter how many callers invoke it.
	 */
	autoActivateBuiltins(): Promise<void> {
		if (this._autoActivatePromise) return this._autoActivatePromise;

		this._autoActivatePromise = (async () => {
			// Use the real (unproxied) reference — this is app code, not extension code
			const api = _realElectronAPI ?? window.electronAPI;
			if (!api?.extensionsDiscover) return;
			try {
				const discovered: ExtensionInfo[] = await api.extensionsDiscover();
				await this.syncConfiguredExtensions(discovered);
			} catch (err) {
				console.error("[extensions] Failed to discover extensions:", err);
			}
		})();

		return this._autoActivatePromise;
	}
}

/**
 * Singleton extension host instance for the renderer process.
 */
export const extensionHost = new ExtensionHost();
