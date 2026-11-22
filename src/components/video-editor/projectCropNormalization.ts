import type { ProjectEditorState } from "./projectPersistenceTypes";
import { clamp, isFiniteNumber } from "./projectPersistenceUtils";
import { DEFAULT_CROP_REGION } from "./types";

export function normalizeProjectCrop(editor: Partial<ProjectEditorState>) {
	const rawCropX = isFiniteNumber(editor.cropRegion?.x)
		? editor.cropRegion.x
		: DEFAULT_CROP_REGION.x;

	const rawCropY = isFiniteNumber(editor.cropRegion?.y)
		? editor.cropRegion.y
		: DEFAULT_CROP_REGION.y;

	const rawCropWidth = isFiniteNumber(editor.cropRegion?.width)
		? editor.cropRegion.width
		: DEFAULT_CROP_REGION.width;

	const rawCropHeight = isFiniteNumber(editor.cropRegion?.height)
		? editor.cropRegion.height
		: DEFAULT_CROP_REGION.height;

	const cropX = clamp(rawCropX, 0, 1);

	const cropY = clamp(rawCropY, 0, 1);

	const cropWidth = clamp(rawCropWidth, 0.01, 1 - cropX);

	const cropHeight = clamp(rawCropHeight, 0.01, 1 - cropY);
	return { cropX, cropY, cropWidth, cropHeight };
}
