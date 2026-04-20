import { autoUpdater } from "electron-updater";
import {
	AUTO_UPDATES_DISABLED,
	DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT,
	DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS,
	DEV_UPDATE_PREVIEW_VERSION,
	DISMISSED_READY_REMINDER_DELAY_MS,
	UPDATE_REMINDER_DELAY_MS,
	UPDATER_LOG_PATH,
	canUseAutoUpdates,
	clearDeferredReminderTimer,
	clearDevPreviewProgressTimer,
	clearVisibleUpdateToast,
	configureUpdateFeed,
	createAutoCheckErrorToastPayload,
	createDownloadedUpdateToastPayload,
	createDownloadingUpdateToastPayload,
	createUpdateErrorToastPayload,
	emitUpdateToastState,
	getReminderPayload,
	isAutoUpdateFeatureEnabled,
	setUpdateStatusSummary,
	shouldSurfaceAutomaticCheckErrors,
	showMessageBox,
	type GetMainWindow,
	type UpdateToastSender,
	updaterState,
	writeUpdaterLog,
} from "./updaterShared";
import {
	showAvailableUpdateDialog,
	showDownloadedUpdateDialog,
	showNoUpdatesDialog,
	showUpdateErrorDialog,
} from "./updaterDialogs";
import { registerAutoUpdaterEventHandlers } from "./updaterEventHandlers";

export { UPDATE_REMINDER_DELAY_MS } from "./updaterShared";
export type {
	UpdateStatusKind,
	UpdateStatusSummary,
	UpdateToastPayload,
	UpdateToastPhase,
} from "./updaterShared";
export { isAutoUpdateFeatureEnabled };

function resetDevPreviewState(sendToRenderer?: UpdateToastSender) {
	clearDevPreviewProgressTimer();
	updaterState.availableVersion = null;
	updaterState.pendingDownloadedVersion = null;
	updaterState.downloadInProgress = false;
	updaterState.downloadToastDismissed = false;
	updaterState.skippedVersion = null;
	clearVisibleUpdateToast(sendToRenderer);
}

function simulateDevPreviewDownload(sendToRenderer?: UpdateToastSender) {
	updaterState.availableVersion = DEV_UPDATE_PREVIEW_VERSION;
	updaterState.pendingDownloadedVersion = null;
	updaterState.downloadInProgress = true;
	updaterState.downloadToastDismissed = false;
	clearDeferredReminderTimer();
	clearDevPreviewProgressTimer();

	let progressPercent = 0;
	emitUpdateToastState(sendToRenderer, {
		...createDownloadingUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION, progressPercent),
		isPreview: true,
	});

	updaterState.devPreviewProgressTimer = setInterval(() => {
		progressPercent = Math.min(100, progressPercent + DEV_UPDATE_PREVIEW_PROGRESS_INCREMENT);

		if (progressPercent >= 100) {
			clearDevPreviewProgressTimer();
			updaterState.downloadInProgress = false;
			updaterState.pendingDownloadedVersion = DEV_UPDATE_PREVIEW_VERSION;
			emitUpdateToastState(sendToRenderer, {
				...createDownloadedUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION),
				isPreview: true,
				detail: "Development preview: the update is ready to install. No real update will be installed.",
			});
			return;
		}

		if (updaterState.downloadToastDismissed) {
			return;
		}

		emitUpdateToastState(sendToRenderer, {
			...createDownloadingUpdateToastPayload(DEV_UPDATE_PREVIEW_VERSION, progressPercent),
			isPreview: true,
		});
	}, DEV_UPDATE_PREVIEW_PROGRESS_STEP_MS);

	return { success: true };
}

export function getCurrentUpdateToastPayload() {
	return updaterState.currentToastPayload;
}

export function getUpdaterLogPath() {
	return UPDATER_LOG_PATH;
}

export function getUpdateStatusSummary() {
	return updaterState.updateStatusSummary;
}

export function dismissUpdateToast(
	getMainWindow: GetMainWindow,
	sendToRenderer?: UpdateToastSender,
) {
	if (updaterState.currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return { success: true };
	}

	if (updaterState.downloadInProgress) {
		updaterState.downloadToastDismissed = true;
		clearVisibleUpdateToast(sendToRenderer);
		return { success: true };
	}

	if (updaterState.currentToastPayload?.phase === "ready") {
		return deferUpdateReminder(
			getMainWindow,
			sendToRenderer,
			DISMISSED_READY_REMINDER_DELAY_MS,
		);
	}

	if (
		updaterState.currentToastPayload?.phase === "available" ||
		updaterState.currentToastPayload?.phase === "error"
	) {
		return deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
	}

	clearVisibleUpdateToast(sendToRenderer);
	return { success: true };
}

export function installDownloadedUpdateNow(sendToRenderer?: UpdateToastSender) {
	if (updaterState.currentToastPayload?.isPreview) {
		resetDevPreviewState(sendToRenderer);
		return;
	}

	clearDeferredReminderTimer();
	updaterState.downloadToastDismissed = false;
	clearVisibleUpdateToast(sendToRenderer);
	setUpdateStatusSummary({
		status: "ready",
		availableVersion: updaterState.pendingDownloadedVersion,
	});
	writeUpdaterLog("Installing downloaded update.");
	autoUpdater.quitAndInstall();
}

export async function downloadAvailableUpdate(sendToRenderer?: UpdateToastSender) {
	if (updaterState.currentToastPayload?.isPreview) {
		return simulateDevPreviewDownload(sendToRenderer);
	}

	if (!updaterState.availableVersion) {
		return { success: false, message: "No update is ready to download." };
	}

	if (updaterState.pendingDownloadedVersion === updaterState.availableVersion) {
		return { success: false, message: "This update has already been downloaded." };
	}

	if (updaterState.downloadInProgress) {
		return { success: false, message: "This update is already downloading." };
	}

	clearDeferredReminderTimer();
	updaterState.downloadInProgress = true;
	updaterState.downloadToastDismissed = false;
	setUpdateStatusSummary({
		status: "downloading",
		availableVersion: updaterState.availableVersion,
		detail: `Downloading Recordly ${updaterState.availableVersion}`,
	});
	emitUpdateToastState(
		sendToRenderer,
		createDownloadingUpdateToastPayload(updaterState.availableVersion, 0),
	);
	writeUpdaterLog(`Starting update download for ${updaterState.availableVersion}.`);

	try {
		await autoUpdater.downloadUpdate();
		writeUpdaterLog(`Update download requested for ${updaterState.availableVersion}.`);
		return { success: true };
	} catch (error) {
		updaterState.downloadInProgress = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion: updaterState.availableVersion,
			detail: String(error),
		});
		writeUpdaterLog(`Update download failed for ${updaterState.availableVersion}.`, error);
		emitUpdateToastState(
			sendToRenderer,
			createUpdateErrorToastPayload(updaterState.availableVersion ?? "unknown", error),
		);
		return { success: false, message: String(error) };
	}
}

export function deferUpdateReminder(
	getMainWindow: GetMainWindow,
	sendToRenderer?: UpdateToastSender,
	delayMs = UPDATE_REMINDER_DELAY_MS,
) {
	const payload = getReminderPayload();
	if (!payload) {
		return { success: false, message: "No update reminder is ready yet." };
	}

	clearDeferredReminderTimer();
	clearVisibleUpdateToast(sendToRenderer);
	updaterState.deferredReminderTimer = setTimeout(() => {
		const nextPayload = getReminderPayload();
		if (!nextPayload) {
			return;
		}

		if (sendToRenderer && emitUpdateToastState(sendToRenderer, nextPayload)) {
			return;
		}

		if (nextPayload.phase === "ready") {
			void showDownloadedUpdateDialog(
				getMainWindow,
				nextPayload.version,
				{
					downloadAvailableUpdate,
					deferUpdateReminder,
					skipAvailableUpdateVersion,
					installDownloadedUpdateNow,
				},
			);
			return;
		}

		void showAvailableUpdateDialog(
			getMainWindow,
			nextPayload.version,
			sendToRenderer,
			{
				downloadAvailableUpdate,
				deferUpdateReminder,
				skipAvailableUpdateVersion,
				installDownloadedUpdateNow,
			},
		);
	}, delayMs);

	return { success: true };
}

export function skipAvailableUpdateVersion(sendToRenderer?: UpdateToastSender) {
	const versionToSkip = updaterState.pendingDownloadedVersion ?? updaterState.availableVersion;
	if (!versionToSkip) {
		return { success: false, message: "No update is available to skip." };
	}

	updaterState.skippedVersion = versionToSkip;
	if (updaterState.pendingDownloadedVersion === versionToSkip) {
		updaterState.pendingDownloadedVersion = null;
	}
	if (updaterState.availableVersion === versionToSkip) {
		updaterState.availableVersion = null;
	}
	updaterState.downloadInProgress = false;
	updaterState.downloadToastDismissed = false;
	clearDeferredReminderTimer();
	clearVisibleUpdateToast(sendToRenderer);

	return { success: true };
}

export function previewUpdateToast(sendToRenderer: UpdateToastSender) {
	clearDeferredReminderTimer();
	clearDevPreviewProgressTimer();
	updaterState.availableVersion = DEV_UPDATE_PREVIEW_VERSION;
	updaterState.pendingDownloadedVersion = null;
	updaterState.downloadInProgress = false;
	updaterState.downloadToastDismissed = false;
	return emitUpdateToastState(sendToRenderer, {
		version: DEV_UPDATE_PREVIEW_VERSION,
		phase: "available",
		detail: "This is a development preview of the in-app update toast.",
		delayMs: UPDATE_REMINDER_DELAY_MS,
		isPreview: true,
	});
}

export async function checkForAppUpdates(
	getMainWindow: GetMainWindow,
	options?: { manual?: boolean },
) {
	if (!canUseAutoUpdates()) {
		writeUpdaterLog(
			`Skipped update check because auto-updates are unavailable. packaged=${process.env.NODE_ENV === "production" ? "yes" : "no"} mas=${process.mas ? "yes" : "no"} disabled=${AUTO_UPDATES_DISABLED ? "yes" : "no"}`,
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

	if (updaterState.updateCheckInProgress) {
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

	updaterState.manualCheckRequested = Boolean(options?.manual);
	updaterState.updateCheckInProgress = true;
	updaterState.updateCheckErrorHandled = false;
	setUpdateStatusSummary({ status: "checking", detail: "Checking for updates..." });
	writeUpdaterLog(
		`Starting ${updaterState.manualCheckRequested ? "manual" : "automatic"} update check.`,
	);

	try {
		await autoUpdater.checkForUpdates();
		writeUpdaterLog("Update check request completed.");
	} catch (error) {
		updaterState.updateCheckInProgress = false;
		const shouldReport = updaterState.manualCheckRequested;
		updaterState.manualCheckRequested = false;
		setUpdateStatusSummary({
			status: "error",
			availableVersion: updaterState.availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("Update check failed.", error);
		console.error("Auto-update check failed:", error);
		if (shouldReport && !updaterState.updateCheckErrorHandled) {
			await showUpdateErrorDialog(getMainWindow, error);
		} else if (!updaterState.updateCheckErrorHandled && shouldSurfaceAutomaticCheckErrors()) {
			emitUpdateToastState(updaterState.activeUpdateToastSender, createAutoCheckErrorToastPayload());
		}
	}
}

export function setupAutoUpdates(
	getMainWindow: GetMainWindow,
	sendToRenderer: UpdateToastSender,
) {
	if (updaterState.updaterInitialized) {
		return;
	}

	if (!canUseAutoUpdates()) {
		setUpdateStatusSummary({ status: "idle", availableVersion: null, detail: undefined });
		return;
	}

	updaterState.updaterInitialized = true;
	updaterState.activeUpdateToastSender = sendToRenderer;
	configureUpdateFeed();
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = false;
	writeUpdaterLog(`Updater initialized. logPath=${UPDATER_LOG_PATH}`);

	registerAutoUpdaterEventHandlers(
		getMainWindow,
		sendToRenderer,
		{
			showNoUpdatesDialog,
			showUpdateErrorDialog,
			showAvailableUpdateDialog: (windowGetter, version, renderer) =>
				showAvailableUpdateDialog(windowGetter, version, renderer, {
					downloadAvailableUpdate,
					deferUpdateReminder,
					skipAvailableUpdateVersion,
					installDownloadedUpdateNow,
				}),
			showDownloadedUpdateDialog: (windowGetter, version) =>
				showDownloadedUpdateDialog(windowGetter, version, {
					downloadAvailableUpdate,
					deferUpdateReminder,
					skipAvailableUpdateVersion,
					installDownloadedUpdateNow,
				}),
		},
		checkForAppUpdates,
	);
}