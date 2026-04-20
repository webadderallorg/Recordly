import {
	EXTENSION_SETTINGS_STORAGE_KEY,
	type ExtensionHostApiContext,
} from "./extensionHostShared";

type ExtensionHostStateApiContext = Pick<
	ExtensionHostApiContext,
	| "extensionSettings"
	| "settingChangeCallbacks"
	| "ensureExtensionSettingsLoaded"
	| "persistExtensionSettings"
	| "getVideoInfo"
	| "getVideoLayout"
	| "getZoomState"
	| "getShadowConfig"
	| "getCursorTelemetry"
	| "getSmoothedCursor"
	| "getKeystrokeEvents"
	| "getActiveFrame"
	| "getPlaybackState"
>;

export abstract class ExtensionHostStateStore {
	protected extensionSettings = new Map<string, Record<string, unknown>>();
	protected settingChangeCallbacks = new Map<
		string,
		Set<(settingId: string, value: unknown) => void>
	>();

	private videoInfo: { width: number; height: number; durationMs: number; fps: number } | null = null;
	private videoLayout: {
		maskRect: { x: number; y: number; width: number; height: number };
		canvasWidth: number;
		canvasHeight: number;
		borderRadius: number;
		padding: number;
	} | null = null;
	private zoomState: { scale: number; focusX: number; focusY: number; progress: number } | null =
		null;
	private shadowConfig: { enabled: boolean; intensity: number } = { enabled: false, intensity: 0 };
	private cursorTelemetry: Array<{
		timeMs: number;
		cx: number;
		cy: number;
		interactionType?: string;
		pressure?: number;
	}> = [];
	private smoothedCursor: {
		timeMs: number;
		cx: number;
		cy: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null = null;
	private keystrokeEvents: Array<{ timeMs: number; key: string; modifiers: string[] }> = [];
	private activeFrame: string | null = null;
	private playbackState: {
		currentTimeMs: number;
		durationMs: number;
		isPlaying: boolean;
	} | null = null;

	protected abstract notifyListeners(): void;

	getVideoInfoSnapshot(): { width: number; height: number; durationMs: number; fps: number } | null {
		return this.videoInfo;
	}

	getExtensionSetting(extensionId: string, settingId: string): unknown {
		this.ensureExtensionSettingsLoaded(extensionId);
		return this.extensionSettings.get(extensionId)?.[settingId];
	}

	setExtensionSetting(extensionId: string, settingId: string, value: unknown): void {
		this.ensureExtensionSettingsLoaded(extensionId);
		this.extensionSettings.get(extensionId)![settingId] = value;
		this.persistExtensionSettings(extensionId);
		const callbacks = this.settingChangeCallbacks.get(extensionId);
		if (callbacks) {
			for (const callback of callbacks) {
				try {
					callback(settingId, value);
				} catch {
					/* ignore */
				}
			}
		}
		this.notifyListeners();
	}

	setVideoInfo(info: { width: number; height: number; durationMs: number; fps: number } | null): void {
		this.videoInfo = info;
	}

	setVideoLayout(
		layout: {
			maskRect: { x: number; y: number; width: number; height: number };
			canvasWidth: number;
			canvasHeight: number;
			borderRadius: number;
			padding: number;
		} | null,
	): void {
		this.videoLayout = layout;
	}

	setZoomState(state: { scale: number; focusX: number; focusY: number; progress: number } | null): void {
		this.zoomState = state;
	}

	setShadowConfig(config: { enabled: boolean; intensity: number }): void {
		this.shadowConfig = config;
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
		this.cursorTelemetry = telemetry;
	}

	setSmoothedCursor(
		cursor: {
			timeMs: number;
			cx: number;
			cy: number;
			trail: Array<{ cx: number; cy: number }>;
		} | null,
	): void {
		this.smoothedCursor = cursor
			? {
					timeMs: cursor.timeMs,
					cx: cursor.cx,
					cy: cursor.cy,
					trail: cursor.trail.map((point) => ({ ...point })),
				}
			: null;
	}

	setKeystrokeEvents(events: Array<{ timeMs: number; key: string; modifiers: string[] }>): void {
		this.keystrokeEvents = events;
	}

	setActiveFrame(frameId: string | null): void {
		this.activeFrame = frameId;
	}

	setPlaybackState(
		state: { currentTimeMs: number; durationMs: number; isPlaying: boolean } | null,
	): void {
		this.playbackState = state;
	}

	protected getStateApiContext(): ExtensionHostStateApiContext {
		return {
			extensionSettings: this.extensionSettings,
			settingChangeCallbacks: this.settingChangeCallbacks,
			ensureExtensionSettingsLoaded: (extensionId: string) =>
				this.ensureExtensionSettingsLoaded(extensionId),
			persistExtensionSettings: (extensionId: string) =>
				this.persistExtensionSettings(extensionId),
			getVideoInfo: () => this.videoInfo,
			getVideoLayout: () => this.videoLayout,
			getZoomState: () => this.zoomState,
			getShadowConfig: () => this.shadowConfig,
			getCursorTelemetry: () => this.cursorTelemetry,
			getSmoothedCursor: () => this.smoothedCursor,
			getKeystrokeEvents: () => this.keystrokeEvents,
			getActiveFrame: () => this.activeFrame,
			getPlaybackState: () => this.playbackState,
		};
	}

	protected ensureExtensionSettingsLoaded(extensionId: string): void {
		if (this.extensionSettings.has(extensionId)) {
			return;
		}

		const store = this.readPersistedSettingsStore();
		const persisted = store[extensionId];
		this.extensionSettings.set(
			extensionId,
			persisted && typeof persisted === "object" && !Array.isArray(persisted)
				? { ...persisted }
				: {},
		);
	}

	protected persistExtensionSettings(extensionId: string): void {
		const store = this.readPersistedSettingsStore();
		const settings = this.extensionSettings.get(extensionId) ?? {};
		if (Object.keys(settings).length === 0) {
			delete store[extensionId];
		} else {
			store[extensionId] = { ...settings };
		}
		this.writePersistedSettingsStore(store);
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
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, Record<string, unknown>>)
				: {};
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
			/* ignore */
		}
	}
}