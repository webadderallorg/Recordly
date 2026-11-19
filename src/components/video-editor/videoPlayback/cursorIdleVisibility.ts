import type { CursorTelemetryPoint } from "../types";
import { getCursorPressIntervals, isCursorPress } from "./cursorPress";

export type CursorIdleHideSettings = {
	enabled: boolean;
	idleThresholdMs: number;
	fadeDelayMs: number;
	fadeDurationMs: number;
	movementTolerancePx: number;
};

export const DEFAULT_CURSOR_IDLE_HIDE: CursorIdleHideSettings = {
	enabled: true,
	idleThresholdMs: 2000,
	fadeDelayMs: 500,
	fadeDurationMs: 300,
	movementTolerancePx: 2,
};

export const CURSOR_IDLE_FADE_IN_MS = 150;

export function normalizeCursorIdleHideSettings(value: unknown): CursorIdleHideSettings {
	const raw =
		value && typeof value === "object" ? (value as Partial<CursorIdleHideSettings>) : {};
	const number = (value: unknown, fallback: number, min: number, max: number) =>
		typeof value === "number" && Number.isFinite(value)
			? Math.min(max, Math.max(min, value))
			: fallback;
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_CURSOR_IDLE_HIDE.enabled,
		idleThresholdMs: number(raw.idleThresholdMs, 2000, 500, 10_000),
		fadeDelayMs: number(raw.fadeDelayMs, 500, 0, 2000),
		fadeDurationMs: number(raw.fadeDurationMs, 300, 100, 1000),
		movementTolerancePx: number(raw.movementTolerancePx, 2, 0, 10),
	};
}

type IdleInterval = { startMs: number; endMs: number };
type IdleIndex = {
	length: number;
	threshold: number;
	tolerance: number;
	intervals: IdleInterval[];
};
const indexes = new WeakMap<CursorTelemetryPoint[], IdleIndex>();

/** Analyze recorded pauses once, so the fade can begin shortly into each pause,
 * including on the first frame after seeking into it. Short pauses stay visible.
 * Tolerance uses normalized telemetry at a 1920×1080 reference size.
 */
export function getCursorIdleIntervals(
	samples: CursorTelemetryPoint[],
	settings: CursorIdleHideSettings = DEFAULT_CURSOR_IDLE_HIDE,
): IdleInterval[] {
	if (!settings.enabled || samples.length < 2) return [];
	const cached = indexes.get(samples);
	if (
		cached?.length === samples.length &&
		cached.threshold === settings.idleThresholdMs &&
		cached.tolerance === settings.movementTolerancePx
	)
		return cached.intervals;
	const intervals: IdleInterval[] = [];
	let anchor = samples[0];
	let startMs = anchor.timeMs;
	const held = new Set<number>();
	// Paired legacy clicks may omit button IDs. Unpaired legacy clicks are
	// pulses, while explicit button downs stay held until their release.
	const heldDowns = new Set(
		getCursorPressIntervals(samples, samples[samples.length - 1].timeMs)
			.filter(({ down, up }) => down.mouseButton || up)
			.map(({ down }) => down),
	);
	const close = (endMs: number) => {
		if (endMs - startMs >= settings.idleThresholdMs) intervals.push({ startMs, endMs });
	};
	for (let i = 0; i < samples.length; i++) {
		const sample = samples[i];
		const wasHeld = held.size > 0;
		const press = isCursorPress(sample);
		if (press && heldDowns.has(sample))
			held.add(
				sample.mouseButton ??
					(sample.interactionType === "right-click"
						? 2
						: sample.interactionType === "middle-click"
							? 3
							: 1),
			);
		if (sample.interactionType === "mouseup") {
			if (sample.mouseButton) held.delete(sample.mouseButton);
			else held.clear();
		}
		const interaction = Boolean(sample.interactionType && sample.interactionType !== "move");
		// Compare with the last activity position, not the preceding sample:
		// gradual movement must accumulate rather than being mistaken for jitter.
		const moved =
			Math.hypot((sample.cx - anchor.cx) * 1920, (sample.cy - anchor.cy) * 1080) >
			settings.movementTolerancePx;
		if (moved || interaction || held.size > 0) {
			if (!wasHeld) close(interaction ? sample.timeMs : samples[Math.max(0, i - 1)].timeMs);
			anchor = sample;
			startMs = sample.timeMs;
		}
	}
	const endMs = samples[samples.length - 1].timeMs;
	if (endMs - startMs >= settings.idleThresholdMs) intervals.push({ startMs, endMs: Infinity });
	indexes.set(samples, {
		length: samples.length,
		threshold: settings.idleThresholdMs,
		tolerance: settings.movementTolerancePx,
		intervals,
	});
	return intervals;
}

/** Stateless media-time evaluation keeps preview, seeking and export identical. */
export function getCursorIdleOpacity(
	samples: CursorTelemetryPoint[],
	timeMs: number,
	settings: CursorIdleHideSettings = DEFAULT_CURSOR_IDLE_HIDE,
): number {
	const intervals = getCursorIdleIntervals(samples, settings);
	let lo = 0;
	let hi = intervals.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (intervals[mid].startMs <= timeMs) lo = mid + 1;
		else hi = mid;
	}
	const idle = intervals[lo - 1];
	if (!idle) return 1;
	const smoothstep = (value: number) => {
		const progress = Math.min(1, Math.max(0, value));
		return progress * progress * (3 - 2 * progress);
	};
	const intervalOpacity = (interval: IdleInterval) => {
		const hidden = smoothstep(
			(Math.min(timeMs, interval.endMs) - interval.startMs - settings.fadeDelayMs) /
				settings.fadeDurationMs,
		);
		const revealed = smoothstep((timeMs - interval.endMs) / CURSOR_IDLE_FADE_IN_MS);
		return 1 - hidden * (1 - revealed);
	};
	// Recover from the actual opacity at wake-up, including a partially faded
	// pause. A second pause may begin during recovery; keep that join continuous.
	const previous = intervals[lo - 2];
	return intervalOpacity(idle) * (previous ? intervalOpacity(previous) : 1);
}
