import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import {
	type ClipFreezeFrameBlockReason,
	fitClipFreezeFrames,
	getRightClipFreezeFramesAfterSplit,
	planAddClipFreezeFrame,
	planClipFreezeFrameDurationChange,
	planRemoveClipFreezeFrame,
} from "../clipFreezeFrames";
import { planClipSpeedChange } from "../clipSpeedChange";
import { deriveNextId } from "../projectPersistence";
import {
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
	DEFAULT_FREEZE_FRAME_DURATION_MS,
	type EditorEffectSection,
	type SpeedRegion,
	type ZoomRegion,
} from "../types";

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseClipRegionCommandsParams {
	clipRegions: ClipRegion[];
	setClipRegions: Dispatch<SetStateAction<ClipRegion[]>>;
	zoomRegions: ZoomRegion[];
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	setAnnotationRegions: Dispatch<SetStateAction<AnnotationRegion[]>>;
	setSpeedRegions: Dispatch<SetStateAction<SpeedRegion[]>>;
	setAudioRegions: Dispatch<SetStateAction<AudioRegion[]>>;
	selectedClipId: string | null;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	nextClipIdRef: MutableRefObject<number>;
	t: Translator;
}

export function useClipRegionCommands({
	clipRegions,
	setClipRegions,
	zoomRegions,
	setZoomRegions,
	setAnnotationRegions,
	setSpeedRegions,
	setAudioRegions,
	selectedClipId,
	setSelectedClipId,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setSelectedCaptionId,
	setActiveEffectSection,
	nextClipIdRef,
	t,
}: UseClipRegionCommandsParams) {
	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectedClipId(id);
			if (id) {
				setActiveEffectSection("clip");
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
				setSelectedAudioId(null);
				setSelectedCaptionId(null);
			} else {
				setActiveEffectSection((section) => (section === "clip" ? "scene" : section));
			}
		},
		[
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const handleClipSplit = useCallback(
		(splitMs: number) => {
			const target = clipRegions.find(
				(clip) => splitMs > clip.startMs && splitMs < clip.endMs,
			);
			if (!target) return;
			const splitAt = Math.round(splitMs);
			const rightFreezeFrames = getRightClipFreezeFramesAfterSplit(target, splitAt);
			if (!rightFreezeFrames) {
				toast.warning(
					t(
						"editor.timeline.freezeSplitBlocked",
						"Remove the freeze frame before splitting after it. A split there would skip the held footage.",
					),
				);
				return;
			}
			const leftId = `clip-${nextClipIdRef.current++}`;
			const rightId = `clip-${nextClipIdRef.current++}`;
			const { freezeFrames: _targetFreezeFrames, ...targetWithoutFreezeFrames } = target;
			const left: ClipRegion = { ...targetWithoutFreezeFrames, id: leftId, endMs: splitAt };
			const right: ClipRegion = {
				...targetWithoutFreezeFrames,
				id: rightId,
				startMs: splitAt,
				...(rightFreezeFrames.length > 0 ? { freezeFrames: rightFreezeFrames } : {}),
			};
			setClipRegions((current) =>
				current.flatMap((clip) => (clip.id === target.id ? [left, right] : [clip])),
			);
			if (selectedClipId === target.id) setSelectedClipId(leftId);
		},
		[clipRegions, nextClipIdRef, selectedClipId, setClipRegions, setSelectedClipId, t],
	);

	const handleClipSpanChange = useCallback(
		(id: string, span: Span) => {
			const oldClip = clipRegions.find((clip) => clip.id === id);
			const newStart = Math.round(span.start);
			const newEnd = Math.round(span.end);
			const removedSegments = oldClip
				? [
						...(newStart > oldClip.startMs
							? [{ startMs: oldClip.startMs, endMs: newStart }]
							: []),
						...(newEnd < oldClip.endMs
							? [{ startMs: newEnd, endMs: oldClip.endMs }]
							: []),
					]
				: [];

			if (oldClip) {
				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				if (Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0) {
					setZoomRegions((current) =>
						current.map((zoom) =>
							zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs
								? {
										...zoom,
										startMs: zoom.startMs + startDelta,
										endMs: zoom.endMs + startDelta,
									}
								: zoom,
						),
					);
				}
			}

			if (removedSegments.length > 0) {
				const removeTrimmedRegions = <T extends { startMs: number; endMs: number }>(
					regions: T[],
				) =>
					regions.filter(
						(region) =>
							!removedSegments.some(
								(segment) =>
									region.startMs < segment.endMs &&
									region.endMs > segment.startMs,
							),
					);
				setZoomRegions((current) => removeTrimmedRegions(current));
				setAnnotationRegions((current) => removeTrimmedRegions(current));
				setSpeedRegions((current) => removeTrimmedRegions(current));
				setAudioRegions((current) => removeTrimmedRegions(current));
			}

			setClipRegions((current) =>
				current.map((clip) => {
					if (clip.id !== id) return clip;
					const startDeltaMs = newStart - clip.startMs;
					const isMove = Math.abs(startDeltaMs - (newEnd - clip.endMs)) < 1;
					// Trimming the left edge moves the clip's source start with it, so holds keep
					// their footage by shifting their offsets. Moving the whole clip keeps offsets.
					const freezeFrames =
						clip.freezeFrames && !isMove
							? clip.freezeFrames.map((freezeFrame) => ({
									...freezeFrame,
									offsetMs: freezeFrame.offsetMs - startDeltaMs,
								}))
							: clip.freezeFrames;
					return fitClipFreezeFrames({
						...clip,
						startMs: newStart,
						endMs: newEnd,
						...(freezeFrames ? { freezeFrames } : {}),
					});
				}),
			);
		},
		[
			clipRegions,
			setAnnotationRegions,
			setAudioRegions,
			setClipRegions,
			setSpeedRegions,
			setZoomRegions,
		],
	);

	const handleClipSpeedChange = useCallback(
		(speed: number) => {
			if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) return;
			const plan = planClipSpeedChange({ clipRegions, zoomRegions, selectedClipId, speed });
			if (!plan) return;
			if ("blockedReason" in plan) {
				toast.warning(
					plan.blockedReason === "clip-overlap"
						? t(
								"editor.timeline.speedClipOverlap",
								"Speed change would overlap the next clip. Move or split clips before slowing this section.",
							)
						: t(
								"editor.timeline.speedZoomOverlap",
								"Speed change would overlap another zoom. Move or delete the overlapping zoom first.",
							),
				);
				return;
			}
			setClipRegions(plan.clipRegions);
			setZoomRegions(plan.zoomRegions);
		},
		[clipRegions, selectedClipId, setClipRegions, setZoomRegions, t, zoomRegions],
	);

	const handleClipMutedChange = useCallback(
		(muted: boolean) => {
			if (!selectedClipId) return;
			setClipRegions((current) =>
				current.map((clip) => (clip.id === selectedClipId ? { ...clip, muted } : clip)),
			);
		},
		[selectedClipId, setClipRegions],
	);
	const handleClipShowSourceAudioChange = useCallback(
		(showSourceAudio: boolean) => {
			if (!selectedClipId) return;
			setClipRegions((current) =>
				current.map((clip) =>
					clip.id === selectedClipId ? { ...clip, showSourceAudio } : clip,
				),
			);
		},
		[selectedClipId, setClipRegions],
	);

	const handleClipDelete = useCallback(
		(id: string) => {
			const deletedClip = clipRegions.find((clip) => clip.id === id);
			setClipRegions((current) => current.filter((clip) => clip.id !== id));
			if (deletedClip) {
				const outsideDeletedClip = (region: { startMs: number; endMs: number }) =>
					region.endMs <= deletedClip.startMs || region.startMs >= deletedClip.endMs;
				setZoomRegions((current) => current.filter(outsideDeletedClip));
				setAnnotationRegions((current) => current.filter(outsideDeletedClip));
				setSpeedRegions((current) => current.filter(outsideDeletedClip));
				setAudioRegions((current) => current.filter(outsideDeletedClip));
			}
			if (selectedClipId === id) setSelectedClipId(null);
		},
		[
			clipRegions,
			selectedClipId,
			setAnnotationRegions,
			setAudioRegions,
			setClipRegions,
			setSelectedClipId,
			setSpeedRegions,
			setZoomRegions,
		],
	);

	const warnFreezeFrameBlocked = useCallback(
		(reason: ClipFreezeFrameBlockReason) => {
			toast.warning(
				reason === "no-clip"
					? t(
							"editor.timeline.freezeNoClip",
							"Move the playhead over a clip to freeze a frame.",
						)
					: reason === "clip-overlap"
						? t(
								"editor.timeline.freezeClipOverlap",
								"The freeze frame would overlap the next clip. Move or split clips to make room first.",
							)
						: t(
								"editor.timeline.freezeZoomOverlap",
								"The freeze frame would push a zoom into another zoom. Move or delete the overlapping zoom first.",
							),
			);
		},
		[t],
	);

	const handleAddFreezeFrame = useCallback(
		(timelineMs: number) => {
			const existingFreezeFrameIds = clipRegions.flatMap((clip) =>
				(clip.freezeFrames ?? []).map(({ id }) => id),
			);
			const plan = planAddClipFreezeFrame({
				clipRegions,
				zoomRegions,
				timelineMs,
				durationMs: DEFAULT_FREEZE_FRAME_DURATION_MS,
				freezeFrameId: `freeze-${deriveNextId("freeze", existingFreezeFrameIds)}`,
			});
			if ("blockedReason" in plan) {
				warnFreezeFrameBlocked(plan.blockedReason);
				return;
			}
			if (plan.created) {
				setClipRegions(plan.clipRegions);
				setZoomRegions(plan.zoomRegions);
			}
			handleSelectClip(plan.clipId);
		},
		[
			clipRegions,
			handleSelectClip,
			setClipRegions,
			setZoomRegions,
			warnFreezeFrameBlocked,
			zoomRegions,
		],
	);

	const handleFreezeFrameDurationChange = useCallback(
		(clipId: string, freezeFrameId: string, durationMs: number) => {
			const plan = planClipFreezeFrameDurationChange({
				clipRegions,
				zoomRegions,
				clipId,
				freezeFrameId,
				durationMs,
			});
			if (!plan) return;
			if ("blockedReason" in plan) {
				warnFreezeFrameBlocked(plan.blockedReason);
				return;
			}
			setClipRegions(plan.clipRegions);
			setZoomRegions(plan.zoomRegions);
		},
		[clipRegions, setClipRegions, setZoomRegions, warnFreezeFrameBlocked, zoomRegions],
	);

	const handleFreezeFrameDelete = useCallback(
		(clipId: string, freezeFrameId: string) => {
			const plan = planRemoveClipFreezeFrame({
				clipRegions,
				zoomRegions,
				clipId,
				freezeFrameId,
			});
			if (!plan) return;
			setClipRegions(plan.clipRegions);
			setZoomRegions(plan.zoomRegions);
		},
		[clipRegions, setClipRegions, setZoomRegions, zoomRegions],
	);

	return {
		handleSelectClip,
		handleClipSplit,
		handleClipSpanChange,
		handleClipSpeedChange,
		handleClipMutedChange,
		handleClipShowSourceAudioChange,
		handleClipDelete,
		handleAddFreezeFrame,
		handleFreezeFrameDurationChange,
		handleFreezeFrameDelete,
	};
}
