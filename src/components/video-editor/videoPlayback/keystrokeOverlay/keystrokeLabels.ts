import type { KeystrokeModifier } from "./keystrokeTypes";

const MODIFIER_ORDER: KeystrokeModifier[] = ["meta", "ctrl", "alt", "shift"];

const SPECIAL_KEY_LABELS: Record<string, string> = {
	enter: "Enter",
	esc: "Esc",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	space: "Space",
	arrowleft: "←",
	arrowright: "→",
	arrowup: "↑",
	arrowdown: "↓",
	home: "Home",
	end: "End",
	pageup: "PgUp",
	pagedown: "PgDn",
};

const PUNCTUATION_LABELS: Record<string, string> = {
	comma: ",",
	period: ".",
	minus: "-",
	equal: "=",
	slash: "/",
	semicolon: ";",
	quote: "'",
	bracketleft: "[",
	bracketright: "]",
	backslash: "\\",
	backquote: "`",
};

function isFunctionKey(key: string) {
	return /^f([1-9]|1[0-9])$/.test(key);
}

export function isCharacterKey(key: string) {
	return key === "space" || key.length === 1 || key in PUNCTUATION_LABELS;
}

function modifierLabel(modifier: KeystrokeModifier, modifiers: readonly KeystrokeModifier[]) {
	if (modifier === "meta") {
		return "⌘";
	}
	if (modifier === "ctrl") {
		return "Ctrl";
	}
	if (modifier === "alt") {
		return "Alt";
	}
	return modifiers.includes("meta") ? "⇧" : "Shift";
}

function keyLabel(key: string) {
	const special = SPECIAL_KEY_LABELS[key];
	if (special) {
		return special;
	}
	const punctuation = PUNCTUATION_LABELS[key];
	if (punctuation) {
		return punctuation;
	}
	if (isFunctionKey(key) || key.length === 1) {
		return key.toUpperCase();
	}
	return key.charAt(0).toUpperCase() + key.slice(1);
}

export function keystrokeLabels(key: string, modifiers: readonly KeystrokeModifier[]): string[] {
	const present = new Set(modifiers);
	const labels: string[] = [];
	for (const modifier of MODIFIER_ORDER) {
		if (present.has(modifier)) {
			labels.push(modifierLabel(modifier, modifiers));
		}
	}
	labels.push(keyLabel(key));
	return labels;
}
