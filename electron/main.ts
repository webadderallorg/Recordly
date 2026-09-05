import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	webContents as electronWebContents,
	ipcMain,
	Menu,
	nativeImage,
	session,
	shell,
	systemPreferences,
	Tray,
} from "electron";
import { RECORDINGS_DIR } from "./appPaths";
import { showCursor } from "./cursorHider";
import { getGpuSwitches, getLinuxOzonePlatformOverride } from "./gpuSwitches";
import {
	cleanupAllExportStreams,
	cleanupNativeVideoExportSessions,
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import { ensureMediaServer } from "./mediaServer";
import { hardenWebContentsNavigation, shouldHardenWebContentsType } from "./navigationPolicy";
import { shouldGrantDisplayCapture, shouldGrantMediaPermission } from "./permissionPolicy";
import { ensurePackagedRendererServer, getPackagedRendererBaseUrl } from "./rendererServer";
import {
	checkForAppUpdates,
	deferUpdateReminder,
	dismissUpdateToast,
	downloadAvailableUpdate,
	getCurrentUpdateToastPayload,
	getExperimentalUpdatesEnabled,
	getUpdaterLogPath,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	previewNativeUpdateDialog,
	previewUpdateToast,
	setExperimentalUpdatesEnabled,
	setupAutoUpdates,
	skipAvailableUpdateVersion,
} from "./updater";
import {
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	getHudOverlayWindow,
	getUpdateToastWindow,
	hideUpdateToastWindow,
	isHudOverlayMousePassthroughSupported,
	reassertHudOverlayCaptureProtection,
	reassertHudOverlayMousePassthrough as reassertHudOverlayMouseState,
	setHudOverlayRecordingActive,
	showUpdateToastWindow,
} from "./windows";

const electronMainDir = path.dirname(fileURLToPath(import.meta.url));
const IS_SMOKE_EXPORT = process.env.RECORDLY_SMOKE_EXPORT === "1";

function ignoreBrokenConsolePipe(stream: NodeJS.WritableStream | undefined) {
	stream?.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EPIPE" || error.code === "EIO") {
			return;
		}
		throw error;
	});
}

ignoreBrokenConsolePipe(process.stdout);
ignoreBrokenConsolePipe(process.stderr);

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("enable-gpu-rasterization");

app.on("web-contents-created", (_event, contents) => {
	if (!shouldHardenWebContentsType(contents.getType())) {
		return;
	}

	hardenWebContentsNavigation(contents, (url) => shell.openExternal(url));
});

function configureGpuAccelerationSwitches() {
	if (process.platform === "linux" && !app.commandLine.hasSwitch("ozone-platform")) {
		const ozonePlatform = getLinuxOzonePlatformOverride(process.env);
		if (ozonePlatform) {
			app.commandLine.appendSwitch("ozone-platform", ozonePlatform);
		}
	}

	const { useAngle, useGl, disableFeatures } = getGpuSwitches(process.platform, process.env);
	if (useAngle) {
		app.commandLine.appendSwitch("use-angle", useAngle);
	}
	if (useGl) {
		app.commandLine.appendSwitch("use-gl", useGl);
	}
	if (disableFeatures && disableFeatures.length > 0) {
		app.commandLine.appendSwitch("disable-features", disableFeatures.join(","));
	}
}

async function logSmokeExportGpuDiagnostics() {
	if (!IS_SMOKE_EXPORT) {
		return;
	}

	try {
		console.log("[smoke-export] GPU feature status", JSON.stringify(app.getGPUFeatureStatus()));
		console.log("[smoke-export] GPU info", JSON.stringify(await app.getGPUInfo("basic")));
	} catch (error) {
		console.warn("[smoke-export] Failed to read GPU diagnostics:", error);
	}
}

configureGpuAccelerationSwitches();

async function ensureRecordingsDir() {
	try {
		await fs.mkdir(RECORDINGS_DIR, { recursive: true });
		console.log("RECORDINGS_DIR:", RECORDINGS_DIR);
		console.log("User Data Path:", app.getPath("userData"));
	} catch (error) {
		console.error("Failed to create recordings directory:", error);
	}
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(electronMainDir, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
const IS_DEV = Boolean(VITE_DEV_SERVER_URL);

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

function getTrustedCaptureDocumentBaseUrls(): string[] {
	const trustedUrls = [pathToFileURL(path.join(RENDERER_DIST, "index.html")).href];

	if (VITE_DEV_SERVER_URL) {
		trustedUrls.push(VITE_DEV_SERVER_URL);
	}

	const packagedRendererBaseUrl = getPackagedRendererBaseUrl();
	if (packagedRendererBaseUrl) {
		trustedUrls.push(new URL("/", packagedRendererBaseUrl).href);
	}

	return trustedUrls;
}

function isHudWebContents(webContents: Electron.WebContents | null): boolean {
	if (!webContents || webContents.isDestroyed()) {
		return false;
	}

	const hudWindow = getHudOverlayWindow();
	return Boolean(hudWindow && hudWindow.webContents === webContents);
}

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayContextMenu: Menu | null = null;
let selectedSourceName = "";
let editorHasUnsavedChanges = false;
let isForceClosing = false;
let isAppQuitting = false;
let isCreatingMainWindow = false;
let isCreatingEditorWindow = false;
const shouldEnforceSingleInstanceLock = !IS_DEV;
const hasSingleInstanceLock = shouldEnforceSingleInstanceLock
	? app.requestSingleInstanceLock()
	: true;

if (!hasSingleInstanceLock) {
	app.quit();
}

function closeEditorWindowBypassingUnsavedPrompt(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (isEditorWindow(window)) {
		isForceClosing = true;
		editorHasUnsavedChanges = false;
	}
	window.close();
}

function closeEditorWindowToHud(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	// The HUD renderer normally remains hidden while the editor is open so
	// recording finalization can continue. Restore that HUD before destroying
	// the editor, keeping Recordly in its ready-to-record state on the taskbar.
	window.hide();
	if (mainWindow === window) {
		mainWindow = null;
	}
	createWindow();
	closeEditorWindowBypassingUnsavedPrompt(window);
}

function restoreWindowSafely(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (!isEditorWindow(window) && process.platform === "win32") {
		showHudOverlayFromTray();
		return;
	}

	if (window.isMinimized()) {
		window.restore();
	}

	if (!window.isVisible()) {
		window.show();
	}

	window.moveTop();
	window.focus();
}

function getExistingEditorWindow(): BrowserWindow | null {
	return (
		BrowserWindow.getAllWindows().find(
			(window) => !window.isDestroyed() && isEditorWindow(window),
		) ?? null
	);
}

// Tray Icons (lazily created after app is ready to avoid accessing Electron APIs too early)
let defaultTrayIcon: ReturnType<typeof getTrayIcon> | null = null;
let recordingTrayIcon: ReturnType<typeof getTrayIcon> | null = null;

function getPlatformAppIconFilename(size: 32 | 128 | 512) {
	const baseName = process.platform === "darwin" ? "recordlymac" : "recordly";
	return `app-icons/${baseName}-${size}.png`;
}

function getDefaultTrayIcon() {
	if (!defaultTrayIcon) {
		defaultTrayIcon = getTrayIcon(getPlatformAppIconFilename(32));
	}
	return defaultTrayIcon;
}

function getRecordingTrayIcon() {
	if (!recordingTrayIcon) {
		recordingTrayIcon = getTrayIcon("rec-button.png");
	}
	return recordingTrayIcon;
}

function showHudOverlayFromTray() {
	const updateToast = getUpdateToastWindow();
	if (updateToast?.isVisible()) {
		updateToast.show();
		updateToast.moveTop();
		updateToast.focus();
		return true;
	}

	const hud = getHudOverlayWindow();
	if (!hud) {
		return false;
	}

	if (hud.isMinimized()) {
		hud.restore();
	}

	if (process.platform === "win32" && isHudOverlayMousePassthroughSupported()) {
		hud.showInactive();
		hud.moveTop();
		reassertHudOverlayMouseState();
		return true;
	}

	hud.show();
	hud.moveTop();
	hud.focus();
	return true;
}

ipcMain.on("set-has-unsaved-changes", (_event, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function createWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			if (!mainWindow || mainWindow.isDestroyed()) {
				createWindow();
			}
		});
		return;
	}

	if (isCreatingMainWindow) {
		return;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		restoreWindowSafely(mainWindow);
		return;
	}

	const existingHudWindow = getHudOverlayWindow();
	if (existingHudWindow) {
		mainWindow = existingHudWindow;
		restoreWindowSafely(existingHudWindow);
		return;
	}

	isCreatingMainWindow = true;
	const createdHudWindow = createHudOverlayWindow();
	mainWindow = createdHudWindow;
	createdHudWindow.once("closed", () => {
		if (mainWindow === createdHudWindow) {
			mainWindow = null;
		}
	});
	isCreatingMainWindow = false;
}

function focusOrCreateMainWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			focusOrCreateMainWindow();
		});
		return;
	}

	const updateToast = getUpdateToastWindow();
	if (updateToast?.isVisible()) {
		updateToast.show();
		updateToast.moveTop();
		updateToast.focus();
		return;
	}

	if (!mainWindow || mainWindow.isDestroyed()) {
		const existingHud = getHudOverlayWindow();
		if (existingHud && !existingHud.isDestroyed()) {
			mainWindow = existingHud;
		} else {
			createWindow();
			return;
		}
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		// On Linux/Wayland, focus() often doesn't take effect (compositor ignores it). Apps like Telegram
		// work because they receive an XDG activation token via StatusNotifierItem.ProvideXdgActivationToken;
		// Electron's tray doesn't handle that yet. Workaround: destroy and recreate the HUD so the new
		// window gets focus (creation path works). Only for HUD, not editor.
		if (
			process.platform === "linux" &&
			!mainWindow.isFocused() &&
			!isEditorWindow(mainWindow)
		) {
			const win = mainWindow;
			mainWindow = null;
			win.once("closed", () => createWindow());
			win.destroy();
			return;
		}

		// On Win32 with mouse passthrough enabled (Win11+), calling
		// show/moveTop/focus on the transparent HUD overlay permanently corrupts
		// setIgnoreMouseEvents forwarding, making it click-through.  Only focus
		// the editor window; the HUD is alwaysOnTop so it doesn't need explicit
		// focus.  On Win10 (passthrough disabled), the HUD is always interactive
		// and can be safely shown/restored.
		if (
			process.platform === "win32" &&
			!isEditorWindow(mainWindow) &&
			isHudOverlayMousePassthroughSupported()
		) {
			showHudOverlayFromTray();
			return;
		}

		mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.moveTop();
		mainWindow.focus();
	}
}

function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];
	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		});
	}

	template.push(
		{
			label: "File",
			submenu: [
				{
					label: "Open Projects…",
					accelerator: "CmdOrCtrl+O",
					click: () => sendEditorMenuAction("menu-load-project"),
				},
				{
					label: "Save Project…",
					accelerator: "CmdOrCtrl+S",
					click: () => sendEditorMenuAction("menu-save-project"),
				},
				{
					label: "Save Project As…",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => sendEditorMenuAction("menu-save-project-as"),
				},
				...(isMac
					? []
					: [
							{ type: "separator" as const },
							{ role: "quit" as const, accelerator: "CmdOrCtrl+Q" },
						]),
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: isMac
				? [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }]
				: [{ role: "minimize" }, { role: "close" }],
		},
		{
			label: "Help",
			submenu: [
				{
					label: "Check for Updates…",
					click: () => {
						void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
					},
				},
			],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function isPrimaryTrayClick(event: unknown) {
	const button =
		event && typeof event === "object" && "button" in event
			? (event as { button?: number | string }).button
			: undefined;
	return button === undefined || button === 0 || button === "left";
}

function createTray() {
	tray = new Tray(getDefaultTrayIcon());
	tray.on("click", (event) => {
		if (process.platform === "win32" && !isPrimaryTrayClick(event)) {
			return;
		}

		focusOrCreateMainWindow();
	});

	if (process.platform === "win32") {
		tray.on("right-click", () => {
			if (!tray || !trayContextMenu) {
				return;
			}

			tray.popUpContextMenu(trayContextMenu);
		});
		return;
	}

	tray.on("double-click", () => focusOrCreateMainWindow());
}

function shouldUseTray() {
	// macOS and Windows expose Recordly through their Dock/taskbar. Keep the
	// tray entry only on Linux, where it remains the primary app entry point.
	return process.platform === "linux";
}

function getPublicAssetPath(filename: string) {
	return path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename);
}

function getAppImage(filename: string) {
	return nativeImage.createFromPath(getPublicAssetPath(filename));
}

function getTrayIcon(filename: string) {
	return getAppImage(filename).resize({
		width: 24,
		height: 24,
		quality: "best",
	});
}

function syncDockIcon() {
	if (process.platform !== "darwin" || !app.dock) {
		return;
	}

	const dockIcon = getAppImage(getPlatformAppIconFilename(512));
	if (!dockIcon.isEmpty()) {
		app.dock.setIcon(dockIcon);
	}
}

function sendUpdateToastToWindows(channel: "update-toast-state", payload: unknown) {
	if (process.platform !== "darwin") {
		return false;
	}

	if (!payload) {
		const existingWindow = getUpdateToastWindow();
		if (existingWindow) {
			existingWindow.webContents.send(channel, null);
		}
		hideUpdateToastWindow();
		return true;
	}

	const toastWindow = showUpdateToastWindow();
	const sendPayload = () => {
		toastWindow.webContents.send(channel, payload);
		showUpdateToastWindow();
	};

	if (toastWindow.webContents.isLoadingMainFrame()) {
		toastWindow.webContents.once("did-finish-load", sendPayload);
	} else {
		sendPayload();
	}

	return true;
}

function getUpdateDialogWindow() {
	const focusedWindow = BrowserWindow.getFocusedWindow();
	if (focusedWindow && !focusedWindow.isDestroyed()) {
		return focusedWindow;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		return mainWindow;
	}

	return getHudOverlayWindow();
}

ipcMain.handle("install-downloaded-update", () => {
	installDownloadedUpdateNow(sendUpdateToastToWindows);
	return { success: true };
});

ipcMain.handle("download-available-update", (_event, installAfterDownload?: boolean) => {
	return downloadAvailableUpdate(sendUpdateToastToWindows, {
		installAfterDownload: Boolean(installAfterDownload),
	});
});

ipcMain.handle("defer-downloaded-update", (_event, delayMs?: number) => {
	return deferUpdateReminder(getUpdateDialogWindow, sendUpdateToastToWindows, delayMs);
});

ipcMain.handle("dismiss-update-toast", () => {
	return dismissUpdateToast(getUpdateDialogWindow, sendUpdateToastToWindows);
});

ipcMain.handle("skip-update-version", () => {
	return skipAvailableUpdateVersion(sendUpdateToastToWindows);
});

ipcMain.handle("get-current-update-toast-payload", () => {
	return getCurrentUpdateToastPayload();
});

ipcMain.handle("get-update-status-summary", () => {
	return getUpdateStatusSummary();
});

ipcMain.handle("get-experimental-updates-enabled", () => {
	return getExperimentalUpdatesEnabled();
});

ipcMain.handle("set-experimental-updates-enabled", async (_event, enabled: unknown) => {
	if (typeof enabled !== "boolean") {
		return { success: false, enabled: getExperimentalUpdatesEnabled() };
	}

	try {
		const savedValue = setExperimentalUpdatesEnabled(enabled);
		await checkForAppUpdates(getUpdateDialogWindow);
		return { success: true, enabled: savedValue };
	} catch (error) {
		console.error("Failed to update experimental updates preference:", error);
		return {
			success: false,
			enabled: getExperimentalUpdatesEnabled(),
			error: String(error),
		};
	}
});

ipcMain.handle("preview-update-toast", async () => {
	if (process.platform !== "darwin") {
		await previewNativeUpdateDialog(getUpdateDialogWindow);
		return { success: true };
	}

	return { success: previewUpdateToast(sendUpdateToastToWindows) };
});

ipcMain.handle("check-for-app-updates", async () => {
	await checkForAppUpdates(getUpdateDialogWindow, { manual: true });
	return { success: true, logPath: getUpdaterLogPath() };
});

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? getRecordingTrayIcon() : getDefaultTrayIcon();
	const trayToolTip = recording ? `Recording: ${selectedSourceName}` : "Recordly";
	const menuTemplate = recording
		? [
				{
					label: "Show Controls",
					click: () => {
						if (!showHudOverlayFromTray()) {
							focusOrCreateMainWindow();
						}
					},
				},
				{
					label: "Stop Recording",
					click: () => {
						if (mainWindow && !mainWindow.isDestroyed()) {
							mainWindow.webContents.send("stop-recording-from-tray");
						}
					},
				},
			]
		: [
				{
					label: "Open",
					click: () => {
						if (!showHudOverlayFromTray()) {
							focusOrCreateMainWindow();
						}
					},
				},
				{
					label: "Quit",
					click: () => {
						app.quit();
					},
				},
			];
	const menu = Menu.buildFromTemplate(menuTemplate);
	trayContextMenu = menu;
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	if (process.platform !== "win32") {
		tray.setContextMenu(menu);
	}
}

function createEditorWindowWrapper() {
	const existingEditorWindow = getExistingEditorWindow();
	if (existingEditorWindow) {
		mainWindow = existingEditorWindow;
		restoreWindowSafely(existingEditorWindow);
		return existingEditorWindow;
	}

	if (isCreatingEditorWindow) {
		const currentWindow = mainWindow;
		if (currentWindow && !currentWindow.isDestroyed()) {
			return currentWindow;
		}

		const currentEditorWindow = getExistingEditorWindow();
		if (currentEditorWindow) {
			mainWindow = currentEditorWindow;
			return currentEditorWindow;
		}
	}

	isCreatingEditorWindow = true;
	const previousWindow = mainWindow;
	if (previousWindow && !previousWindow.isDestroyed()) {
		const closingEditorWindow = isEditorWindow(previousWindow);

		if (closingEditorWindow) {
			closeEditorWindowBypassingUnsavedPrompt(previousWindow);
		} else {
			// It's the HUD or another window. Hide it instead of closing so background
			// tasks (like webcam finalizing) can finish in its renderer process.
			previousWindow.hide();
		}

		if (!closingEditorWindow) {
			isForceClosing = false;
		}
		if (mainWindow === previousWindow) {
			mainWindow = null;
		}
	}
	const editorWindow = createEditorWindow();
	mainWindow = editorWindow;
	editorHasUnsavedChanges = false;

	editorWindow.on("closed", () => {
		if (mainWindow === editorWindow) {
			mainWindow = null;
		}
		isCreatingEditorWindow = false;
		isForceClosing = false;
		editorHasUnsavedChanges = false;
	});

	editorWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) {
			if (process.platform === "win32" && !isForceClosing && !isAppQuitting) {
				event.preventDefault();
				closeEditorWindowToHud(editorWindow);
			}
			return;
		}

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(editorWindow, {
			type: "warning",
			buttons: ["Save & Close", "Discard & Close", "Cancel"],
			defaultId: 0,
			cancelId: 2,
			title: "Unsaved Changes",
			message: "You have unsaved changes.",
			detail: "Do you want to save your project before closing?",
		});

		if (choice === 0) {
			editorWindow.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_event, saved: boolean) => {
				if (!saved) {
					isAppQuitting = false;
					return;
				}

				if (process.platform === "win32" && !isAppQuitting) {
					closeEditorWindowToHud(editorWindow);
				} else {
					closeEditorWindowBypassingUnsavedPrompt(editorWindow);
				}
			});
		} else if (choice === 1) {
			if (process.platform === "win32" && !isAppQuitting) {
				closeEditorWindowToHud(editorWindow);
			} else {
				closeEditorWindowBypassingUnsavedPrompt(editorWindow);
			}
		} else {
			isAppQuitting = false;
		}
	});

	return editorWindow;
}

function createSourceSelectorWindowWrapper() {
	sourceSelectorWindow = createSourceSelectorWindow();
	sourceSelectorWindow.on("closed", () => {
		sourceSelectorWindow = null;
	});
	return sourceSelectorWindow;
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on("before-quit", () => {
	isAppQuitting = true;
	killWindowsCaptureProcess();
	showCursor();
	cleanupNativeVideoExportSessions();
	void cleanupAllExportStreams();
});

app.on("window-all-closed", () => {
	if (IS_SMOKE_EXPORT || process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	// On OS X it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	focusOrCreateMainWindow();
});

app.on("second-instance", () => {
	focusOrCreateMainWindow();
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	if (process.platform === "win32") {
		app.setAppUserModelId("dev.recordly.app");
	}

	session.defaultSession.setPermissionCheckHandler(
		(webContents, permission, requestingOrigin, details) => {
			return shouldGrantMediaPermission(
				{
					permission,
					isTrustedCaptureWindow: isHudWebContents(webContents),
					isMainFrame: details.isMainFrame,
					currentDocumentUrl: webContents?.getURL() ?? "",
					// Electron 39 may supply the last committed document URL, including its
					// query, in the requestingOrigin argument for media checks.
					requestingUrl: details.requestingUrl ?? requestingOrigin,
					securityOrigins:
						details.securityOrigin === undefined ? [] : [details.securityOrigin],
				},
				getTrustedCaptureDocumentBaseUrls(),
			);
		},
	);

	session.defaultSession.setPermissionRequestHandler(
		(webContents, permission, callback, details) => {
			const securityOrigin = "securityOrigin" in details ? details.securityOrigin : undefined;

			callback(
				shouldGrantMediaPermission(
					{
						permission,
						isTrustedCaptureWindow: isHudWebContents(webContents),
						isMainFrame: details.isMainFrame,
						currentDocumentUrl: webContents.getURL(),
						requestingUrl: details.requestingUrl,
						securityOrigins: securityOrigin === undefined ? [] : [securityOrigin],
					},
					getTrustedCaptureDocumentBaseUrls(),
				),
			);
		},
	);

	// Recordly does not use WebHID, Web Serial, or WebUSB. Do not grant devices by default.
	session.defaultSession.setDevicePermissionHandler(() => false);

	// macOS prompts for camera and microphone access at the point of use. Asking
	// here blocks the first window behind two modal OS permission flows and makes
	// a fresh install look hung. Windows has no equivalent request API, so retain
	// its diagnostic warnings.
	if (process.platform === "win32") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (cameraStatus !== "granted") {
			console.warn(
				`[permissions] Camera access is "${cameraStatus}" — webcam may not work. Check Windows Settings > Privacy > Camera.`,
			);
		}
		if (micStatus !== "granted") {
			console.warn(
				`[permissions] Microphone access is "${micStatus}" — mic recording may not work. Check Windows Settings > Privacy > Microphone.`,
			);
		}
	}

	ipcMain.on("hud-overlay-close", () => {
		const hud = getHudOverlayWindow();
		if (hud) {
			console.log("[main] Closing HUD window via hud-overlay-close");
			hud.close();
		}

		// If this was the last window (or we are in a state where we should quit), do it.
		// We use a small delay to allow window.close() to propagate.
		setTimeout(() => {
			const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
			if (windows.length === 0) {
				console.log("[main] No windows left, quitting app");
				app.quit();
			}
		}, 100);
	});
	if (process.platform === "darwin" && app.dock) {
		await app.dock.show();
	}
	syncDockIcon();
	if (shouldUseTray()) {
		createTray();
		updateTrayMenu();
	}
	setupApplicationMenu();
	await Promise.all([
		ensureRecordingsDir(),
		!VITE_DEV_SERVER_URL
			? ensurePackagedRendererServer(RENDERER_DIST).catch((error) => {
					console.warn(
						"[renderer-server] Failed to start packaged renderer server:",
						error,
					);
				})
			: Promise.resolve(),
		ensureMediaServer().catch((error) => {
			console.warn("[media-server] Failed to start media server:", error);
		}),
	]);

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			setHudOverlayRecordingActive(recording);
			if (shouldUseTray()) {
				if (!tray) createTray();
				updateTrayMenu(recording);
			}
			if (recording) {
				reassertHudOverlayMouseState();
			}
			if (!recording) {
				restoreWindowSafely(mainWindow);
			}
		},
	);

	if (IS_SMOKE_EXPORT || process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT) {
		await logSmokeExportGpuDiagnostics();
		if (IS_SMOKE_EXPORT) {
			const smokeSource =
				process.env.RECORDLY_SMOKE_EXPORT_PROJECT ??
				process.env.RECORDLY_SMOKE_EXPORT_INPUT ??
				"<missing input>";
			console.log(`[smoke-export] Starting editor smoke export for ${smokeSource}`);
		} else {
			console.log(
				`[dev-open-recording] Starting editor for ${process.env.RECORDLY_DEV_OPEN_RECORDING_INPUT}`,
			);
		}
		createEditorWindowWrapper();
		return;
	}

	createWindow();
	setupAutoUpdates(getUpdateDialogWindow, sendUpdateToastToWindows);
	if (IS_DEV && process.env.RECORDLY_DEV_PREVIEW_UPDATE === "1") {
		setTimeout(() => {
			if (process.platform === "darwin") {
				previewUpdateToast(sendUpdateToastToWindows);
				return;
			}

			void previewNativeUpdateDialog(getUpdateDialogWindow);
		}, 750);
	}

	// Register the display media handler so that renderer's getDisplayMedia()
	// calls land on the pre-selected source without showing a system picker.
	//
	// IMPORTANT: The callback must receive a plain { id, name } Video object.
	// Passing the full DesktopCapturerSource (with thumbnail, appIcon, etc.)
	// via an unsafe cast breaks Electron's internal cursor-constraint
	// propagation and causes cursor: 'never' from the renderer to be silently
	// ignored by the native capture pipeline.
	session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
		try {
			const frame = request.frame;
			const isLiveFrame = Boolean(frame && !frame.isDestroyed());
			const requestingWebContents =
				isLiveFrame && frame ? electronWebContents.fromFrame(frame) : undefined;
			const isHudMainFrame = Boolean(
				isLiveFrame &&
					requestingWebContents &&
					isHudWebContents(requestingWebContents) &&
					frame === requestingWebContents.mainFrame,
			);

			if (
				!shouldGrantDisplayCapture(
					{
						isTrustedCaptureWindow: isHudMainFrame,
						isMainFrame: Boolean(isLiveFrame && frame?.parent === null),
						currentDocumentUrl: isLiveFrame ? (frame?.url ?? "") : "",
						securityOrigin: request.securityOrigin,
						videoRequested: request.videoRequested,
					},
					getTrustedCaptureDocumentBaseUrls(),
				)
			) {
				callback({});
				return;
			}

			// Browser and Linux portal capture starts as soon as this callback
			// resolves, before recording-state-changed is emitted.
			reassertHudOverlayCaptureProtection();

			const sourceId = getSelectedSourceId();
			// On Linux/Wayland, calling desktopCapturer.getSources() itself
			// invokes the xdg-desktop-portal picker. If we then return one of
			// those sources, Chromium triggers a SECOND portal because the
			// pre-enumerated source IDs are stale on Wayland. To collapse this
			// into a single portal invocation, when the Linux portal sentinel
			// is set we skip getSources entirely and hand back a synthetic
			// source id; Chromium then opens the portal once to actually
			// resolve the capture.
			// Default to the sentinel on Linux when no source has been
			// pre-selected (e.g. fresh session where the renderer skipped the
			// source picker entirely). This avoids calling getSources() which
			// would itself trigger an extra portal dialog.
			const isLinuxPortalSentinel =
				process.platform === "linux" && (sourceId === "screen:linux-portal" || !sourceId);
			if (isLinuxPortalSentinel) {
				callback({ video: { id: "screen:0:0", name: "Entire screen" } });
				return;
			}
			const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
			const source = sourceId
				? (sources.find((s) => s.id === sourceId) ?? sources[0])
				: sources[0];
			if (source) {
				callback({
					video: { id: source.id, name: source.name },
				});
			} else {
				callback({});
			}
		} catch (error) {
			console.error("setDisplayMediaRequestHandler error:", error);
			callback({});
		}
	});

	const currentToastPayload = getCurrentUpdateToastPayload();
	if (currentToastPayload) {
		sendUpdateToastToWindows("update-toast-state", currentToastPayload);
	}
});
