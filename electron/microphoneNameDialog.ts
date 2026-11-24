import { BrowserWindow } from "electron";

/** The Linux recording HUD does not take keyboard focus. Use a focusable child on all platforms. */
export async function showMicrophoneNameDialog(
	parent: BrowserWindow,
	preload: string,
	label: string,
	name: string,
): Promise<string | null> {
	const existing = parent.getChildWindows().find((child) => child.isModal());
	if (existing) {
		existing.focus();
		return null;
	}
	const url = new URL(parent.webContents.getURL());
	url.search = "?windowType=microphone-name";
	url.hash = "";
	const dialog = new BrowserWindow({
		parent,
		modal: true,
		show: false,
		width: 420,
		height: 200,
		useContentSize: true,
		minimizable: false,
		maximizable: false,
		autoHideMenuBar: true,
		webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
	});
	let result: string | null = null;
	const closed = new Promise<string | null>((resolve) => {
		dialog.once("closed", () => resolve(result));
	});
	dialog.webContents.ipc.handle("microphone-name:initial", (event) =>
		event.senderFrame === dialog.webContents.mainFrame ? { label, name } : null,
	);
	dialog.webContents.ipc.on("microphone-name:save", (event, value: unknown) => {
		if (
			event.senderFrame !== dialog.webContents.mainFrame ||
			typeof value !== "string" ||
			value.length > 100
		)
			return;
		result = value.trim();
		dialog.close();
	});
	dialog.once("ready-to-show", () => dialog.show());
	try {
		await dialog.loadURL(url.href);
	} catch (error) {
		if (!dialog.isDestroyed()) {
			dialog.destroy();
			throw error;
		}
	}
	return closed;
}
