/* biome-ignore-all lint/correctness/useExhaustiveDependencies: mutable timeline bootstrap refs intentionally do not trigger effects. */
import { type MutableRefObject, useCallback, useEffect, useMemo } from "react";
import { closeClipGaps, rippleRegionAnchors, rippleRegions } from "../clipSequence";
import { projectCaptionCues } from "../captionTimeline";
import { deriveNextId } from "../projectPersistence";
import type { useTimelineState } from "../state/useTimelineState";
import {
	clipsToTrims,
	extendAutoFullTrackClip,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
	mapSourceTimeToTimelineTime,
	mapTimelineTimeToSourceTime,
	type SpeedRegion,
	trimsToClips,
	type ZoomRegion,
} from "../types";

type Input = {
	timeline: ReturnType<typeof useTimelineState>;
	duration: number;
	currentTime: number;
	nextClipIdRef: MutableRefObject<number>;
	initializedRef: MutableRefObject<boolean>;
	autoFullTrackIdRef: MutableRefObject<string | null>;
	autoFullTrackEndRef: MutableRefObject<number | null>;
};

export function useTimelineProjection({
	timeline,
	duration,
	currentTime,
	nextClipIdRef,
	initializedRef,
	autoFullTrackIdRef,
	autoFullTrackEndRef,
}: Input) {
	const { clipRegions, trimRegions, speedRegions, zoomRegions, autoCaptions } = timeline;

	useEffect(() => {
		const totalMs = Math.round(duration * 1000);
		if (totalMs <= 0) return;
		if (!initializedRef.current) {
			if (clipRegions.length === 0) {
				const nextRegions =
					trimRegions.length > 0
						? trimsToClips(trimRegions, totalMs)
						: (() => {
								const id = `clip-${nextClipIdRef.current++}`;
								autoFullTrackIdRef.current = id;
								autoFullTrackEndRef.current = totalMs;
								return [{ id, startMs: 0, endMs: totalMs, speed: 1 as const }];
							})();
				if (trimRegions.length > 0) {
					nextClipIdRef.current = deriveNextId(
						"clip",
						nextRegions.map(({ id }) => id),
					);
				}
				const sequence = closeClipGaps(nextRegions);
				timeline.setClipRegions(sequence);
				if (trimRegions.length > 0) {
					timeline.setZoomRegions((current) =>
						rippleRegions(current, nextRegions, sequence),
					);
					timeline.setAnnotationRegions((current) =>
						rippleRegions(current, nextRegions, sequence),
					);
					timeline.setAudioRegions((current) =>
						rippleRegionAnchors(current, nextRegions, sequence),
					);
				}
			}
			initializedRef.current = true;
			return;
		}

		const extended = extendAutoFullTrackClip(
			clipRegions,
			autoFullTrackIdRef.current,
			autoFullTrackEndRef.current,
			totalMs,
		);
		if (!extended) return;
		autoFullTrackEndRef.current = totalMs;
		timeline.setClipRegions(extended);
	}, [duration, clipRegions, trimRegions, nextClipIdRef, timeline.setClipRegions]);

	useEffect(() => {
		const totalMs = Math.round(duration * 1000);
		if (totalMs > 0 && clipRegions.length > 0) {
			timeline.setTrimRegions(clipsToTrims(clipRegions, totalMs));
		}
	}, [clipRegions, duration, timeline.setTrimRegions]);

	const toSourceTime = useCallback(
		(timeMs: number) => mapTimelineTimeToSourceTime(timeMs, clipRegions),
		[clipRegions],
	);
	const toTimelineTime = useCallback(
		(timeMs: number) => mapSourceTimeToTimelineTime(timeMs, clipRegions),
		[clipRegions],
	);
	const effectiveZoomRegions: ZoomRegion[] = zoomRegions;
	const effectiveCaptionRegions = useMemo(
		() => projectCaptionCues(autoCaptions, clipRegions),
		[autoCaptions, clipRegions],
	);
	const timelinePlayheadTime = currentTime;
	const timelineDuration = useMemo(
		() =>
			getTimelineDurationMs(clipRegions, initializedRef.current ? 0 : duration * 1000) / 1000,
		[clipRegions, duration],
	);
	const effectiveSpeedRegions = useMemo<SpeedRegion[]>(() => {
		const clipDerived = clipRegions
			.filter(({ speed }) => speed !== 1)
			.map((clip) => ({
				id: `clip-speed-${clip.id}`,
				startMs: getClipSourceStartMs(clip),
				endMs: getClipSourceEndMs(clip),
				speed: clip.speed as SpeedRegion["speed"],
			}));
		if (clipDerived.length === 0) return speedRegions;
		return [
			...speedRegions,
			...clipDerived.filter(
				(candidate) =>
					!speedRegions.some(
						(region) =>
							region.endMs > candidate.startMs && region.startMs < candidate.endMs,
					),
			),
		];
	}, [clipRegions, speedRegions]);

	return {
		mapTimelineTimeToSourceTime: toSourceTime,
		mapSourceTimeToTimelineTime: toTimelineTime,
		effectiveZoomRegions,
		effectiveCaptionRegions,
		timelinePlayheadTime,
		timelineDuration,
		effectiveSpeedRegions,
	};
}
