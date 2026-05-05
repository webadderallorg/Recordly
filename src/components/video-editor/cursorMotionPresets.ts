import { DEFAULT_ZOOM_IN_DURATION_MS, DEFAULT_ZOOM_OUT_DURATION_MS } from "./types";

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
	cursorMotionBlur: number;
	cursorClickBounce: number;
	cursorClickBounceDuration: number;
}

const SHARED_CURSOR_PRESET_VALUES = {
	cursorSize: 2.2,
	cursorSmoothing: 0.67,
	cursorSpringMassMultiplier: 1.29,
	cursorMotionBlur: 0.4,
	cursorClickBounce: 3.5,
	cursorClickBounceDuration: 350,
} as const;

export const CURSOR_MOTION_PRESETS: Record<CursorMotionPresetId, CursorMotionPreset> = {
	focused: {
		id: "focused",
		label: "Focused",
		zoomSmoothness: 0.5,
		zoomInDurationMs: 100,
		zoomOutDurationMs: 100,
		...SHARED_CURSOR_PRESET_VALUES,
		cursorSpringStiffnessMultiplier: 1.35,
		cursorSpringDampingMultiplier: 0.79,
	},
	smooth: {
		id: "smooth",
		label: "Smooth",
		zoomSmoothness: 0.5,
		zoomInDurationMs: DEFAULT_ZOOM_IN_DURATION_MS,
		zoomOutDurationMs: DEFAULT_ZOOM_OUT_DURATION_MS,
		...SHARED_CURSOR_PRESET_VALUES,
		cursorSpringStiffnessMultiplier: 0.92,
		cursorSpringDampingMultiplier: 1.36,
	},
};