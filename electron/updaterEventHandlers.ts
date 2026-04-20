import { app } from "electron";
import { autoUpdater } from "electron-updater";
import {
	clearDeferredReminderTimer,
	clearDevPreviewProgressTimer,
	clearVisibleUpdateToast,
	createAutoCheckErrorToastPayload,
	createAvailableUpdateToastPayload,
	createDownloadedUpdateToastPayload,
	createDownloadingUpdateToastPayload,
	createUpdateErrorToastPayload,
	emitUpdateToastState,
	getUpdateCheckIntervalMs,
	setUpdateStatusSummary,
	shouldSurfaceAutomaticCheckErrors,
	type GetMainWindow,
	type UpdateToastSender,
	updaterState,
	writeUpdaterLog,
} from "./updaterShared";

interface UpdaterEventHandlerDialogs {
	showNoUpdatesDialog: (getMainWindow: GetMainWindow) => Promise<void>;
	showUpdateErrorDialog: (getMainWindow: GetMainWindow, error: unknown) => Promise<void>;
	showAvailableUpdateDialog: (
		getMainWindow: GetMainWindow,
		version: string,
		sendToRenderer: UpdateToastSender | undefined,
	) => Promise<void>;
	showDownloadedUpdateDialog: (getMainWindow: GetMainWindow, version: string) => Promise<void>;
}

export function registerAutoUpdaterEventHandlers(
	getMainWindow: GetMainWindow,
	sendToRenderer: UpdateToastSender,
	dialogs: UpdaterEventHandlerDialogs,
	checkForAppUpdates: (getMainWindow: GetMainWindow, options?: { manual?: boolean }) => Promise<void>,
) {
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
		updaterState.updateCheckInProgress = false;
		updaterState.availableVersion = info.version;
		updaterState.pendingDownloadedVersion = null;
		updaterState.downloadInProgress = false;
		updaterState.downloadToastDismissed = false;
		setUpdateStatusSummary({
			status: "available",
			availableVersion: info.version,
			detail: `Recordly ${info.version} is available.`,
		});
		if (updaterState.skippedVersion === info.version) {
			updaterState.manualCheckRequested = false;
			return;
		}

		const payload = createAvailableUpdateToastPayload(info.version);
		if (emitUpdateToastState(sendToRenderer, payload)) {
			updaterState.manualCheckRequested = false;
			return;
		}

		if (updaterState.manualCheckRequested) {
			void dialogs.showAvailableUpdateDialog(getMainWindow, info.version, sendToRenderer);
			updaterState.manualCheckRequested = false;
		}
	});

	autoUpdater.on("update-not-available", () => {
		writeUpdaterLog("No update available.");
		updaterState.updateCheckInProgress = false;
		updaterState.availableVersion = null;
		updaterState.pendingDownloadedVersion = null;
		updaterState.downloadInProgress = false;
		updaterState.downloadToastDismissed = false;
		setUpdateStatusSummary({
			status: "up-to-date",
			availableVersion: null,
			detail: `Recordly ${app.getVersion()} is up to date.`,
		});
		clearVisibleUpdateToast(sendToRenderer);
		const shouldReport = updaterState.manualCheckRequested;
		updaterState.manualCheckRequested = false;
		if (shouldReport) {
			void dialogs.showNoUpdatesDialog(getMainWindow);
		}
	});

	autoUpdater.on("download-progress", (progress) => {
		if (!updaterState.availableVersion) {
			return;
		}

		updaterState.downloadInProgress = true;
		setUpdateStatusSummary({
			status: "downloading",
			availableVersion: updaterState.availableVersion,
			detail: `Downloading Recordly ${updaterState.availableVersion}`,
		});
		writeUpdaterLog(
			`Download progress for ${updaterState.availableVersion}: ${progress.percent.toFixed(1)}%`,
		);
		if (updaterState.downloadToastDismissed) {
			return;
		}

		emitUpdateToastState(
			sendToRenderer,
			createDownloadingUpdateToastPayload(updaterState.availableVersion, progress.percent),
		);
	});

	autoUpdater.on("error", (error) => {
		updaterState.updateCheckInProgress = false;
		const shouldReport = updaterState.manualCheckRequested;
		updaterState.manualCheckRequested = false;
		if (!updaterState.downloadInProgress) {
			updaterState.updateCheckErrorHandled = true;
		}
		setUpdateStatusSummary({
			status: "error",
			availableVersion: updaterState.availableVersion,
			detail: String(error),
		});
		writeUpdaterLog("electron-updater emitted error.", error);
		console.error("Auto-updater error:", error);
		if (updaterState.downloadInProgress && updaterState.availableVersion) {
			updaterState.downloadInProgress = false;
			updaterState.downloadToastDismissed = false;
			emitUpdateToastState(
				sendToRenderer,
				createUpdateErrorToastPayload(updaterState.availableVersion, error),
			);
		}
		if (shouldReport) {
			void dialogs.showUpdateErrorDialog(getMainWindow, error);
		} else if (shouldSurfaceAutomaticCheckErrors()) {
			emitUpdateToastState(sendToRenderer, createAutoCheckErrorToastPayload());
		}
	});

	autoUpdater.on("update-downloaded", (info) => {
		writeUpdaterLog(`Update downloaded: version=${info.version}`);
		updaterState.updateCheckInProgress = false;
		updaterState.manualCheckRequested = false;
		updaterState.downloadInProgress = false;
		updaterState.downloadToastDismissed = false;
		if (updaterState.skippedVersion === info.version) {
			return;
		}
		updaterState.availableVersion = info.version;
		updaterState.pendingDownloadedVersion = info.version;
		setUpdateStatusSummary({
			status: "ready",
			availableVersion: info.version,
			detail: `Recordly ${info.version} is ready to install.`,
		});
		clearDeferredReminderTimer();

		if (emitUpdateToastState(sendToRenderer, createDownloadedUpdateToastPayload(info.version))) {
			return;
		}

		void dialogs.showDownloadedUpdateDialog(getMainWindow, info.version);
	});

	void checkForAppUpdates(getMainWindow);
	updaterState.periodicCheckTimer = setInterval(() => {
		void checkForAppUpdates(getMainWindow);
	}, getUpdateCheckIntervalMs());

	app.on("before-quit", () => {
		clearDeferredReminderTimer();
		clearDevPreviewProgressTimer();
		if (updaterState.periodicCheckTimer) {
			clearInterval(updaterState.periodicCheckTimer);
			updaterState.periodicCheckTimer = null;
		}
	});
}