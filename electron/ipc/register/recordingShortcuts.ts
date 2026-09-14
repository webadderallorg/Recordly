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

function broadcastRecordingShortcut(action: RecordingShortcutAction) {
	for (const window of BrowserWindow.getAllWindows()) {
		if (!window.isDestroyed()) {
			window.webContents.send("recording-shortcut", { action });
		}
	}
}

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

export function getRecordingShortcutsConfig(): RecordingShortcutsConfig {
	return currentConfig;
}

export function unregisterRecordingShortcuts() {
	unregisterAll();
}

export async function initRecordingShortcuts() {
	const config = await loadConfigFromDisk();
	return registerFromConfig(config);
}

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
		} catch {
			/* ignore write failure; still re-register defaults in memory */
		}
		const result = registerFromConfig({ ...DEFAULT_RECORDING_SHORTCUTS });
		return { success: result.success, config: result.config, failed: result.failed };
	});
}
