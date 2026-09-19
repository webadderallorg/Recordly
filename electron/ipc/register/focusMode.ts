import { ipcMain, webContents } from "electron";
import { readAppSetting, writeAppSetting } from "../../appSettingsStore";

const FOCUS_MODE_SETTING_KEY = "focusModeEnabled";

/** The result shape returned by all focus-mode IPC handlers. */
interface FocusModeResult {
	success: boolean;
	enabled: boolean;
	/** Always true: in-app suppression is supported on every platform. */
	supported: boolean;
	error?: string;
}

function readFocusModeEnabled(): boolean {
	const stored = readAppSetting(FOCUS_MODE_SETTING_KEY);
	return stored === true;
}

function broadcastFocusModeChanged(result: FocusModeResult) {
	for (const wc of webContents.getAllWebContents()) {
		if (!wc.isDestroyed()) {
			wc.send("focus-mode-changed", result);
		}
	}
}

export function registerFocusModeHandlers() {
	// ── get-focus-mode-status ─────────────────────────────────────────────────
	ipcMain.handle("get-focus-mode-status", (): FocusModeResult => {
		try {
			return {
				success: true,
				enabled: readFocusModeEnabled(),
				supported: true,
			};
		} catch (error) {
			console.error("[focus-mode] Failed to read focus mode status:", error);
			return {
				success: false,
				enabled: false,
				supported: true,
				error: String(error),
			};
		}
	});

	// ── set-focus-mode ────────────────────────────────────────────────────────
	ipcMain.handle("set-focus-mode", (_event, enabled: unknown): FocusModeResult => {
		// Validate: reject non-boolean payloads rather than coercing.
		if (typeof enabled !== "boolean") {
			const error = `set-focus-mode: expected boolean, received ${typeof enabled}`;
			console.warn(`[focus-mode] ${error}`);
			return {
				success: false,
				enabled: readFocusModeEnabled(),
				supported: true,
				error,
			};
		}

		try {
			writeAppSetting(FOCUS_MODE_SETTING_KEY, enabled);

			const result: FocusModeResult = {
				success: true,
				enabled,
				supported: true,
			};

			// Broadcast to all renderer windows so multi-window state stays in sync.
			broadcastFocusModeChanged(result);

			return result;
		} catch (error) {
			console.error("[focus-mode] Failed to set focus mode:", error);
			// Return last-known state so the renderer can revert correctly.
			return {
				success: false,
				enabled: readFocusModeEnabled(),
				supported: true,
				error: String(error),
			};
		}
	});
}
