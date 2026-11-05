import { DEFAULT_CURSOR_CLICK_BOUNCE, DEFAULT_CURSOR_CLICK_BOUNCE_DURATION } from "./types";
import type { CursorSpringTuning } from "./videoPlayback/motionSmoothing";

// Keep the legacy "smooth" ID so existing preferences retain their preset.
export type CursorMotionPresetId = "focused" | "smooth";

export interface CursorMotionPreset {
	id: CursorMotionPresetId;
	label: string;
	zoomSmoothness: number;
	zoomInDurationMs: number;
	zoomOutDurationMs: number;
	cursorSize: number;
	cursorSmoothing: number;
	cursorSpringStiffnessMultiplier: number;
	cursorSpringDampingMultiplier: number;
	cursorSpringMassMultiplier: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
}

export interface CursorMotionPresetSelectionInput {
	zoomInDurationMs: number;
	zoomOutDurationMs: number;
	cursorSize: number;
	cursorSmoothing: number;
	cursorSpringStiffnessMultiplier: number;
	cursorSpringDampingMultiplier: number;
	cursorSpringMassMultiplier: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
}

const REGULAR_MOTION_VALUES = {
	zoomSmoothness: 0.5,
	zoomInDurationMs: 200,
	zoomOutDurationMs: 200,
	cursorSize: 2.5,
	cursorSmoothing: 0.67,
	cursorSpringStiffnessMultiplier: 1.35,
	cursorSpringDampingMultiplier: 0.79,
	cursorSpringMassMultiplier: 1.29,
	cursorClickBounce: DEFAULT_CURSOR_CLICK_BOUNCE,
	cursorClickBounceDuration: DEFAULT_CURSOR_CLICK_BOUNCE_DURATION,
} as const;

const SMOOTH_MOTION_SPEED = 0.7;

export const CURSOR_MOTION_PRESETS: Record<CursorMotionPresetId, CursorMotionPreset> = {
	focused: {
		id: "focused",
		label: "Focused",
		...REGULAR_MOTION_VALUES,
		zoomOutDurationMs: REGULAR_MOTION_VALUES.zoomOutDurationMs / 0.7,
	},
	smooth: {
		id: "smooth",
		label: "Cinematic",
		...REGULAR_MOTION_VALUES,
		zoomInDurationMs: REGULAR_MOTION_VALUES.zoomInDurationMs / SMOOTH_MOTION_SPEED,
		// Apply the zoom-out slowdown, then the overall zoom slowdown.
		zoomOutDurationMs: REGULAR_MOTION_VALUES.zoomOutDurationMs / SMOOTH_MOTION_SPEED ** 2,
		// Scale spring frequency while preserving its damping ratio and click timing.
		cursorSpringStiffnessMultiplier:
			REGULAR_MOTION_VALUES.cursorSpringStiffnessMultiplier * SMOOTH_MOTION_SPEED ** 2,
		cursorSpringDampingMultiplier:
			REGULAR_MOTION_VALUES.cursorSpringDampingMultiplier * SMOOTH_MOTION_SPEED,
	},
};

export function getMatchingCursorMotionPresetId(
	values: CursorMotionPresetSelectionInput,
): CursorMotionPresetId | null {
	for (const presetId of Object.keys(CURSOR_MOTION_PRESETS) as CursorMotionPresetId[]) {
		const preset = CURSOR_MOTION_PRESETS[presetId];
		if (
			preset.zoomInDurationMs === values.zoomInDurationMs &&
			preset.zoomOutDurationMs === values.zoomOutDurationMs &&
			preset.cursorSize === values.cursorSize &&
			preset.cursorSmoothing === values.cursorSmoothing &&
			preset.cursorSpringStiffnessMultiplier === values.cursorSpringStiffnessMultiplier &&
			preset.cursorSpringDampingMultiplier === values.cursorSpringDampingMultiplier &&
			preset.cursorSpringMassMultiplier === values.cursorSpringMassMultiplier &&
			preset.cursorClickBounce === values.cursorClickBounce &&
			preset.cursorClickBounceDuration === values.cursorClickBounceDuration
		) {
			return presetId;
		}
	}

	return null;
}

/** Presets are persisted as motion values, rather than a separate preset ID. */
export function isCinematicCursorMotion(smoothing: number, tuning?: CursorSpringTuning) {
	const preset = CURSOR_MOTION_PRESETS.smooth;
	return (
		smoothing === preset.cursorSmoothing &&
		tuning?.stiffnessMultiplier === preset.cursorSpringStiffnessMultiplier &&
		tuning?.dampingMultiplier === preset.cursorSpringDampingMultiplier &&
		tuning?.massMultiplier === preset.cursorSpringMassMultiplier
	);
}

export function isCinematicZoomMotion(values: {
	zoomInDurationMs?: number;
	zoomOutDurationMs?: number;
}) {
	const preset = CURSOR_MOTION_PRESETS.smooth;
	return (
		values.zoomInDurationMs === preset.zoomInDurationMs &&
		values.zoomOutDurationMs === preset.zoomOutDurationMs
	);
}

export function resolveCursorMotionPresetId(
	values: CursorMotionPresetSelectionInput,
	fallback: CursorMotionPresetId = "focused",
): CursorMotionPresetId {
	return getMatchingCursorMotionPresetId(values) ?? fallback;
}
