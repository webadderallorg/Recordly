import fs from "node:fs/promises";
import { BrowserWindow, globalShortcut, ipcMain } from "electron";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	mergeRecordingShortcuts,
	RECORDING_SHORTCUT_ACTIONS,
	type RecordingShortcutAction,
	type RecordingShortcutsConfig,
} from "../../../src/lib/recordingShortcuts";
import { RECORDING_SHORTCUTS_FILE } from "../constants";
import { parseJsonWithByteOrderMark } from "../utils";

let registeredAccelerators: string[] = [];
let currentConfig: RecordingShortcutsConfig = { ...DEFAULT_RECORDING_SHORTCUTS };

/** Notify every open window that a global recording shortcut was pressed. */
function broadcastRecordingShortcut(action: RecordingShortcutAction) {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send("recording-shortcut", { action });
		}
	}
}

/** Unregister every previously registered recording accelerator. */
function unregisterAll() {
	for (const accelerator of registeredAccelerators) {
		try {
			globalShortcut.unregister(accelerator);
		} catch (error) {
			console.warn(`[recording-shortcuts] Failed to unregister ${accelerator}:`, error);
		}
	}
	registeredAccelerators = [];
}

/**
 * Replace the active global shortcuts with the given config.
 * Returns which actions failed to register (e.g. OS already owns the key).
 */
function registerFromConfig(config: RecordingShortcutsConfig): {
	success: boolean;
	config: RecordingShortcutsConfig;
	failed: RecordingShortcutAction[];
} {
	unregisterAll();
	currentConfig = config;
	const failed: RecordingShortcutAction[] = [];
	const used = new Set<string>();

	for (const action of RECORDING_SHORTCUT_ACTIONS) {
		const accelerator = config[action];
		if (used.has(accelerator)) {
			console.warn(
				`[recording-shortcuts] Duplicate accelerator "${accelerator}" for ${action}`,
			);
			failed.push(action);
			continue;
		}
		used.add(accelerator);

		try {
			const ok = globalShortcut.register(accelerator, () => {
				broadcastRecordingShortcut(action);
			});
			if (!ok) {
				console.warn(
					`[recording-shortcuts] Could not register "${accelerator}" for ${action} (may be taken by the OS)`,
				);
				failed.push(action);
				continue;
			}
			registeredAccelerators.push(accelerator);
		} catch (error) {
			console.warn(
				`[recording-shortcuts] Error registering "${accelerator}" for ${action}:`,
				error,
			);
			failed.push(action);
		}
	}

	return { success: failed.length === 0, config: currentConfig, failed };
}

/** Load persisted shortcuts from disk, or defaults when the file is missing. */
async function loadConfigFromDisk(): Promise<RecordingShortcutsConfig> {
	try {
		const data = await fs.readFile(RECORDING_SHORTCUTS_FILE, "utf-8");
		return mergeRecordingShortcuts(
			parseJsonWithByteOrderMark<Partial<RecordingShortcutsConfig>>(data),
		);
	} catch {
		return { ...DEFAULT_RECORDING_SHORTCUTS };
	}
}

/** Current in-memory recording shortcuts config (after last load/save/reset). */
export function getRecordingShortcutsConfig(): RecordingShortcutsConfig {
	return currentConfig;
}

/** Unregister all recording shortcuts (call on app quit). */
export function unregisterRecordingShortcuts() {
	unregisterAll();
}

/** Load persisted shortcuts and register them with Electron `globalShortcut`. */
export async function initRecordingShortcuts() {
	const config = await loadConfigFromDisk();
	return registerFromConfig(config);
}

/** Register IPC handlers for get/save/reset of recording shortcuts. */
export function registerRecordingShortcutHandlers() {
	ipcMain.handle("get-recording-shortcuts", async () => {
		return currentConfig;
	});

	ipcMain.handle("save-recording-shortcuts", async (_, shortcuts: unknown) => {
		try {
			const next = mergeRecordingShortcuts(
				shortcuts as Partial<RecordingShortcutsConfig> | null,
			);
			await fs.writeFile(RECORDING_SHORTCUTS_FILE, JSON.stringify(next, null, 2), "utf-8");
			const result = registerFromConfig(next);
			return {
				success: result.success,
				config: result.config,
				failed: result.failed,
			};
		} catch (error) {
			console.error("[recording-shortcuts] Failed to save:", error);
			return {
				success: false,
				config: currentConfig,
				failed: [...RECORDING_SHORTCUT_ACTIONS],
				error: String(error),
			};
		}
	});

	ipcMain.handle("reset-recording-shortcuts", async () => {
		try {
			await fs.writeFile(
				RECORDING_SHORTCUTS_FILE,
				JSON.stringify(DEFAULT_RECORDING_SHORTCUTS, null, 2),
				"utf-8",
			);
		} catch (error) {
			console.error("[recording-shortcuts] Failed to reset:", error);
			return {
				success: false,
				config: currentConfig,
				failed: [],
				error: String(error),
			};
		}
		const result = registerFromConfig({ ...DEFAULT_RECORDING_SHORTCUTS });
		return { success: result.success, config: result.config, failed: result.failed };
	});
}
