export const DEFAULT_RECORDING_SHORTCUTS = {
	toggleRecording: "CommandOrControl+Alt+R",
	togglePause: "CommandOrControl+Alt+P",
	toggleHud: "CommandOrControl+Alt+H",
	cancelRecording: "CommandOrControl+Alt+Shift+X",
	openCapturePicker: "CommandOrControl+Shift+2",
};

export type RecordingShortcutAction = keyof typeof DEFAULT_RECORDING_SHORTCUTS;
export type RecordingShortcutSettings = Record<RecordingShortcutAction, string>;
export type RecordingShortcutStatus = {
	settings: RecordingShortcutSettings;
	errors: string[];
};

export const RECORDING_SHORTCUT_LABELS: Record<RecordingShortcutAction, string> = {
	toggleRecording: "Start / stop recording",
	togglePause: "Pause / resume recording",
	toggleHud: "Show / hide controls",
	cancelRecording: "Cancel recording (with confirmation)",
	openCapturePicker: "Choose recording source",
};

// A deliberately small accelerator grammar makes configuration errors explicit.
// Empty bindings disable an action. Require modifiers for letters to avoid typing traps.
export function validateRecordingShortcuts(value: unknown): RecordingShortcutSettings {
	if (!value || typeof value !== "object") throw new Error("Invalid shortcut settings.");
	const result = {} as RecordingShortcutSettings;
	const seen = new Set<string>();
	for (const action of Object.keys(DEFAULT_RECORDING_SHORTCUTS) as RecordingShortcutAction[]) {
		const binding = (value as Record<string, unknown>)[action];
		if (typeof binding !== "string") throw new Error(`Missing shortcut: ${action}`);
		const parts = binding.trim().split("+");
		const key = parts.pop() ?? "";
		const modifiers = parts.map((part) => {
			const normalized = part.toLowerCase();
			return (
				(
					{ ctrl: "control", cmd: "command", cmdorctrl: "commandorcontrol" } as Record<
						string,
						string
					>
				)[normalized] ?? normalized
			);
		});
		if (
			binding.trim() &&
			(!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/i.test(key) ||
				(!modifiers.length && !/^F\d+$/i.test(key)) ||
				modifiers.some(
					(part) =>
						![
							"commandorcontrol",
							"control",
							"command",
							"alt",
							"shift",
							"super",
						].includes(part),
				) ||
				new Set(modifiers).size !== modifiers.length)
		)
			throw new Error(
				`Invalid shortcut for ${RECORDING_SHORTCUT_LABELS[action]}: ${binding}`,
			);
		const canonical = [...modifiers.sort(), key.toUpperCase()].join("+");
		if (binding.trim() && seen.has(canonical))
			throw new Error(`Duplicate shortcut: ${binding}`);
		if (binding.trim()) seen.add(canonical);
		result[action] = binding.trim();
	}
	return result;
}
