import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	Notification,
	session,
	systemPreferences,
	Tray,
} from "electron";
import { RECORDINGS_DIR } from "./appPaths";
import { showCursor } from "./cursorHider";
import {
	cleanupNativeVideoExportSessions,
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import {
	checkForAppUpdates,
	dismissUpdateToast,
	downloadAvailableUpdate,
	deferUpdateReminder,
	getCurrentUpdateToastPayload,
	getUpdaterLogPath,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	previewUpdateToast,
	skipAvailableUpdateVersion,
	setupAutoUpdates,
} from "./updater";
import type { UpdateToastPayload } from "./updater";
import {
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	getUpdateToastWindow,
	getHudOverlayWindow,
	hideUpdateToastWindow,
	showUpdateToastWindow,
} from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_SMOKE_EXPORT = process.env.RECORDLY_SMOKE_EXPORT === "1";

function configureGpuAccelerationSwitches() {
	app.commandLine.appendSwitch("ignore-gpu-blocklist");
	app.commandLine.appendSwitch("enable-gpu-rasterization");

	if (process.platform === "darwin") {
		app.commandLine.appendSwitch("use-angle", "metal");
		app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
		return;
	}

	if (process.platform === "win32") {
		app.commandLine.appendSwitch("use-angle", "d3d11");
		return;
	}

	if (process.platform === "linux") {
		app.commandLine.appendSwitch("use-angle", "vulkan");
		app.commandLine.appendSwitch("enable-features", "Vulkan");
	}
}

async function logSmokeExportGpuDiagnostics() {
	if (!IS_SMOKE_EXPORT) {
		return;
	}

	try {
		console.log(
			"[smoke-export] GPU feature status",
			JSON.stringify(app.getGPUFeatureStatus()),
		);
		console.log(
			"[smoke-export] GPU info",
			JSON.stringify(await app.getGPUInfo("basic")),
		);
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
process.env.APP_ROOT = path.join(__dirname, "..");

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
	? path.join(process.env.APP_ROOT, "public")
	: RENDERER_DIST;

// Window references
let mainWindow: BrowserWindow | null = null;
let sourceSelectorWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let selectedSourceName = "";
let editorHasUnsavedChanges = false;
let isForceClosing = false;
let activeUpdateNotification: Notification | null = null;
let activeUpdateNotificationKey: string | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
	app.quit();
}

function closeEditorWindowBypassingUnsavedPrompt(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	isForceClosing = true;
	editorHasUnsavedChanges = false;
	window.close();
}

// Tray Icons (lazily created after app is ready to avoid accessing Electron APIs too early)
let defaultTrayIcon: ReturnType<typeof getTrayIcon> | null = null;
let recordingTrayIcon: ReturnType<typeof getTrayIcon> | null = null;

function getDefaultTrayIcon() {
	if (!defaultTrayIcon) {
		defaultTrayIcon = getTrayIcon("app-icons/recordly-32.png");
	}
	return defaultTrayIcon;
}

function getRecordingTrayIcon() {
	if (!recordingTrayIcon) {
		recordingTrayIcon = getTrayIcon("rec-button.png");
	}
	return recordingTrayIcon;
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

	mainWindow = createHudOverlayWindow();
}

function focusOrCreateMainWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			focusOrCreateMainWindow();
		});
		return;
	}

	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
		return;
	}

	if (mainWindow && !mainWindow.isDestroyed()) {
		// On Linux/Wayland, focus() often doesn't take effect (compositor ignores it). Apps like Telegram
		// work because they receive an XDG activation token via StatusNotifierItem.ProvideXdgActivationToken;
		// Electron's tray doesn't handle that yet. Workaround: destroy and recreate the HUD so the new
		// window gets focus (creation path works). Only for HUD, not editor.
		if (process.platform === "linux" && !mainWindow.isFocused() && !isEditorWindow(mainWindow)) {
			const win = mainWindow;
			mainWindow = null;
			win.once("closed", () => createWindow());
			win.destroy();
			return;
		}

		// On Win32, calling show/moveTop/focus on the transparent HUD overlay
		// permanently corrupts setIgnoreMouseEvents forwarding, making it
		// click-through.  Only focus the editor window; the HUD is alwaysOnTop
		// so it doesn't need explicit focus.
		if (process.platform === "win32" && !isEditorWindow(mainWindow)) {
			return;
		}

		mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.moveTop();
		mainWindow.focus();
	}
}

/**
 * On Windows 10, focus changes and native notifications can break
 * {@link BrowserWindow.setIgnoreMouseEvents} forwarding on the transparent HUD
 * overlay, causing it to become permanently click-through.  Call this after any
 * operation that may alter focus or z-order so that hover detection keeps working.
 */
function reassertHudOverlayMouseState() {
	if (process.platform !== "win32") {
		return;
	}

	const hud = getHudOverlayWindow();
	if (!hud) {
		return;
	}

	// Toggle off then back on so the native WS_EX_TRANSPARENT flag is fully
	// re-initialised rather than merely re-asserted in a potentially broken state.
	hud.setIgnoreMouseEvents(false);
	setTimeout(() => {
		if (!hud.isDestroyed()) {
			hud.setIgnoreMouseEvents(true, { forward: true });
		}
	}, 50);
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
	if (!isMac) {
		Menu.setApplicationMenu(null);
		return;
	}

	const template: Electron.MenuItemConstructorOptions[] = [];
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
				...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }]),
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

function createTray() {
	tray = new Tray(getDefaultTrayIcon());
	tray.on("click", () => focusOrCreateMainWindow());
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

	const dockIcon = getAppImage("app-icons/recordly-512.png");
	if (!dockIcon.isEmpty()) {
		app.dock.setIcon(dockIcon);
	}
}

function getUpdateNotificationTitle(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return `Recordly ${payload.version} is available`;
		case "downloading":
			return `Downloading Recordly ${payload.version}`;
		case "ready":
			return `Recordly ${payload.version} is ready`;
		case "error":
			return `Recordly ${payload.version} needs attention`;
	}
}

function getUpdateNotificationBody(payload: UpdateToastPayload) {
	switch (payload.phase) {
		case "available":
			return "Click to download the update.";
		case "downloading":
			return "Recordly is downloading the update in the foreground.";
		case "ready":
			return "Click to install the downloaded update.";
		case "error":
			return "Click to retry checking for updates.";
	}
}

function clearActiveUpdateNotification() {
	if (activeUpdateNotification) {
		activeUpdateNotification.close();
		activeUpdateNotification = null;
	}
	activeUpdateNotificationKey = null;
}

function sendUpdateToastToWindows(channel: "update-toast-state", payload: unknown) {
	if (process.platform !== "darwin") {
		if (!payload) {
			clearActiveUpdateNotification();
			return true;
		}

		const updatePayload = payload as UpdateToastPayload;
		if (updatePayload.phase === "downloading") {
			return true;
		}

		if (!Notification.isSupported()) {
			return false;
		}

		const notificationKey = [updatePayload.phase, updatePayload.version, updatePayload.detail].join(":");
		if (activeUpdateNotificationKey === notificationKey) {
			return true;
		}

		clearActiveUpdateNotification();
		const notification = new Notification({
			title: getUpdateNotificationTitle(updatePayload),
			body: getUpdateNotificationBody(updatePayload),
			icon: getAppImage("app-icons/recordly-128.png"),
			silent: false,
		});

		notification.on("click", () => {
			focusOrCreateMainWindow();
			switch (updatePayload.phase) {
				case "available":
					void downloadAvailableUpdate(sendUpdateToastToWindows);
					break;
				case "ready":
					installDownloadedUpdateNow(sendUpdateToastToWindows);
					break;
				case "error":
					void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
					break;
				default:
					break;
			}
		});

		notification.on("close", () => {
			if (activeUpdateNotification === notification) {
				activeUpdateNotification = null;
				activeUpdateNotificationKey = null;
			}
		});

		notification.show();
		// On Win10, showing a native notification can break setIgnoreMouseEvents
		// forwarding on the transparent HUD overlay.  Re-assert it after a short
		// delay so the renderer's hover detection keeps working.
		reassertHudOverlayMouseState();
		activeUpdateNotification = notification;
		activeUpdateNotificationKey = notificationKey;
		return true;
	}

	if (!payload) {
		const existingWindow = getUpdateToastWindow();
		if (!existingWindow) {
			return false;
		}

		existingWindow.webContents.send(channel, null);
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

ipcMain.handle("download-available-update", () => {
	return downloadAvailableUpdate(sendUpdateToastToWindows);
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

ipcMain.handle("preview-update-toast", () => {
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
						if (mainWindow && !mainWindow.isDestroyed()) {
							if (mainWindow.isMinimized()) mainWindow.restore();
							mainWindow.show();
							mainWindow.focus();
							mainWindow.moveTop();
						} else {
							createWindow();
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
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function createEditorWindowWrapper() {
	if (mainWindow) {
		closeEditorWindowBypassingUnsavedPrompt(mainWindow);
		mainWindow = null;
	}
	mainWindow = createEditorWindow();
	editorHasUnsavedChanges = false;

	mainWindow.on("closed", () => {
		if (mainWindow?.isDestroyed()) {
			mainWindow = null;
		}
		isForceClosing = false;
		editorHasUnsavedChanges = false;
	});

	mainWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) {
			return;
		}

		event.preventDefault();

		const choice = dialog.showMessageBoxSync(mainWindow!, {
			type: "warning",
			buttons: ["Save & Close", "Discard & Close", "Cancel"],
			defaultId: 0,
			cancelId: 2,
			title: "Unsaved Changes",
			message: "You have unsaved changes.",
			detail: "Do you want to save your project before closing?",
		});

		if (choice === 0) {
			mainWindow!.webContents.send("request-save-before-close");
			ipcMain.once("save-before-close-done", (_event, saved: boolean) => {
				if (saved) {
					closeEditorWindowBypassingUnsavedPrompt(mainWindow);
				}
			});
		} else if (choice === 1) {
			closeEditorWindowBypassingUnsavedPrompt(mainWindow);
		}
	});
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
	killWindowsCaptureProcess();
	showCursor();
	cleanupNativeVideoExportSessions();
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

	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone", "camera", "videoCapture"];
		callback(allowed.includes(permission));
	});

	session.defaultSession.setDevicePermissionHandler((_details) => true);

	if (process.platform === "darwin") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		if (cameraStatus !== "granted") {
			await systemPreferences.askForMediaAccess("camera");
		}

		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
		}
	} else if (process.platform === "win32") {
		const cameraStatus = systemPreferences.getMediaAccessStatus("camera");
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (cameraStatus !== "granted") {
			console.warn(`[permissions] Camera access is "${cameraStatus}" — webcam may not work. Check Windows Settings > Privacy > Camera.`);
		}
		if (micStatus !== "granted") {
			console.warn(`[permissions] Microphone access is "${micStatus}" — mic recording may not work. Check Windows Settings > Privacy > Microphone.`);
		}
	}

	ipcMain.on("hud-overlay-close", () => {
		app.quit();
	});
	syncDockIcon();
	createTray();
	updateTrayMenu();
	setupApplicationMenu();
	// Ensure recordings directory exists
	await ensureRecordingsDir();

	registerIpcHandlers(
		createEditorWindowWrapper,
		createSourceSelectorWindowWrapper,
		() => mainWindow,
		() => sourceSelectorWindow,
		(recording: boolean, sourceName: string) => {
			selectedSourceName = sourceName;
			if (!tray) createTray();
			updateTrayMenu(recording);
			if (recording) {
				reassertHudOverlayMouseState();
			}
			if (!recording) {
				if (mainWindow) mainWindow.restore();
			}
		},
	);

	if (IS_SMOKE_EXPORT) {
		await logSmokeExportGpuDiagnostics();
		console.log(
			`[smoke-export] Starting editor smoke export for ${process.env.RECORDLY_SMOKE_EXPORT_INPUT ?? "<missing input>"}`,
		);
		createEditorWindowWrapper();
		return;
	}

	createWindow();
	setupAutoUpdates(getUpdateDialogWindow, sendUpdateToastToWindows);

	// Register the display media handler so that renderer's getDisplayMedia()
	// calls land on the pre-selected source without showing a system picker.
	//
	// IMPORTANT: The callback must receive a plain { id, name } Video object.
	// Passing the full DesktopCapturerSource (with thumbnail, appIcon, etc.)
	// via an unsafe cast breaks Electron's internal cursor-constraint
	// propagation and causes cursor: 'never' from the renderer to be silently
	// ignored by the native capture pipeline.
	session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
		try {
			const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
			const sourceId = getSelectedSourceId();
			const source = sourceId ? (sources.find((s) => s.id === sourceId) ?? sources[0]) : sources[0];
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
