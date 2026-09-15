export const RECORDING_SHORTCUT_ACTIONS = ["toggle", "pauseResume", "stop"] as const;

export type RecordingShortcutAction = (typeof RECORDING_SHORTCUT_ACTIONS)[number];

/** Electron `globalShortcut` accelerator string, e.g. "F9" or "CommandOrControl+Shift+R". */
export type RecordingShortcutAccelerator = string;

export type RecordingShortcutsConfig = Record<
	RecordingShortcutAction,
	RecordingShortcutAccelerator
>;

/** Live recording controls used when a global shortcut is pressed. */
export type RecordingShortcutControls = {
	recording: boolean;
	paused: boolean;
	toggleRecording: () => void | Promise<void>;
	pauseRecording: () => void;
	resumeRecording: () => void;
	stopRecording: () => void;
};

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

/**
 * Merge a partial shortcuts config with defaults.
 * Blank or missing accelerators fall back to `DEFAULT_RECORDING_SHORTCUTS`.
 */
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

/**
 * Route a recording-shortcut action to the matching control callback.
 * Ignores pause/stop when not recording so idle presses are no-ops.
 */
export function dispatchRecordingShortcut(
	action: RecordingShortcutAction | undefined,
	controls: RecordingShortcutControls,
): void {
	if (action === "toggle") {
		void controls.toggleRecording();
		return;
	}
	if (action === "stop") {
		if (controls.recording) {
			controls.stopRecording();
		}
		return;
	}
	if (action === "pauseResume") {
		if (!controls.recording) return;
		if (controls.paused) {
			controls.resumeRecording();
		} else {
			controls.pauseRecording();
		}
	}
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
