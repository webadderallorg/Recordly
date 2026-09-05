import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, desktopCapturer, ipcMain, systemPreferences } from "electron";
import { reassertHudOverlayMousePassthrough } from "../../windows";
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../constants";
import {
	getNativeMacWindowSources,
	resolveLinuxWindowBounds,
	resolveMacWindowBounds,
	stopWindowBoundsCapture,
} from "../cursor/bounds";
import { getDisplayBoundsForSource, getDisplayWorkAreaForSource } from "../recording/ffmpeg";
import { selectedSource, setSelectedSource } from "../state";
import type { SelectedSource, WindowBounds } from "../types";
import { getScreen, parseWindowId } from "../utils";
import { bringWindowsWindowForward, resolveWindowsWindowBounds } from "../windowsWindowControl";
import { getScreenSourceIdForDisplay } from "./sourceMapping";

const execFileAsync = promisify(execFile);
const SOURCE_LIST_CACHE_TTL_MS = 1200;
let sourceListCache: {
	key: string;
	expiresAt: number;
	value: Array<Record<string, unknown>>;
} | null = null;

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function broadcastSelectedSourceChange() {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send("selected-source-changed", selectedSource);
		}
	}
}

export async function bringSelectedWindowForward(
	source: SelectedSource,
): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	if (!windowId) return null;

	try {
		if (process.platform === "darwin") {
			const rawAppName = source.appName || source.name?.split(" — ")[0]?.trim();
			const appName =
				rawAppName && /^[\w .&()+'-]{1,64}$/.test(rawAppName) ? rawAppName : null;
			if (!appName) return null;
			await execFileAsync("open", ["-a", appName], { timeout: 2000 });
			try {
				systemPreferences?.isTrustedAccessibilityClient?.(true);
				const { stdout } = await execFileAsync(
					"osascript",
					[
						"-e",
						"on run argv",
						"-e",
						'tell application "System Events" to tell process (item 1 of argv)',
						"-e",
						"repeat with candidate in windows",
						"-e",
						"try",
						"-e",
						'if value of attribute "AXWindowNumber" of candidate is (item 2 of argv) as integer then',
						"-e",
						'perform action "AXRaise" of candidate',
						"-e",
						"set windowPosition to position of candidate",
						"-e",
						"set windowSize to size of candidate",
						"-e",
						'return ((item 1 of windowPosition) as text) & "," & ((item 2 of windowPosition) as text) & "," & ((item 1 of windowSize) as text) & "," & ((item 2 of windowSize) as text)',
						"-e",
						"end if",
						"-e",
						"end try",
						"-e",
						"end repeat",
						"-e",
						"end tell",
						"-e",
						"end run",
						"--",
						appName,
						String(windowId),
					],
					{ timeout: 2000 },
				);
				const [x, y, width, height] = stdout.trim().split(",").map(Number);
				if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
					await new Promise((resolve) => setTimeout(resolve, 250));
					return { x, y, width, height };
				}
			} catch {
				// App activation still works without macOS Accessibility permission.
			}
		} else if (process.platform === "win32") {
			await bringWindowsWindowForward(windowId);
		} else if (process.platform === "linux") {
			await execFileAsync("wmctrl", ["-i", "-a", `0x${windowId.toString(16)}`], {
				timeout: 1500,
			});
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	} catch {
		// Raising the source is best-effort; selection and capture can still continue.
	}
	return null;
}

export function registerSourceHandlers({
	createEditorWindow,
	createSourceSelectorWindow,
	getSourceSelectorWindow,
}: {
	createEditorWindow: () => void;
	createSourceSelectorWindow: () => BrowserWindow;
	getSourceSelectorWindow: () => BrowserWindow | null;
}) {
	ipcMain.handle("get-sources", async (_, opts) => {
		const cacheKey = JSON.stringify({
			types: opts?.types,
			thumbnailSize: opts?.thumbnailSize,
			fetchWindowIcons: opts?.fetchWindowIcons,
		});
		if (
			sourceListCache &&
			sourceListCache.key === cacheKey &&
			sourceListCache.expiresAt > Date.now()
		) {
			return sourceListCache.value;
		}

		const includeScreens = Array.isArray(opts?.types) ? opts.types.includes("screen") : true;
		const includeWindows = Array.isArray(opts?.types) ? opts.types.includes("window") : true;
		const includeWindowIcons = Boolean(opts?.fetchWindowIcons);
		const electronTypes = [
			...(includeScreens ? ["screen" as const] : []),
			...(includeWindows ? ["window" as const] : []),
		];
		const electronSources =
			electronTypes.length > 0
				? await desktopCapturer
						.getSources({
							...opts,
							types: electronTypes,
						})
						.catch((error) => {
							console.warn(
								"desktopCapturer.getSources failed (screen recording permission may be missing):",
								error,
							);
							return [];
						})
				: [];
		const ownWindowNames = new Set(
			[
				app.getName(),
				"Recordly",
				...BrowserWindow.getAllWindows().flatMap((win) => {
					const title = win.getTitle().trim();
					return title ? [title] : [];
				}),
			]
				.map((name) => normalizeDesktopSourceName(name))
				.filter(Boolean),
		);
		const ownAppName = normalizeDesktopSourceName(app.getName());

		const displays = includeScreens
			? [...getScreen().getAllDisplays()].sort(
					(left, right) =>
						left.bounds.x - right.bounds.x ||
						left.bounds.y - right.bounds.y ||
						left.id - right.id,
				)
			: [];
		const primaryDisplayId = includeScreens ? String(getScreen().getPrimaryDisplay().id) : "";
		const electronScreenSourcesByDisplayId = new Map(
			electronSources
				.filter((source) => source.id.startsWith("screen:"))
				.map((source) => [String(source.display_id ?? ""), source] as const),
		);
		// On Linux, desktopCapturer display_id values may not match screen.getAllDisplays() IDs.
		// Keep an ordered list so we can fall back to position-based matching.
		const electronScreenSourcesByIndex = electronSources.filter((source) =>
			source.id.startsWith("screen:"),
		);

		const screenSources = displays.map((display, index) => {
			const displayId = String(display.id);
			const matchedSource =
				electronScreenSourcesByDisplayId.get(displayId) ??
				(electronScreenSourcesByIndex.length === displays.length
					? electronScreenSourcesByIndex[index]
					: undefined);
			const displayName =
				displayId === primaryDisplayId
					? `Screen ${index + 1} (Primary)`
					: `Screen ${index + 1}`;

			return {
				id: getScreenSourceIdForDisplay({
					displayId,
					env: process.env,
					matchedSourceId: matchedSource?.id,
					platform: process.platform,
				}),
				name: displayName,
				originalName: matchedSource?.name ?? displayName,
				display_id: displayId,
				thumbnail: matchedSource?.thumbnail ? matchedSource.thumbnail.toDataURL() : null,
				appIcon: null,
				sourceType: "screen" as const,
			};
		});

		if (process.platform !== "darwin" || !includeWindows) {
			const windowSources = electronSources
				.filter((source) => source.id.startsWith("window:"))
				.filter((source) => {
					const normalizedName = normalizeDesktopSourceName(source.name);
					if (!normalizedName) {
						return true;
					}

					if (ALLOW_RECORDLY_WINDOW_CAPTURE && normalizedName.includes("recordly")) {
						return true;
					}

					for (const ownName of ownWindowNames) {
						if (!ownName) continue;
						if (normalizedName === ownName) {
							return false;
						}
					}

					return true;
				})
				.map((source) => ({
					id: source.id,
					name: source.name,
					originalName: source.name,
					display_id: source.display_id,
					thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
					appIcon:
						includeWindowIcons && source.appIcon ? source.appIcon.toDataURL() : null,
					sourceType: "window" as const,
				}));
			const result = [...screenSources, ...windowSources];
			sourceListCache = {
				key: cacheKey,
				expiresAt: Date.now() + SOURCE_LIST_CACHE_TTL_MS,
				value: result,
			};
			return result;
		}

		try {
			const nativeWindowSources = await getNativeMacWindowSources();
			const electronWindowSourceMap = new Map(
				electronSources
					.filter((source) => source.id.startsWith("window:"))
					.map((source) => [source.id, source] as const),
			);

			const mergedWindowSources = nativeWindowSources
				.filter((source) => {
					const normalizedWindowName = normalizeDesktopSourceName(
						source.windowTitle ?? source.name,
					);
					const normalizedAppName = normalizeDesktopSourceName(source.appName ?? "");

					if (
						!ALLOW_RECORDLY_WINDOW_CAPTURE &&
						normalizedAppName &&
						normalizedAppName === ownAppName
					) {
						return false;
					}

					if (
						ALLOW_RECORDLY_WINDOW_CAPTURE &&
						(normalizedAppName === "recordly" ||
							normalizedWindowName?.includes("recordly"))
					) {
						return true;
					}

					if (!normalizedWindowName) {
						return true;
					}

					for (const ownName of ownWindowNames) {
						if (!ownName) continue;
						if (normalizedWindowName === ownName) {
							return false;
						}
					}

					return true;
				})
				.map((source) => {
					const electronWindowSource = electronWindowSourceMap.get(source.id);
					return {
						id: source.id,
						name: source.name,
						originalName: source.name,
						display_id: source.display_id ?? electronWindowSource?.display_id ?? "",
						thumbnail: electronWindowSource?.thumbnail
							? electronWindowSource.thumbnail.toDataURL()
							: null,
						appIcon: includeWindowIcons
							? (source.appIcon ??
								(electronWindowSource?.appIcon
									? electronWindowSource.appIcon.toDataURL()
									: null))
							: null,
						appName: source.appName,
						windowTitle: source.windowTitle,
						bundleId: source.bundleId,
						sourceType: "window" as const,
					};
				});

			const result = [...screenSources, ...mergedWindowSources];
			sourceListCache = {
				key: cacheKey,
				expiresAt: Date.now() + SOURCE_LIST_CACHE_TTL_MS,
				value: result,
			};
			return result;
		} catch (error) {
			console.warn("Falling back to Electron window enumeration on macOS:", error);

			const windowSources = electronSources
				.filter((source) => source.id.startsWith("window:"))
				.filter((source) => {
					const normalizedName = normalizeDesktopSourceName(source.name);
					if (!normalizedName) {
						return true;
					}

					if (ALLOW_RECORDLY_WINDOW_CAPTURE && normalizedName.includes("recordly")) {
						return true;
					}

					for (const ownName of ownWindowNames) {
						if (!ownName) continue;
						if (
							normalizedName === ownName ||
							normalizedName.includes(ownName) ||
							ownName.includes(normalizedName)
						) {
							return false;
						}
					}

					return true;
				})
				.map((source) => ({
					id: source.id,
					name: source.name,
					originalName: source.name,
					display_id: source.display_id,
					thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
					appIcon:
						includeWindowIcons && source.appIcon ? source.appIcon.toDataURL() : null,
					sourceType: "window" as const,
				}));

			const result = [...screenSources, ...windowSources];
			sourceListCache = {
				key: cacheKey,
				expiresAt: Date.now() + SOURCE_LIST_CACHE_TTL_MS,
				value: result,
			};
			return result;
		}
	});

	ipcMain.handle("select-source", async (_, source: SelectedSource) => {
		if (source.id?.startsWith("window:")) {
			await bringSelectedWindowForward(source);
		}
		setSelectedSource(source);
		broadcastSelectedSourceChange();
		stopWindowBoundsCapture();
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.close();
		}
		app.focus({ steal: true });
		return selectedSource;
	});

	ipcMain.handle("show-source-highlight", async (_, source: SelectedSource) => {
		try {
			const isWindow = source.id?.startsWith("window:");

			// ── 1. Resolve bounds ──
			let bounds: { x: number; y: number; width: number; height: number } | null = null;

			if (source.id?.startsWith("screen:")) {
				bounds =
					process.platform === "darwin"
						? getDisplayWorkAreaForSource(source)
						: getDisplayBoundsForSource(source);
			} else if (isWindow) {
				if (process.platform === "darwin") {
					bounds = await resolveMacWindowBounds(source);
				} else if (process.platform === "win32") {
					bounds = await resolveWindowsWindowBounds(source);
				} else if (process.platform === "linux") {
					bounds = await resolveLinuxWindowBounds(source);
				}
			}

			// A window highlight must never silently become a fullscreen highlight.
			// If HWND bounds cannot be resolved, skip the animation and report the
			// failure so the next selection can retry with the same window source.
			if (isWindow && (!bounds || bounds.width <= 0 || bounds.height <= 0)) {
				console.warn("Unable to resolve selected window bounds for highlight", {
					sourceId: source.id,
					platform: process.platform,
				});
				return { success: false };
			}

			if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
				bounds = getDisplayBoundsForSource(source);
			}

			if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
				const primaryBounds = getScreen().getPrimaryDisplay().bounds;
				if (primaryBounds.width <= 0 || primaryBounds.height <= 0) {
					return { success: false };
				}
				bounds = primaryBounds;
			}

			const resolvedBounds = bounds;

			// ── 2. Show traveling wave highlight ──
			// On macOS, screen highlights use workArea and no outward padding —
			// macOS clamps window positions below the menu bar so outward
			// padding only works on the left/top while right/bottom run off-screen.
			const isScreen = source.id?.startsWith("screen:");
			const isMacScreen = isScreen && process.platform === "darwin";
			const pad = isMacScreen ? 0 : 6;
			const highlightWin = new BrowserWindow({
				x: Math.round(resolvedBounds.x - pad),
				y: Math.round(resolvedBounds.y - pad),
				width: Math.max(1, Math.round(resolvedBounds.width + pad * 2)),
				height: Math.max(1, Math.round(resolvedBounds.height + pad * 2)),
				frame: false,
				transparent: true,
				alwaysOnTop: true,
				skipTaskbar: true,
				hasShadow: false,
				resizable: false,
				focusable: false,
				show: false,
				...(process.platform === "darwin" ? { type: "panel" as const } : {}),
				webPreferences: { nodeIntegration: false, contextIsolation: true },
			});

			highlightWin.setIgnoreMouseEvents(true);
			highlightWin.setAlwaysOnTop(true, "screen-saver");
			if (process.platform === "darwin") {
				highlightWin.setVisibleOnAllWorkspaces(true, {
					visibleOnFullScreen: true,
					skipTransformProcessType: true,
				});
			}

			const borderRadius = isMacScreen ? 0 : 10;
			const glowInset = isMacScreen ? 0 : -4;
			const glowRadius = isMacScreen ? 0 : 14;
			const glowPad = isMacScreen ? 3 : 6;

			const html = `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;overflow:hidden;width:100vw;height:100vh}

.border-wrap{
  position:fixed;inset:0;border-radius:${borderRadius}px;padding:3px;
  background:conic-gradient(from var(--angle,0deg),
    transparent 0%,
    transparent 60%,
    rgba(37,99,235,.15) 70%,
    rgba(37,99,235,.9) 80%,
    rgba(117,166,255,1) 85%,
    rgba(37,99,235,.9) 90%,
    rgba(37,99,235,.15) 95%,
    transparent 100%
  );
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  animation:spin 1.2s linear forwards, fadeAll 1.6s ease-out forwards;
}

.glow-wrap{
  position:fixed;inset:${glowInset}px;border-radius:${glowRadius}px;padding:${glowPad}px;
  background:conic-gradient(from var(--angle,0deg),
    transparent 0%,
    transparent 65%,
    rgba(37,99,235,.3) 78%,
    rgba(117,166,255,.5) 85%,
    rgba(37,99,235,.3) 92%,
    transparent 100%
  );
  -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0);
  -webkit-mask-composite:xor;
  mask-composite:exclude;
  filter:blur(8px);
  animation:spin 1.2s linear forwards, fadeAll 1.6s ease-out forwards;
}

@property --angle{
  syntax:'<angle>';
  initial-value:0deg;
  inherits:false;
}

@keyframes spin{
  0%{--angle:0deg}
  100%{--angle:360deg}
}

@keyframes fadeAll{
  0%,60%{opacity:1}
  100%{opacity:0}
}
</style></head><body>
<div class="glow-wrap"></div>
<div class="border-wrap"></div>
</body></html>`;

			try {
				await highlightWin.loadURL(
					`data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
				);
				highlightWin.showInactive();
			} catch (loadError) {
				if (!highlightWin.isDestroyed()) {
					highlightWin.close();
				}
				throw loadError;
			}

			// The highlight window appearing (even with focusable:false) can corrupt
			// the WS_EX_TRANSPARENT flag on the HUD on Windows 11+, breaking hover
			// detection until the user moves their mouse over the bar again.
			// Re-assert passthrough immediately so click-through is restored at once.
			reassertHudOverlayMousePassthrough();

			const highlightCloseTimer = setTimeout(() => {
				if (!highlightWin.isDestroyed()) highlightWin.close();
			}, 1700);

			highlightWin.on("closed", () => {
				clearTimeout(highlightCloseTimer);
				// Re-assert once more when the window is actually destroyed so the
				// native flag is clean regardless of timing.
				reassertHudOverlayMousePassthrough();
			});

			return { success: true };
		} catch (error) {
			console.error("Failed to show source highlight:", error);
			return { success: false };
		}
	});

	ipcMain.handle("get-selected-source", () => {
		return selectedSource;
	});

	ipcMain.handle("open-source-selector", () => {
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.focus();
			return;
		}
		createSourceSelectorWindow();
	});
	ipcMain.handle("switch-to-editor", () => {
		console.log("[switch-to-editor] Opening editor window");
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin && !sourceSelectorWin.isDestroyed()) {
			sourceSelectorWin.close();
		}
		createEditorWindow();
	});
}
