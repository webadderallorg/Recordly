import { type RefObject, useCallback } from "react";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { ClipRegion, ZoomRegion } from "../types";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseEditorPlaybackControlsParams {
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	playSourceAudioPreview: () => void;
	clipRegions: readonly ClipRegion[];
	zoomRegions: readonly ZoomRegion[];
	timelinePlayheadTime: number;
	timelineDuration: number;
}

export function useEditorPlaybackControls({
	videoPlaybackRef,
	timelineRef,
	playSourceAudioPreview,
	clipRegions,
	zoomRegions,
	timelinePlayheadTime,
	timelineDuration,
}: UseEditorPlaybackControlsParams) {
	const getActivePlayback = useCallback(() => videoPlaybackRef.current, [videoPlaybackRef]);

	const startPlayback = useCallback(() => {
		const playback = getActivePlayback();
		if (!playback?.video) return;

		playSourceAudioPreview();
		playback.play().catch((error) => console.error("Video play failed:", error));
	}, [getActivePlayback, playSourceAudioPreview]);

	const togglePlayPause = useCallback(() => {
		const playback = getActivePlayback();
		const video = playback?.video;
		if (!playback || !video) return;

		if (playback.isPlaying) playback.pause();
		else startPlayback();
	}, [getActivePlayback, startPlayback]);

	const handleSeek = useCallback(
		(time: number, options: { pause?: boolean } = {}) => {
			const playback = getActivePlayback();
			const video = playback?.video;
			if (!video) return;

			if (options.pause) playback.pause();
			playback.seekTimeline(time);
		},
		[getActivePlayback],
	);

	const handleTimelineSeek = useCallback(
		(time: number) => handleSeek(time, { pause: true }),
		[handleSeek],
	);

	const handlePreviewSkip = useCallback(
		(direction: "backward" | "forward") => {
			const forward = direction === "forward";
			const currentMs = timelinePlayheadTime * 1000;
			const durationMs = timelineDuration * 1000;
			const points = [
				...clipRegions.map((clip) => clip.startMs),
				...zoomRegions.map((zoom) => zoom.startMs),
				...(timelineRef.current?.keyframes ?? []).map((keyframe) => keyframe.time),
			];
			let targetMs = forward ? durationMs : 0;
			for (const point of points) {
				const nearer = forward
					? point > currentMs + 1 && point < targetMs
					: point < currentMs - 1 && point > targetMs;
				if (nearer) targetMs = point;
			}
			handleSeek(targetMs / 1000);
		},
		[clipRegions, handleSeek, timelineDuration, timelinePlayheadTime, timelineRef, zoomRegions],
	);

	return {
		startPlayback,
		togglePlayPause,
		handleSeek,
		handleTimelineSeek,
		handlePreviewSkip,
	};
}
