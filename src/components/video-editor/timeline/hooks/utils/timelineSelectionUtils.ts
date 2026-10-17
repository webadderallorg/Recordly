export type DeleteSelectionTarget =
	| "keyframe"
	| "zoom"
	| "clip"
	| "annotation"
	| "audio"
	| "caption"
	| "none";

interface ResolveDeleteSelectionTargetParams {
	selectAllBlocksActive: boolean;
	selectedZoomIds?: readonly string[];
	selectedKeyframeId: string | null;
	selectedZoomId: string | null;
	selectedClipId?: string | null;
	selectedAnnotationId?: string | null;
	selectedAudioId?: string | null;
	selectedCaptionId?: string | null;
}

export function resolveDeleteSelectionTarget({
	selectAllBlocksActive,
	selectedZoomIds = [],
	selectedKeyframeId,
	selectedZoomId,
	selectedClipId,
	selectedAnnotationId,
	selectedAudioId,
	selectedCaptionId,
}: ResolveDeleteSelectionTargetParams): DeleteSelectionTarget {
	if (selectAllBlocksActive || selectedZoomIds.length > 0) return "zoom";
	if (selectedKeyframeId) return "keyframe";
	if (selectedZoomId) return "zoom";
	if (selectedClipId) return "clip";
	if (selectedAnnotationId) return "annotation";
	if (selectedAudioId) return "audio";
	if (selectedCaptionId) return "caption";
	return "none";
}

/** Ids of the zoom blocks that overlap the time range a selection box covers. */
export function getZoomIdsInRange(
	zooms: ReadonlyArray<{ id: string; span: { start: number; end: number } }>,
	fromMs: number,
	toMs: number,
): string[] {
	const start = Math.min(fromMs, toMs);
	const end = Math.max(fromMs, toMs);
	return zooms
		.filter((zoom) => zoom.span.start < end && zoom.span.end > start)
		.map((zoom) => zoom.id);
}
