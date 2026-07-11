// Keystroke overlay — token → display label mapping.
//
// Pure functions only. Given a semantic key token (from the capture layer) and
// the current platform glyph style, produce the human-facing keycap label.

import type { KeystrokeEvent, ModifierGlyphStyle } from "./keystrokeTypes";

/**
 * Tokens that represent a modifier or lock key on their own. A lone press of
 * one of these should NOT produce a keycap — modifiers only appear as part of a
 * chord (see coalescing).
 */
const MODIFIER_TOKENS = new Set<string>([
	"Ctrl",
	"Control",
	"ControlLeft",
	"ControlRight",
	"CtrlRight",
	"Alt",
	"AltLeft",
	"AltRight",
	"AltGr",
	"Shift",
	"ShiftLeft",
	"ShiftRight",
	"Meta",
	"MetaLeft",
	"MetaRight",
	"Cmd",
	"Command",
	"Super",
	"Win",
	"CapsLock",
	"NumLock",
	"ScrollLock",
	"Fn",
]);

export function isModifierToken(token: string): boolean {
	return MODIFIER_TOKENS.has(token);
}

/**
 * Ordered modifier labels present on an event. Order is Ctrl, Alt, Shift, Meta —
 * matching the conventional left-to-right reading order for shortcut chords.
 */
export function formatModifierLabels(
	event: Pick<KeystrokeEvent, "ctrl" | "alt" | "shift" | "meta">,
	style: ModifierGlyphStyle,
): string[] {
	const isMac = style === "mac";
	const labels: string[] = [];

	if (event.ctrl) {
		labels.push(isMac ? "⌃" : "Ctrl");
	}
	if (event.alt) {
		labels.push(isMac ? "⌥" : "Alt");
	}
	if (event.shift) {
		labels.push(isMac ? "⇧" : "Shift");
	}
	if (event.meta) {
		labels.push(isMac ? "⌘" : style === "linux" ? "Super" : "Win");
	}

	return labels;
}

const KEY_LABEL_MAP: Record<string, string> = {
	Enter: "↵",
	Return: "↵",
	Escape: "Esc",
	Esc: "Esc",
	Backspace: "⌫",
	Delete: "⌦",
	Del: "⌦",
	Tab: "⇥",
	Space: "Space",
	Spacebar: "Space",
	Up: "↑",
	ArrowUp: "↑",
	Down: "↓",
	ArrowDown: "↓",
	Left: "←",
	ArrowLeft: "←",
	Right: "→",
	ArrowRight: "→",
	Home: "Home",
	End: "End",
	PageUp: "PgUp",
	PageDown: "PgDn",
	Insert: "Ins",
	Comma: ",",
	Period: ".",
	Slash: "/",
	Backslash: "\\",
	Semicolon: ";",
	Quote: "'",
	Apostrophe: "'",
	BracketLeft: "[",
	BracketRight: "]",
	Minus: "-",
	Equal: "=",
	Plus: "+",
	Backquote: "`",
	Grave: "`",
};

/**
 * Map a semantic key token to its display label. Handles named keys, letters,
 * digits (top-row / numpad / "DigitN" spellings), and function keys, with a
 * graceful humanized fallback for anything unrecognised.
 */
export function keyTokenToLabel(token: string): string {
	if (!token) {
		return "";
	}

	const mapped = KEY_LABEL_MAP[token];
	if (mapped) {
		return mapped;
	}

	// Single letter → uppercase keycap.
	if (/^[A-Za-z]$/.test(token)) {
		return token.toUpperCase();
	}

	// Digit tokens across spellings: "1", "Num1", "Digit1", "Numpad1".
	const digitMatch = token.match(/^(?:Num|Digit|Numpad)?([0-9])$/);
	if (digitMatch) {
		return digitMatch[1];
	}

	// Function keys F1..F24.
	if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(token)) {
		return token;
	}

	// Already a single printable character.
	if (token.length === 1) {
		return token;
	}

	// Unknown token — show it as-is rather than dropping the keystroke.
	return token;
}
