import { createReleaseVersionCatalog } from "./releaseVersions";
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
import { nativeT, setNativeLocale } from "./nativeI18n";
import {
	captureEditorMenuTarget,
	createEditorCommandMenus,
	withHiddenDockEditorMenus,
	type ProjectMenuAction,
} from "./editorCommandMenu";
import { validateAppLocaleRequest } from "./localeIpc";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";
import { refreshDesktopPresenceLocale } from "./desktopPresence";
import { initializeInstanceSession, RECORDINGS_DIR } from "./appPaths";
import { activateFromDesktopIcon } from "./appActivation";
import { getUpdatePresentation } from "./updatePresentation";
import { createAuthCallbackController } from "./authCallback";
import { showCursor } from "./cursorHider";
import {
	desktopPresenceNeedsTray,
	initializeDesktopPresence,
	setDesktopPresenceRecording,
	stopRecordingFromDesktopIcon,
} from "./desktopPresence";
import { getGpuSwitches } from "./gpuSwitches";
import {
	cleanupAllExportStreams,
	cleanupNativeVideoExportSessions,
	getSelectedSourceId,
	killWindowsCaptureProcess,
	registerIpcHandlers,
} from "./ipc/handlers";
import { recordingFocus } from "./ipc/recording/focus";
import { clearRecordingTrashUndo } from "./ipc/recording/library";
import { resolveDisplayMediaSource } from "./ipc/register/sourceMapping";
import { ensureMediaServer } from "./mediaServer";
import {
	hardenWebContentsNavigation,
	isInternalRendererTarget,
	shouldHardenWebContentsType,
} from "./navigationPolicy";
import { shouldGrantDisplayCapture, shouldGrantMediaPermission } from "./permissionPolicy";
import { ensurePackagedRendererServer, getPackagedRendererBaseUrl } from "./rendererServer";
import { createSaveBeforeCloseController } from "./saveBeforeClose";
import {
	checkForAppUpdates,
	deferUpdateReminder,
	dismissUpdateToast,
	downloadAvailableUpdate,
	getCurrentUpdateToastPayload,
	getAutomaticUpdateDownloadsEnabled,
	getExperimentalUpdatesEnabled,
	getUpdaterLogPath,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	previewNativeUpdateDialog,
	previewUpdateToast,
	setExperimentalUpdatesEnabled,
	setAutomaticUpdateDownloadsEnabled,
	setupAutoUpdates,
	showUpdateNotificationOnOpen,
	skipAvailableUpdateVersion,
} from "./updater";
import {
	beginHudCaptureProtection,
	closeOnboardingWindow,
	createEditorWindow,
	createHudOverlayWindow,
	createSourceSelectorWindow,
	focusOnboardingWindow,
	getHudOverlayWindow,
	getOnboardingWindow,
	getUpdateToastWindow,
	hideUpdateToastWindow,
	isHudOverlayMousePassthroughSupported,
	replayOnboardingIntro,
	reassertHudOverlayMousePassthrough as reassertHudOverlayMouseState,
	setHudOverlayRecordingActive,
	showOnboardingWindow,
	showUpdateToastWindow,
} from "./windows";

const electronMainDir = path.dirname(fileURLToPath(import.meta.url));
const IS_SMOKE_EXPORT = process.env.RECORDLY_SMOKE_EXPORT === "1";
let startupWindowsReady = false;
let firstRunIntroStarted = false;
initializeInstanceSession();

function ignoreBrokenConsolePipe(stream: NodeJS.WritableStream | undefined) {
	stream?.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code === "EPIPE" || error.code === "EIO") {
			return;
		}
		throw error;
	});
}

ipcMain.handle("show-onboarding-window", (_event, options?: { preview?: boolean }) => {
	showOnboardingWindow({ preview: !app.isPackaged && options?.preview === true });
	return true;
});
ipcMain.handle("replay-onboarding-intro", (event) => {
	const owner = BrowserWindow.fromWebContents(event.sender);
	return owner ? replayOnboardingIntro(owner) : false;
});
ipcMain.handle("close-onboarding-window", () => {
	closeOnboardingWindow();
	return true;
});

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
// │ │ └── preload.js
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

ipcMain.handle("set-app-locale", (event, locale: unknown) => {
	if (!validateAppLocaleRequest(event, locale, getTrustedCaptureDocumentBaseUrls())) {
		throw new Error("Invalid app locale request");
	}
	setNativeLocale(locale);
	writeAppSetting("recordly.locale", locale);
	setupApplicationMenu();
	updateTrayMenu(desktopRecordingActive);
	refreshDesktopPresenceLocale();
	const onboarding = getOnboardingWindow();
	if (onboarding && !onboarding.isDestroyed()) onboarding.setTitle(nativeT("welcome"));
	return true;
});

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
const exportingRenderers = new Set<number>();
const observedExportRenderers = new WeakSet<Electron.WebContents>();
let isForceClosing = false;
let isAppQuitting = false;
let isCreatingMainWindow = false;
let isCreatingEditorWindow = false;
// Multiple app instances are supported. Recording handlers acquire the OS
// instance lock only while a recording is starting or capturing.

const authCallbacks = createAuthCallbackController({
	isDev: IS_DEV,
	focusApp: () => focusOrCreateMainWindow(),
});

app.on("open-url", (event, rawUrl) => {
	try {
		const url = new URL(rawUrl);
		if (
			url.protocol !== `${authCallbacks.protocol}:` ||
			url.hostname !== "billing" ||
			url.pathname !== "/return" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return;
		event.preventDefault();
		if (app.isReady()) focusOrCreateMainWindow();
	} catch {
		// Ignore malformed URLs; no callback can grant a billing entitlement.
	}
});

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

ipcMain.on("set-export-in-progress", (event, active: unknown) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (!window || !isEditorWindow(window) || typeof active !== "boolean") return;
	const id = event.sender.id;
	if (active) {
		if (!observedExportRenderers.has(event.sender)) {
			observedExportRenderers.add(event.sender);
			event.sender.once("destroyed", () => exportingRenderers.delete(id));
		}
		exportingRenderers.add(id);
	} else {
		exportingRenderers.delete(id);
	}
});

function canRestartForUpdate() {
	return !desktopRecordingActive && !editorHasUnsavedChanges && exportingRenderers.size === 0;
}

function createWindow() {
	if (!startupWindowsReady) return;

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

	if (app.isPackaged && readAppSetting("recordly.onboarding.v1.seen") !== true) {
		showOnboardingWindow({ intro: claimFirstRunIntro() });
		return;
	}

	isCreatingMainWindow = true;
	const createdHudWindow = createHudOverlayWindow();
	mainWindow = createdHudWindow;
	createdHudWindow.once("closed", () => {
		recordingFocus.stop();
		if (mainWindow === createdHudWindow) {
			mainWindow = null;
		}
	});
	isCreatingMainWindow = false;
}

function claimFirstRunIntro() {
	if (firstRunIntroStarted) return false;
	firstRunIntroStarted = true;
	const introStartedKey = "recordly.onboarding.introStarted";
	if (readAppSetting(introStartedKey) === true) return false;
	const resumingPermissions = readAppSetting("recordly.onboarding.permissionsRequested") === true;
	try {
		writeAppSetting(introStartedKey, true);
	} catch (error) {
		console.warn("[onboarding] Could not save reveal progress", error);
	}
	return !resumingPermissions;
}

function focusOrCreateMainWindow() {
	if (!startupWindowsReady) return;
	const onboarding = getOnboardingWindow();
	if (onboarding) {
		focusOnboardingWindow();
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

function isOwnedEditorWindow(window: BrowserWindow): boolean {
	return (
		!window.isDestroyed() &&
		BrowserWindow.fromId(window.id) === window &&
		!window.webContents.isDestroyed() &&
		isEditorWindow(window) &&
		getTrustedCaptureDocumentBaseUrls().some((base) =>
			isInternalRendererTarget(base, window.webContents.getURL()),
		)
	);
}

function sendEditorMenuAction(channel: ProjectMenuAction, capturedTarget?: BrowserWindow) {
	if (!startupWindowsReady) return;
	if (getOnboardingWindow()) {
		focusOnboardingWindow();
		return;
	}
	if (capturedTarget) {
		if (isOwnedEditorWindow(capturedTarget)) capturedTarget.webContents.send(channel);
		return;
	}
	let targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow;

	if (!targetWindow || targetWindow.isDestroyed() || !isEditorWindow(targetWindow)) {
		createEditorWindowWrapper();
		targetWindow = mainWindow;
		if (!targetWindow || targetWindow.isDestroyed()) return;

		const send = () => {
			if (!targetWindow || targetWindow.isDestroyed()) return;
			targetWindow.webContents.send(channel);
		};
		if (targetWindow.webContents.isLoadingMainFrame())
			targetWindow.webContents.once("did-finish-load", send);
		else send();
		return;
	}

	targetWindow.webContents.send(channel);
}

function setupApplicationMenu() {
	const isMac = process.platform === "darwin";
	const template: Electron.MenuItemConstructorOptions[] = [];
	const editorMenus = createEditorCommandMenus({
		translate: nativeT,
		onProjectAction: sendEditorMenuAction,
	});
	if (!isMac)
		editorMenus[0].submenu.push(
			{ type: "separator" },
			{ label: nativeT("quit"), role: "quit", accelerator: "CmdOrCtrl+Q" },
		);
	if (isMac) {
		template.push({
			label: app.name,
			submenu: [
				{ label: nativeT("about"), role: "about" },
				{ type: "separator" },
				{ label: nativeT("services"), role: "services" },
				{ type: "separator" },
				{ label: nativeT("hide"), role: "hide" },
				{ label: nativeT("hideOthers"), role: "hideOthers" },
				{ label: nativeT("unhide"), role: "unhide" },
				{ type: "separator" },
				{ label: nativeT("quit"), role: "quit" },
			],
		});
	}

	template.push(
		...editorMenus,
		{
			label: nativeT("view"),
			submenu: [
				{ label: nativeT("reload"), role: "reload" },
				{ label: nativeT("forceReload"), role: "forceReload" },
				{ label: nativeT("toggleDevTools"), role: "toggleDevTools" },
				{ type: "separator" },
				{ label: nativeT("resetZoom"), role: "resetZoom" },
				{ label: nativeT("zoomIn"), role: "zoomIn" },
				{ label: nativeT("zoomOut"), role: "zoomOut" },
				{ type: "separator" },
				{ label: nativeT("toggleFullscreen"), role: "togglefullscreen" },
			],
		},
		{
			label: nativeT("window"),
			submenu: isMac
				? [
						{ label: nativeT("minimize"), role: "minimize" },
						{ label: nativeT("zoom"), role: "zoom" },
						{ type: "separator" },
						{ label: nativeT("front"), role: "front" },
					]
				: [
						{ label: nativeT("minimize"), role: "minimize" },
						{ label: nativeT("close"), role: "close" },
					],
		},
		{
			label: nativeT("help"),
			submenu: [
				{
					label: nativeT("checkUpdates"),
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

function activateDesktopEntryPoint() {
	activateFromDesktopIcon({
		stopRecording: stopRecordingFromDesktopIcon,
		getPriorityWindow: () => {
			const onboarding = getOnboardingWindow();
			if (onboarding) return onboarding;
			const updateToast = getUpdateToastWindow();
			return updateToast?.isVisible() ? updateToast : null;
		},
		getHudWindow: getHudOverlayWindow,
		showHud: () => {
			showHudOverlayFromTray();
		},
		showMain: focusOrCreateMainWindow,
	});
	if (app.isReady() && !desktopRecordingActive && !getOnboardingWindow()) {
		notifyAboutUpdateOnOpen = true;
		if (!showUpdateNotificationOnOpen(getUpdateDialogWindow, sendUpdateToastToWindows)) {
			void checkForAppUpdates(getUpdateDialogWindow);
		}
	}
}

function createTray() {
	tray = new Tray(getDefaultTrayIcon());
	if (process.platform === "darwin") tray.setIgnoreDoubleClickEvents(true);
	const activate = activateDesktopEntryPoint;
	tray.on("click", (event) => {
		if (!isPrimaryTrayClick(event)) {
			return;
		}

		activate();
	});

	if (process.platform === "win32" || process.platform === "darwin") {
		tray.on("right-click", () => {
			if (process.platform === "darwin" && app.dock && !app.dock.isVisible())
				updateTrayMenu(desktopRecordingActive);
			if (!tray || !trayContextMenu) {
				return;
			}

			tray.popUpContextMenu(trayContextMenu);
		});
		return;
	}

	tray.on("double-click", activate);
}

function shouldUseTray() {
	return process.platform === "linux" || desktopPresenceNeedsTray();
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
	// The packaged app uses the native icon from its macOS bundle.
	if (process.platform !== "darwin" || app.isPackaged || !app.dock) {
		return;
	}

	const dockIcon = getAppImage("app-icons/recordly-solid-blue-512.png");
	if (!dockIcon.isEmpty()) {
		app.dock.setIcon(dockIcon);
	}
}

let notifyAboutUpdateOnOpen = true;

function sendUpdateToastToWindows(
	channel: "update-toast-state",
	payload: ReturnType<typeof getCurrentUpdateToastPayload>,
) {
	const hud = getHudOverlayWindow();
	const editorVisible = Boolean(
		mainWindow &&
			mainWindow !== hud &&
			!mainWindow.isDestroyed() &&
			mainWindow.isVisible() &&
			!mainWindow.isMinimized(),
	);
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed() && window !== getUpdateToastWindow()) {
			window.webContents.send(channel, payload);
		}
	}
	const presentation = getUpdatePresentation({
		phase: payload?.phase,
		recording: desktopRecordingActive,
		editorVisible,
		notifyOnOpen: notifyAboutUpdateOnOpen,
		platform: process.platform,
		notificationVisible: getUpdateToastWindow()?.isVisible() ?? false,
		automaticDownloads: getAutomaticUpdateDownloadsEnabled(),
	});
	if (!payload && getUpdateStatusSummary().status === "up-to-date") {
		notifyAboutUpdateOnOpen = false;
	}
	if (presentation === "notification" || presentation === "native") {
		notifyAboutUpdateOnOpen = false;
	}
	if (presentation === "silent" || presentation === "inline") {
		hideUpdateToastWindow();
		return true;
	}
	if (presentation === "native") {
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
		if (toastWindow.isDestroyed() || getCurrentUpdateToastPayload() !== payload) return;
		toastWindow.webContents.send(channel, payload);
		showUpdateToastWindow();
		if (payload.isPreview && (payload.phase === "ready" || payload.phase === "available")) {
			toastWindow.show();
			toastWindow.focus();
		}
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
	return installDownloadedUpdateNow(sendUpdateToastToWindows);
});

ipcMain.handle("download-available-update", (_event, installAfterDownload?: boolean) => {
	return downloadAvailableUpdate(sendUpdateToastToWindows, {
		installAfterDownload: Boolean(installAfterDownload),
		canInstall: canRestartForUpdate,
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

const releaseVersionCatalog = createReleaseVersionCatalog(process.platform, process.arch);
ipcMain.handle("list-release-versions", async () => {
	if (process.windowsStore || process.mas) return { success: true, versions: [] };
	try {
		return { success: true, versions: await releaseVersionCatalog.list() };
	} catch {
		return { success: false, versions: [] };
	}
});
ipcMain.handle("download-release-version", async (_event, tag: unknown) => {
	if (process.windowsStore || process.mas) return { success: false };
	const installer = releaseVersionCatalog.installer(tag);
	if (!installer) return { success: false };
	try {
		await shell.openExternal(installer);
		return { success: true };
	} catch {
		return { success: false };
	}
});

ipcMain.handle("get-update-status-summary", () => {
	return getUpdateStatusSummary();
});

ipcMain.handle("get-experimental-updates-enabled", () => {
	return getExperimentalUpdatesEnabled();
});

ipcMain.handle("get-automatic-update-downloads-enabled", () =>
	getAutomaticUpdateDownloadsEnabled(),
);
ipcMain.handle("set-automatic-update-downloads-enabled", (_event, enabled: unknown) => {
	if (typeof enabled !== "boolean")
		return { success: false, enabled: getAutomaticUpdateDownloadsEnabled() };
	try {
		const saved = setAutomaticUpdateDownloadsEnabled(enabled, sendUpdateToastToWindows);
		return { success: saved === enabled, enabled: saved };
	} catch (error) {
		return {
			success: false,
			enabled: getAutomaticUpdateDownloadsEnabled(),
			error: String(error),
		};
	}
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
	notifyAboutUpdateOnOpen = true;
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

let desktopRecordingActive = false;

function requestStopRecording() {
	// Capture belongs to the HUD, which can outlive the current main/editor window.
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
			win.webContents.send("stop-recording-from-tray");
		}
	}
}

function refreshTrayPresence() {
	if (shouldUseTray()) {
		if (!tray) createTray();
		updateTrayMenu(desktopRecordingActive);
	} else if (tray) {
		tray.destroy();
		tray = null;
		trayContextMenu = null;
	}
}

function updateTrayMenu(recording: boolean = false) {
	if (!tray) return;
	const trayIcon = recording ? getRecordingTrayIcon() : getDefaultTrayIcon();
	const trayToolTip = recording
		? nativeT("stopTooltip", { source: selectedSourceName })
		: "Recordly";
	const menuTemplate = recording
		? [
				{
					label: nativeT("showControls"),
					click: () => {
						if (!showHudOverlayFromTray()) {
							focusOrCreateMainWindow();
						}
					},
				},
				{
					label: nativeT("stopRecording"),
					click: requestStopRecording,
				},
			]
		: [
				{
					label: nativeT("open"),
					click: () => {
						if (!showHudOverlayFromTray()) {
							focusOrCreateMainWindow();
						}
					},
				},
				{
					label: nativeT("quit"),
					click: () => {
						app.quit();
					},
				},
			];
	const focused = BrowserWindow.getFocusedWindow();
	const target = captureEditorMenuTarget(
		getOnboardingWindow()
			? null
			: focused && isOwnedEditorWindow(focused)
				? focused
				: mainWindow,
		isOwnedEditorWindow,
	);
	const menu = Menu.buildFromTemplate(
		withHiddenDockEditorMenus(menuTemplate, {
			platform: process.platform,
			dockVisible: app.dock?.isVisible() ?? true,
			translate: nativeT,
			onProjectAction: sendEditorMenuAction,
			target,
		}),
	);
	trayContextMenu = menu;
	tray.setImage(trayIcon);
	tray.setToolTip(trayToolTip);
	// A native macOS context menu consumes the primary click. Keep that click
	// available for stopping capture, and open the menu on right-click instead.
	if (process.platform === "linux") {
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

	const closeAfterSave = () => {
		if (process.platform === "win32" && !isAppQuitting && !getOnboardingWindow())
			closeEditorWindowToHud(editorWindow);
		else closeEditorWindowBypassingUnsavedPrompt(editorWindow);
	};
	let closeSaveRequestId = 0;
	const closeSave = createSaveBeforeCloseController({
		requestSave: () =>
			editorWindow.webContents.send("request-save-before-close", ++closeSaveRequestId),
		subscribe: (done) => {
			const saved = (event: Electron.IpcMainEvent, success: unknown, requestId: unknown) => {
				if (event.sender === editorWindow.webContents && requestId === closeSaveRequestId)
					done(success === true);
			};
			ipcMain.on("save-before-close-done", saved);
			return () => ipcMain.removeListener("save-before-close-done", saved);
		},
		offerDiscard: async () => {
			const result = await dialog.showMessageBox(editorWindow, {
				type: "warning",
				buttons: [nativeT("discardClose"), nativeT("cancel")],
				defaultId: 1,
				cancelId: 1,
				title: nativeT("saveFailedTitle"),
				message: nativeT("saveFailedMessage"),
			});
			return result.response === 0;
		},
		close: closeAfterSave,
		cancel: () => {
			isAppQuitting = false;
		},
	});
	editorWindow.once("closed", closeSave.dispose);
	editorWindow.on("close", (event) => {
		if (isForceClosing || !editorHasUnsavedChanges) {
			if (
				process.platform === "win32" &&
				!isForceClosing &&
				!isAppQuitting &&
				!getOnboardingWindow()
			) {
				event.preventDefault();
				closeEditorWindowToHud(editorWindow);
			}
			return;
		}
		event.preventDefault();
		closeSave.start();
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
	recordingFocus.stop();
	isAppQuitting = true;
	authCallbacks.close();
	void clearRecordingTrashUndo().catch((error) =>
		console.warn("Could not clear recording undo cache", error),
	);
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

app.on("activate", activateDesktopEntryPoint);

app.on("second-instance", async (_event, commandLine, _workingDirectory, additionalData) => {
	if ((additionalData as { recordlyRecordingLock?: boolean })?.recordlyRecordingLock === true)
		return;
	const authCallback = authCallbacks.find(commandLine);
	if (authCallback) {
		const routed = await authCallbacks.route(authCallback);
		if (isAppQuitting) return;
		if (routed !== "forwarded") focusOrCreateMainWindow();
	} else {
		activateDesktopEntryPoint();
	}
});

// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
	setNativeLocale(String(readAppSetting("recordly.locale") || app.getLocale()));
	authCallbacks.startDevServer();
	if (process.defaultApp && process.argv[1]) {
		app.setAsDefaultProtocolClient(authCallbacks.protocol, process.execPath, [
			path.resolve(process.argv[1]),
		]);
	} else {
		app.setAsDefaultProtocolClient(authCallbacks.protocol);
	}
	const startupAuthCallback = authCallbacks.find(process.argv);
	const routedStartupAuth = await authCallbacks.routeStartup(startupAuthCallback);
	if (isAppQuitting) return;
	if (routedStartupAuth === "forwarded") {
		// A separate protocol launcher exits only after the exact existing owner
		// accepted the callback into its private in-memory queue.
		app.quit();
		return;
	}

	if (process.platform === "win32" && !process.windowsStore) {
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
	syncDockIcon();
	initializeDesktopPresence({
		refreshEntryPoints: refreshTrayPresence,
		stopRecording: requestStopRecording,
		onRecordingOwnerLost: () => {
			desktopRecordingActive = false;
			setHudOverlayRecordingActive(false);
			setDesktopPresenceRecording(false);
		},
		stopIcon: getAppImage("rec-button.png").resize({ width: 16, height: 16 }),
	});
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
			desktopRecordingActive = recording;
			setDesktopPresenceRecording(recording);
			if (recording) {
				reassertHudOverlayMouseState();
			}
			// Idle updates also follow cancelled starts and discarded recordings.
			// Only the explicit editor handoff should reveal/focus the editor.
		},
		authCallbacks.flowStorageHooks,
	);
	startupWindowsReady = true;

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
	setupAutoUpdates(getUpdateDialogWindow, sendUpdateToastToWindows, canRestartForUpdate);
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
			beginHudCaptureProtection();

			const video = await resolveDisplayMediaSource({
				platform: process.platform,
				env: process.env,
				selectedSourceId: getSelectedSourceId(),
				getSources: () =>
					desktopCapturer.getSources({
						types: ["screen", "window"],
						thumbnailSize: { width: 0, height: 0 },
					}),
			});
			callback(video ? { video } : {});
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
