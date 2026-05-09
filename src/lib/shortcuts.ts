export interface ShortcutBinding {
	key: string;
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export const EDITOR_SHORTCUT_ACTIONS = [
	"addZoom",
	"splitClip",
	"addAnnotation",
	"addKeyframe",
	"deleteSelected",
	"playPause",
] as const;

export type EditorShortcutAction = (typeof EDITOR_SHORTCUT_ACTIONS)[number];
export type ShortcutsConfig = Record<EditorShortcutAction, ShortcutBinding>;

export const LAUNCH_SHORTCUT_ACTIONS = [
	"startRecording",
	"stopRecording",
	"pauseRecording",
	"resumeRecording",
	"muteMicrophone",
] as const;

export type LaunchShortcutAction = (typeof LAUNCH_SHORTCUT_ACTIONS)[number];
export type LaunchShortcutsConfig = Record<LaunchShortcutAction, ShortcutBinding>;

export interface FixedShortcut {
	label: string;
	display: string;
	bindings: ShortcutBinding[];
}

export const FIXED_SHORTCUTS: FixedShortcut[] = [
	{ label: "Cycle Annotations Forward", display: "Tab", bindings: [{ key: "tab" }] },
	{ label: "Cycle Annotations Backward", display: "Shift + Tab", bindings: [{ key: "tab", shift: true }] },
	{ label: "Delete Selected (alt)", display: "Del / ⌫", bindings: [{ key: "delete" }, { key: "backspace" }] },
	{ label: "Pan Timeline", display: "Shift + Ctrl + Scroll", bindings: [] },
	{ label: "Zoom Timeline", display: "Ctrl + Scroll", bindings: [] },
];

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

export const SHORTCUT_LABELS: Record<EditorShortcutAction, string> = {
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

type Conflict<T extends string> = { type: "configurable"; action: T };
export type ShortcutConflict = Conflict<EditorShortcutAction> | { type: "fixed"; label: string };
export type LaunchShortcutConflict = Conflict<LaunchShortcutAction>;

export function bindingsEqual(a: ShortcutBinding, b: ShortcutBinding): boolean {
	return a.key.toLowerCase() === b.key.toLowerCase() && !!a.ctrl === !!b.ctrl && !!a.shift === !!b.shift && !!a.alt === !!b.alt;
}

function findConfigConflict<T extends string>(
	binding: ShortcutBinding,
	forAction: T,
	actions: readonly T[],
	config: Record<T, ShortcutBinding>,
): Conflict<T> | null {
	for (const action of actions) {
		if (action !== forAction && bindingsEqual(config[action], binding)) return { type: "configurable", action };
	}
	return null;
}

export function findConflict(
	binding: ShortcutBinding,
	forAction: EditorShortcutAction,
	config: ShortcutsConfig,
): ShortcutConflict | null {
	for (const fixed of FIXED_SHORTCUTS) {
		if (fixed.bindings.some((b) => bindingsEqual(b, binding))) return { type: "fixed", label: fixed.label };
	}
	return findConfigConflict(binding, forAction, EDITOR_SHORTCUT_ACTIONS, config);
}

export function findLaunchConflict(
	binding: ShortcutBinding,
	forAction: LaunchShortcutAction,
	config: LaunchShortcutsConfig,
): LaunchShortcutConflict | null {
	return findConfigConflict(binding, forAction, LAUNCH_SHORTCUT_ACTIONS, config);
}

export function matchesShortcut(e: KeyboardEvent, binding: ShortcutBinding, isMacPlatform: boolean): boolean {
	if (e.key.toLowerCase() !== binding.key.toLowerCase()) return false;
	const primaryMod = isMacPlatform ? e.metaKey : e.ctrlKey;
	return primaryMod === !!binding.ctrl && e.shiftKey === !!binding.shift && e.altKey === !!binding.alt;
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

function mergeDefaults<T extends string>(
	defaults: Record<T, ShortcutBinding>,
	actions: readonly T[],
	partial: Partial<Record<T, ShortcutBinding>>,
): Record<T, ShortcutBinding> {
	const merged = { ...defaults };
	for (const action of actions) {
		if (partial[action]) merged[action] = partial[action] as ShortcutBinding;
	}
	return merged;
}

export const mergeWithDefaults = (partial: Partial<ShortcutsConfig>) =>
	mergeDefaults(DEFAULT_SHORTCUTS, EDITOR_SHORTCUT_ACTIONS, partial);

export const mergeLaunchWithDefaults = (partial: Partial<LaunchShortcutsConfig>) =>
	mergeDefaults(DEFAULT_LAUNCH_SHORTCUTS, LAUNCH_SHORTCUT_ACTIONS, partial);

export type PersistedShortcutsPayload =
	| Partial<ShortcutsConfig>
	| { editor?: Partial<ShortcutsConfig>; launch?: Partial<LaunchShortcutsConfig> };

export function resolvePersistedShortcuts(payload: PersistedShortcutsPayload | null | undefined) {
	if (!payload || typeof payload !== "object") {
		return { editor: { ...DEFAULT_SHORTCUTS }, launch: { ...DEFAULT_LAUNCH_SHORTCUTS } };
	}

	const maybeStructured = payload as { editor?: Partial<ShortcutsConfig>; launch?: Partial<LaunchShortcutsConfig> };
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
