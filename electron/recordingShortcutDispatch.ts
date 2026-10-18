import type { BrowserWindow, WebContents } from "electron";
import type { RecordingShortcutAction } from "../src/lib/recordingShortcuts";

type RecordingHud = Pick<BrowserWindow, "isDestroyed" | "isVisible" | "isMinimized" | "hide"> & {
	webContents: Pick<WebContents, "isLoadingMainFrame" | "send">;
};

export function createRecordingShortcutDispatcher(deps: {
	getHud: () => RecordingHud | null;
	showHud: () => void;
	getRecordingSession: () => number | null;
	confirmDiscard: () => Promise<boolean>;
}) {
	let confirming = false;
	return async (action: RecordingShortcutAction) => {
		const hud = deps.getHud();
		if (!hud || hud.isDestroyed() || hud.webContents.isLoadingMainFrame()) return;
		if (action === "toggleHud") {
			if (hud.isVisible() && !hud.isMinimized()) hud.hide();
			else deps.showHud();
			return;
		}
		if (confirming) return;
		if (action === "openCapturePicker") {
			if (deps.getRecordingSession() !== null) return;
			deps.showHud();
		}
		if (action === "cancelRecording") {
			const session = deps.getRecordingSession();
			if (session === null) return;
			confirming = true;
			try {
				if (
					!(await deps.confirmDiscard()) ||
					deps.getRecordingSession() !== session ||
					hud !== deps.getHud() ||
					hud.isDestroyed()
				)
					return;
			} finally {
				confirming = false;
			}
		}
		// Capture belongs to the HUD, even while an editor or dashboard is focused.
		hud.webContents.send("recording-shortcut", action);
	};
}
