import { resolveExtensionRelativeFileUrl } from "./fileUrls";
import type {
	ContributedCursorStyle,
	ContributedFrame,
	ContributedWallpaper,
	ExtensionEventType,
	ExtensionSettingsPanel,
	FrameInstance,
	RecordlyExtensionAPI,
	RenderHookFn,
	RenderHookPhase,
	CursorEffectFn,
	ExtensionEventHandler,
} from "./types";
import type {
	ExtensionHostApiContext,
	RegisteredCursorEffect,
	RegisteredCursorStyle,
	RegisteredRenderHook,
	RegisteredSettingsPanel,
	RegisteredWallpaper,
} from "./extensionHostShared";

interface RegistrationApiArgs {
	extensionId: string;
	extensionPath: string;
	disposables: (() => void)[];
	host: ExtensionHostApiContext;
	requirePermission(permission: string, method: string): void;
	getEventPermission(event: ExtensionEventType): "cursor" | "timeline" | "export" | null;
}

export function createExtensionRegistrationApi({
	extensionId,
	extensionPath,
	disposables,
	host,
	requirePermission,
	getEventPermission,
}: RegistrationApiArgs): Pick<
	RecordlyExtensionAPI,
	| "registerRenderHook"
	| "registerCursorEffect"
	| "registerFrame"
	| "registerWallpaper"
	| "registerCursorStyle"
	| "on"
	| "registerSettingsPanel"
	| "getSetting"
	| "setSetting"
	| "resolveAsset"
	| "playSound"
	| "log"
> {
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
				const canvas = document.createElement("canvas");
				canvas.width = 192;
				canvas.height = 108;
				const context = canvas.getContext("2d");
				if (context) frame.draw(context, 192, 108);
				filePath = canvas.toDataURL("image/png");
			} else if (frame.dataUrl) {
				filePath = frame.dataUrl;
			} else if (frame.file) {
				filePath = resolveFramePath(frame.file);
			} else {
				throw new Error("Device frame must provide either draw, file, or dataUrl");
			}

			const thumbnailPath = frame.thumbnail ? resolveFramePath(frame.thumbnail) : filePath;
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
			const callbacks = host.settingChangeCallbacks.get(extensionId);
			if (callbacks) {
				for (const callback of callbacks) {
					try {
						callback(settingId, value);
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
			const audio = new Audio(resolveExtensionRelativeFileUrl(extensionPath, relativePath));
			audio.volume = Math.max(0, Math.min(1, options?.volume ?? 1));
			audio.play().catch((error) => {
				console.warn(`[ext:${extensionId}] Failed to play sound:`, error);
			});
			return () => {
				audio.pause();
				audio.src = "";
			};
		},

		log(message: string, ...args: unknown[]): void {
			console.log(`[ext:${extensionId}]`, message, ...args);
		},
	};
}