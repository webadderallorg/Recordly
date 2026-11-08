import { nativeT, nativeNumber } from "./nativeI18n";
import fs from "node:fs";
import path from "node:path";
import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { app, BrowserWindow, dialog, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { USER_DATA_PATH } from "./appPaths";
import { readAppSetting, writeAppSetting } from "./appSettingsStore";
import { getUpdateChannelConfiguration } from "./updateChannel";

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_UPDATE_CHECK_DELAY_MS = 1500;
export const UPDATE_REMINDER_DELAY_MS = 3 * 60 * 60 * 1000;
const AUTO_UPDATES_DISABLED = process.env.RECORDLY_DISABLE_AUTO_UPDATES === "1";
const UPDATE_FEED_URL_OVERRIDE = process.env.RECORDLY_UPDATE_FEED_URL?.trim() ?? "";
const UPDATER_LOG_PATH =
	process.env.RECORDLY_UPDATER_LOG_PATH?.trim() || path.join(USER_DATA_PATH, "updater.log");
const DEV_UPDATE_PREVIEW_VERSION = "9.9.9";
const DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL =
	process.env.RECORDLY_DEV_PREVIEW_EXPERIMENTAL_UPDATE === "1";
const DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS = 300;
const DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT = 20;
const ONE_MEGABYTE = 1024 * 1024;
const EXPERIMENTAL_UPDATES_SETTING_KEY = "experimentalUpdatesEnabled";
const AUTOMATIC_DOWNLOADS_SETTING_KEY = "automaticUpdateDownloadsEnabled";

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
	progressPercent?: number;
	detail?: string;
}

export interface UpdateToastPayload {
	version: string;
	detail: string;
	phase: UpdateToastPhase;
	delayMs: number;
	isPreview?: boolean;
	isExperimental?: boolean;
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
let initialCheckTimer: NodeJS.Timeout | null = null;
let deferredReminderTimer: NodeJS.Timeout | null = null;
let reminderDueAt = 0;
let devPreviewProgressTimer: NodeJS.Timeout | null = null;
let currentToastPayload: UpdateToastPayload | null = null;
let availableVersion: string | null = null;
let pendingDownloadedVersion: string | null = null;
let downloadInProgress = false;
let downloadToastDismissed = false;
let skippedVersion: string | null = null;
let canInstallUpdate = () => false;
let updaterWindow: (() => BrowserWindow | null) | undefined;
let updaterSender: UpdateToastSender | undefined;
let channelRecheckRequested = false;
let updateStatusSummary: UpdateStatusSummary = {
	status: "idle",
	currentVersion: app.getVersion(),
	availableVersion: null,
};

function setUpdateStatusSummary(summary: Partial<UpdateStatusSummary>) {
	updateStatusSummary = {
		...updateStatusSummary,
		...(summary.status !== undefined && summary.status !== "downloading"
			? { progressPercent: undefined }
			: {}),
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

export function getExperimentalUpdatesEnabled() {
	if (process.windowsStore) return false;
	return readAppSetting(EXPERIMENTAL_UPDATES_SETTING_KEY) === true;
}

export function getAutomaticUpdateDownloadsEnabled() {
	return isAutoUpdateFeatureEnabled() && readAppSetting(AUTOMATIC_DOWNLOADS_SETTING_KEY) === true;
}

export function setAutomaticUpdateDownloadsEnabled(
	enabled: boolean,
	sendToRenderer?: UpdateToastSender,
) {
	if (!isAutoUpdateFeatureEnabled()) return false;
	writeAppSetting(AUTOMATIC_DOWNLOADS_SETTING_KEY, enabled);
	if (enabled && availableVersion && !downloadInProgress && !pendingDownloadedVersion) {
		void downloadAvailableUpdate(sendToRenderer);
	}
	return enabled;
}

function applyExperimentalUpdatesPreference() {
	const enabled = getExperimentalUpdatesEnabled();
	const { channel, allowPrerelease, allowDowngrade } = getUpdateChannelConfiguration(enabled);
	autoUpdater.channel = channel;
	autoUpdater.allowPrerelease = allowPrerelease;
	// Changing channels enables downgrades inside electron-updater. Recordly never
	// needs that behaviour: opting out waits for the next stable version instead.
	autoUpdater.allowDowngrade = allowDowngrade;
	writeUpdaterLog(
		`Update channel configured: ${enabled ? "experimental" : "stable"} (${channel}).`,
	);
	return enabled;
}

function isExperimentalVersion(version: string | null) {
	return Boolean(version?.includes("-"));
}

function recheckChangedChannel() {
	if (!channelRecheckRequested || !updaterWindow || downloadInProgress || updateCheckInProgress)
		return;
	channelRecheckRequested = false;
	// Let electron-updater finish clearing its own in-flight promise first.
	const getWindow = updaterWindow;
	setImmediate(() => void checkForAppUpdates(getWindow));
}

export function setExperimentalUpdatesEnabled(enabled: boolean) {
	if (process.windowsStore) return false;
	writeAppSetting(EXPERIMENTAL_UPDATES_SETTING_KEY, enabled);
	applyExperimentalUpdatesPreference();
	skippedVersion = null;
	channelRecheckRequested = downloadInProgress || updateCheckInProgress;
	if (
		!enabled &&
		(isExperimentalVersion(availableVersion) || isExperimentalVersion(pendingDownloadedVersion))
	) {
		availableVersion = null;
		pendingDownloadedVersion = null;
		downloadToastDismissed = false;
		clearDeferredReminderTimer();
		clearVisibleUpdateToast(updaterSender);
		setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
	}
	writeUpdaterLog(`Experimental updates ${enabled ? "enabled" : "disabled"} by user.`);
	return enabled;
}

function canUseAutoUpdates() {
	return isAutoUpdateFeatureEnabled() && app.isPackaged && !process.mas;
}

export function isAutoUpdateFeatureEnabled() {
	// Store packages must never replace themselves with the direct-download installer.
	return !AUTO_UPDATES_DISABLED && !process.windowsStore;
}

function getDialogWindow(getMainWindow: () => BrowserWindow | null) {
	const window = getMainWindow();
	return window && !window.isDestroyed() ? window : undefined;
}

function showMessageBox(
	getMainWindow: () => BrowserWindow | null,
	options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
	if (process.platform !== "darwin") {
		return dialog.showMessageBox(options);
	}

	const window = getDialogWindow(getMainWindow);
	return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

function clearDeferredReminderTimer() {
	reminderDueAt = 0;
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

function getCurrentToastExperimentalFlag(version: string) {
	return currentToastPayload?.version === version
		? (currentToastPayload.isExperimental ?? isExperimentalVersion(version))
		: isExperimentalVersion(version);
}

function createAvailableUpdateToastPayload(
	version: string,
	isExperimental = isExperimentalVersion(version),
): UpdateToastPayload {
	return {
		version,
		phase: "available",
		detail: isExperimental ? nativeT("experimentalDescription") : nativeT("installOrLater"),
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		primaryAction: "install-and-restart",
	};
}

function createDownloadingUpdateToastPayload(
	version: string,
	progress: DownloadProgressSnapshot = {},
	isExperimental = getCurrentToastExperimentalFlag(version),
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
				? nativeT("finishingDownload")
				: remainingMb !== null
					? nativeT("remainingDownload", {
							amount: nativeNumber(remainingMb, {
								minimumFractionDigits: 1,
								maximumFractionDigits: 1,
							}),
						})
					: nativeT("downloadingRestart"),
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		progressPercent: normalizedProgress,
		transferredBytes,
		totalBytes,
		remainingBytes,
		bytesPerSecond,
		primaryAction: "install-and-restart",
	};
}

function createDownloadedUpdateToastPayload(
	version: string,
	isExperimental = getCurrentToastExperimentalFlag(version),
): UpdateToastPayload {
	return {
		version,
		phase: "ready",
		detail: nativeT("updateReadyDetail"),
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
		primaryAction: "install-and-restart",
	};
}

function createUpdateErrorToastPayload(
	version: string,
	error: unknown,
	isExperimental = getCurrentToastExperimentalFlag(version),
): UpdateToastPayload {
	return {
		version,
		phase: "error",
		detail: nativeT("downloadError", { error: String(error) }),
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isExperimental,
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

export function showUpdateNotificationOnOpen(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer: UpdateToastSender,
) {
	if (reminderDueAt > Date.now()) return false;
	if (downloadInProgress) return false;
	const payload = currentToastPayload ?? getReminderPayload();
	if (!payload || (payload.phase !== "available" && payload.phase !== "ready")) return false;
	clearDeferredReminderTimer();
	if (payload.phase === "available" && getAutomaticUpdateDownloadsEnabled()) {
		void downloadAvailableUpdate(sendToRenderer);
		return true;
	}
	if (!emitUpdateToastState(sendToRenderer, payload)) {
		if (payload.phase === "ready") {
			void showDownloadedUpdateDialog(getMainWindow, payload.version, {
				isPreview: payload.isPreview,
			});
		} else {
			void showAvailableUpdateDialog(getMainWindow, payload.version, sendToRenderer, {
				isPreview: payload.isPreview,
			});
		}
	}
	return true;
}

export function getUpdaterLogPath() {
	return UPDATER_LOG_PATH;
}

export function getUpdateStatusSummary() {
	return updateStatusSummary;
}

function resetDevPreviewState(sendToRenderer?: UpdateToastSender) {
	clearDevPreviewProgressTimer();
	availableVersion = null;
	pendingDownloadedVersion = null;
	downloadInProgress = false;
	downloadToastDismissed = false;
	skippedVersion = null;
	clearVisibleUpdateToast(sendToRenderer);
}

function simulateDevPreviewDownload(sendToRenderer?: UpdateToastSender, onReady?: () => void) {
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
				detail: nativeT("previewReady"),
			});
			onReady?.();
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
		downloadToastDismissed = true;
		clearVisibleUpdateToast(sendToRenderer);
		return { success: true };
	}

	if (currentToastPayload?.phase === "ready") {
		return deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
	}

	if (currentToastPayload?.phase === "available" || currentToastPayload?.phase === "error") {
		return deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
	}

	clearVisibleUpdateToast(sendToRenderer);
	return { success: true };
}

export function installDownloadedUpdateNow(sendToRenderer?: UpdateToastSender) {
	if (process.windowsStore) return { success: false, message: nativeT("updatesDisabled") };
	if (currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return { success: true };
	}

	if (!pendingDownloadedVersion) return { success: false, message: nativeT("noDownloadReady") };
	if (!canInstallUpdate())
		return {
			success: false,
			code: "restart-blocked" as const,
			message: nativeT("restartBlocked"),
		};
	clearDeferredReminderTimer();
	downloadToastDismissed = false;
	clearVisibleUpdateToast(sendToRenderer);
	setUpdateStatusSummary({ status: "ready", availableVersion: pendingDownloadedVersion });
	writeUpdaterLog("Installing downloaded update.");
	autoUpdater.quitAndInstall();
	return { success: true };
}

export async function downloadAvailableUpdate(
	sendToRenderer?: UpdateToastSender,
	options?: { installAfterDownload?: boolean; canInstall?: () => boolean },
) {
	if (process.windowsStore) {
		return { success: false, message: nativeT("updatesDisabled") };
	}
	if (currentToastPayload?.isPreview) {
		return simulateDevPreviewDownload(sendToRenderer, () => {
			if (options?.installAfterDownload && options.canInstall?.()) {
				installDownloadedUpdateNow(sendToRenderer);
			}
		});
	}

	if (!availableVersion) {
		return { success: false, message: nativeT("noDownloadReady") };
	}

	if (pendingDownloadedVersion === availableVersion) {
		return { success: false, message: nativeT("alreadyDownloaded") };
	}

	if (downloadInProgress) {
		return { success: false, message: nativeT("alreadyDownloading") };
	}

	clearDeferredReminderTimer();
	const downloadVersion = availableVersion;
	downloadInProgress = true;
	downloadToastDismissed = false;
	setUpdateStatusSummary({
		status: "downloading",
		availableVersion,
		progressPercent: 0,
		detail: nativeT("downloadingVersion", { version: availableVersion ?? "" }),
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
		if (
			pendingDownloadedVersion === downloadVersion &&
			options?.installAfterDownload &&
			options.canInstall?.()
		) {
			installDownloadedUpdateNow(sendToRenderer);
		}
		return { success: true };
	} catch (error) {
		downloadInProgress = false;
		if (availableVersion !== downloadVersion) return { success: false };
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
	} finally {
		downloadInProgress = false;
		recheckChangedChannel();
	}
}

export function deferUpdateReminder(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer?: UpdateToastSender,
	delayMs = UPDATE_REMINDER_DELAY_MS,
) {
	const payload = getReminderPayload();
	if (!payload) {
		return { success: false, message: nativeT("noReminderReady") };
	}

	clearDeferredReminderTimer();
	clearVisibleUpdateToast(sendToRenderer);
	reminderDueAt = Date.now() + delayMs;
	deferredReminderTimer = setTimeout(() => {
		deferredReminderTimer = null;
		reminderDueAt = 0;
		const nextPayload = getReminderPayload();
		if (!nextPayload) {
			return;
		}
		if (nextPayload.phase === "available" && getAutomaticUpdateDownloadsEnabled()) {
			void downloadAvailableUpdate(sendToRenderer);
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
		return { success: false, message: nativeT("noSkipAvailable") };
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
	currentToastPayload = {
		version: DEV_UPDATE_PREVIEW_VERSION,
		phase: "available",
		detail: DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL
			? nativeT("experimentalDescription")
			: nativeT("previewToast"),
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isPreview: true,
		isExperimental: DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL,
	};
	if (getAutomaticUpdateDownloadsEnabled()) simulateDevPreviewDownload(sendToRenderer);
	else emitUpdateToastState(sendToRenderer, currentToastPayload);
	return true;
}

async function showAvailableUpdateDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
	sendToRenderer?: UpdateToastSender,
	options?: { isPreview?: boolean; isExperimental?: boolean },
) {
	const isPreview = Boolean(options?.isPreview);
	const isExperimental = options?.isExperimental ?? isExperimentalVersion(version);
	const result = await showMessageBox(getMainWindow, {
		type: "info",
		title: isExperimental ? nativeT("experimentalAvailable") : nativeT("updateAvailable"),
		message: nativeT(isExperimental ? "experimentalVersionAvailable" : "versionAvailable", {
			version,
		}),
		detail: isPreview
			? nativeT("previewDetail")
			: isExperimental
				? nativeT("experimentalDescription")
				: nativeT("installOrLater"),
		buttons: [nativeT("downloadUpdate"), nativeT("later")],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		if (isPreview) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: nativeT("previewOnly"),
				message: nativeT("noUpdateInstalled"),
				detail: nativeT("previewPrompt"),
			});
			return;
		}

		await downloadAvailableUpdate(sendToRenderer);
		return;
	}

	if (isPreview) {
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
		title: nativeT("updateReady"),
		message: isPreview
			? nativeT("versionReady", { version: version ?? "" })
			: nativeT("versionDownloaded", { version: version ?? "" }),
		detail: isPreview ? nativeT("previewDetail") : nativeT("updateReadyDetail"),
		buttons: [nativeT("installRestart"), nativeT("later")],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		if (isPreview) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: nativeT("previewOnly"),
				message: nativeT("noUpdateInstalled"),
				detail: nativeT("previewPrompt"),
			});
			return;
		}

		clearDeferredReminderTimer();
		setImmediate(() => {
			const result = installDownloadedUpdateNow();
			if (!result.success) {
				void showMessageBox(getMainWindow, {
					type: "info",
					title: nativeT("updateReady"),
					message: result.message ?? nativeT("restartBlocked"),
				});
			}
		});
		return;
	}

	if (result.response === 1) {
		if (isPreview) {
			return;
		}

		deferUpdateReminder(getMainWindow, updaterSender, UPDATE_REMINDER_DELAY_MS);
	}
}

export function previewNativeUpdateDialog(getMainWindow: () => BrowserWindow | null) {
	return showAvailableUpdateDialog(getMainWindow, DEV_UPDATE_PREVIEW_VERSION, undefined, {
		isPreview: true,
		isExperimental: DEV_UPDATE_PREVIEW_IS_EXPERIMENTAL,
	});
}

async function showUpdateErrorDialog(
	getMainWindow: () => BrowserWindow | null,
	version: string,
	error: unknown,
) {
	await showMessageBox(getMainWindow, {
		type: "error",
		title: nativeT("updateFailed"),
		message: nativeT("versionFailed", { version: version ?? "" }),
		detail: String(error),
		buttons: ["OK"],
		defaultId: 0,
		noLink: true,
	});
}

export async function checkForAppUpdates(
	getMainWindow: () => BrowserWindow | null,
	options?: { manual?: boolean },
) {
	if (process.windowsStore) {
		if (options?.manual) await shell.openExternal("ms-windows-store://downloadsandupdates");
		return;
	}
	if (!canUseAutoUpdates()) {
		writeUpdaterLog(
			`Skipped update check because auto-updates are unavailable. packaged=${app.isPackaged} mas=${process.mas ? "yes" : "no"} disabled=${AUTO_UPDATES_DISABLED ? "yes" : "no"}`,
		);
		if (options?.manual) {
			await showMessageBox(getMainWindow, {
				type: "info",
				title: nativeT("updatesDisabled"),
				message: nativeT("packagedOnly"),
				detail: AUTO_UPDATES_DISABLED ? nativeT("disabledBuild") : nativeT("devMetadata"),
			});
		}
		return;
	}

	if (updateCheckInProgress || downloadInProgress || pendingDownloadedVersion) {
		writeUpdaterLog("Skipped update check because a previous check is still running.");
		return;
	}

	manualCheckRequested = Boolean(options?.manual);
	updateCheckInProgress = true;
	applyExperimentalUpdatesPreference();
	setUpdateStatusSummary({ status: "checking", detail: nativeT("checkingUpdates") });
	writeUpdaterLog(`Starting ${manualCheckRequested ? "manual" : "automatic"} update check.`);

	try {
		await autoUpdater.checkForUpdates();
		writeUpdaterLog("Update check request completed.");
	} catch (error) {
		updateCheckInProgress = false;
		manualCheckRequested = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("Update check failed.", error);
		console.error("Auto-update check failed:", error);
	} finally {
		recheckChangedChannel();
	}
}

export function setupAutoUpdates(
	getMainWindow: () => BrowserWindow | null,
	sendToRenderer: UpdateToastSender,
	canInstall: () => boolean = () => false,
) {
	if (updaterInitialized) {
		return;
	}

	if (!canUseAutoUpdates()) {
		setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
		return;
	}

	updaterInitialized = true;
	canInstallUpdate = canInstall;
	updaterWindow = getMainWindow;
	updaterSender = sendToRenderer;
	configureUpdateFeed();
	applyExperimentalUpdatesPreference();
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	writeUpdaterLog(`Updater initialized. logPath=${UPDATER_LOG_PATH}`);

	autoUpdater.on("checking-for-update", () => {
		setUpdateStatusSummary({
			status: "checking",
			availableVersion: null,
			detail: nativeT("checkingUpdates"),
		});
		writeUpdaterLog("electron-updater emitted checking-for-update.");
	});

	autoUpdater.on("update-available", (info) => {
		writeUpdaterLog(`Update available: version=${info.version}`);
		updateCheckInProgress = false;
		if (isExperimentalVersion(info.version) && !getExperimentalUpdatesEnabled()) {
			manualCheckRequested = false;
			setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
			return;
		}
		if (downloadInProgress || pendingDownloadedVersion) {
			manualCheckRequested = false;
			return;
		}
		availableVersion = info.version;
		pendingDownloadedVersion = null;
		downloadInProgress = false;
		downloadToastDismissed = false;
		setUpdateStatusSummary({
			status: "available",
			availableVersion: info.version,
			detail: nativeT("versionAvailable", { version: info.version ?? "" }),
		});
		if (skippedVersion === info.version) {
			manualCheckRequested = false;
			return;
		}

		if (getAutomaticUpdateDownloadsEnabled()) {
			void downloadAvailableUpdate(sendToRenderer);
		} else if (
			!emitUpdateToastState(sendToRenderer, createAvailableUpdateToastPayload(info.version))
		) {
			void showAvailableUpdateDialog(getMainWindow, info.version, sendToRenderer);
		}
		manualCheckRequested = false;
	});

	autoUpdater.on("update-not-available", () => {
		writeUpdaterLog("No update available.");
		updateCheckInProgress = false;
		availableVersion = null;
		pendingDownloadedVersion = null;
		downloadInProgress = false;
		downloadToastDismissed = false;
		setUpdateStatusSummary({
			status: "up-to-date",
			availableVersion: null,
			detail: nativeT("upToDate", { version: app.getVersion() ?? "" }),
		});
		clearVisibleUpdateToast(sendToRenderer);
		manualCheckRequested = false;
	});

	autoUpdater.on("download-progress", (progress) => {
		if (!availableVersion) {
			return;
		}

		downloadInProgress = true;
		setUpdateStatusSummary({
			status: "downloading",
			availableVersion,
			progressPercent: Math.max(0, Math.min(100, progress.percent)),
			detail: nativeT("downloadingVersion", { version: availableVersion ?? "" }),
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
		manualCheckRequested = false;
		if (channelRecheckRequested && !availableVersion) {
			writeUpdaterLog("Ignored error from an update invalidated by a channel change.", error);
			return;
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
			const shownInRenderer = emitUpdateToastState(
				sendToRenderer,
				createUpdateErrorToastPayload(availableVersion, error),
			);
			if (!shownInRenderer) {
				void showUpdateErrorDialog(getMainWindow, availableVersion, error);
			}
		}
	});

	autoUpdater.on("update-downloaded", (info) => {
		writeUpdaterLog(`Update downloaded: version=${info.version}`);
		updateCheckInProgress = false;
		manualCheckRequested = false;
		downloadInProgress = false;
		downloadToastDismissed = false;
		if (isExperimentalVersion(info.version) && !getExperimentalUpdatesEnabled()) return;
		if (skippedVersion === info.version) {
			return;
		}
		availableVersion = info.version;
		pendingDownloadedVersion = info.version;
		setUpdateStatusSummary({
			status: "ready",
			availableVersion: info.version,
			detail: nativeT("versionReady", { version: info.version ?? "" }),
		});
		clearDeferredReminderTimer();

		if (
			emitUpdateToastState(sendToRenderer, createDownloadedUpdateToastPayload(info.version))
		) {
			return;
		}

		void showDownloadedUpdateDialog(getMainWindow, info.version);
	});

	initialCheckTimer = setTimeout(() => {
		initialCheckTimer = null;
		void checkForAppUpdates(getMainWindow);
	}, INITIAL_UPDATE_CHECK_DELAY_MS);
	periodicCheckTimer = setInterval(() => {
		void checkForAppUpdates(getMainWindow);
	}, UPDATE_CHECK_INTERVAL_MS);

	app.on("before-quit", () => {
		clearDeferredReminderTimer();
		clearDevPreviewProgressTimer();
		if (initialCheckTimer) {
			clearTimeout(initialCheckTimer);
			initialCheckTimer = null;
		}
		if (periodicCheckTimer) {
			clearInterval(periodicCheckTimer);
			periodicCheckTimer = null;
		}
	});
}
