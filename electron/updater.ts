import fs from "node:fs";
import path from "node:path";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { USER_DATA_PATH } from "./appPaths";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const DISMISSED_READY_REMINDER_DELAY_MS = 5 * 60 * 1000;
const AUTO_UPDATES_DISABLED = process.env.RECORDLY_DISABLE_AUTO_UPDATES === "1";
const AUTO_UPDATE_ERROR_TOASTS_DISABLED =
	process.env.RECORDLY_DISABLE_AUTO_UPDATE_ERROR_TOASTS === "1";
const UPDATE_FEED_URL_OVERRIDE = process.env.RECORDLY_UPDATE_FEED_URL?.trim() ?? "";
const UPDATER_LOG_PATH =
	process.env.RECORDLY_UPDATER_LOG_PATH?.trim() || path.join(USER_DATA_PATH, "updater.log");
const DEV_UPDATE_PREVIEW_VERSION = "9.9.9";
const DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS = 300;
const DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT = 20;
const ONE_MEGABYTE = 1024 * 1024;

export type UpdateToastPhase = "available" | "downloading" | "ready" | "error";

export type UpdateStatusKind =
	| "idle"
	| "checking"
	| "up-to-date"
	| "available"
	| "downloading"
	| "ready"
	| "error";

export interface UpdateStatusSummary {
	status: UpdateStatusKind;
	currentVersion: string;
	availableVersion: string | null;
	detail?: string;
}

export interface UpdateToastPayload {
	version: string;
	detail: string;
	phase: UpdateToastPhase;
	delayMs: number;
	isPreview?: boolean;
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	remainingBytes?: number;
	bytesPerSecond?: number;
	primaryAction?: "install-and-restart" | "retry-check";
}

interface DownloadProgressSnapshot {
	progressPercent?: number;
	transferredBytes?: number;
	totalBytes?: number;
	bytesPerSecond?: number;
}

type UpdateToastSender = (
	channel: "update-toast-state",
	payload: UpdateToastPayload | null,
) => boolean;

let updaterInitialized = false;
let updateCheckInProgress = false;
let manualCheckRequested = false;
let periodicCheckTimer: NodeJS.Timeout | null = null;
let deferredReminderTimer: NodeJS.Timeout | null = null;
let devPreviewProgressTimer: NodeJS.Timeout | null = null;
let currentToastPayload: UpdateToastPayload | null = null;
let availableVersion: string | null = null;
let pendingDownloadedVersion: string | null = null;
let downloadInProgress = false;
let downloadToastDismissed = false;
let skippedVersion: string | null = null;
let updateCheckErrorHandled = false;
let installAfterDownloadRequested = false;
let activeUpdateToastSender: UpdateToastSender | undefined;
let updateStatusSummary: UpdateStatusSummary = {
	status: "idle",
	currentVersion: app.getVersion(),
	availableVersion: null,
};

function setUpdateStatusSummary(summary: Partial<UpdateStatusSummary>) {
	updateStatusSummary = {
		...updateStatusSummary,
		currentVersion: app.getVersion(),
		...summary,
	};
}

function summarizeError(error: unknown) {
	if (error instanceof Error) {
		return error.stack || `${error.name}: ${error.message}`;
	}

	return String(error);
}

function writeUpdaterLog(message: string, detail?: unknown) {
	try {
		fs.mkdirSync(path.dirname(UPDATER_LOG_PATH), { recursive: true });
		const suffix = detail === undefined ? "" : ` ${summarizeError(detail)}`;
		fs.appendFileSync(
			UPDATER_LOG_PATH,
			`${new Date().toISOString()} ${message}${suffix}\n`,
			"utf8",
		);
	} catch (logError) {
		console.error("Failed to write updater log:", logError);
	}
}

function createAutoCheckErrorToastPayload(): UpdateToastPayload {
	return {
		version: app.getVersion(),
		phase: "error",
		detail: "Recordly could not check for updates automatically. Retry now, or inspect updater.log in your user data folder.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "retry-check",
	};
}

function shouldSurfaceAutomaticCheckErrors() {
	return !AUTO_UPDATE_ERROR_TOASTS_DISABLED;
}

function configureUpdateFeed() {
	if (!UPDATE_FEED_URL_OVERRIDE) {
		writeUpdaterLog("Using published GitHub update feed.");
		return;
	}

	autoUpdater.setFeedURL({
		provider: "generic",
		url: UPDATE_FEED_URL_OVERRIDE,
		channel: "latest",
	});
	writeUpdaterLog(`Using overridden update feed: ${UPDATE_FEED_URL_OVERRIDE}`);
}

function canUseAutoUpdates() {
	return !AUTO_UPDATES_DISABLED && app.isPackaged && !process.mas;
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

function clearDevPreviewProgressTimer() {
	if (devPreviewProgressTimer) {
		clearInterval(devPreviewProgressTimer);
		devPreviewProgressTimer = null;
	}
}

function emitUpdateToastState(
	sendToRenderer: UpdateToastSender | undefined,
	payload: UpdateToastPayload | null,
) {
	currentToastPayload = payload;
	if (!sendToRenderer) {
		return false;
	}

	return sendToRenderer("update-toast-state", payload);
}

function createAvailableUpdateToastPayload(version: string): UpdateToastPayload {
	return {
		version,
		phase: "available",
		detail: "Install the latest version now, or remind yourself to come back to it later.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "install-and-restart",
	};
}

function createDownloadingUpdateToastPayload(
	version: string,
	progress: DownloadProgressSnapshot = {},
): UpdateToastPayload {
	const normalizedProgress = Math.max(
		0,
		Math.min(100, Math.round(progress.progressPercent ?? 0)),
	);
	const transferredBytes =
		typeof progress.transferredBytes === "number" && Number.isFinite(progress.transferredBytes)
			? Math.max(0, progress.transferredBytes)
			: undefined;
	const totalBytes =
		typeof progress.totalBytes === "number" && Number.isFinite(progress.totalBytes)
			? Math.max(0, progress.totalBytes)
			: undefined;
	const remainingBytes =
		totalBytes !== undefined && transferredBytes !== undefined
			? Math.max(totalBytes - transferredBytes, 0)
			: undefined;
	const bytesPerSecond =
		typeof progress.bytesPerSecond === "number" && Number.isFinite(progress.bytesPerSecond)
			? Math.max(0, progress.bytesPerSecond)
			: undefined;
	const remainingMb =
		remainingBytes !== undefined ? Math.max(0, remainingBytes / ONE_MEGABYTE) : null;
	return {
		version,
		phase: "downloading",
		detail:
			normalizedProgress >= 100
				? "Finishing the update download. Recordly will restart as soon as the installer is ready."
				: remainingMb !== null
					? `${remainingMb.toFixed(1)} MB left before Recordly restarts.`
					: "Downloading the update now. Recordly will restart when it finishes.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		progressPercent: normalizedProgress,
		transferredBytes,
		totalBytes,
		remainingBytes,
		bytesPerSecond,
		primaryAction: "install-and-restart",
	};
}

function createDownloadedUpdateToastPayload(version: string): UpdateToastPayload {
	return {
		version,
		phase: "ready",
		detail: "The update is ready. Install and restart now, or remind yourself later.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "install-and-restart",
	};
}

function createUpdateErrorToastPayload(version: string, error: unknown): UpdateToastPayload {
	return {
		version,
		phase: "error",
		detail: `The update could not be downloaded. ${String(error)}`,
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "install-and-restart",
	};
}

function getReminderPayload(): UpdateToastPayload | null {
	if (pendingDownloadedVersion) {
		return createDownloadedUpdateToastPayload(pendingDownloadedVersion);
	}

	if (availableVersion && !downloadInProgress) {
		return createAvailableUpdateToastPayload(availableVersion);
	}

	return null;
}

function clearVisibleUpdateToast(sendToRenderer?: UpdateToastSender) {
	emitUpdateToastState(sendToRenderer, null);
}

export function getCurrentUpdateToastPayload() {
	return currentToastPayload;
}

export function getUpdaterLogPath() {
	return UPDATER_LOG_PATH;
}

export function getUpdateStatusSummary() {
	return updateStatusSummary;
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

function resetDevPreviewState(sendToRenderer?: UpdateToastSender) {
	clearDevPreviewProgressTimer();
	availableVersion = null;
	pendingDownloadedVersion = null;
	downloadInProgress = false;
	downloadToastDismissed = false;
	skippedVersion = null;
	installAfterDownloadRequested = false;
	clearVisibleUpdateToast(sendToRenderer);
}

function simulateDevPreviewDownload(sendToRenderer?: UpdateToastSender) {
	availableVersion = DEV_UPDATE_PREVIEW_VERSION;
	pendingDownloadedVersion = null;
	downloadInProgress = true;
	downloadToastDismissed = false;
	clearDeferredReminderTimer();
	clearDevPreviewProgressTimer();

	let progressPercent = 0;
	emitUpdateToastState(sendToRenderer, {
		...createDownloadingUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION, {
			progressPercent,
			transferredBytes: 0,
			totalBytes: 20 * ONE_MEGABYTE,
			bytesPerSecond: 5 * ONE_MEGABYTE,
		}),
		isPreview: true,
	});

	devPreviewProgressTimer = setInterval(() => {
		progressPercent = Math.min(100, progressPercent + DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT);

		if (progressPercent >= 100) {
			clearDevPreviewProgressTimer();
			downloadInProgress = false;
			pendingDownloadedVersion = DEV_UPDATE_PREVIEW_VERSION;
			emitUpdateToastState(sendToRenderer, {
				...createDownloadedUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION),
				isPreview: true,
				detail: "Development preview: the update is ready to install. No real update will be installed.",
			});
			return;
		}

		if (downloadToastDismissed) {
			return;
		}

		emitUpdateToastState(sendToRenderer, {
			...createDownloadingUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION, {
				progressPercent,
				transferredBytes: (progressPercent / 100) * 20 * ONE_MEGABYTE,
				totalBytes: 20 * ONE_MEGABYTE,
				bytesPerSecond: 5 * ONE_MEGABYTE,
			}),
			isPreview: true,
		});
	}, DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS);

	return { success: true };
}

export function dismissUpdateToast(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer?: UpdateToastSender,
) {
	if (currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return { success: true };
	}

	if (downloadInProgress) {
		installAfterDownloadRequested = false;
		downloadToastDismissed = true;
		clearVisibleUpdateToast(sendToRenderer);
		return { success: true };
	}

	if (currentToastPayload?.phase === "ready") {
		return deferUpdateReminder(
			getMainWindow,
			sendToRenderer,
			DISMISSED_READY_REMINDER_DELAY_MS,
		);
	}

	if (currentToastPayload?.phase === "available" || currentToastPayload?.phase === "error") {
		return deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
	}

	clearVisibleUpdateToast(sendToRenderer);
	return { success: true };
}

export function installDownloadedUpdateNow(sendToRenderer?: UpdateToastSender) {
	if (currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return;
	}

	clearDeferredReminderTimer();
	downloadToastDismissed = false;
	installAfterDownloadRequested = false;
	clearVisibleUpdateToast(sendToRenderer);
	setUpdateStatusSummary({ status: "ready", availableVersion: pendingDownloadedVersion });
	writeUpdaterLog("Installing downloaded update.");
	autoUpdater.quitAndInstall();
}

export async function downloadAvailableUpdate(
	sendToRenderer?: UpdateToastSender,
	options?: { installAfterDownload?: boolean },
) {
	if (currentToastPayload?.isPreview) {
		return simulateDevPreviewDownload(sendToRenderer);
	}

	if (!availableVersion) {
		return { success: false, message: "No update is ready to download." };
	}

	if (pendingDownloadedVersion === availableVersion) {
		return { success: false, message: "This update has already been downloaded." };
	}

	if (downloadInProgress) {
		return { success: false, message: "This update is already downloading." };
	}

	clearDeferredReminderTimer();
	downloadInProgress = true;
	downloadToastDismissed = false;
	installAfterDownloadRequested =
		Boolean(options?.installAfterDownload) || installAfterDownloadRequested;
	setUpdateStatusSummary({
		status: "downloading",
		availableVersion,
		detail: `Downloading Recordly ${availableVersion}`,
	});
	emitUpdateToastState(
		sendToRenderer,
		createDownloadingUpdateToastPayload(availableVersion, {
			progressPercent: 0,
			transferredBytes: 0,
		}),
	);
	writeUpdaterLog(`Starting update download for ${availableVersion}.`);

	try {
		await autoUpdater.downloadUpdate();
		writeUpdaterLog(`Update download requested for ${availableVersion}.`);
		return { success: true };
	} catch (error) {
		downloadInProgress = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog(`Update download failed for ${availableVersion}.`, error);
		emitUpdateToastState(
			sendToRenderer,
			createUpdateErrorToastPayload(availableVersion, error),
		);
		return { success: false, message: String(error) };
	}
}

export function deferUpdateReminder(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer?: UpdateToastSender,
	delayMs = UPDATE_REMINDER_DELAY_MS,
) {
	const payload = getReminderPayload();
	if (!payload) {
		return { success: false, message: "No update reminder is ready yet." };
	}

	clearDeferredReminderTimer();
	installAfterDownloadRequested = false;
	clearVisibleUpdateToast(sendToRenderer);
	deferredReminderTimer = setTimeout(() => {
		const nextPayload = getReminderPayload();
		if (!nextPayload) {
			return;
		}

		if (sendToRenderer && emitUpdateToastState(sendToRenderer, nextPayload)) {
			return;
		}

		if (nextPayload.phase === "ready") {
			void showDownloadedUpdateDialog(getMainWindow, nextPayload.version);
			return;
		}

		void showAvailableUpdateDialog(getMainWindow, nextPayload.version, sendToRenderer);
	}, delayMs);

	return { success: true };
}

export function skipAvailableUpdateVersion(sendToRenderer?: UpdateToastSender) {
	const versionToSkip = pendingDownloadedVersion ?? availableVersion;
	if (!versionToSkip) {
		return { success: false, message: "No update is available to skip." };
	}

	skippedVersion = versionToSkip;
	if (pendingDownloadedVersion === versionToSkip) {
		pendingDownloadedVersion = null;
	}
	if (availableVersion === versionToSkip) {
		availableVersion = null;
	}
	downloadInProgress = false;
	downloadToastDismissed = false;
	installAfterDownloadRequested = false;
	clearDeferredReminderTimer();
	clearVisibleUpdateToast(sendToRenderer);

	return { success: true };
}

export function previewUpdateToast(sendToRenderer: UpdateToastSender) {
	clearDeferredReminderTimer();
	clearDevPreviewProgressTimer();
	availableVersion = DEV_UPDATE_PREVIEW_VERSION;
	pendingDownloadedVersion = null;
	downloadInProgress = false;
	downloadToastDismissed = false;
	installAfterDownloadRequested = false;
	return emitUpdateToastState(sendToRenderer, {
		version: DEV_UPDATE_PREVIEW_VERSION,
		phase: "available",
		detail: "This is a development preview of the in-app update toast.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isPreview: true,
	});
}

async function showAvailableUpdateDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
	sendToRenderer?: UpdateToastSender,
) {
	const result = await showMessageBox(getMainWindow, {
		type: "info",
		title: "Update Available",
		message: `Recordly ${version} is available.`,
		detail: "Install and restart now, or remind me later.",
		buttons: ["Install & Restart", "Later"],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		await downloadAvailableUpdate(sendToRenderer, { installAfterDownload: true });
		return;
	}

	deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
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
			: "Install and restart now, or remind me later.",
		buttons: ["Install & Restart", "Later"],
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
				detail: "This was only a manual development preview of the update prompt.",
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

		deferUpdateReminder(getMainWindow, undefined, UPDATE_REMINDER_DELAY_MS);
	}
}

export async function checkForAppUpdates(
	getMainWindow: () => BrowserWindow | null,
	options?: { manual?: boolean },
) {
	if (!canUseAutoUpdates()) {
		writeUpdaterLog(
			`Skipped update check because auto-updates are unavailable. packaged=${app.isPackaged} mas=${process.mas ? "yes" : "no"} disabled=${AUTO_UPDATES_DISABLED ? "yes" : "no"}`,
		);
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
		writeUpdaterLog("Skipped update check because a previous check is still running.");
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
	updateCheckErrorHandled = false;
	setUpdateStatusSummary({ status: "checking", detail: "Checking for updates..." });
	writeUpdaterLog(`Starting ${manualCheckRequested ? "manual" : "automatic"} update check.`);

	try {
		await autoUpdater.checkForUpdates();
		writeUpdaterLog("Update check request completed.");
	} catch (error) {
		updateCheckInProgress = false;
		const shouldReport = manualCheckRequested;
		manualCheckRequested = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("Update check failed.", error);
		console.error("Auto-update check failed:", error);
		if (shouldReport && !updateCheckErrorHandled) {
			await showUpdateErrorDialog(getMainWindow, error);
		} else if (!updateCheckErrorHandled && shouldSurfaceAutomaticCheckErrors()) {
			emitUpdateToastState(activeUpdateToastSender, createAutoCheckErrorToastPayload());
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

	if (!canUseAutoUpdates()) {
		setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
		return;
	}

	updaterInitialized = true;
	activeUpdateToastSender = sendToRenderer;
	configureUpdateFeed();
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	writeUpdaterLog(`Updater initialized. logPath=${UPDATER_LOG_PATH}`);

	autoUpdater.on("checking-for-update", () => {
		setUpdateStatusSummary({
			status: "checking",
			availableVersion: null,
			detail: "Checking for updates...",
		});
		writeUpdaterLog("electron-updater emitted checking-for-update.");
	});

	autoUpdater.on("update-available", (info) => {
		writeUpdaterLog(`Update available: version=${info.version}`);
		updateCheckInProgress = false;
		availableVersion = info.version;
		pendingDownloadedVersion = null;
		downloadInProgress = false;
		downloadToastDismissed = false;
		installAfterDownloadRequested = false;
		setUpdateStatusSummary({
			status: "available",
			availableVersion: info.version,
			detail: `Recordly ${info.version} is available.`,
		});
		if (skippedVersion === info.version) {
			manualCheckRequested = false;
			return;
		}

		const payload = createAvailableUpdateToastPayload(info.version);
		if (emitUpdateToastState(sendToRenderer, payload)) {
			manualCheckRequested = false;
			return;
		}

		if (manualCheckRequested) {
			void showAvailableUpdateDialog(getMainWindow, info.version, sendToRenderer);
			manualCheckRequested = false;
		}
	});

	autoUpdater.on("update-not-available", () => {
		writeUpdaterLog("No update available.");
		updateCheckInProgress = false;
		availableVersion = null;
		pendingDownloadedVersion = null;
		downloadInProgress = false;
		downloadToastDismissed = false;
		installAfterDownloadRequested = false;
		setUpdateStatusSummary({
			status: "up-to-date",
			availableVersion: null,
			detail: `Recordly ${app.getVersion()} is up to date.`,
		});
		clearVisibleUpdateToast(sendToRenderer);
		const shouldReport = manualCheckRequested;
		manualCheckRequested = false;
		if (shouldReport) {
			void showNoUpdatesDialog(getMainWindow);
		}
	});

	autoUpdater.on("download-progress", (progress) => {
		if (!availableVersion) {
			return;
		}

		downloadInProgress = true;
		setUpdateStatusSummary({
			status: "downloading",
			availableVersion,
			detail: `Downloading Recordly ${availableVersion}`,
		});
		writeUpdaterLog(
			`Download progress for ${availableVersion}: ${progress.percent.toFixed(1)}%`,
		);
		if (downloadToastDismissed) {
			return;
		}

		emitUpdateToastState(
			sendToRenderer,
			createDownloadingUpdateToastPayload(availableVersion, {
				progressPercent: progress.percent,
				transferredBytes: progress.transferred,
				totalBytes: progress.total,
				bytesPerSecond: progress.bytesPerSecond,
			}),
		);
	});

	autoUpdater.on("error", (error) => {
		updateCheckInProgress = false;
		const shouldReport = manualCheckRequested;
		manualCheckRequested = false;
		if (!downloadInProgress) {
			updateCheckErrorHandled = true;
		}
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("electron-updater emitted error.", error);
		console.error("Auto-updater error:", error);
		if (downloadInProgress && availableVersion) {
			downloadInProgress = false;
			downloadToastDismissed = false;
			installAfterDownloadRequested = false;
			emitUpdateToastState(
				sendToRenderer,
				createUpdateErrorToastPayload(availableVersion, error),
			);
		}
		if (shouldReport) {
			void showUpdateErrorDialog(getMainWindow, error);
		} else if (shouldSurfaceAutomaticCheckErrors()) {
			emitUpdateToastState(sendToRenderer, createAutoCheckErrorToastPayload());
		}
	});

	autoUpdater.on("update-downloaded", (info) => {
		writeUpdaterLog(`Update downloaded: version=${info.version}`);
		updateCheckInProgress = false;
		manualCheckRequested = false;
		downloadInProgress = false;
		downloadToastDismissed = false;
		if (skippedVersion === info.version) {
			installAfterDownloadRequested = false;
			return;
		}
		availableVersion = info.version;
		pendingDownloadedVersion = info.version;
		setUpdateStatusSummary({
			status: "ready",
			availableVersion: info.version,
			detail: `Recordly ${info.version} is ready to install.`,
		});
		clearDeferredReminderTimer();

		if (installAfterDownloadRequested && !currentToastPayload?.isPreview) {
			installAfterDownloadRequested = false;
			clearVisibleUpdateToast(sendToRenderer);
			writeUpdaterLog(`Auto-installing downloaded update: version=${info.version}`);
			setImmediate(() => {
				installDownloadedUpdateNow(sendToRenderer);
			});
			return;
		}

		if (
			emitUpdateToastState(sendToRenderer, createDownloadedUpdateToastPayload(info.version))
		) {
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
		clearDevPreviewProgressTimer();
		if (periodicCheckTimer) {
			clearInterval(periodicCheckTimer);
			periodicCheckTimer = null;
		}
	});
}
