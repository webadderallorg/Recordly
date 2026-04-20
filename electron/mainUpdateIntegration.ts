import path from "node:path";
import { BrowserWindow, ipcMain, Notification, nativeImage } from "electron";
import type { UpdateToastPayload } from "./updater";
import {
	checkForAppUpdates,
	deferUpdateReminder,
	dismissUpdateToast,
	downloadAvailableUpdate,
	getCurrentUpdateToastPayload,
	getUpdaterLogPath,
	getUpdateStatusSummary,
	installDownloadedUpdateNow,
	previewUpdateToast,
	setupAutoUpdates,
	skipAvailableUpdateVersion,
} from "./updater";
import { mainRuntimeState } from "./mainRuntimeState";
import { getHudOverlayWindow, getUpdateToastWindow, hideUpdateToastWindow, showUpdateToastWindow } from "./windows";

interface MainUpdateIntegrationDependencies {
	rendererDist: string;
	focusOrCreateMainWindow: () => void;
	reassertHudOverlayMouseState: () => void;
}

let deps: MainUpdateIntegrationDependencies | null = null;

function requireDeps() {
	if (!deps) {
		throw new Error("mainUpdateIntegration has not been initialized");
	}
	return deps;
}

function getPublicAssetPath(filename: string) {
	return path.join(process.env.VITE_PUBLIC || requireDeps().rendererDist, filename);
}

function getAppImage(filename: string) {
	return nativeImage.createFromPath(getPublicAssetPath(filename));
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
	if (mainRuntimeState.activeUpdateNotification) {
		mainRuntimeState.activeUpdateNotification.close();
		mainRuntimeState.activeUpdateNotification = null;
	}
	mainRuntimeState.activeUpdateNotificationKey = null;
}

export function initializeMainUpdateIntegration(nextDeps: MainUpdateIntegrationDependencies) {
	deps = nextDeps;
}

export function sendUpdateToastToWindows(channel: "update-toast-state", payload: unknown) {
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
		if (mainRuntimeState.activeUpdateNotificationKey === notificationKey) {
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
			requireDeps().focusOrCreateMainWindow();
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
			if (mainRuntimeState.activeUpdateNotification === notification) {
				mainRuntimeState.activeUpdateNotification = null;
				mainRuntimeState.activeUpdateNotificationKey = null;
			}
		});

		notification.show();
		requireDeps().reassertHudOverlayMouseState();
		mainRuntimeState.activeUpdateNotification = notification;
		mainRuntimeState.activeUpdateNotificationKey = notificationKey;
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

export function getUpdateDialogWindow() {
	const focusedWindow = BrowserWindow.getFocusedWindow();
	if (focusedWindow && !focusedWindow.isDestroyed()) {
		return focusedWindow;
	}

	if (mainRuntimeState.mainWindow && !mainRuntimeState.mainWindow.isDestroyed()) {
		return mainRuntimeState.mainWindow;
	}

	return getHudOverlayWindow();
}

export function registerUpdateIpcHandlers() {
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
}

export function runManualUpdateCheck() {
	void checkForAppUpdates(getUpdateDialogWindow, { manual: true });
}

export function setupMainAutoUpdates() {
	setupAutoUpdates(getUpdateDialogWindow, sendUpdateToastToWindows);
	const currentToastPayload = getCurrentUpdateToastPayload();
	if (currentToastPayload) {
		sendUpdateToastToWindows("update-toast-state", currentToastPayload);
	}
}