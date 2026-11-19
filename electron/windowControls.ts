import type { BrowserWindow } from "electron";

type ControlledWindow = Pick<
	BrowserWindow,
	"isDestroyed" | "isMaximized" | "minimize" | "maximize" | "unmaximize" | "close"
>;

export function applyWindowControl(win: ControlledWindow | null, action: unknown): boolean {
	if (!win || win.isDestroyed()) return false;
	switch (action) {
		case "minimize":
			win.minimize();
			return true;
		case "maximize":
			if (win.isMaximized()) win.unmaximize();
			else win.maximize();
			return true;
		case "close":
			// Preserve the ordinary close event and its unsaved-project prompt.
			win.close();
			return true;
		default:
			return false;
	}
}
