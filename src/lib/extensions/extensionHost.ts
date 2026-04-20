/**
 * Extension Host — Renderer Process
 *
 * Manages the lifecycle of extensions in the renderer. Loads extension
 * modules, provides the permission-gated host API, and coordinates render hooks.
 */

import { createExtensionModuleUrl } from "./fileUrls";
import { createExtensionAPI } from "./extensionHostApiFactory";
import {
	type ActiveExtension,
	type ExtensionHostApiContext,
	getExtensionElectronApi,
	installElectronAPIGuard,
	type RegisteredCursorEffect,
	type RegisteredCursorStyle,
	type RegisteredRenderHook,
	type RegisteredSettingsPanel,
	type RegisteredWallpaper,
	runWithExtensionActivationGuard,
} from "./extensionHostShared";
import { ExtensionHostStateStore } from "./extensionHostState";
import type {
	CursorEffectContext,
	ExtensionEvent,
	ExtensionEventHandler,
	ExtensionEventType,
	ExtensionInfo,
	FrameInstance,
	RecordlyExtensionModule,
	RenderHookContext,
	RenderHookPhase,
} from "./types";
installElectronAPIGuard();

/**
 * The Extension Host manages all loaded extensions and provides
 * access to their registered hooks, effects, and settings.
 */
export class ExtensionHost extends ExtensionHostStateStore {
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
	private listeners = new Set<() => void>();

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

			mod = await runWithExtensionActivationGuard(async () => {
				const loaded: RecordlyExtensionModule = await import(/* @vite-ignore */ moduleUrl);
				const api = this.createAPI(
					info.manifest.id,
					info.path,
					info.manifest.permissions ?? [],
					disposables,
				);
				await loaded.activate(api);
				return loaded;
			});

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

	getSettingsPanels(): RegisteredSettingsPanel[] {
		return [...this.settingsPanels];
	}

	hasRenderHooks(phase: RenderHookPhase): boolean {
		return this.renderHooks.some((h) => h.phase === phase);
	}

	hasCursorEffects(): boolean {
		return this.cursorEffects.length > 0;
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
	// Private
	// ---------------------------------------------------------------------------

	protected notifyListeners(): void {
		for (const listener of this.listeners) {
			try {
				listener();
			} catch {
				/* ignore */
			}
		}
	}

	private buildApiContext(): ExtensionHostApiContext {
		return {
			activeExtensions: this.activeExtensions,
			renderHooks: this.renderHooks,
			cursorEffects: this.cursorEffects,
			frames: this.frames,
			eventHandlers: this.eventHandlers,
			settingsPanels: this.settingsPanels,
			wallpapers: this.wallpapers,
			cursorStyles: this.cursorStyles,
			notifyListeners: () => this.notifyListeners(),
			...this.getStateApiContext(),
		};
	}

	private createAPI(
		extensionId: string,
		extensionPath: string,
		permissions: string[],
		disposables: (() => void)[],
	) {
		return createExtensionAPI({
			extensionId,
			extensionPath,
			permissions,
			disposables,
			host: this.buildApiContext(),
		});
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
			const api = getExtensionElectronApi();
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
