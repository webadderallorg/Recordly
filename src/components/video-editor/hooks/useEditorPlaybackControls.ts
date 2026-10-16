import { type RefObject, useCallback, useEffect, useRef } from "react";
import type { TimelineEditorHandle } from "../timeline/TimelineEditor";
import type { VideoPlaybackRef } from "../VideoPlayback";

interface UseEditorPlaybackControlsParams {
	videoPlaybackRef: RefObject<VideoPlaybackRef | null>;
	timelineRef: RefObject<TimelineEditorHandle | null>;
	playSourceAudioPreview: () => void;
	timelinePlayheadTime: number;
	timelineDuration: number;
}

export function useEditorPlaybackControls({
	videoPlaybackRef,
	timelineRef,
	playSourceAudioPreview,
	timelinePlayheadTime,
	timelineDuration,
}: UseEditorPlaybackControlsParams) {
	const lastSeekTargetRef = useRef(timelinePlayheadTime);

	useEffect(() => {
		lastSeekTargetRef.current = timelinePlayheadTime;
	}, [timelinePlayheadTime]);

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

			lastSeekTargetRef.current = time;
			if (options.pause) playback.pause();
			playback.seekTimeline(time);
		},
		[getActivePlayback],
	);

	const handleTimelineSeek = useCallback(
		(time: number) => handleSeek(time, { pause: true }),
		[handleSeek],
	);

	const handlePreviewSkipBack = useCallback(() => {
		const currentMs = lastSeekTargetRef.current * 1000;
		const keyframes = timelineRef.current?.keyframes ?? [];
		const previous = [...keyframes]
			.reverse()
			.find((keyframe) => keyframe.time < currentMs - 50);
		handleSeek(previous ? previous.time / 1000 : Math.max(0, lastSeekTargetRef.current - 5));
	}, [handleSeek, timelineRef]);

	const handlePreviewSkipForward = useCallback(() => {
		const currentMs = lastSeekTargetRef.current * 1000;
		const keyframes = timelineRef.current?.keyframes ?? [];
		const next = keyframes.find((keyframe) => keyframe.time > currentMs + 50);
		handleSeek(
			next ? next.time / 1000 : Math.min(timelineDuration, lastSeekTargetRef.current + 5),
		);
	}, [handleSeek, timelineDuration, timelineRef]);

	const stepFrameForward = useCallback(
		(fps = 60) => {
			const delta = 1 / Math.max(1, fps);
			const baseTime = lastSeekTargetRef.current;
			const targetTime = Math.min(timelineDuration, baseTime + delta);
			handleSeek(targetTime, { pause: true });
		},
		[handleSeek, timelineDuration],
	);

	const stepFrameBackward = useCallback(
		(fps = 60) => {
			const delta = 1 / Math.max(1, fps);
			const baseTime = lastSeekTargetRef.current;
			const targetTime = Math.max(0, baseTime - delta);
			handleSeek(targetTime, { pause: true });
		},
		[handleSeek],
	);

	const stepTimeSeconds = useCallback(
		(seconds: number) => {
			const baseTime = lastSeekTargetRef.current;
			const targetTime = Math.max(0, Math.min(timelineDuration, baseTime + seconds));
			handleSeek(targetTime, { pause: true });
		},
		[handleSeek, timelineDuration],
	);

	return {
		startPlayback,
		togglePlayPause,
		handleSeek,
		handleTimelineSeek,
		handlePreviewSkipBack,
		handlePreviewSkipForward,
		stepFrameBackward,
		stepFrameForward,
		stepTimeSeconds,
	};
}
