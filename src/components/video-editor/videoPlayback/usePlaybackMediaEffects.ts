import { useEffect } from "react";
import {
	clampMediaTimeToDuration,
	enablePitchPreservingPlayback,
	getMediaSyncPlaybackRate,
} from "@/lib/mediaTiming";
import type { PlaybackProps } from "./playbackProps";
import type { usePlaybackState } from "./usePlaybackState";
import { createMotionBlurState } from "./zoomTransform";
export type usePlaybackMediaEffectsInput = Pick<
	ReturnType<typeof usePlaybackState> & PlaybackProps,
	| "zoomRegionsRef"
	| "zoomRegions"
	| "requestPausedFrameRefresh"
	| "selectedZoomIdRef"
	| "selectedZoomId"
	| "isPlayingRef"
	| "isPlaying"
	| "bgVideoRef"
	| "suspendRenderingRef"
	| "suspendRendering"
	| "pixiReady"
	| "appRef"
	| "webcamVideoRef"
	| "layoutVideoContentRef"
	| "videoRef"
	| "currentTimeRef"
	| "timelineTime"
	| "lastBackgroundSyncTimeRef"
	| "videoEffectsContainerRef"
	| "zoomBlurFilterRef"
	| "motionBlurFilterRef"
	| "zoomMotionBlurRef"
	| "motionBlurStateRef"
	| "updatePreviewTextureRef"
>;
export function usePlaybackMediaEffects(input: usePlaybackMediaEffectsInput) {
	const {
		zoomRegionsRef,
		zoomRegions,
		requestPausedFrameRefresh,
		selectedZoomIdRef,
		selectedZoomId,
		isPlayingRef,
		isPlaying,
		bgVideoRef,
		suspendRenderingRef,
		suspendRendering,
		pixiReady,
		appRef,
		webcamVideoRef,
		layoutVideoContentRef,
		videoRef,
		currentTimeRef,
		timelineTime,
		lastBackgroundSyncTimeRef,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		zoomMotionBlurRef,
		motionBlurStateRef,
		updatePreviewTextureRef,
	} = input;

	useEffect(() => {
		zoomRegionsRef.current = zoomRegions;
		requestPausedFrameRefresh();
	}, [zoomRegions, requestPausedFrameRefresh, zoomRegionsRef]);

	useEffect(() => {
		selectedZoomIdRef.current = selectedZoomId;
	}, [selectedZoomId, selectedZoomIdRef]);

	useEffect(() => {
		isPlayingRef.current = isPlaying;
		const bgVideo = bgVideoRef.current;
		if (bgVideo) {
			if (isPlaying) {
				bgVideo.play().catch(() => undefined);
			} else {
				bgVideo.pause();
			}
		}
	}, [isPlaying, isPlayingRef, bgVideoRef]);

	useEffect(() => {
		suspendRenderingRef.current = suspendRendering;
		if (!pixiReady) return;
		const app = appRef.current;
		if (!app?.ticker) {
			return;
		}

		if (suspendRendering) {
			bgVideoRef.current?.pause();
			webcamVideoRef.current?.pause();
			layoutVideoContentRef.current?.();
			updatePreviewTextureRef.current?.();
			app.render();
			return;
		}

		const video = videoRef.current;
		if (video) {
			const targetTime = clampMediaTimeToDuration(
				currentTimeRef.current / 1000,
				Number.isFinite(video.duration) ? video.duration : null,
			);
			if (Math.abs(video.currentTime - targetTime) > 0.001) {
				try {
					video.currentTime = targetTime;
				} catch {
					// no-op
				}
			}
		}
		layoutVideoContentRef.current?.();
		updatePreviewTextureRef.current?.();
		requestAnimationFrame(() => {
			appRef.current?.render();
		});
		if (isPlayingRef.current) {
			bgVideoRef.current?.play().catch(() => undefined);
			webcamVideoRef.current?.play().catch(() => undefined);
		}
	}, [
		pixiReady,
		suspendRendering,
		suspendRenderingRef,
		appRef,
		bgVideoRef,
		webcamVideoRef,
		layoutVideoContentRef,
		videoRef,
		currentTimeRef,
		isPlayingRef,
		updatePreviewTextureRef,
	]);

	// Backgrounds run on the output timeline, including empty clip intervals.
	useEffect(() => {
		const bgVideo = bgVideoRef.current;
		if (!bgVideo) return;

		const clipTimelineTime = timelineTime;
		const videoDuration =
			Number.isFinite(bgVideo.duration) && bgVideo.duration > 0 ? bgVideo.duration : null;
		const targetTime = videoDuration
			? clipTimelineTime % videoDuration
			: clampMediaTimeToDuration(clipTimelineTime, videoDuration);

		enablePitchPreservingPlayback(bgVideo);
		const syncedPlaybackRate = getMediaSyncPlaybackRate({
			basePlaybackRate: 1,
			currentTime: bgVideo.currentTime,
			targetTime,
			toleranceSeconds: 0.02,
			correctionWindowSeconds: 1.5,
			maxAdjustment: 0.12,
		});
		if (Math.abs(bgVideo.playbackRate - syncedPlaybackRate) > 0.001) {
			bgVideo.playbackRate = syncedPlaybackRate;
		}

		const previousTimelineTime = lastBackgroundSyncTimeRef.current;
		const timelineJumped =
			previousTimelineTime === null ||
			Math.abs(clipTimelineTime - previousTimelineTime) > 0.25;
		const driftThreshold = isPlaying ? 0.35 : 0.01;
		if (timelineJumped || Math.abs(bgVideo.currentTime - targetTime) > driftThreshold) {
			try {
				bgVideo.currentTime = targetTime;
			} catch {
				// no-op
			}
		}

		if (isPlaying) {
			const playPromise = bgVideo.play();
			if (playPromise) {
				playPromise.catch(() => undefined);
			}
		} else {
			bgVideo.pause();
		}

		lastBackgroundSyncTimeRef.current = clipTimelineTime;
	}, [timelineTime, isPlaying, bgVideoRef, lastBackgroundSyncTimeRef]);

	useEffect(() => {
		if (!pixiReady) return;
		const videoEffectsContainer = videoEffectsContainerRef.current;
		const zoomBlurFilter = zoomBlurFilterRef.current;
		const motionBlurFilter = motionBlurFilterRef.current;

		if (!videoEffectsContainer || !motionBlurFilter || !zoomBlurFilter) {
			return;
		}

		videoEffectsContainer.filters =
			(zoomMotionBlurRef.current ?? 0) > 0 ? [motionBlurFilter, zoomBlurFilter] : null;
		motionBlurFilter.velocity = { x: 0, y: 0 };
		motionBlurFilter.kernelSize = 5;
		motionBlurFilter.offset = 0;
		zoomBlurFilter.strength = 0;
		zoomBlurFilter.innerRadius = 0;
		zoomBlurFilter.radius = -1;
		motionBlurStateRef.current = createMotionBlurState();
	}, [
		pixiReady,
		videoEffectsContainerRef,
		zoomBlurFilterRef,
		motionBlurFilterRef,
		zoomMotionBlurRef,
		motionBlurStateRef,
	]);
	return {};
}
