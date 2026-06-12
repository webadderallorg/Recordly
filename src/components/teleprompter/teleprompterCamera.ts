export const CAMERA_OPACITY_MIN = 0.05;
export const CAMERA_OPACITY_MAX = 0.8;
export const CAMERA_OPACITY_DEFAULT = 0.35;

export function clampCameraOpacity(value: number): number {
	if (!Number.isFinite(value)) return CAMERA_OPACITY_DEFAULT;
	return Math.max(CAMERA_OPACITY_MIN, Math.min(CAMERA_OPACITY_MAX, value));
}

export function parseStoredCameraOpacity(raw: string | null): number {
	if (raw === null) return CAMERA_OPACITY_DEFAULT;
	const parsed = Number.parseFloat(raw);
	if (!Number.isFinite(parsed)) return CAMERA_OPACITY_DEFAULT;
	return clampCameraOpacity(parsed);
}
