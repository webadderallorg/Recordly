// Keystroke overlay — coalescing / display policy.
//
// Pure function of (events, currentTimeMs, style, policy) → visible keycap
// groups. Because it depends only on event timestamps and the queried time, it
// is inherently frame-rate independent: the same playback time always yields
// the same overlay, whether the editor renders at 30fps or 120fps.
//
// Two grouping rules:
//   1. A key pressed with a non-shift modifier (Ctrl/Alt/Meta) is a *chord* —
//      modifiers + key render together as one group ("⌘⇧P") and never merge.
//   2. Plain keys typed in quick succession merge into one running group so
//      "hello" reads as a word instead of five flickering caps.

import { formatModifierLabels, isModifierToken, keyTokenToLabel } from "./keyLabels";
import {
	DEFAULT_KEYSTROKE_OVERLAY_POLICY,
	type KeycapGroup,
	type KeystrokeEvent,
	type KeystrokeOverlayPolicy,
	type ModifierGlyphStyle,
} from "./keystrokeTypes";

export function computeOpacity(ageMs: number, policy: KeystrokeOverlayPolicy): number {
	if (ageMs <= policy.holdMs) {
		return 1;
	}
	if (ageMs >= policy.holdMs + policy.fadeMs) {
		return 0;
	}
	return 1 - (ageMs - policy.holdMs) / policy.fadeMs;
}

export function buildKeycapGroups(
	events: KeystrokeEvent[],
	currentTimeMs: number,
	style: ModifierGlyphStyle,
	policy: KeystrokeOverlayPolicy = DEFAULT_KEYSTROKE_OVERLAY_POLICY,
): KeycapGroup[] {
	const visibleSpanMs = policy.holdMs + policy.fadeMs;
	// Only events within this lookback window can possibly still be visible.
	const lookbackMs = visibleSpanMs + policy.groupWindowMs * (policy.maxKeysPerGroup + 1) + 2000;
	const windowStart = currentTimeMs - lookbackMs;

	const relevant = events
		.filter(
			(event) =>
				event.timeMs <= currentTimeMs &&
				event.timeMs >= windowStart &&
				!isModifierToken(event.key),
		)
		.sort((a, b) => a.timeMs - b.timeMs);

	const groups: KeycapGroup[] = [];

	for (const event of relevant) {
		// Shift alone does not start a chord (Shift+letter is just an uppercase
		// keystroke); Ctrl/Alt/Meta do.
		const isChord = Boolean(event.ctrl || event.alt || event.meta);
		const keyLabel = keyTokenToLabel(event.key);

		if (isChord) {
			groups.push({
				id: `k${event.timeMs}-${groups.length}`,
				labels: [...formatModifierLabels(event, style), keyLabel],
				isChord: true,
				startMs: event.timeMs,
				lastMs: event.timeMs,
				opacity: 1,
			});
			continue;
		}

		const open = groups[groups.length - 1];
		const canExtend =
			open &&
			!open.isChord &&
			event.timeMs - open.lastMs <= policy.groupWindowMs &&
			open.labels.length < policy.maxKeysPerGroup;

		if (open && canExtend) {
			open.labels.push(keyLabel);
			open.lastMs = event.timeMs;
		} else {
			groups.push({
				id: `k${event.timeMs}-${groups.length}`,
				labels: [keyLabel],
				isChord: false,
				startMs: event.timeMs,
				lastMs: event.timeMs,
				opacity: 1,
			});
		}
	}

	return groups
		.map((group) => ({
			...group,
			opacity: computeOpacity(currentTimeMs - group.lastMs, policy),
		}))
		.filter((group) => group.opacity > 0)
		.slice(-policy.maxGroups);
}
