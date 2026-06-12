export type DeleteSelectionTarget =
	| "multi"
	| "keyframe"
	| "zoom"
	| "clip"
	| "annotation"
	| "audio"
	| "camera"
	| "fillFrame"
	| "none";

interface ResolveDeleteSelectionTargetParams {
	selectAllBlocksActive: boolean;
	multiSelectedCount?: number;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCameraId?: string | null;
	selectedFillFrameId?: string | null;
}

export function resolveDeleteSelectionTarget({
	selectAllBlocksActive,
	multiSelectedCount = 0,
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCameraId,
	selectedFillFrameId,
}: ResolveDeleteSelectionTargetParams): DeleteSelectionTarget {
	if (selectAllBlocksActive) return "zoom";
	if (multiSelectedCount > 0) return "multi";
	if (selectedKeyframeId) return "keyframe";
	if (selectedZoomId) return "zoom";
	if (selectedClipId) return "clip";
	if (selectedAnnotationId) return "annotation";
	if (selectedAudioId) return "audio";
	if (selectedCameraId) return "camera";
	if (selectedFillFrameId) return "fillFrame";
	return "none";
}
