import type { AnnotationRegion } from "./types";

type Rect = { x: number; y: number; width: number; height: number };

/** Place a new item inside the recording area currently visible through the camera. */
export function annotationPlacement(
	viewport: { width: number; height: number },
	recording: Rect,
	transform: { scale: number; x: number; y: number },
): Pick<AnnotationRegion, "position" | "size"> | null {
	const { scale, x, y } = transform;
	if (
		![
			viewport.width,
			viewport.height,
			recording.x,
			recording.y,
			recording.width,
			recording.height,
			scale,
			x,
			y,
		].every(Number.isFinite) ||
		scale <= 0 ||
		recording.width <= 0 ||
		recording.height <= 0
	)
		return null;
	const left = Math.max(0, recording.x * scale + x);
	const top = Math.max(0, recording.y * scale + y);
	const right = Math.min(viewport.width, (recording.x + recording.width) * scale + x);
	const bottom = Math.min(viewport.height, (recording.y + recording.height) * scale + y);
	if (right <= left || bottom <= top) return null;
	const width = Math.min(
		right - left,
		Math.max(recording.width * scale * 0.01, (right - left) * 0.3),
	);
	const height = Math.min(
		bottom - top,
		Math.max(recording.height * scale * 0.01, (bottom - top) * 0.2),
	);
	return {
		position: {
			x: ((((left + right - width) / 2 - x) / scale - recording.x) / recording.width) * 100,
			y: ((((top + bottom - height) / 2 - y) / scale - recording.y) / recording.height) * 100,
		},
		size: {
			width: (width / scale / recording.width) * 100,
			height: (height / scale / recording.height) * 100,
		},
	};
}
