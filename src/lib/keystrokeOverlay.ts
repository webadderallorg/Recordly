export const KEYSTROKE_OVERLAY_CAPTURE_SETTING = "keystrokeOverlayCaptureEnabled";
export const KEYSTROKE_TELEMETRY_VERSION = 1;
export const KEYSTROKE_OVERLAY_DISPLAY_MS = 1000;

export type KeystrokeOverlayMode = "shortcuts" | "all";
export type KeystrokeOverlayPosition = "top" | "bottom";

export interface KeystrokeSample {
	timeMs: number;
	key: string;
	code: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	repeat?: boolean;
}

export interface KeystrokeOverlaySettings {
	enabled: boolean;
	mode: KeystrokeOverlayMode;
	position: KeystrokeOverlayPosition;
	fontSize: number;
	bottomOffset: number;
}

export const DEFAULT_KEYSTROKE_OVERLAY_SETTINGS: KeystrokeOverlaySettings = {
	enabled: true,
	mode: "shortcuts",
	position: "bottom",
	fontSize: 22,
	bottomOffset: 8,
};

const SPECIAL_KEYS = new Set([
	"enter",
	"return",
	"escape",
	"esc",
	"tab",
	"backspace",
	"delete",
	"space",
	"arrowup",
	"arrowdown",
	"arrowleft",
	"arrowright",
	"home",
	"end",
	"pageup",
	"pagedown",
	"insert",
	"capslock",
]);

const MODIFIER_KEYS = new Set([
	"shift",
	"control",
	"ctrl",
	"alt",
	"option",
	"meta",
	"cmd",
	"command",
	"super",
	"win",
	"windows",
]);

export function clampNumber(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function normalizeKeystrokeOverlaySettings(
	value: unknown,
	fallback: KeystrokeOverlaySettings = DEFAULT_KEYSTROKE_OVERLAY_SETTINGS,
): KeystrokeOverlaySettings {
	const source = value && typeof value === "object" ? (value as Partial<KeystrokeOverlaySettings>) : {};
	return {
		enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
		mode: source.mode === "all" || source.mode === "shortcuts" ? source.mode : fallback.mode,
		position:
			source.position === "top" || source.position === "bottom"
				? source.position
				: fallback.position,
		fontSize:
			typeof source.fontSize === "number" && Number.isFinite(source.fontSize)
				? clampNumber(source.fontSize, 12, 64)
				: fallback.fontSize,
		bottomOffset:
			typeof source.bottomOffset === "number" && Number.isFinite(source.bottomOffset)
				? clampNumber(source.bottomOffset, 0, 40)
				: fallback.bottomOffset,
	};
}

function normalizeKeyName(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}
	return value.trim();
}

export function normalizeKeystrokeSamples(rawSamples: unknown): KeystrokeSample[] {
	const samples = Array.isArray(rawSamples)
		? rawSamples
		: Array.isArray((rawSamples as { samples?: unknown[] } | null | undefined)?.samples)
			? ((rawSamples as { samples: unknown[] }).samples ?? [])
			: [];

	return samples
		.filter((sample): sample is Record<string, unknown> => Boolean(sample && typeof sample === "object"))
		.map((sample) => {
			const key = normalizeKeyName(sample.key) || normalizeKeyName(sample.code);
			const code = normalizeKeyName(sample.code) || key;
			return {
				timeMs:
					typeof sample.timeMs === "number" && Number.isFinite(sample.timeMs)
						? Math.max(0, sample.timeMs)
						: 0,
				key,
				code,
				ctrl: sample.ctrl === true,
				alt: sample.alt === true,
				shift: sample.shift === true,
				meta: sample.meta === true,
				repeat: sample.repeat === true ? true : undefined,
			} satisfies KeystrokeSample;
		})
		.filter((sample) => sample.key.length > 0)
		.sort((left, right) => left.timeMs - right.timeMs);
}

export function hasModifier(sample: Pick<KeystrokeSample, "ctrl" | "alt" | "shift" | "meta">) {
	return sample.ctrl || sample.alt || sample.shift || sample.meta;
}

function canonicalKey(sample: KeystrokeSample) {
	return (sample.key || sample.code).trim().toLowerCase();
}

export function isModifierOnlyKeystroke(sample: KeystrokeSample) {
	return MODIFIER_KEYS.has(canonicalKey(sample)) && !hasOtherNonModifierIdentity(sample);
}

function hasOtherNonModifierIdentity(sample: KeystrokeSample) {
	const key = canonicalKey(sample);
	return key.length > 0 && !MODIFIER_KEYS.has(key);
}

export function isSpecialKeystroke(sample: KeystrokeSample) {
	const key = canonicalKey(sample);
	if (SPECIAL_KEYS.has(key)) {
		return true;
	}
	if (/^f([1-9]|1[0-9]|2[0-4])$/.test(key)) {
		return true;
	}
	if (key.startsWith("arrow")) {
		return true;
	}
	return false;
}

export function isShortcutKeystroke(sample: KeystrokeSample) {
	if (isModifierOnlyKeystroke(sample)) {
		return false;
	}
	if (isSpecialKeystroke(sample)) {
		return true;
	}
	return hasModifier(sample) && hasOtherNonModifierIdentity(sample);
}

export function shouldStoreCapturedKeystroke(
	sample: KeystrokeSample,
	options: { platform?: string; isPasswordField: boolean | "unknown" },
) {
	if (options.isPasswordField !== false) {
		return false;
	}
	if (sample.repeat) {
		return false;
	}
	if (isModifierOnlyKeystroke(sample)) {
		return false;
	}
	if ((options.platform ?? "") === "linux") {
		return isShortcutKeystroke(sample);
	}
	return true;
}

export function filterKeystrokesForDisplay(
	samples: KeystrokeSample[],
	settings: KeystrokeOverlaySettings,
) {
	if (!settings.enabled) {
		return [];
	}
	return samples.filter((sample) =>
		settings.mode === "all" ? !isModifierOnlyKeystroke(sample) : isShortcutKeystroke(sample),
	);
}

const KEY_LABELS: Record<string, string> = {
	enter: "Enter",
	return: "Enter",
	escape: "Esc",
	esc: "Esc",
	tab: "Tab",
	backspace: "Backspace",
	delete: "Delete",
	space: "Space",
	arrowup: "↑",
	arrowdown: "↓",
	arrowleft: "←",
	arrowright: "→",
	pageup: "Page Up",
	pagedown: "Page Down",
	home: "Home",
	end: "End",
	insert: "Insert",
	capslock: "Caps Lock",
	equal: "=",
	minus: "-",
	",": ",",
	".": ".",
	"/": "/",
	control: "Ctrl",
	ctrl: "Ctrl",
	alt: "Alt",
	option: "Alt",
	shift: "Shift",
	meta: "⌘",
	cmd: "⌘",
	command: "⌘",
	super: "Super",
	win: "Win",
	windows: "Win",
};

function formatKeyCap(raw: string) {
	const key = raw.trim();
	if (!key) {
		return "";
	}
	const lower = key.toLowerCase();
	if (KEY_LABELS[lower]) {
		return KEY_LABELS[lower];
	}
	if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
		return key.toUpperCase();
	}
	if (key.length === 1) {
		return key.toUpperCase();
	}
	if (lower.startsWith("key") && lower.length === 4) {
		return key.slice(3).toUpperCase();
	}
	if (lower.startsWith("digit") && lower.length === 6) {
		return key.slice(5);
	}
	return key.charAt(0).toUpperCase() + key.slice(1);
}

export function formatKeystrokeLabel(sample: KeystrokeSample, isMac = false) {
	const parts: string[] = [];
	if (sample.ctrl) {
		parts.push(isMac ? "⌃" : "Ctrl");
	}
	if (sample.alt) {
		parts.push(isMac ? "⌥" : "Alt");
	}
	if (sample.shift) {
		parts.push(isMac ? "⇧" : "Shift");
	}
	if (sample.meta) {
		parts.push(isMac ? "⌘" : "Win");
	}
	parts.push(formatKeyCap(sample.key || sample.code));
	return parts.filter(Boolean).join(isMac ? "" : "+");
}

type VisibleKeystrokeCache = {
	samples: KeystrokeSample[];
	enabled: boolean;
	mode: KeystrokeOverlaySettings["mode"];
	filtered: KeystrokeSample[];
	lastTimeMs: number;
	lastIndex: number;
};

let visibleKeystrokeCache: VisibleKeystrokeCache | null = null;

function findRightmostSampleAtOrBefore(samples: KeystrokeSample[], timeMs: number): number {
	let low = 0;
	let high = samples.length - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (samples[mid].timeMs <= timeMs) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return found;
}

function getCachedVisibleKeystrokes(
	samples: KeystrokeSample[],
	settings: KeystrokeOverlaySettings,
): VisibleKeystrokeCache {
	if (
		visibleKeystrokeCache &&
		visibleKeystrokeCache.samples === samples &&
		visibleKeystrokeCache.enabled === settings.enabled &&
		visibleKeystrokeCache.mode === settings.mode
	) {
		return visibleKeystrokeCache;
	}

	visibleKeystrokeCache = {
		samples,
		enabled: settings.enabled,
		mode: settings.mode,
		filtered: filterKeystrokesForDisplay(samples, settings),
		lastTimeMs: Number.NEGATIVE_INFINITY,
		lastIndex: -1,
	};
	return visibleKeystrokeCache;
}

export function getVisibleKeystroke(
	samples: KeystrokeSample[],
	timeMs: number,
	settings: KeystrokeOverlaySettings,
	displayMs = KEYSTROKE_OVERLAY_DISPLAY_MS,
): KeystrokeSample | null {
	const cache = getCachedVisibleKeystrokes(samples, settings);
	const visible = cache.filtered;
	if (visible.length === 0) {
		cache.lastTimeMs = timeMs;
		cache.lastIndex = -1;
		return null;
	}

	let index: number;
	if (timeMs >= cache.lastTimeMs && cache.lastIndex >= -1) {
		index = cache.lastIndex;
		if (index < 0) {
			index = visible[0].timeMs <= timeMs ? 0 : -1;
		}
		while (index + 1 < visible.length && visible[index + 1].timeMs <= timeMs) {
			index += 1;
		}
	} else {
		index = findRightmostSampleAtOrBefore(visible, timeMs);
	}

	cache.lastTimeMs = timeMs;
	cache.lastIndex = index;
	if (index < 0) {
		return null;
	}

	const latest = visible[index];
	if (timeMs - latest.timeMs <= displayMs) {
		return latest;
	}
	return null;
}

export function getKeystrokeOverlayOpacity(
	sample: KeystrokeSample | null,
	timeMs: number,
	displayMs = KEYSTROKE_OVERLAY_DISPLAY_MS,
) {
	if (!sample) {
		return 0;
	}
	const elapsed = timeMs - sample.timeMs;
	if (elapsed < 0 || elapsed > displayMs) {
		return 0;
	}
	const fadeStart = displayMs * 0.65;
	if (elapsed <= fadeStart) {
		return 1;
	}
	return Math.max(0, 1 - (elapsed - fadeStart) / (displayMs - fadeStart));
}

export interface ParsedKeyMonitorLine {
	action: "down" | "up";
	key: string;
	code: string;
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	meta: boolean;
	repeat: boolean;
}

export function parseKeyMonitorLine(line: string): ParsedKeyMonitorLine | null {
	const match = line.trim().match(/^KEY:(down|up):([^:]+):?(.*)$/i);
	if (!match) {
		return null;
	}
	const modifiers = new Set(
		(match[3] ?? "")
			.split(",")
			.map((part) => part.trim().toLowerCase())
			.filter(Boolean),
	);
	const identity = decodeURIComponent(match[2] ?? "").trim();
	if (!identity) {
		return null;
	}
	return {
		action: match[1] === "up" ? "up" : "down",
		key: identity,
		code: identity,
		ctrl: modifiers.has("ctrl") || modifiers.has("control"),
		alt: modifiers.has("alt") || modifiers.has("option"),
		shift: modifiers.has("shift"),
		meta: modifiers.has("meta") || modifiers.has("cmd") || modifiers.has("command") || modifiers.has("win"),
		repeat: modifiers.has("repeat"),
	};
}

export function encodeKeyMonitorLine(sample: {
	action?: "down" | "up";
	key: string;
	ctrl?: boolean;
	alt?: boolean;
	shift?: boolean;
	meta?: boolean;
	repeat?: boolean;
}) {
	const modifiers = [
		sample.ctrl ? "ctrl" : "",
		sample.alt ? "alt" : "",
		sample.shift ? "shift" : "",
		sample.meta ? "meta" : "",
		sample.repeat ? "repeat" : "",
	].filter(Boolean);
	const identity = encodeURIComponent(sample.key);
	return `KEY:${sample.action ?? "down"}:${identity}${modifiers.length ? `:${modifiers.join(",")}` : ""}`;
}
