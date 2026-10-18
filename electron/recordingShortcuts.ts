import fs from "node:fs";
import path from "node:path";
import { app, globalShortcut, ipcMain } from "electron";
import {
	DEFAULT_RECORDING_SHORTCUTS,
	RECORDING_SHORTCUT_LABELS,
	type RecordingShortcutAction,
	type RecordingShortcutSettings,
	type RecordingShortcutStatus,
	validateRecordingShortcuts,
} from "../src/lib/recordingShortcuts";
import { USER_DATA_PATH } from "./appPaths";

export function registerRecordingShortcuts(dispatch: (action: RecordingShortcutAction) => void) {
	const settingsPath = path.join(USER_DATA_PATH, "recording-shortcuts.json");
	let settings = { ...DEFAULT_RECORDING_SHORTCUTS };
	let errors: string[] = [];
	const registered = new Set<string>();
	const unregister = () => {
		for (const binding of registered) globalShortcut.unregister(binding);
		registered.clear();
	};
	const bind = (next: RecordingShortcutSettings) => {
		unregister();
		errors = [];
		for (const action of Object.keys(next) as RecordingShortcutAction[]) {
			const binding = next[action];
			if (!binding) continue;
			try {
				if (globalShortcut.register(binding, () => dispatch(action))) {
					registered.add(binding);
				} else {
					errors.push(
						`${RECORDING_SHORTCUT_LABELS[action]}: ${binding} is unavailable or already in use.`,
					);
				}
			} catch (error) {
				errors.push(`${binding}: ${String(error)}`);
			}
		}
		for (const error of errors) console.warn("[recording-shortcuts]", error);
	};
	try {
		if (fs.existsSync(settingsPath))
			settings = validateRecordingShortcuts(
				JSON.parse(fs.readFileSync(settingsPath, "utf8")),
			);
		bind(settings);
	} catch (error) {
		// Do not replace a corrupt user configuration with silently active defaults.
		errors = [`Could not load recording shortcuts: ${String(error)}`];
		console.warn("[recording-shortcuts]", errors[0]);
	}
	const status = (): RecordingShortcutStatus => ({
		settings: { ...settings },
		errors: [...errors],
	});
	ipcMain.handle("get-recording-shortcuts", status);
	ipcMain.handle("set-recording-shortcuts", (_event, value: unknown) => {
		try {
			const next = validateRecordingShortcuts(value);
			// Persist before replacing active bindings, so disk failures leave them intact.
			fs.writeFileSync(`${settingsPath}.tmp`, JSON.stringify(next, null, 2), "utf8");
			fs.renameSync(`${settingsPath}.tmp`, settingsPath);
			settings = next;
			bind(settings);
			return { success: true, ...status() };
		} catch (error) {
			return { success: false, ...status(), error: String(error) };
		}
	});
	app.on("will-quit", unregister);
	return status;
}
