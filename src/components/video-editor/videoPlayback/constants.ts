import type { ZoomFocus } from "../types";

export const DEFAULT_FOCUS: ZoomFocus = { cx: 0.5, cy: 0.5 };
export const TRANSITION_WINDOW_MS = 275;
export const ZOOM_IN_TRANSITION_WINDOW_MS = 350;
export const ZOOM_IN_OVERLAP_MS = 200;
export const ZOOM_OUT_EARLY_START_MS = 500;
export const CHAINED_ZOOM_PAN_GAP_MS = 2500;
export const MIN_DELTA = 0.0001;
export const VIEWPORT_SCALE = 0.8;
export const ZOOM_TRANSLATION_DEADZONE_PX = 1.25;
export const ZOOM_SCALE_DEADZONE = 0.002;
