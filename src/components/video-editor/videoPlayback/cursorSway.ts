import { clampDeltaMs } from "./motionSmoothing";

const CURSOR_SWAY_MAX_ROTATION = Math.PI / 18;
const CURSOR_SWAY_SPEED_REFERENCE = 1400;
const CURSOR_SWAY_VERTICAL_WEIGHT = 0.65;
const CURSOR_SWAY_INTENSITY_SCALE = 3;
export const CURSOR_SWAY_SLIDER_SCALE = 2;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export function computeCursorSwayRotation(dx: number, dy: number, deltaMs: number, sway: number) {
	if (sway <= 0) {
		return 0;
	}

	const distance = Math.hypot(dx, dy);
	if (!Number.isFinite(distance) || distance < 0.01) {
		return 0;
	}

	const speedPxPerSecond = distance / (clampDeltaMs(deltaMs) / 1000);
	const speedFactor = clamp(speedPxPerSecond / CURSOR_SWAY_SPEED_REFERENCE, 0, 1);
	if (speedFactor <= 0) {
		return 0;
	}

	const directionalBias = clamp((dx + dy * CURSOR_SWAY_VERTICAL_WEIGHT) / distance, -1, 1);
	return (
		directionalBias * speedFactor * CURSOR_SWAY_MAX_ROTATION * sway * CURSOR_SWAY_INTENSITY_SCALE
	);
}

export function toCursorSwaySliderValue(sway: number) {
	return sway / CURSOR_SWAY_SLIDER_SCALE;
}

export function fromCursorSwaySliderValue(sliderValue: number) {
	return sliderValue * CURSOR_SWAY_SLIDER_SCALE;
}
