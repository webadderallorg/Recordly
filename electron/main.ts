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
	session,
	systemPreferences,
	Tray,
} from "electron";
import { showCursor } from "./cursorHider";
import {
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import {
	checkForAppUpdates,
	deferDownloadedUpdateReminder,
	installDownloadedUpdateNow,
	previewUpdateToast,
	skipDownloadedUpdateVersion,
	setupAutoUpdates,
} from "./updater";
import type { UpdateToastPayload } from "./updater";
import {
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	createUpdateToastWindow,
	closeUpdateToastWindow,
	getUpdateToastWindow,
	positionUpdateToastWindow,
} from "./windows";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env["VITE_DEV_SERVER_URL"]) {
	const devUserDataPath = path.join(app.getPath("appData"), "Recordly-dev");
	app.setPath("userData", devUserDataPath);
	app.setPath("sessionData", path.join(devUserDataPath, "session"));
}

if (process.platform === "darwin") {
	app.commandLine.appendSwitch("disable-features", "MacCatapLoopbackAudioForScreenShare");
}

export const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

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
let currentUpdateToastPayload: UpdateToastPayload | null = null;
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

// Tray Icons
const defaultTrayIcon = getTrayIcon("app-icons/recordly-32.png");
const recordingTrayIcon = getTrayIcon("rec-button.png");

ipcMain.on("set-has-unsaved-changes", (_event, hasChanges: boolean) => {
	editorHasUnsavedChanges = hasChanges;
});

function createWindow() {
	mainWindow = createHudOverlayWindow();
}

function focusOrCreateMainWindow() {
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
		mainWindow.show();
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.moveTop();
		mainWindow.focus();
		positionUpdateToastWindow();
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
						void checkForAppUpdates(() => mainWindow, { manual: true });
					},
				},
				...(!app.isPackaged
					? [
						{ type: "separator" as const },
						{
							label: "Preview Update Toast",
							click: () => {
								previewUpdateToast(sendUpdateToastToWindows);
							},
						},
					]
					: []),
			],
		},
	);

	const menu = Menu.buildFromTemplate(template);
	Menu.setApplicationMenu(menu);
}

function createTray() {
	tray = new Tray(defaultTrayIcon);
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

function sendUpdateToastToWindows(channel: "update-ready-toast", payload: unknown) {
	currentUpdateToastPayload = payload as UpdateToastPayload;
	positionUpdateToastWindow();
	let toastWindow = getUpdateToastWindow();

	if (!toastWindow) {
		toastWindow = createUpdateToastWindow();
	}

	const sendPayload = () => {
		if (!toastWindow || toastWindow.isDestroyed() || !currentUpdateToastPayload) {
			return false;
		}

		positionUpdateToastWindow();
		toastWindow.webContents.send(channel, currentUpdateToastPayload);
		toastWindow.show();
		toastWindow.moveTop();
		toastWindow.focus();
		return true;
	};

	if (toastWindow.webContents.isLoading()) {
		toastWindow.webContents.once("did-finish-load", () => {
			sendPayload();
		});
		return true;
	}

	return sendPayload();
}

ipcMain.handle("install-downloaded-update", () => {
	closeUpdateToastWindow();
	installDownloadedUpdateNow();
	return { success: true };
});

ipcMain.handle("defer-downloaded-update", (_event, delayMs?: number) => {
	return deferDownloadedUpdateReminder(() => mainWindow, sendUpdateToastToWindows, delayMs);
});

ipcMain.handle("preview-update-toast", () => {
	return { success: previewUpdateToast(sendUpdateToastToWindows) };
});

ipcMain.handle("dismiss-update-toast", () => {
	closeUpdateToastWindow();
	return { success: true };
});

ipcMain.handle("skip-downloaded-update", (_event, version?: string) => {
	closeUpdateToastWindow();
	return skipDownloadedUpdateVersion(version);
});

ipcMain.handle("get-current-update-toast-payload", () => {
	return currentUpdateToastPayload;
});

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
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
	positionUpdateToastWindow();

	mainWindow.on("closed", () => {
		if (mainWindow?.isDestroyed()) {
			mainWindow = null;
		}
		closeUpdateToastWindow();
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
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
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
	session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
		const allowed = ["media", "audioCapture", "microphone"];
		return allowed.includes(permission);
	});

	session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
		const allowed = ["media", "audioCapture", "microphone"];
		callback(allowed.includes(permission));
	});

	if (process.platform === "darwin") {
		const micStatus = systemPreferences.getMediaAccessStatus("microphone");
		if (micStatus !== "granted") {
			await systemPreferences.askForMediaAccess("microphone");
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
			if (!recording) {
				if (mainWindow) mainWindow.restore();
			}
		},
	);

	setupAutoUpdates(() => mainWindow, sendUpdateToastToWindows);

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

	createWindow();
});
