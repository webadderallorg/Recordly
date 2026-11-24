export const SHORTCUT_ACTIONS = [
	"addZoom",
	"splitClip",
	"trimStart",
	"trimEnd",
	"addAnnotation",
	"addKeyframe",
	"deleteSelected",
	"duplicateSelected",
	"playPause",
] as const;

export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];

export interface ShortcutBinding {
	key: string;
	/** Maps to Cmd on macOS, Ctrl on Windows/Linux */
	ctrl?: boolean;
	shift?: boolean;
	alt?: boolean;
}

export type ShortcutsConfig = Record<ShortcutAction, ShortcutBinding>;
export const SHORTCUTS_VERSION = 1;
export type StoredShortcutsConfig = Partial<ShortcutsConfig> & { version?: number };

export function serializeShortcuts(config: ShortcutsConfig) {
	return { ...config, version: SHORTCUTS_VERSION };
}

export interface FixedShortcut {
	label: string;
	display?: string;
	bindings: ShortcutBinding[];
}

export const CLEAR_ALL_ZOOMS_SHORTCUT: ShortcutBinding = {
	key: "backspace",
	ctrl: true,
	shift: true,
};

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
	{ label: "Clear All Zooms", bindings: [CLEAR_ALL_ZOOMS_SHORTCUT] },
	{ label: "Pan Timeline", display: "Shift + Scroll", bindings: [] },
	{ label: "Zoom Timeline", display: "Ctrl + Scroll", bindings: [] },
];

export type ShortcutConflict =
	| { type: "configurable"; action: ShortcutAction }
	| { type: "fixed"; label: string };

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

export const DEFAULT_SHORTCUTS: ShortcutsConfig = {
	addZoom: { key: "z" },
	splitClip: { key: "b", ctrl: true },
	trimStart: { key: "q" },
	trimEnd: { key: "w" },
	addAnnotation: { key: "a" },
	addKeyframe: { key: "f" },
	deleteSelected: { key: "d", ctrl: true },
	duplicateSelected: { key: "d", ctrl: true, shift: true },
	playPause: { key: " " },
};

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
	addZoom: "Add Zoom",
	splitClip: "Split Clip",
	trimStart: "Trim Start to Playhead",
	trimEnd: "Trim End to Playhead",
	addAnnotation: "Add Annotation",
	addKeyframe: "Add Keyframe",
	deleteSelected: "Delete Selected",
	duplicateSelected: "Duplicate Selected",
	playPause: "Play / Pause",
};

export function matchesShortcut(
	e: KeyboardEvent,
	binding: ShortcutBinding,
	isMacPlatform: boolean,
	allowOptionLetter = false,
): boolean {
	const key = binding.key.toLowerCase();
	const reportedKey = e.key.toLowerCase();
	const optionLetterMatches =
		allowOptionLetter &&
		isMacPlatform &&
		e.altKey &&
		/^[a-z]$/.test(key) &&
		!/^[a-z]$/.test(reportedKey) &&
		e.code === `Key${key.toUpperCase()}`;
	if (reportedKey !== key && !optionLetterMatches) return false;

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

export function mergeWithDefaults(partial: StoredShortcutsConfig): ShortcutsConfig {
	const merged = { ...DEFAULT_SHORTCUTS };
	for (const action of SHORTCUT_ACTIONS) {
		if (partial[action]) {
			merged[action] = partial[action] as ShortcutBinding;
		}
	}
	// Saved configurations include the previous C default. Upgrade that binding
	// while preserving custom shortcuts and avoiding collisions with other actions.
	if (
		(partial.version ?? 0) < SHORTCUTS_VERSION &&
		bindingsEqual(merged.splitClip, { key: "c" }) &&
		!findConflict(DEFAULT_SHORTCUTS.splitClip, "splitClip", merged)
	) {
		merged.splitClip = DEFAULT_SHORTCUTS.splitClip;
	}
	for (const action of ["trimStart", "trimEnd"] as const) {
		if (partial[action]) continue;
		const { key } = DEFAULT_SHORTCUTS[action];
		const modifiers = [
			{},
			{ shift: true },
			{ alt: true },
			{ alt: true, shift: true },
			{ ctrl: true },
			{ ctrl: true, shift: true },
			{ ctrl: true, alt: true },
			{ ctrl: true, alt: true, shift: true },
		];
		for (const modifier of modifiers) {
			const binding = { key, ...modifier };
			if (findConflict(binding, action, merged)) continue;
			merged[action] = binding;
			break;
		}
	}
	return merged;
}
