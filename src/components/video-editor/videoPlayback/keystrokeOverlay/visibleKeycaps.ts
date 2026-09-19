import { isCharacterKey, keystrokeLabels } from "./keystrokeLabels";
import type {
	KeycapGroup,
	KeystrokeModifier,
	KeystrokeOverlayMode,
	KeystrokeTelemetryPoint,
} from "./keystrokeTypes";

export const KEYCAP_HOLD_MS = 500;
export const KEYCAP_FADE_MS = 150;
export const KEYCAP_DEDUPE_MS = 45;
export const MAX_VISIBLE_GROUPS = 4;

const SHORTCUT_KEYS = new Set([
	"enter",
	"esc",
	"tab",
	"backspace",
	"delete",
	"arrowleft",
	"arrowright",
	"arrowup",
	"arrowdown",
	"home",
	"end",
	"pageup",
	"pagedown",
]);

function isFunctionKey(key: string) {
	return /^f([1-9]|1[0-9])$/.test(key);
}

function hasNonShiftModifier(modifiers: readonly KeystrokeModifier[]) {
	return modifiers.some(
		(modifier) => modifier === "ctrl" || modifier === "meta" || modifier === "alt",
	);
}

function isShortcutEvent(event: KeystrokeTelemetryPoint) {
	if (hasNonShiftModifier(event.modifiers)) {
		return true;
	}
	return SHORTCUT_KEYS.has(event.key) || isFunctionKey(event.key);
}

function isVisibleInMode(event: KeystrokeTelemetryPoint, mode: KeystrokeOverlayMode) {
	if (isShortcutEvent(event)) {
		return true;
	}
	return mode === "all" && isCharacterKey(event.key);
}

function eventSignature(key: string, modifiers: readonly KeystrokeModifier[]) {
	return `${key}:${modifiers.join("+")}`;
}

function groupOpacity(ageMs: number) {
	if (ageMs <= KEYCAP_HOLD_MS) {
		return 1;
	}
	return Math.max(0, 1 - (ageMs - KEYCAP_HOLD_MS) / KEYCAP_FADE_MS);
}

export function visibleKeycaps(
	samples: readonly KeystrokeTelemetryPoint[],
	timeMs: number,
	mode: KeystrokeOverlayMode,
): KeycapGroup[] {
	const windowEnd = timeMs;
	const windowStart = timeMs - (KEYCAP_HOLD_MS + KEYCAP_FADE_MS);
	const inWindow: KeystrokeTelemetryPoint[] = [];
	for (const event of samples) {
		if (!isVisibleInMode(event, mode)) {
			continue;
		}
		if (event.timeMs > windowEnd || event.timeMs <= windowStart) {
			continue;
		}
		const signature = eventSignature(event.key, event.modifiers);
		const duplicate = inWindow.some(
			(kept) =>
				eventSignature(kept.key, kept.modifiers) === signature &&
				event.timeMs - kept.timeMs < KEYCAP_DEDUPE_MS,
		);
		if (duplicate) {
			continue;
		}
		inWindow.push(event);
	}

	const groups = inWindow.map((event) => ({
		id: `${event.timeMs}:${event.key}:${event.modifiers.join("+")}`,
		labels: keystrokeLabels(event.key, event.modifiers),
		opacity: groupOpacity(timeMs - event.timeMs),
	}));
	return groups.slice(-MAX_VISIBLE_GROUPS);
}
