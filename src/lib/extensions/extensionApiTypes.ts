import type {
	ContributedCursorStyle,
	ContributedFrame,
	ContributedWallpaper,
} from "./extensionManifestTypes";
import type {
	CursorEffectFn,
	ExtensionEventHandler,
	ExtensionEventType,
	ExtensionSettingsPanel,
	RenderHookFn,
	RenderHookPhase,
} from "./extensionHookTypes";

export interface RecordlyExtensionAPI {
	registerRenderHook(phase: RenderHookPhase, hook: RenderHookFn): () => void;
	registerCursorEffect(effect: CursorEffectFn): () => void;
	registerFrame(frame: ContributedFrame): () => void;
	registerWallpaper(wallpaper: ContributedWallpaper): () => void;
	registerCursorStyle(cursorStyle: ContributedCursorStyle): () => void;
	on(event: ExtensionEventType, handler: ExtensionEventHandler): () => void;
	registerSettingsPanel(panel: ExtensionSettingsPanel): () => void;
	getSetting(settingId: string): unknown;
	setSetting(settingId: string, value: unknown): void;
	resolveAsset(relativePath: string): string;
	playSound(relativePath: string, options?: { volume?: number }): () => void;
	log(message: string, ...args: unknown[]): void;
	getVideoInfo(): { width: number; height: number; durationMs: number; fps: number } | null;
	getVideoLayout(): {
		maskRect: { x: number; y: number; width: number; height: number };
		canvasWidth: number;
		canvasHeight: number;
		borderRadius: number;
		padding: number;
	} | null;
	getCursorAt(timeMs: number): {
		cx: number;
		cy: number;
		timeMs: number;
		interactionType?: string;
		pressure?: number;
	} | null;
	getSmoothedCursor(): {
		cx: number;
		cy: number;
		timeMs: number;
		trail: Array<{ cx: number; cy: number }>;
	} | null;
	getZoomState(): { scale: number; focusX: number; focusY: number; progress: number } | null;
	getShadowConfig(): { enabled: boolean; intensity: number };
	getKeystrokesInRange(
		startMs: number,
		endMs: number,
	): Array<{ timeMs: number; key: string; modifiers: string[] }>;
	getAspectRatio(): number | null;
	getActiveFrame(): string | null;
	isExtensionActive(extensionId: string): boolean;
	getPlaybackState(): {
		currentTimeMs: number;
		durationMs: number;
		isPlaying: boolean;
	} | null;
	getCanvasDimensions(): { width: number; height: number } | null;
	onSettingChange(callback: (settingId: string, value: unknown) => void): () => void;
	getAllSettings(): Record<string, unknown>;
}

export interface RecordlyExtensionModule {
	activate(api: RecordlyExtensionAPI): void | Promise<void>;
	deactivate?(): void | Promise<void>;
}

export interface FrameInstance {
	id: string;
	extensionId: string;
	label: string;
	category: ContributedFrame["category"];
	filePath: string;
	thumbnailPath: string;
	screenInsets: { top: number; right: number; bottom: number; left: number };
	appearance?: "light" | "dark";
	draw?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
}