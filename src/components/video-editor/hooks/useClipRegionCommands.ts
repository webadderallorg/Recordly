import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import { planClipSpeedChange } from "../clipSpeedChange";
import {
	getClipTimelineStartMs,
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
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
			const target = clipRegions.find((clip) => {
				const timelineStart = getClipTimelineStartMs(clip, clipRegions);
				const timelineEnd = timelineStart + Math.max(0, clip.endMs - clip.startMs);
				return splitMs > timelineStart && splitMs < timelineEnd;
			});
			if (!target) return;
			const leftId = `clip-${nextClipIdRef.current++}`;
			const rightId = `clip-${nextClipIdRef.current++}`;
			const timelineStart = getClipTimelineStartMs(target, clipRegions);
			const splitAt = Math.round(splitMs);
			const splitOffset = splitAt - timelineStart;
			const safeSpeed = Number.isFinite(target.speed) && target.speed > 0 ? target.speed : 1;
			const newSourceStart = Math.round(target.startMs + splitOffset * safeSpeed);
			// ClipRegion.endMs is the display end (= startMs + display duration), not
			// the source end, so the left clip keeps exactly `splitOffset` of display
			// time rather than inheriting the source-derived split point.
			const left: ClipRegion = { ...target, id: leftId, endMs: target.startMs + splitOffset };
			const right: ClipRegion = {
				...target,
				id: rightId,
				startMs: newSourceStart,
				endMs: newSourceStart + Math.max(0, target.endMs - target.startMs - splitOffset),
			};
			setClipRegions((current) =>
				current.flatMap((clip) => (clip.id === target.id ? [left, right] : [clip])),
			);
			if (selectedClipId === target.id) setSelectedClipId(leftId);
		},
		[clipRegions, nextClipIdRef, selectedClipId, setClipRegions, setSelectedClipId],
	);

	const handleClipSpanChange = useCallback(
		(id: string, span: Span) => {
			const oldClip = clipRegions.find((clip) => clip.id === id);
			const newTimelineStart = Math.round(span.start);
			const newTimelineEnd = Math.round(span.end);
			const oldTimelineStart = oldClip
				? getClipTimelineStartMs(oldClip, clipRegions)
				: 0;
			const oldTimelineEnd =
				oldTimelineStart + Math.max(0, (oldClip?.endMs ?? 0) - (oldClip?.startMs ?? 0));
			const newTimelineDuration = Math.max(0, newTimelineEnd - newTimelineStart);
			const speed = oldClip && oldClip.speed > 0 ? oldClip.speed : 1;
			const newSourceStart = oldClip
				? Math.round(oldClip.startMs + (newTimelineStart - oldTimelineStart) * speed)
				: 0;
			const newEndMs = newSourceStart + newTimelineDuration;
			const removedSegments = oldClip
				? [
						...(newTimelineStart > oldTimelineStart
							? [{ startMs: oldTimelineStart, endMs: newTimelineStart }]
							: []),
						...(newTimelineEnd < oldTimelineEnd
							? [{ startMs: newTimelineEnd, endMs: oldTimelineEnd }]
							: []),
					]
				: [];

			if (oldClip) {
				const timelineStartDelta = newTimelineStart - oldTimelineStart;
				const timelineEndDelta = newTimelineEnd - oldTimelineEnd;
				if (Math.abs(timelineStartDelta - timelineEndDelta) < 1 && Math.abs(timelineStartDelta) > 0) {
					setZoomRegions((current) =>
						current.map((zoom) =>
							zoom.startMs < oldTimelineEnd && zoom.endMs > oldTimelineStart
								? {
										...zoom,
										startMs: zoom.startMs + timelineStartDelta,
										endMs: zoom.endMs + timelineStartDelta,
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
				current.map((clip) =>
					clip.id === id
						? { ...clip, startMs: newSourceStart, endMs: newEndMs }
						: clip,
				),
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

	return {
		handleSelectClip,
		handleClipSplit,
		handleClipSpanChange,
		handleClipSpeedChange,
		handleClipMutedChange,
		handleClipShowSourceAudioChange,
		handleClipDelete,
	};
}
