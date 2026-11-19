import { app, BrowserWindow, ipcMain, Menu, type NativeImage } from "electron";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";
import { createDockVisibilityController } from "./dockVisibility";
import { nativeT } from "./nativeI18n";

const SHOW_KEY = "recordly.application.showInDock";
const HIDE_RECORDING_KEY = "recordly.application.hideWhileRecording";
let recording = false;
let stopRequested = false;
let initialized = false;
let refreshEntryPoints: () => void = () => undefined;
let stopRecording: () => void = () => undefined;
let onRecordingOwnerLost: () => void = () => undefined;
let quitting = false;
let stopIcon: NativeImage | undefined;
const primaryWindows = new Map<BrowserWindow, boolean>();
let dockVisibility: ReturnType<typeof createDockVisibilityController> | undefined;

function showInDock() {
	return readAppSetting(SHOW_KEY) !== false;
}

function hideWhileRecording() {
	return readAppSetting(HIDE_RECORDING_KEY) !== false;
}

function visible() {
	return showInDock() && !(recording && hideWhileRecording());
}

export function desktopPresenceNeedsTray() {
	return recording || !visible();
}

/** Consume recording-icon clicks, including repeated clicks while capture finalizes. */
export function stopRecordingFromDesktopIcon(): boolean {
	if (!recording) return false;
	if (!stopRequested) {
		stopRequested = true;
		stopRecording();
	}
	return true;
}

function preferences() {
	const launchAtLoginSupported =
		app.isPackaged && (process.platform === "darwin" || process.platform === "win32");
	return {
		success: true,
		showInDock: showInDock(),
		hideWhileRecording: hideWhileRecording(),
		launchAtLogin: launchAtLoginSupported && app.getLoginItemSettings().openAtLogin,
		launchAtLoginSupported,
		platform: process.platform,
	};
}

function applyWindow(win: BrowserWindow, taskbarEligible: boolean) {
	if (win.isDestroyed()) return;
	if (process.platform !== "darwin") {
		win.setSkipTaskbar(!taskbarEligible || !visible());
	}
	if (process.platform === "win32" && taskbarEligible) {
		win.setThumbarButtons(
			recording && stopIcon && !stopIcon.isEmpty()
				? [{ tooltip: nativeT("stopRecording"), icon: stopIcon, click: stopRecording }]
				: [],
		);
	}
}

function applyPresence() {
	// Create the tray before hiding the usual entry point so controls stay reachable.
	refreshEntryPoints();
	if (process.platform === "darwin" && app.dock) {
		dockVisibility ??= createDockVisibilityController(app.dock);
		dockVisibility.setVisible(visible());
		app.dock.setMenu(
			recording
				? Menu.buildFromTemplate([
						{ label: nativeT("stopRecording"), click: stopRecording },
					])
				: Menu.buildFromTemplate([]),
		);
	}
	for (const [win, taskbarEligible] of primaryWindows) applyWindow(win, taskbarEligible);
}

/** Register only user-facing windows; capture overlays keep their own taskbar policy. */
export function registerDesktopPresenceWindow(
	win: BrowserWindow,
	taskbarEligible = true,
	controlsRecording = false,
) {
	primaryWindows.set(win, taskbarEligible);
	applyWindow(win, taskbarEligible);
	win.on("show", () => applyWindow(win, taskbarEligible));
	// Windows creates thumbnail toolbars only after the taskbar button exists.
	win.on("ready-to-show", () => applyWindow(win, taskbarEligible));
	win.once("closed", () => primaryWindows.delete(win));
	if (controlsRecording) {
		const restoreAfterLoss = () => {
			if (recording && !quitting) onRecordingOwnerLost();
		};
		win.once("closed", restoreAfterLoss);
		win.webContents.on("render-process-gone", restoreAfterLoss);
	}
}

export function setDesktopPresenceRecording(active: boolean) {
	if (recording !== active) stopRequested = false;
	recording = active;
	applyPresence();
}

export function initializeDesktopPresence(options: {
	refreshEntryPoints: () => void;
	stopRecording: () => void;
	onRecordingOwnerLost: () => void;
	stopIcon: NativeImage;
}) {
	if (initialized) return;
	initialized = true;
	refreshEntryPoints = options.refreshEntryPoints;
	stopRecording = options.stopRecording;
	onRecordingOwnerLost = options.onRecordingOwnerLost;
	stopIcon = options.stopIcon;
	app.once("before-quit", () => {
		quitting = true;
		dockVisibility?.dispose();
	});
	ipcMain.handle("get-application-preferences", () => preferences());
	ipcMain.handle("set-application-preferences", (_event, patch: unknown) => {
		if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
			return { ...preferences(), success: false, error: "Invalid application preferences." };
		}
		const values = patch as Record<string, unknown>;
		const allowed = new Set(["showInDock", "hideWhileRecording", "launchAtLogin"]);
		if (
			Object.entries(values).some(
				([key, value]) => !allowed.has(key) || typeof value !== "boolean",
			)
		) {
			return { ...preferences(), success: false, error: "Invalid application preferences." };
		}
		try {
			if (typeof values.launchAtLogin === "boolean") {
				if (!preferences().launchAtLoginSupported) {
					return {
						...preferences(),
						success: false,
						error: "Launch at login is unavailable.",
					};
				}
				app.setLoginItemSettings({ openAtLogin: values.launchAtLogin });
			}
			if (typeof values.showInDock === "boolean")
				writeAppSetting(SHOW_KEY, values.showInDock);
			if (typeof values.hideWhileRecording === "boolean") {
				writeAppSetting(HIDE_RECORDING_KEY, values.hideWhileRecording);
			}
			applyPresence();
			return preferences();
		} catch (error) {
			return { ...preferences(), success: false, error: String(error) };
		}
	});
	applyPresence();
}

export function refreshDesktopPresenceLocale() {
	if (initialized) applyPresence();
}
