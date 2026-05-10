export type DeleteSelectionTarget =
	| "all"
	| "keyframe"
	| "zoom"
	| "trim"
	| "clip"
	| "annotation"
	| "audio"
	| "none";

interface ResolveDeleteSelectionTargetParams {
	selectAllBlocksActive: boolean;
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedTrimId?: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
}

export function resolveDeleteSelectionTarget({
	selectAllBlocksActive,
	selectedKeyframeId,
	selectedZoomId,
	selectedTrimId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
}: ResolveDeleteSelectionTargetParams): DeleteSelectionTarget {
	if (selectAllBlocksActive) return "all";
	if (selectedKeyframeId) return "keyframe";
	if (selectedZoomId) return "zoom";
	if (selectedTrimId) return "trim";
	if (selectedClipId) return "clip";
	if (selectedAnnotationId) return "annotation";
	if (selectedAudioId) return "audio";
	return "none";
}
