import fs from "node:fs";
import path from "node:path";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import { USER_DATA_PATH } from "./appPaths";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
export const DISMISSED_READY_REMINDER_DELAY_MS = 5 * 60 * 1000;
export const AUTO_UPDATES_DISABLED = process.env.RECORDLY_DISABLE_AUTO_UPDATES === "1";
const AUTO_UPDATE_ERROR_TOASTS_DISABLED =
	process.env.RECORDLY_DISABLE_AUTO_UPDATE_ERROR_TOASTS === "1";
const UPDATE_FEED_URL_OVERRIDE = process.env.RECORDLY_UPDATE_FEED_URL?.trim() ?? "";
export const UPDATER_LOG_PATH =
	process.env.RECORDLY_UPDATER_LOG_PATH?.trim() || path.join(USER_DATA_PATH, "updater.log");
export const DEV_UPDATE_PREVIEW_VERSION = "9.9.9";
export const DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS = 300;
export const DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT = 20;

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
	primaryAction?: "download-update" | "install-update" | "retry-check";
}

export type UpdateToastSender = (
	channel: "update-toast-state",
	payload: UpdateToastPayload | null,
) => boolean;

export type GetMainWindow = () => BrowserWindow | null;

export interface UpdaterState {
	updaterInitialized: boolean;
	updateCheckInProgress: boolean;
	manualCheckRequested: boolean;
	periodicCheckTimer: NodeJS.Timeout | null;
	deferredReminderTimer: NodeJS.Timeout | null;
	devPreviewProgressTimer: NodeJS.Timeout | null;
	currentToastPayload: UpdateToastPayload | null;
	availableVersion: string | null;
	pendingDownloadedVersion: string | null;
	downloadInProgress: boolean;
	downloadToastDismissed: boolean;
	skippedVersion: string | null;
	updateCheckErrorHandled: boolean;
	activeUpdateToastSender?: UpdateToastSender;
	updateStatusSummary: UpdateStatusSummary;
}

export const updaterState: UpdaterState = {
	updaterInitialized: false,
	updateCheckInProgress: false,
	manualCheckRequested: false,
	periodicCheckTimer: null,
	deferredReminderTimer: null,
	devPreviewProgressTimer: null,
	currentToastPayload: null,
	availableVersion: null,
	pendingDownloadedVersion: null,
	downloadInProgress: false,
	downloadToastDismissed: false,
	skippedVersion: null,
	updateCheckErrorHandled: false,
	activeUpdateToastSender: undefined,
	updateStatusSummary: {
		status: "idle",
		currentVersion: app.getVersion(),
		availableVersion: null,
	},
};

export function getUpdateCheckIntervalMs() {
	return UPDATE_CHECK_INTERVAL_MS;
}

export function setUpdateStatusSummary(summary: Partial<UpdateStatusSummary>) {
	updaterState.updateStatusSummary = {
		...updaterState.updateStatusSummary,
		currentVersion: app.getVersion(),
		...summary,
	};
}

export function summarizeError(error: unknown) {
	if (error instanceof Error) {
		return error.stack || `${error.name}: ${error.message}`;
	}

	return String(error);
}

export function writeUpdaterLog(message: string, detail?: unknown) {
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

export function createAutoCheckErrorToastPayload(): UpdateToastPayload {
	return {
		version: app.getVersion(),
		phase: "error",
		detail: "Recordly could not check for updates automatically. Retry now, or inspect updater.log in your user data folder.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "retry-check",
	};
}

export function shouldSurfaceAutomaticCheckErrors() {
	return !AUTO_UPDATE_ERROR_TOASTS_DISABLED;
}

export function configureUpdateFeed() {
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

export function canUseAutoUpdates() {
	return !AUTO_UPDATES_DISABLED && app.isPackaged && !process.mas;
}

export function isAutoUpdateFeatureEnabled() {
	return !AUTO_UPDATES_DISABLED;
}

export function getDialogWindow(getMainWindow: GetMainWindow) {
	const window = getMainWindow();
	return window && !window.isDestroyed() ? window : undefined;
}

export function showMessageBox(
	getMainWindow: GetMainWindow,
	options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
	const window = getDialogWindow(getMainWindow);
	return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

export function clearDeferredReminderTimer() {
	if (updaterState.deferredReminderTimer) {
		clearTimeout(updaterState.deferredReminderTimer);
		updaterState.deferredReminderTimer = null;
	}
}

export function clearDevPreviewProgressTimer() {
	if (updaterState.devPreviewProgressTimer) {
		clearInterval(updaterState.devPreviewProgressTimer);
		updaterState.devPreviewProgressTimer = null;
	}
}

export function emitUpdateToastState(
	sendToRenderer: UpdateToastSender | undefined,
	payload: UpdateToastPayload | null,
) {
	updaterState.currentToastPayload = payload;
	if (!sendToRenderer) {
		return false;
	}

	return sendToRenderer("update-toast-state", payload);
}

export function createAvailableUpdateToastPayload(version: string): UpdateToastPayload {
	return {
		version,
		phase: "available",
		detail: "A new version is available. Download it now, or wait and we will remind you again in 3 hours.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "download-update",
	};
}

export function createDownloadingUpdateToastPayload(
	version: string,
	progressPercent = 0,
): UpdateToastPayload {
	const normalizedProgress = Math.max(0, Math.min(100, progressPercent));
	return {
		version,
		phase: "downloading",
		detail:
			normalizedProgress >= 100
				? "Finishing the update download. You can keep using Recordly while this completes."
				: `Downloading the update in the foreground: ${normalizedProgress.toFixed(0)}% complete.`,
		delayMs: UPDATE_REMINDER_DELAY_MS,
		progressPercent: normalizedProgress,
	};
}

export function createDownloadedUpdateToastPayload(version: string): UpdateToastPayload {
	return {
		version,
		phase: "ready",
		detail: "Install now to restart into the new version, or wait and we will remind you again in 3 hours.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "install-update",
	};
}

export function createUpdateErrorToastPayload(
	version: string,
	error: unknown,
): UpdateToastPayload {
	return {
		version,
		phase: "error",
		detail: `The update download failed. ${String(error)}`,
		delayMs: UPDATE_REMINDER_DELAY_MS,
		primaryAction: "download-update",
	};
}

export function getReminderPayload(): UpdateToastPayload | null {
	if (updaterState.pendingDownloadedVersion) {
		return createDownloadedUpdateToastPayload(updaterState.pendingDownloadedVersion);
	}

	if (updaterState.availableVersion && !updaterState.downloadInProgress) {
		return createAvailableUpdateToastPayload(updaterState.availableVersion);
	}

	return null;
}

export function clearVisibleUpdateToast(sendToRenderer?: UpdateToastSender) {
	emitUpdateToastState(sendToRenderer, null);
}