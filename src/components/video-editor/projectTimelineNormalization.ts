import { closeClipGaps } from "./clipSequence";
import type { ProjectEditorState } from "./projectPersistenceTypes";
import { clamp, isFiniteNumber } from "./projectPersistenceUtils";
import {
	type ClipRegion,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type SpeedRegion,
	type TrimRegion,
	type ZoomRegion,
} from "./types";

export function normalizeProjectTimeline(editor: Partial<ProjectEditorState>) {
	const normalizedZoomRegions: ZoomRegion[] = Array.isArray(editor.zoomRegions)
		? editor.zoomRegions
				.filter((region): region is ZoomRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs)
						? Math.round(region.startMs)
						: 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					return {
						id: region.id,
						startMs,
						endMs,
						depth: [1, 2, 3, 4, 5, 6].includes(region.depth)
							? region.depth
							: DEFAULT_ZOOM_DEPTH,
						focus: {
							cx: clamp(
								isFiniteNumber(region.focus?.cx) ? region.focus.cx : 0.5,
								0,
								1,
							),
							cy: clamp(
								isFiniteNumber(region.focus?.cy) ? region.focus.cy : 0.5,
								0,
								1,
							),
						},
						mode:
							region.mode === "auto" || region.mode === "manual"
								? region.mode
								: undefined,
						focusSpace:
							region.focusSpace === "source" || region.focusSpace === "viewport"
								? region.focusSpace
								: undefined,
					};
				})
		: [];

	const normalizedTrimRegions: TrimRegion[] = Array.isArray(editor.trimRegions)
		? editor.trimRegions
				.filter((region): region is TrimRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs)
						? Math.round(region.startMs)
						: 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					return {
						id: region.id,
						startMs,
						endMs,
					};
				})
		: [];

	const normalizedClipRegions: ClipRegion[] = Array.isArray(editor.clipRegions)
		? editor.clipRegions
				.filter((region): region is ClipRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs)
						? Math.round(region.startMs)
						: 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);
					const sourceStartMs = isFiniteNumber(region.sourceStartMs)
						? Math.max(0, Math.round(region.sourceStartMs))
						: undefined;
					let sourceMinMs = isFiniteNumber(region.sourceMinMs)
						? Math.max(0, Math.round(region.sourceMinMs))
						: undefined;
					let sourceMaxMs = isFiniteNumber(region.sourceMaxMs)
						? Math.max(0, Math.round(region.sourceMaxMs))
						: undefined;
					if (
						sourceMaxMs !== undefined &&
						sourceMaxMs < Math.max(sourceMinMs ?? 0, sourceStartMs ?? startMs)
					) {
						sourceMinMs = undefined;
						sourceMaxMs = undefined;
					}
					return {
						id: region.id,
						startMs,
						endMs,
						sourceStartMs,
						sourceMinMs,
						sourceMaxMs,
						speed: isFiniteNumber(region.speed) && region.speed > 0 ? region.speed : 1,
						muted: typeof region.muted === "boolean" ? region.muted : false,
						showSourceAudio:
							typeof region.showSourceAudio === "boolean"
								? region.showSourceAudio
								: false,
					};
				})
		: [];

	// Migrate before applying editor state, so loaded history and the saved baseline
	// both begin with the same canonical sequence rather than recording a repair edit.
	const sequenceClips = closeClipGaps(normalizedClipRegions);

	const originalClips = new Set(normalizedClipRegions);
	const sequenceChanged = sequenceClips.some((clip) => !originalClips.has(clip));

	const normalizedAutoFullTrackClipId =
		typeof editor.autoFullTrackClipId === "string" ? editor.autoFullTrackClipId : null;

	const normalizedAutoFullTrackClipEndMs = isFiniteNumber(editor.autoFullTrackClipEndMs)
		? Math.round(editor.autoFullTrackClipEndMs)
		: null;

	const normalizedSpeedRegions: SpeedRegion[] = Array.isArray(editor.speedRegions)
		? editor.speedRegions
				.filter((region): region is SpeedRegion =>
					Boolean(region && typeof region.id === "string"),
				)
				.map((region) => {
					const rawStart = isFiniteNumber(region.startMs)
						? Math.round(region.startMs)
						: 0;
					const rawEnd = isFiniteNumber(region.endMs)
						? Math.round(region.endMs)
						: rawStart + 1000;
					const startMs = Math.max(0, Math.min(rawStart, rawEnd));
					const endMs = Math.max(startMs + 1, rawEnd);

					const speed =
						region.speed === 0.25 ||
						region.speed === 0.5 ||
						region.speed === 0.75 ||
						region.speed === 1.25 ||
						region.speed === 1.5 ||
						region.speed === 1.75 ||
						region.speed === 2
							? region.speed
							: DEFAULT_PLAYBACK_SPEED;

					return {
						id: region.id,
						startMs,
						endMs,
						speed,
					};
				})
		: [];
	return {
		normalizedZoomRegions,
		normalizedTrimRegions,
		normalizedClipRegions,
		sequenceClips,
		sequenceChanged,
		normalizedAutoFullTrackClipId,
		normalizedAutoFullTrackClipEndMs,
		normalizedSpeedRegions,
	};
}
