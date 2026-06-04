export const SHORTCUT_ACTIONS = [
	"addZoom",
	"splitClip",
	"addAnnotation",
	"addKeyframe",
	"deleteSelected",
	"playPause",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export const LAUNCH_SHORTCUT_ACTIONS = [
	"startRecording",
	"stopRecording",
	"pauseRecording",
	"resumeRecording",
	"muteMicrophone",
] as const;

export type LaunchShortcutAction = (typeof LAUNCH_SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
	key: string;
	/** Maps to Cmd on macOS, Ctrl on Windows/Linux */
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type ShortcutsConfig = Record<ShortcutAction, ShortcutBinding>;
export type LaunchShortcutsConfig = Record<LaunchShortcutAction, ShortcutBinding>;

export interface FixedShortcut {
	label: string;
	display: string;
	bindings: ShortcutBinding[];
}

export const FIXED_SHORTCUTS: FixedShortcut[] = [
	{ label: "Cycle Annotations Forward", display: "Tab", bindings: [{ key: "tab" }] },
	{
		label: "Cycle Annotations Backward",
		display: "Shift + Tab",
		bindings: [{ key: "tab", shift: true }],
	},
	{
		label: "Delete Selected (alt)",
		display: "Del / ⌫",
		bindings: [{ key: "delete" }, { key: "backspace" }],
	},
	{ label: "Pan Timeline", display: "Shift + Scroll", bindings: [] },
	{ label: "Zoom Timeline", display: "Ctrl + Scroll", bindings: [] },
];

export type ShortcutConflict =
	| { type: "configurable"; action: ShortcutAction }
	| { type: "fixed"; label: string };
export type LaunchShortcutConflict = { type: "configurable"; action: LaunchShortcutAction };

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
	return (
		a.key.toLowerCase() === b.key.toLowerCase() &&
		!!a.ctrl === !!b.ctrl &&
		!!a.shift === !!b.shift &&
		!!a.alt === !!b.alt
	);
}

export function findConflict(
	binding: ShortcutBinding,
	forAction: ShortcutAction,
	config: ShortcutsConfig,
): ShortcutConflict | null {
	for (const fixed of FIXED_SHORTCUTS) {
		if (fixed.bindings.some((b) => bindingsEqual(b, binding))) {
			return { type: "fixed", label: fixed.label };
		}
	}
	for (const action of SHORTCUT_ACTIONS) {
		if (action !== forAction && bindingsEqual(config[action], binding)) {
			return { type: "configurable", action };
		}
	}
	return null;
}

export function findLaunchConflict(
	binding: ShortcutBinding,
	forAction: LaunchShortcutAction,
	config: LaunchShortcutsConfig,
): LaunchShortcutConflict | null {
	for (const action of LAUNCH_SHORTCUT_ACTIONS) {
		if (action !== forAction && bindingsEqual(config[action], binding)) {
			return { type: "configurable", action };
		}
	}
	return null;
}

export const DEFAULT_SHORTCUTS: ShortcutsConfig = {
	addZoom: { key: "z" },
	splitClip: { key: "c" },
	addAnnotation: { key: "a" },
	addKeyframe: { key: "f" },
	deleteSelected: { key: "d", ctrl: true },
	playPause: { key: " " },
};

export const DEFAULT_LAUNCH_SHORTCUTS: LaunchShortcutsConfig = {
	startRecording: { key: "r", ctrl: true, shift: true },
	stopRecording: { key: "s", ctrl: true, shift: true },
	pauseRecording: { key: "p", ctrl: true, shift: true },
	resumeRecording: { key: "p", ctrl: true, shift: true, alt: true },
	muteMicrophone: { key: "m", ctrl: true, shift: true },
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	addZoom: "Add Zoom",
	splitClip: "Split Clip",
	addAnnotation: "Add Annotation",
	addKeyframe: "Add Keyframe",
	deleteSelected: "Delete Selected",
	playPause: "Play / Pause",
};

export const LAUNCH_SHORTCUT_LABELS: Record<LaunchShortcutAction, string> = {
	startRecording: "Start Recording",
	stopRecording: "Stop Recording",
	pauseRecording: "Pause Recording",
	resumeRecording: "Resume Recording",
	muteMicrophone: "Mute / Unmute Microphone",
};

export function matchesShortcut(
	e: KeyboardEvent,
	binding: ShortcutBinding,
	isMacPlatform: boolean,
): boolean {
	if (e.key.toLowerCase() !== binding.key.toLowerCase()) return false;

	const primaryMod = isMacPlatform ? e.metaKey : e.ctrlKey;
	if (primaryMod !== !!binding.ctrl) return false;
	if (e.shiftKey !== !!binding.shift) return false;
	if (e.altKey !== !!binding.alt) return false;

	return true;
}

const KEY_LABELS: Record<string, string> = {
	" ": "Space",
	delete: "Del",
	backspace: "⌫",
	escape: "Esc",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
};

export function formatBinding(binding: ShortcutBinding, isMac: boolean): string {
	const parts: string[] = [];
	if (binding.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
	if (binding.shift) parts.push(isMac ? "⇧" : "Shift");
	if (binding.alt) parts.push(isMac ? "⌥" : "Alt");
	parts.push(KEY_LABELS[binding.key] ?? binding.key.toUpperCase());
	return parts.join(" + ");
}

export function mergeWithDefaults(partial: Partial<ShortcutsConfig>): ShortcutsConfig {
	const merged = { ...DEFAULT_SHORTCUTS };
	for (const action of SHORTCUT_ACTIONS) {
		if (partial[action]) {
			merged[action] = partial[action] as ShortcutBinding;
		}
	}
	return merged;
}

export function mergeLaunchWithDefaults(
	partial: Partial<LaunchShortcutsConfig>,
): LaunchShortcutsConfig {
	const merged = { ...DEFAULT_LAUNCH_SHORTCUTS };
	for (const action of LAUNCH_SHORTCUT_ACTIONS) {
		if (partial[action]) {
			merged[action] = partial[action] as ShortcutBinding;
		}
	}
	return merged;
}

export type PersistedShortcutsPayload =
	| Partial<ShortcutsConfig>
	| {
			editor?: Partial<ShortcutsConfig>;
			launch?: Partial<LaunchShortcutsConfig>;
	  };

export function resolvePersistedShortcuts(payload: PersistedShortcutsPayload | null | undefined): {
	editor: ShortcutsConfig;
	launch: LaunchShortcutsConfig;
} {
	if (!payload || typeof payload !== "object") {
		return {
			editor: { ...DEFAULT_SHORTCUTS },
			launch: { ...DEFAULT_LAUNCH_SHORTCUTS },
		};
	}

	const maybeStructured = payload as {
		editor?: Partial<ShortcutsConfig>;
		launch?: Partial<LaunchShortcutsConfig>;
	};

	if ("editor" in maybeStructured || "launch" in maybeStructured) {
		return {
			editor: mergeWithDefaults(maybeStructured.editor ?? {}),
			launch: mergeLaunchWithDefaults(maybeStructured.launch ?? {}),
		};
	}

	return {
		editor: mergeWithDefaults(payload as Partial<ShortcutsConfig>),
		launch: { ...DEFAULT_LAUNCH_SHORTCUTS },
	};
}
