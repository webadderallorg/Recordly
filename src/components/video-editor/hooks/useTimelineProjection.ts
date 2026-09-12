/* biome-ignore-all lint/correctness/useExhaustiveDependencies: mutable timeline bootstrap refs intentionally do not trigger effects. */
import { type MutableRefObject, useCallback, useEffect, useMemo } from "react";
import { deriveNextId } from "../projectPersistence";
import type { useTimelineState } from "../state/useTimelineState";
import {
	type CaptionCue,
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
				timeline.setClipRegions(nextRegions);
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
	const effectiveZoomRegions = useMemo<ZoomRegion[]>(
		() =>
			zoomRegions.map((region) => ({
				...region,
				startMs: toSourceTime(region.startMs),
				endMs: toSourceTime(region.endMs),
			})),
		[zoomRegions, toSourceTime],
	);
	const effectiveCaptionRegions = useMemo<CaptionCue[]>(
		() =>
			autoCaptions.map((cue) => ({
				...cue,
				startMs: toTimelineTime(cue.startMs),
				endMs: toTimelineTime(cue.endMs),
			})),
		[autoCaptions, toTimelineTime],
	);
	const timelinePlayheadTime = useMemo(
		() => toTimelineTime(currentTime * 1000) / 1000,
		[currentTime, toTimelineTime],
	);
	const timelineDuration = useMemo(
		() => getTimelineDurationMs(clipRegions, duration * 1000) / 1000,
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
