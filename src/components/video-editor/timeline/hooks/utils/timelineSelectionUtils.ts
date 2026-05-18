export type DeleteSelectionTarget =
	| "all"
	| "keyframe"
	| "zoom"
	| "clip"
	| "annotation"
	| "audio"
	| "webcam-size"
	| "webcam-focus"
	| "webcam-position"
	| "none";

interface ResolveDeleteSelectionTargetParams {
	selectAllBlocksActive: boolean;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedWebcamSizeRegionId?: string | null;
	selectedWebcamFocusRegionId?: string | null;
	selectedWebcamPositionRegionId?: string | null;
}

export function resolveDeleteSelectionTarget({
	selectAllBlocksActive,
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedWebcamSizeRegionId,
	selectedWebcamFocusRegionId,
	selectedWebcamPositionRegionId,
}: ResolveDeleteSelectionTargetParams): DeleteSelectionTarget {
	if (selectAllBlocksActive) return "all";
	if (selectedKeyframeId) return "keyframe";
	if (selectedZoomId) return "zoom";
	if (selectedClipId) return "clip";
	if (selectedAnnotationId) return "annotation";
	if (selectedAudioId) return "audio";
	if (selectedWebcamSizeRegionId) return "webcam-size";
	if (selectedWebcamFocusRegionId) return "webcam-focus";
	if (selectedWebcamPositionRegionId) return "webcam-position";
	return "none";
}
