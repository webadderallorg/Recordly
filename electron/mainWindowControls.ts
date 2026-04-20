import path from "node:path";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	nativeImage,
	Tray,
} from "electron";
import { mainRuntimeState } from "./mainRuntimeState";

interface MainWindowControlsDependencies {
	rendererDist: string;
	createHudOverlayWindow: () => BrowserWindow;
	createEditorWindow: () => BrowserWindow;
	createSourceSelectorWindow: () => BrowserWindow;
	getHudOverlayWindow: () => BrowserWindow | null;
	isHudOverlayMousePassthroughSupported: () => boolean;
	onCheckForUpdates: () => void;
}

let deps: MainWindowControlsDependencies | null = null;

function requireDeps() {
	if (!deps) {
		throw new Error("mainWindowControls has not been initialized");
	}
	return deps;
}

function getPublicAssetPath(filename: string) {
	return path.join(process.env.VITE_PUBLIC || requireDeps().rendererDist, filename);
}

function getAppImage(filename: string) {
	return nativeImage.createFromPath(getPublicAssetPath(filename));
}

function getTrayIcon(filename: string) {
	return getAppImage(filename).resize({ width: 24, height: 24, quality: "best" });
}

function getDefaultTrayIcon() {
	if (!mainRuntimeState.defaultTrayIcon) {
		mainRuntimeState.defaultTrayIcon = getTrayIcon("app-icons/recordly-32.png");
	}
	return mainRuntimeState.defaultTrayIcon;
}

function getRecordingTrayIcon() {
	if (!mainRuntimeState.recordingTrayIcon) {
		mainRuntimeState.recordingTrayIcon = getTrayIcon("rec-button.png");
	}
	return mainRuntimeState.recordingTrayIcon;
}

export function initializeMainWindowControls(nextDeps: MainWindowControlsDependencies) {
	deps = nextDeps;
	ipcMain.on("set-has-unsaved-changes", (_event, hasChanges: boolean) => {
		mainRuntimeState.editorHasUnsavedChanges = hasChanges;
	});
}

export function isEditorWindow(window: BrowserWindow) {
	return window.webContents.getURL().includes("windowType=editor");
}

export function closeEditorWindowBypassingUnsavedPrompt(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	if (isEditorWindow(window)) {
		mainRuntimeState.isForceClosing = true;
		mainRuntimeState.editorHasUnsavedChanges = false;
	}
	window.close();
}

export function restoreWindowSafely(window: BrowserWindow | null) {
	if (!window || window.isDestroyed()) {
		return;
	}

	window.restore();
}

export function showHudOverlayFromTray() {
	const hud = requireDeps().getHudOverlayWindow();
	if (!hud) {
		return false;
	}

	if (hud.isMinimized()) {
		hud.restore();
	}

	if (process.platform === "win32" && requireDeps().isHudOverlayMousePassthroughSupported()) {
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

export function createWindow() {
	if (!app.isReady()) {
		void app.whenReady().then(() => {
			if (!mainRuntimeState.mainWindow || mainRuntimeState.mainWindow.isDestroyed()) {
				createWindow();
			}
		});
		return;
	}

	mainRuntimeState.mainWindow = requireDeps().createHudOverlayWindow();
}

export function focusOrCreateMainWindow() {
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

	if (mainRuntimeState.mainWindow && !mainRuntimeState.mainWindow.isDestroyed()) {
		if (
			process.platform === "linux" &&
			!mainRuntimeState.mainWindow.isFocused() &&
			!isEditorWindow(mainRuntimeState.mainWindow)
		) {
			const windowToRecreate = mainRuntimeState.mainWindow;
			mainRuntimeState.mainWindow = null;
			windowToRecreate.once("closed", () => createWindow());
			windowToRecreate.destroy();
			return;
		}

		if (
			process.platform === "win32" &&
			!isEditorWindow(mainRuntimeState.mainWindow) &&
			requireDeps().isHudOverlayMousePassthroughSupported()
		) {
			showHudOverlayFromTray();
			return;
		}

		mainRuntimeState.mainWindow.show();
		if (mainRuntimeState.mainWindow.isMinimized()) {
			mainRuntimeState.mainWindow.restore();
		}
		mainRuntimeState.mainWindow.moveTop();
		mainRuntimeState.mainWindow.focus();
	}
}

export function reassertHudOverlayMouseState() {
	if (process.platform !== "win32" || !requireDeps().isHudOverlayMousePassthroughSupported()) {
		return;
	}

	const hud = requireDeps().getHudOverlayWindow();
	if (!hud) {
		return;
	}

	hud.setIgnoreMouseEvents(false);
	setTimeout(() => {
		if (!hud.isDestroyed()) {
			hud.setIgnoreMouseEvents(true, { forward: true });
		}
	}, 50);
}

function sendEditorMenuAction(
	channel: "menu-load-project" | "menu-save-project" | "menu-save-project-as",
) {
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainRuntimeState.mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainRuntimeState.mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) {
			return;
		}

		targetWindow.webContents.once("did-finish-load", () => {
			if (!targetWindow || targetWindow.isDestroyed()) {
				return;
			}
			targetWindow.webContents.send(channel);
		});
		return;
	}

	targetWindow.webContents.send(channel);
}

export function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	if (!isMac) {
		Menu.setApplicationMenu(null);
		return;
	}

	const template: Electron.MenuItemConstructorOptions[] = [
		{
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
		},
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
					click: () => requireDeps().onCheckForUpdates(),
				},
			],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function isPrimaryTrayClick(event: unknown) {
	const button =
		event && typeof event === "object" && "button" in event
			? (event as { button?: number | string }).button
			: undefined;
	return button === undefined || button === 0 || button === "left";
}

export function createTray() {
	mainRuntimeState.tray = new Tray(getDefaultTrayIcon());
	mainRuntimeState.tray.on("click", (event) => {
		if (process.platform === "win32" && !isPrimaryTrayClick(event)) {
			return;
		}

		focusOrCreateMainWindow();
	});

	if (process.platform === "win32") {
		mainRuntimeState.tray.on("right-click", () => {
			if (!mainRuntimeState.tray || !mainRuntimeState.trayContextMenu) {
				return;
			}

			mainRuntimeState.tray.popUpContextMenu(mainRuntimeState.trayContextMenu);
		});
		return;
	}

	mainRuntimeState.tray.on("double-click", () => focusOrCreateMainWindow());
}

export function syncDockIcon() {
	if (process.platform !== "darwin" || !app.dock) {
		return;
	}

	const dockIcon = getAppImage("app-icons/recordly-512.png");
	if (!dockIcon.isEmpty()) {
		app.dock.setIcon(dockIcon);
	}
}

export function updateTrayMenu(recording = false) {
	if (!mainRuntimeState.tray) {
		return;
	}

	const trayIcon = recording ? getRecordingTrayIcon() : getDefaultTrayIcon();
	const trayToolTip = recording
		? `Recording: ${mainRuntimeState.selectedSourceName}`
		: "Recordly";
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
						if (mainRuntimeState.mainWindow && !mainRuntimeState.mainWindow.isDestroyed()) {
							mainRuntimeState.mainWindow.webContents.send("stop-recording-from-tray");
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
				{ label: "Quit", click: () => app.quit() },
		  ];

	const menu = Menu.buildFromTemplate(menuTemplate);
	mainRuntimeState.trayContextMenu = menu;
	mainRuntimeState.tray.setImage(trayIcon);
	mainRuntimeState.tray.setToolTip(trayToolTip);
	if (process.platform !== "win32") {
		mainRuntimeState.tray.setContextMenu(menu);
	}
}

export function createEditorWindowWrapper() {
	const previousWindow = mainRuntimeState.mainWindow;
	if (previousWindow && !previousWindow.isDestroyed()) {
		const closingEditorWindow = isEditorWindow(previousWindow);
		closeEditorWindowBypassingUnsavedPrompt(previousWindow);
		if (!closingEditorWindow) {
			mainRuntimeState.isForceClosing = false;
		}
		if (mainRuntimeState.mainWindow === previousWindow) {
			mainRuntimeState.mainWindow = null;
		}
	}

	const editorWindow = requireDeps().createEditorWindow();
	mainRuntimeState.mainWindow = editorWindow;
	mainRuntimeState.editorHasUnsavedChanges = false;

	editorWindow.on("closed", () => {
		if (mainRuntimeState.mainWindow === editorWindow) {
			mainRuntimeState.mainWindow = null;
		}
		mainRuntimeState.isForceClosing = false;
		mainRuntimeState.editorHasUnsavedChanges = false;
	});

	editorWindow.on("close", (event) => {
		if (mainRuntimeState.isForceClosing || !mainRuntimeState.editorHasUnsavedChanges) {
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
				if (saved) {
					closeEditorWindowBypassingUnsavedPrompt(editorWindow);
				}
			});
		} else if (choice === 1) {
			closeEditorWindowBypassingUnsavedPrompt(editorWindow);
		}
	});
}

export function createSourceSelectorWindowWrapper() {
	mainRuntimeState.sourceSelectorWindow = requireDeps().createSourceSelectorWindow();
	mainRuntimeState.sourceSelectorWindow.on("closed", () => {
		mainRuntimeState.sourceSelectorWindow = null;
	});
	return mainRuntimeState.sourceSelectorWindow;
}