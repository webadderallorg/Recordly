import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const AUTO_UPDATES_DISABLED = process.env.RECORDLY_DISABLE_AUTO_UPDATES === "1";
const DEV_UPDATE_PREVIEW_INTERVAL_MS = 10 * 1000;

export interface UpdateToastPayload {
	version: string;
	detail: string;
	delayMs: number;
	isPreview?: boolean;
}

type UpdateToastSender = (channel: "update-ready-toast", payload: UpdateToastPayload) => boolean;

let updaterInitialized = false;
let updateCheckInProgress = false;
let manualCheckRequested = false;
let periodicCheckTimer: NodeJS.Timeout | null = null;
let deferredReminderTimer: NodeJS.Timeout | null = null;
let devPreviewTimer: NodeJS.Timeout | null = null;
let pendingDownloadedVersion: string | null = null;
let skippedVersion: string | null = null;

function canUseAutoUpdates() {
	return !AUTO_UPDATES_DISABLED && app.isPackaged && !process.mas;
}

function canUseDevUpdatePreview() {
	return false;
}

export function isAutoUpdateFeatureEnabled() {
	return !AUTO_UPDATES_DISABLED;
}

function getDialogWindow(getMainWindow: () => BrowserWindow | null) {
	const window = getMainWindow();
	return window && !window.isDestroyed() ? window : undefined;
}

function showMessageBox(
	getMainWindow: () => BrowserWindow | null,
	options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
	const window = getDialogWindow(getMainWindow);
	return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function clearDeferredReminderTimer() {
	if (deferredReminderTimer) {
		clearTimeout(deferredReminderTimer);
		deferredReminderTimer = null;
	}
}

function clearDevPreviewTimer() {
	if (devPreviewTimer) {
		clearTimeout(devPreviewTimer);
		devPreviewTimer = null;
	}
}

function sendUpdateToast(sendToRenderer: UpdateToastSender, payload: UpdateToastPayload) {
	return sendToRenderer("update-ready-toast", payload);
}

function createDownloadedUpdateToastPayload(version: string): UpdateToastPayload {
	return {
		version,
		detail: "Restart now to install the update, or wait and we will remind you again in 3 hours.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
	};
}

async function showNoUpdatesDialog(getMainWindow: () => BrowserWindow | null) {
	await showMessageBox(getMainWindow, {
		type: "info",
		title: "No Updates Available",
		message: "Recordly is up to date.",
		detail: `You are running version ${app.getVersion()}.`,
	});
}

async function showUpdateErrorDialog(getMainWindow: () => BrowserWindow | null, error: unknown) {
	await showMessageBox(getMainWindow, {
		type: "error",
		title: "Update Check Failed",
		message: "Recordly could not check for updates.",
		detail: String(error),
	});
}

function scheduleDevUpdatePreview(sendToRenderer: UpdateToastSender) {
	clearDevPreviewTimer();
	devPreviewTimer = setTimeout(() => {
		previewUpdateToast(sendToRenderer);
		scheduleDevUpdatePreview(sendToRenderer);
	}, DEV_UPDATE_PREVIEW_INTERVAL_MS);
}

export function installDownloadedUpdateNow() {
	clearDeferredReminderTimer();
	clearDevPreviewTimer();
	autoUpdater.quitAndInstall();
}

export function skipDownloadedUpdateVersion(version?: string) {
	if (!version && !pendingDownloadedVersion) {
		return { success: false, message: "No downloaded update is ready yet." };
	}

	skippedVersion = version ?? pendingDownloadedVersion;
	pendingDownloadedVersion = null;
	clearDeferredReminderTimer();
	clearDevPreviewTimer();
	return { success: true };
}

export function deferDownloadedUpdateReminder(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer?: UpdateToastSender,
	delayMs = UPDATE_REMINDER_DELAY_MS,
) {
	if (!pendingDownloadedVersion) {
		return { success: false, message: "No downloaded update is ready yet." };
	}

	clearDeferredReminderTimer();
	deferredReminderTimer = setTimeout(() => {
		if (pendingDownloadedVersion) {
			if (sendToRenderer) {
				const payload = createDownloadedUpdateToastPayload(pendingDownloadedVersion);
				if (sendUpdateToast(sendToRenderer, payload)) {
					return;
				}
			}

			void showDownloadedUpdateDialog(getMainWindow, pendingDownloadedVersion);
		}
	}, delayMs);

	return { success: true };
}

export function previewUpdateToast(sendToRenderer: UpdateToastSender) {
	skippedVersion = null;
	return sendUpdateToast(sendToRenderer, {
		version: "9.9.9",
		detail: "This is a development preview of the in-app update toast.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isPreview: true,
	});
}

async function showDownloadedUpdateDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
    options?: { isPreview?: boolean },
) {
	const isPreview = Boolean(options?.isPreview);
	const result = await showMessageBox(getMainWindow, {
		type: "info",
		title: "Update Ready",
		message: isPreview
			? `Recordly ${version} is ready to install.`
			: `Recordly ${version} has been downloaded.`,
		detail: isPreview
			? "Development preview of the native update prompt. No real update will be installed."
			: "Install now, remind me in 3 hours, or skip this version.",
		buttons: ["Update Now", "Remind Me in 3 Hours", "Skip This Version"],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		if (isPreview) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: "Preview Only",
				message: "No real update was installed.",
				detail: "The development preview will appear again in 10 seconds.",
			});
			return;
		}

		clearDeferredReminderTimer();
		setImmediate(() => {
			installDownloadedUpdateNow();
		});
		return;
	}

	if (result.response === 1) {
		if (isPreview) {
			return;
		}

		deferDownloadedUpdateReminder(getMainWindow, undefined, UPDATE_REMINDER_DELAY_MS);
		return;
	}

	if (isPreview) {
		return;
	}

	skippedVersion = version;
	pendingDownloadedVersion = null;
	clearDeferredReminderTimer();
}

export async function checkForAppUpdates(
	getMainWindow: () => BrowserWindow | null,
	options?: { manual?: boolean },
) {
	if (!canUseAutoUpdates()) {
		if (options?.manual) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: "Updates Not Enabled",
				message: "Auto-updates are only available in packaged releases.",
				detail: AUTO_UPDATES_DISABLED
					? "This build disabled auto-updates through RECORDLY_DISABLE_AUTO_UPDATES=1."
					: "Development builds do not ship the packaged update metadata required by electron-updater.",
			});
		}
		return;
	}

	if (updateCheckInProgress) {
		if (options?.manual) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: "Update Check In Progress",
				message: "Recordly is already checking for updates.",
			});
		}
		return;
	}

	manualCheckRequested = Boolean(options?.manual);
	updateCheckInProgress = true;

	try {
		await autoUpdater.checkForUpdates();
	} catch (error) {
		updateCheckInProgress = false;
		const shouldReport = manualCheckRequested;
		manualCheckRequested = false;
		console.error("Auto-update check failed:", error);
		if (shouldReport) {
			await showUpdateErrorDialog(getMainWindow, error);
		}
	}
}

export function setupAutoUpdates(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer: UpdateToastSender,
) {
	if (updaterInitialized) {
		return;
	}

	if (canUseDevUpdatePreview()) {
		updaterInitialized = true;
		scheduleDevUpdatePreview(sendToRenderer);

		app.on("before-quit", () => {
			clearDeferredReminderTimer();
			clearDevPreviewTimer();
			if (periodicCheckTimer) {
				clearInterval(periodicCheckTimer);
				periodicCheckTimer = null;
			}
		});
		return;
	}

	if (!canUseAutoUpdates()) {
		return;
	}

	updaterInitialized = true;
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("update-available", (info) => {
		updateCheckInProgress = false;
		if (!manualCheckRequested) {
			return;
		}

		void showMessageBox(getMainWindow, {
			type: "info",
			title: "Update Available",
			message: `Recordly ${info.version} is available.`,
			detail: "The update is downloading in the background and you will see a native update prompt when it is ready.",
		});
	});

	autoUpdater.on("update-not-available", () => {
		updateCheckInProgress = false;
		const shouldReport = manualCheckRequested;
		manualCheckRequested = false;
		if (shouldReport) {
			void showNoUpdatesDialog(getMainWindow);
		}
	});

	autoUpdater.on("error", (error) => {
		updateCheckInProgress = false;
		const shouldReport = manualCheckRequested;
		manualCheckRequested = false;
		console.error("Auto-updater error:", error);
		if (shouldReport) {
			void showUpdateErrorDialog(getMainWindow, error);
		}
	});

	autoUpdater.on("update-downloaded", (info) => {
		updateCheckInProgress = false;
		manualCheckRequested = false;
		if (skippedVersion === info.version) {
			return;
		}
		pendingDownloadedVersion = info.version;
		clearDeferredReminderTimer();

		if (sendUpdateToast(sendToRenderer, createDownloadedUpdateToastPayload(info.version))) {
			return;
		}

		void showDownloadedUpdateDialog(getMainWindow, info.version);
	});

	void checkForAppUpdates(getMainWindow);
	periodicCheckTimer = setInterval(() => {
		void checkForAppUpdates(getMainWindow);
	}, UPDATE_CHECK_INTERVAL_MS);

	app.on("before-quit", () => {
		clearDeferredReminderTimer();
		clearDevPreviewTimer();
		if (periodicCheckTimer) {
			clearInterval(periodicCheckTimer);
			periodicCheckTimer = null;
		}
	});
}