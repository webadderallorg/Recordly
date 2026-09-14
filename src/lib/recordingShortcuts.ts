export const RECORDING_SHORTCUT_ACTIONS = ["toggle", "pauseResume", "stop"] as const;

export type RecordingShortcutAction = (typeof RECORDING_SHORTCUT_ACTIONS)[number];

/** Electron `globalShortcut` accelerator string, e.g. "F9" or "CommandOrControl+Shift+R". */
export type RecordingShortcutAccelerator = string;

export type RecordingShortcutsConfig = Record<
	RecordingShortcutAction,
	RecordingShortcutAccelerator
>;

export const DEFAULT_RECORDING_SHORTCUTS: RecordingShortcutsConfig = {
	toggle: "F9",
	pauseResume: "F8",
	stop: "F10",
};

export const RECORDING_SHORTCUT_LABELS: Record<RecordingShortcutAction, string> = {
	toggle: "Start / Stop Recording",
	pauseResume: "Pause / Resume Recording",
	stop: "Stop Recording",
};

export function mergeRecordingShortcuts(
	partial: Partial<RecordingShortcutsConfig> | null | undefined,
): RecordingShortcutsConfig {
	const merged: RecordingShortcutsConfig = { ...DEFAULT_RECORDING_SHORTCUTS };
	if (!partial || typeof partial !== "object") {
		return merged;
	}

	for (const action of RECORDING_SHORTCUT_ACTIONS) {
		const value = partial[action];
		if (typeof value === "string" && value.trim().length > 0) {
			merged[action] = value.trim();
		}
	}
	return merged;
}

/** Human-readable label for tooltips (Electron accelerators → display text). */
export function formatRecordingAccelerator(accelerator: string, isMac: boolean): string {
	return accelerator
		.split("+")
		.map((part) => {
			const key = part.trim();
			const lower = key.toLowerCase();
			if (lower === "commandorcontrol" || lower === "cmdorctrl") {
				return isMac ? "⌘" : "Ctrl";
			}
			if (lower === "command" || lower === "cmd" || lower === "meta") {
				return isMac ? "⌘" : "Ctrl";
			}
			if (lower === "control" || lower === "ctrl") return isMac ? "⌃" : "Ctrl";
			if (lower === "shift") return isMac ? "⇧" : "Shift";
			if (lower === "alt" || lower === "option") return isMac ? "⌥" : "Alt";
			if (lower === "super") return isMac ? "⌘" : "Win";
			if (lower === "space") return "Space";
			if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
			if (key.length === 1) return key.toUpperCase();
			return key;
		})
		.join(" + ");
}
