import {
	showMessageBox,
	type GetMainWindow,
	type UpdateToastSender,
	UPDATE_REMINDER_DELAY_MS,
} from "./updaterShared";

interface UpdaterDialogActions {
	downloadAvailableUpdate: (sendToRenderer?: UpdateToastSender) => Promise<unknown>;
	deferUpdateReminder: (
		getMainWindow: GetMainWindow,
		sendToRenderer?: UpdateToastSender,
		delayMs?: number,
	) => unknown;
	skipAvailableUpdateVersion: (sendToRenderer?: UpdateToastSender) => unknown;
	installDownloadedUpdateNow: (sendToRenderer?: UpdateToastSender) => void;
}

export async function showNoUpdatesDialog(getMainWindow: GetMainWindow) {
	await showMessageBox(getMainWindow, {
		type: "info",
		title: "No Updates Available",
		message: "Recordly is up to date.",
		detail: "You are already running the latest version.",
	});
}

export async function showUpdateErrorDialog(getMainWindow: GetMainWindow, error: unknown) {
	await showMessageBox(getMainWindow, {
		type: "error",
		title: "Update Check Failed",
		message: "Recordly could not check for updates.",
		detail: String(error),
	});
}

export async function showAvailableUpdateDialog(
	getMainWindow: GetMainWindow,
	version: string,
	sendToRenderer: UpdateToastSender | undefined,
	actions: UpdaterDialogActions,
) {
	const result = await showMessageBox(getMainWindow, {
		type: "info",
		title: "Update Available",
		message: `Recordly ${version} is available.`,
		detail: "Download now, remind me in 3 hours, or skip this version.",
		buttons: ["Download Update", "Remind Me in 3 Hours", "Skip This Version"],
		defaultId: 0,
		cancelId: 1,
		noLink: true,
	});

	if (result.response === 0) {
		await actions.downloadAvailableUpdate(sendToRenderer);
		return;
	}

	if (result.response === 1) {
		actions.deferUpdateReminder(getMainWindow, sendToRenderer, UPDATE_REMINDER_DELAY_MS);
		return;
	}

	actions.skipAvailableUpdateVersion(sendToRenderer);
}

export async function showDownloadedUpdateDialog(
	getMainWindow: GetMainWindow,
	version: string,
	actions: UpdaterDialogActions,
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
		buttons: ["Install Update", "Remind Me in 3 Hours", "Skip This Version"],
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

		setImmediate(() => {
			actions.installDownloadedUpdateNow();
		});
		return;
	}

	if (result.response === 1) {
		if (!isPreview) {
			actions.deferUpdateReminder(getMainWindow, undefined, UPDATE_REMINDER_DELAY_MS);
		}
		return;
	}

	if (!isPreview) {
		actions.skipAvailableUpdateVersion();
	}
}