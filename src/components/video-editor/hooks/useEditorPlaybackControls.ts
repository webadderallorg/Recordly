import { type RefObject, useCallback } from "react";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseEditorPlaybackControlsParams {
	videoPlaybackRef: RefObject<VideoPlaybackRef>;
	timelineRef: RefObject<TimelineEditorHandle>;
	playSourceAudioPreview: () => void;
	mapTimelineTimeToSourceTime: (timeMs: number) => number;
	timelinePlayheadTime: number;
	timelineDuration: number;
}

export function useEditorPlaybackControls({
	videoPlaybackRef,
	timelineRef,
	playSourceAudioPreview,
	mapTimelineTimeToSourceTime,
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

		// A freeze frame hold pauses the video element while playback is still running.
		if (playback.isPlaybackActive()) playback.pause();
		else startPlayback();
	}, [getActivePlayback, startPlayback]);

	const handleSeek = useCallback(
		(time: number, options: { pause?: boolean } = {}) => {
			const playback = getActivePlayback();
			const video = playback?.video;
			if (!video) return;

			if (options.pause && !video.paused) playback?.pause();
			video.currentTime = mapTimelineTimeToSourceTime(time * 1000) / 1000;
		},
		[getActivePlayback, mapTimelineTimeToSourceTime],
	);

	const handleTimelineSeek = useCallback(
		(time: number) => handleSeek(time, { pause: true }),
		[handleSeek],
	);

	const handlePreviewSkipBack = useCallback(() => {
		const currentMs = timelinePlayheadTime * 1000;
		const keyframes = timelineRef.current?.keyframes ?? [];
		const previous = [...keyframes]
			.reverse()
			.find((keyframe) => keyframe.time < currentMs - 50);
		handleSeek(previous ? previous.time / 1000 : Math.max(0, timelinePlayheadTime - 5));
	}, [handleSeek, timelinePlayheadTime, timelineRef]);

	const handlePreviewSkipForward = useCallback(() => {
		const currentMs = timelinePlayheadTime * 1000;
		const keyframes = timelineRef.current?.keyframes ?? [];
		const next = keyframes.find((keyframe) => keyframe.time > currentMs + 50);
		handleSeek(next ? next.time / 1000 : Math.min(timelineDuration, timelinePlayheadTime + 5));
	}, [handleSeek, timelineDuration, timelinePlayheadTime, timelineRef]);

	return {
		startPlayback,
		togglePlayPause,
		handleSeek,
		handleTimelineSeek,
		handlePreviewSkipBack,
		handlePreviewSkipForward,
	};
}
