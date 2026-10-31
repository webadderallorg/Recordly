import type { BrowserWindow, WebContents } from "electron";
import type { SelectedSource } from "./ipc/types";

export type SourceListPickResult = {
	success: boolean;
	canceled?: boolean;
	source?: SelectedSource;
};

/** Keeps the existing Linux source-list window open until selection or dismissal. */
export function createSourceListPicker(createWindow: () => BrowserWindow) {
	let activeWindow: BrowserWindow | null = null;
	let pending: Promise<SourceListPickResult> | null = null;
	let finish: ((result: SourceListPickResult) => void) | null = null;
	return {
		open() {
			if (pending) return pending;
			activeWindow = createWindow();
			pending = new Promise<SourceListPickResult>((resolve) => {
				finish = resolve;
			});
			activeWindow.once("closed", () => {
				finish?.({ success: false, canceled: true });
				finish = null;
				pending = null;
				activeWindow = null;
			});
			return pending;
		},
		isSender(sender: WebContents) {
			return activeWindow?.webContents === sender;
		},
		complete(source: SelectedSource) {
			finish?.({ success: true, source });
			finish = null;
		},
	};
}
