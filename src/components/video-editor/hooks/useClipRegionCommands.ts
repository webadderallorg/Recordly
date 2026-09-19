import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import { changeClipSpan } from "../clipSpanChange";
import { planClipSpeedChange } from "../clipSpeedChange";
import { planClipSplit } from "../clipSplit";
import type { ClipRegion, EditorEffectSection, ZoomRegion } from "../types";
import { supportsPreviewPlaybackRate } from "../videoPlayback/playbackRate";

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseClipRegionCommandsParams {
	sourceDurationMs: number;
	clipRegions: ClipRegion[];
	setClipRegions: Dispatch<SetStateAction<ClipRegion[]>>;
	zoomRegions: ZoomRegion[];
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
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
	sourceDurationMs,
	clipRegions,
	setClipRegions,
	zoomRegions,
	setZoomRegions,
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
			const plan = planClipSplit({
				clipRegions,
				splitMs,
				createId: () => `clip-${nextClipIdRef.current++}`,
			});
			if (!plan) return;
			setClipRegions((current) =>
				current.flatMap((clip) =>
					clip.id === plan.targetId ? [plan.left, plan.right] : [clip],
				),
			);
			if (selectedClipId === plan.targetId) setSelectedClipId(plan.left.id);
		},
		[clipRegions, nextClipIdRef, selectedClipId, setClipRegions, setSelectedClipId],
	);

	const handleClipSpanChange = useCallback(
		(id: string, span: Span) => {
			const oldClip = clipRegions.find((clip) => clip.id === id);
			const newStart = Math.round(span.start);
			const newEnd = Math.round(span.end);

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

			setClipRegions((current) =>
				current.map((clip) => {
					if (clip.id !== id) return clip;
					return changeClipSpan(clip, newStart, newEnd, sourceDurationMs);
				}),
			);
		},
		[clipRegions, setClipRegions, setZoomRegions, sourceDurationMs],
	);

	const handleClipSpeedChange = useCallback(
		(speed: number) => {
			if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) return;
			if (!supportsPreviewPlaybackRate(speed)) {
				toast.error(
					t(
						"editor.timeline.unsupportedSpeed",
						"This speed is not supported for preview on this device.",
					),
				);
				return;
			}
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
			// Other tracks have their own timeline positions; deleting footage is not a ripple edit.
			setClipRegions((current) => current.filter((clip) => clip.id !== id));
			if (selectedClipId === id) setSelectedClipId(null);
		},
		[selectedClipId, setClipRegions, setSelectedClipId],
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
