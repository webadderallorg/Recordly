import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, desktopCapturer, ipcMain } from "electron";
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../constants";
import { selectedSource, setSelectedSource } from "../state";
import type { SelectedSource } from "../types";
import { getScreen, parseWindowId } from "../utils";
import { getDisplayBoundsForSource, getDisplayWorkAreaForSource } from "../recording/ffmpeg";
import {
	getNativeMacWindowSources,
	resolveMacWindowBounds,
	resolveWindowsWindowBounds,
	resolveLinuxWindowBounds,
	stopWindowBoundsCapture,
} from "../cursor/bounds";

const execFileAsync = promisify(execFile);

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
		const includeScreens = Array.isArray(opts?.types) ? opts.types.includes("screen") : true;
		const includeWindows = Array.isArray(opts?.types) ? opts.types.includes("window") : true;
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
				id: matchedSource?.id ?? `screen:fallback:${displayId}`,
				name: displayName,
				originalName: matchedSource?.name ?? displayName,
				display_id: displayId,
				thumbnail: matchedSource?.thumbnail ? matchedSource.thumbnail.toDataURL() : null,
				appIcon: matchedSource?.appIcon ? matchedSource.appIcon.toDataURL() : null,
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
					appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
					sourceType: "window" as const,
				}));

			return [...screenSources, ...windowSources];
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
						appIcon:
							source.appIcon ??
							(electronWindowSource?.appIcon
								? electronWindowSource.appIcon.toDataURL()
								: null),
						appName: source.appName,
						windowTitle: source.windowTitle,
						sourceType: "window" as const,
					};
				});

			return [...screenSources, ...mergedWindowSources];
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
					appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
					sourceType: "window" as const,
				}));

			return [...screenSources, ...windowSources];
		}
	});

	ipcMain.handle("select-source", (_, source: SelectedSource) => {
		setSelectedSource(source);
		broadcastSelectedSourceChange();
		stopWindowBoundsCapture();
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.close();
		}
		return selectedSource;
	});

	ipcMain.handle("show-source-highlight", async (_, source: SelectedSource) => {
		try {
			const isWindow = source.id?.startsWith("window:");
			const windowId = isWindow ? parseWindowId(source.id) : null;

			// ── 1. Bring window to front ──
			if (isWindow && process.platform === "darwin") {
				const rawAppName = source.appName || source.name?.split(" — ")[0]?.trim();
				const appName =
					rawAppName && /^[\w .&()+'-]{1,64}$/.test(rawAppName) ? rawAppName : null;
				if (appName) {
					try {
						await execFileAsync(
							"osascript",
							[
								"-e",
								"on run argv",
								"-e",
								"tell application (item 1 of argv) to activate",
								"-e",
								"end run",
								"--",
								appName,
							],
							{ timeout: 2000 },
						);
						await new Promise((resolve) => setTimeout(resolve, 350));
					} catch {
						/* ignore */
					}
				}
			} else if (windowId && process.platform === "linux") {
				try {
					await execFileAsync("wmctrl", ["-i", "-a", `0x${windowId.toString(16)}`], {
						timeout: 1500,
					});
				} catch {
					try {
						await execFileAsync("xdotool", ["windowactivate", String(windowId)], {
							timeout: 1500,
						});
					} catch {
						/* not available */
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}

			// ── 2. Resolve bounds ──
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

			// ── 3. Show traveling wave highlight ──
			// On macOS, screen highlights use workArea and no outward padding —
			// macOS clamps window positions below the menu bar so outward
			// padding only works on the left/top while right/bottom run off-screen.
			const isScreen = source.id?.startsWith("screen:");
			const isMacScreen = isScreen && process.platform === "darwin";
			const pad = isMacScreen ? 0 : 6;
			const highlightWin = new BrowserWindow({
				x: resolvedBounds.x - pad,
				y: resolvedBounds.y - pad,
				width: resolvedBounds.width + pad * 2,
				height: resolvedBounds.height + pad * 2,
				frame: false,
				transparent: true,
				alwaysOnTop: true,
				skipTaskbar: true,
				hasShadow: false,
				resizable: false,
				focusable: false,
				webPreferences: { nodeIntegration: false, contextIsolation: true },
			});

			highlightWin.setIgnoreMouseEvents(true);

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
    rgba(99,96,245,.15) 70%,
    rgba(99,96,245,.9) 80%,
    rgba(123,120,255,1) 85%,
    rgba(99,96,245,.9) 90%,
    rgba(99,96,245,.15) 95%,
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
    rgba(99,96,245,.3) 78%,
    rgba(123,120,255,.5) 85%,
    rgba(99,96,245,.3) 92%,
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
</body></html>`

			try {
				await highlightWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
			} catch (loadError) {
				if (!highlightWin.isDestroyed()) {
					highlightWin.close()
				}
				throw loadError
			}

      setTimeout(() => {
        if (!highlightWin.isDestroyed()) highlightWin.close()
      }, 1700)

      return { success: true }
    } catch (error) {
      console.error('Failed to show source highlight:', error)
      return { success: false }
    }
  })

  ipcMain.handle('get-selected-source', () => {
    return selectedSource
  })

  ipcMain.handle('open-source-selector', () => {
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.focus()
      return
    }
    createSourceSelectorWindow()
  })
  ipcMain.handle('switch-to-editor', () => {
    console.log('[switch-to-editor] Opening editor window')
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin && !sourceSelectorWin.isDestroyed()) {
      sourceSelectorWin.close()
    }
    createEditorWindow()
  })

}
