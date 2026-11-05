import { closeClipGaps, rippleRegionAnchors, rippleRegions } from "../clipSequence";
import type { ProjectEditorState } from "../projectPersistence";
import { clipsToTrims, trimsToClips } from "../types";

/** Resolve the old source-time trim model before it becomes an editable baseline. */
export async function migrateLegacyTrimOnlyProject(
	editor: ProjectEditorState,
	hasSavedClipSequence: boolean,
	probeDurationMs: () => Promise<number>,
): Promise<ProjectEditorState> {
	if (hasSavedClipSequence || editor.trimRegions.length === 0) return editor;
	const durationMs = await probeDurationMs();
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error("Could not determine the recording duration for this legacy project.");
	}
	const sourceClips = trimsToClips(editor.trimRegions, Math.round(durationMs));
	const clips = closeClipGaps(sourceClips);
	return {
		...editor,
		clipRegions: clips,
		trimRegions: clips.length ? clipsToTrims(clips, Math.round(durationMs)) : editor.trimRegions,
		zoomRegions: rippleRegions(editor.zoomRegions, sourceClips, clips),
		annotationRegions: rippleRegions(editor.annotationRegions, sourceClips, clips),
		audioRegions: rippleRegionAnchors(editor.audioRegions, sourceClips, clips),
	};
}
