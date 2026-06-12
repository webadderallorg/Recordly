/** Auto-scroll speeds in CSS pixels per second. */
export const SPEED_LEVELS = [10, 20, 30, 45, 60, 80, 105, 135, 170, 210] as const;
export const DEFAULT_SPEED_INDEX = 3;

/** Reading font sizes in CSS pixels. */
export const FONT_SIZES = [20, 24, 28, 32, 40, 48, 56, 64] as const;
export const DEFAULT_FONT_SIZE_INDEX = 3;

/** Clamp-stepped index into a level table. */
export function stepIndex(current: number, delta: number, length: number): number {
	return Math.max(0, Math.min(length - 1, current + delta));
}

/**
 * Advance a fractional scroll position. Kept as a float by the caller so slow
 * speeds (< 1px/frame) still accumulate instead of stalling on integer rounding.
 */
export function advanceScrollTop(
	scrollTop: number,
	speedPxPerSecond: number,
	elapsedMs: number,
): number {
	if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
		return scrollTop;
	}
	return scrollTop + (speedPxPerSecond * elapsedMs) / 1000;
}
