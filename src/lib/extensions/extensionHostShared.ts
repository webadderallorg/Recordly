import type {
	ContributedCursorStyle,
	ContributedWallpaper,
	ExtensionEventHandler,
	ExtensionEventType,
	ExtensionInfo,
	ExtensionSettingsPanel,
	FrameInstance,
	RecordlyExtensionModule,
	RenderHookFn,
	RenderHookPhase,
	CursorEffectFn,
} from "./types";

export const EXTENSION_SETTINGS_STORAGE_KEY = "recordly.extension-settings.v1";

let extensionActivationDepth = 0;
let realElectronAPI: typeof window.electronAPI | undefined;

export interface RegisteredRenderHook {
	extensionId: string;
	phase: RenderHookPhase;
	hook: RenderHookFn;
}

export interface RegisteredCursorEffect {
	extensionId: string;
	effect: CursorEffectFn;
}

export interface RegisteredSettingsPanel {
	extensionId: string;
	panel: ExtensionSettingsPanel;
}

export interface RegisteredWallpaper {
	id: string;
	extensionId: string;
	wallpaper: ContributedWallpaper;
	resolvedUrl: string;
	resolvedThumbnailUrl: string;
}

export interface RegisteredCursorStyle {
	id: string;
	extensionId: string;
	cursorStyle: ContributedCursorStyle;
	resolvedDefaultUrl: string;
	resolvedClickUrl?: string;
}

export interface ActiveExtension {
	info: ExtensionInfo;
	module: RecordlyExtensionModule;
	disposables: (() => void)[];
}

export interface ExtensionHostApiContext {
	activeExtensions: Map<string, ActiveExtension>;
	renderHooks: RegisteredRenderHook[];
	cursorEffects: RegisteredCursorEffect[];
	frames: FrameInstance[];
	eventHandlers: Map<
		ExtensionEventType,
		{ extensionId: string; handler: ExtensionEventHandler }[]
	>;
	settingsPanels: RegisteredSettingsPanel[];
	wallpapers: RegisteredWallpaper[];
	cursorStyles: RegisteredCursorStyle[];
	extensionSettings: Map<string, Record<string, unknown>>;
	settingChangeCallbacks: Map<string, Set<(settingId: string, value: unknown) => void>>;
	notifyListeners(): void;
	ensureExtensionSettingsLoaded(extensionId: string): void;
	persistExtensionSettings(extensionId: string): void;
	getVideoInfo(): { width: number; height: number; durationMs: number; fps: number } | null;
	getVideoLayout(): {
		maskRect: { x: number; y: number; width: number; height: number };
		canvasWidth: number;
		canvasHeight: number;
		borderRadius: number;
		padding: number;
	} | null;
	getZoomState(): { scale: number; focusX: number; focusY: number; progress: number } | null;
	getShadowConfig(): { enabled: boolean; intensity: number };
	getCursorTelemetry(): Array<{
		timeMs: number;
		cx: number;
		cy: number;
		interactionType?: string;
		pressure?: number;
	}>;
	getSmoothedCursor(): {
		timeMs: number;
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null;
	getKeystrokeEvents(): Array<{ timeMs: number; key: string; modifiers: string[] }>;
	getActiveFrame(): string | null;
	getPlaybackState(): { currentTimeMs: number; durationMs: number; isPlaying: boolean } | null;
}

export function installElectronAPIGuard(): void {
	if (typeof window === "undefined" || realElectronAPI !== undefined) return;

	const real = window.electronAPI;
	if (!real) return;

	realElectronAPI = real;
	const proxy = new Proxy(real, {
		get(target, prop, receiver) {
			if (extensionActivationDepth > 0) {
				console.warn(`[extensions] Blocked extension access to electronAPI.${String(prop)}`);
				return undefined;
			}
			return Reflect.get(target, prop, receiver);
		},
	});

	const descriptor = Object.getOwnPropertyDescriptor(window, "electronAPI");
	if (!descriptor || descriptor.configurable) {
		Object.defineProperty(window, "electronAPI", {
			value: proxy,
			writable: false,
			configurable: false,
		});
	}
}

export async function runWithExtensionActivationGuard<T>(action: () => Promise<T>): Promise<T> {
	extensionActivationDepth += 1;
	try {
		return await action();
	} finally {
		extensionActivationDepth -= 1;
	}
}

export function getExtensionElectronApi(): typeof window.electronAPI | undefined {
	if (typeof window === "undefined") {
		return undefined;
	}

	return realElectronAPI ?? window.electronAPI;
}