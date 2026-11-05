import { useCallback, useEffect, useRef } from "react";
import { mapTimelineTimeToSourceTime } from "../types";
import { createClipPlayback, findPreviewClipAtTimelineTime } from "./clipPlayback";
import type { PlaybackProps } from "./playbackProps";
import { PreviewVideoSource } from "./previewVideoSource";
import type { createPreviewRenderLoop } from "./previewRenderLoop";
import { usePreviewVideoReady } from "./usePreviewVideoReady";
export function usePreviewMediaState(
	input: Pick<
		PlaybackProps,
		"videoPath" | "timelineTime" | "clipRegions" | "onError" | "isPlaying" | "suspendRendering"
	>,
) {
	const { videoPath, timelineTime, clipRegions, onError, isPlaying, suspendRendering } = input;

	const videoRef = useRef<HTMLVideoElement | null>(null);

	const previewVideoSourceRef = useRef(new PreviewVideoSource());

	const attachVideo = useCallback((video: HTMLVideoElement | null) => {
		// VideoSource.destroy() clears the media URL, so only destroy it when
		// React detaches the element, never during a layout effect cleanup.
		previewVideoSourceRef.current.setVideo(video);
		videoRef.current = video;
	}, []);

	const videoReady = usePreviewVideoReady(videoRef, videoPath);

	const currentTime = mapTimelineTimeToSourceTime(timelineTime * 1000, clipRegions) / 1000;

	const isGap = !findPreviewClipAtTimelineTime(timelineTime * 1000, clipRegions);

	const clipRegionsRef = useRef(clipRegions);

	const clipPlaybackRef = useRef<ReturnType<typeof createClipPlayback> | null>(null);

	const onPlaybackErrorRef = useRef(onError);

	const timelineTimeRef = useRef(timelineTime);

	useEffect(() => {
		onPlaybackErrorRef.current = onError;
		timelineTimeRef.current = timelineTime;
	}, [onError, timelineTime]);

	const currentTimeRef = useRef(0);

	useEffect(() => {
		clipRegionsRef.current = clipRegions;
		clipPlaybackRef.current?.refresh();
	}, [clipRegions]);

	const isPlayingRef = useRef(isPlaying);

	const suspendRenderingRef = useRef(suspendRendering);

	const isSeekingRef = useRef(false);

	const shouldSnapPausedFrameRef = useRef(false);

	const lastBackgroundSyncTimeRef = useRef<number | null>(null);

	const bgVideoRef = useRef<HTMLVideoElement | null>(null);

	const lastRenderedContentTimeRef = useRef<number | null>(null);

	const previewRenderLoopRef = useRef<ReturnType<typeof createPreviewRenderLoop> | null>(null);
	const requestPreviewRender = useCallback(() => {
		previewRenderLoopRef.current?.requestRender();
	}, []);

	/** Requests one exact composition after an output-affecting edit while paused. */
	const requestPausedFrameRefresh = useCallback(() => {
		if (!isPlayingRef.current) {
			shouldSnapPausedFrameRef.current = true;
			requestPreviewRender();
		}
	}, [requestPreviewRender]);
	return {
		videoRef,
		previewVideoSourceRef,
		attachVideo,
		videoReady,
		currentTime,
		isGap,
		clipRegionsRef,
		clipPlaybackRef,
		onPlaybackErrorRef,
		timelineTimeRef,
		currentTimeRef,
		isPlayingRef,
		suspendRenderingRef,
		isSeekingRef,
		shouldSnapPausedFrameRef,
		lastBackgroundSyncTimeRef,
		bgVideoRef,
		lastRenderedContentTimeRef,
		requestPausedFrameRefresh,
		requestPreviewRender,
		previewRenderLoopRef,
	};
}
