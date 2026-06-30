import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { app, BrowserWindow, desktopCapturer, ipcMain } from "electron";
import { ALLOW_RECORDLY_WINDOW_CAPTURE } from "../constants";
import { selectedSource, setSelectedSource } from "../state";
import type { SelectedSource } from "../types";
import { getScreen } from "../utils";
import { getDisplayBoundsForSource, getDisplayWorkAreaForSource } from "../recording/ffmpeg";
import { getScreenSourceIdForDisplay } from "./sourceMapping";
import {
	getNativeMacWindowSources,
	resolveMacWindowVisibleBounds,
	resolveWindowsWindowBounds,
	stopWindowBoundsCapture,
} from "../cursor/bounds";
import {
	clearSourceHighlightWindow,
	showSourceHighlightWindow,
} from "../../sourceHighlight";

const execFileAsync = promisify(execFile);
const SOURCE_LIST_CACHE_TTL_MS = 1200;
let sourceListCache:
	| {
			key: string;
			expiresAt: number;
			value: Array<Record<string, unknown>>;
	  }
	| null = null;

type SourceHighlightIpcOptions = {
	activateWindow?: boolean;
};

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function intersectBounds(
	first: { x: number; y: number; width: number; height: number },
	second: { x: number; y: number; width: number; height: number },
) {
	const x = Math.max(first.x, second.x);
	const y = Math.max(first.y, second.y);
	const right = Math.min(first.x + first.width, second.x + second.width);
	const bottom = Math.min(first.y + first.height, second.y + second.height);
	const width = right - x;
	const height = bottom - y;

	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function getVisibleWindowHighlightBounds(bounds: {
	x: number;
	y: number;
	width: number;
	height: number;
}) {
	const intersections = getScreen()
		.getAllDisplays()
		.map((display) => intersectBounds(bounds, display.bounds))
		.filter((candidate): candidate is typeof bounds => candidate !== null)
		.sort((left, right) => right.width * right.height - left.width * left.height);

	return intersections[0] ?? null;
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
		const cacheKey = JSON.stringify({
			types: opts?.types,
			thumbnailSize: opts?.thumbnailSize,
			fetchWindowIcons: opts?.fetchWindowIcons,
		});
		if (sourceListCache && sourceListCache.key === cacheKey && sourceListCache.expiresAt > Date.now()) {
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
						appIcon:
							includeWindowIcons
								? (source.appIcon ??
									(electronWindowSource?.appIcon
										? electronWindowSource.appIcon.toDataURL()
										: null))
								: null,
						appName: source.appName,
						windowTitle: source.windowTitle,
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

	ipcMain.handle(
		"show-source-highlight",
		async (_, source: SelectedSource, options?: SourceHighlightIpcOptions) => {
			try {
				const isWindow = source.id?.startsWith("window:");
				const shouldActivateWindow = options?.activateWindow !== false;

				if (process.platform === "linux") {
					clearSourceHighlightWindow();
					return { success: false };
				}

				// ── 1. Bring window to front ──
				if (shouldActivateWindow && isWindow && process.platform === "darwin") {
					const rawAppName = source.appName || source.name?.split(" — ")[0]?.trim();
					const appName =
						rawAppName && /^[\w .&()+'-]{1,64}$/.test(rawAppName)
							? rawAppName
							: null;
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
				}

				// ── 2. Resolve bounds ──
				let bounds: { x: number; y: number; width: number; height: number } | null =
					null;

				if (source.id?.startsWith("screen:")) {
					bounds =
						process.platform === "darwin"
							? getDisplayWorkAreaForSource(source)
							: getDisplayBoundsForSource(source);
				} else if (isWindow) {
					if (process.platform === "darwin") {
						bounds = await resolveMacWindowVisibleBounds(source);
					} else if (process.platform === "win32") {
						bounds = await resolveWindowsWindowBounds(source);
					}
				}

				if (isWindow) {
					if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
						clearSourceHighlightWindow();
						return { success: false };
					}
					const visibleBounds = getVisibleWindowHighlightBounds(bounds);
					if (!visibleBounds) {
						clearSourceHighlightWindow();
						return { success: false };
					}
					bounds = visibleBounds;
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

				const isScreen = source.id?.startsWith("screen:");
				const isMacScreen = isScreen && process.platform === "darwin";
				const success = await showSourceHighlightWindow(bounds, { isMacScreen });

				return { success };
			} catch (error) {
				console.error("Failed to show source highlight:", error);
				return { success: false };
			}
		},
	);

	ipcMain.handle("clear-source-highlight", () => {
		clearSourceHighlightWindow();
		return { success: true };
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
