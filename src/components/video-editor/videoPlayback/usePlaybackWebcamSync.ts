import type React from "react";
import { useCallback, useEffect } from "react";
import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import { findClipAtTimelineTime } from "../types";
import type { PlaybackProps } from "./playbackProps";
import { supportsPreviewPlaybackRate } from "./playbackRate";
import type { usePlaybackLayout } from "./usePlaybackLayout";
import type { usePlaybackState } from "./usePlaybackState";
import type { usePlaybackWebcamLayout } from "./usePlaybackWebcamLayout";
import {
	getWebcamMediaTargetTimeSeconds,
	isWebcamMediaSynchronized,
	shouldSeekWebcamMedia,
} from "./webcamSync";
export type usePlaybackWebcamSyncInput = Pick<
	ReturnType<typeof usePlaybackState> &
		ReturnType<typeof usePlaybackWebcamLayout> &
		PlaybackProps &
		ReturnType<typeof usePlaybackLayout>,
	| "pixiReady"
	| "videoReady"
	| "applyWebcamBubbleLayout"
	| "animationStateRef"
	| "webcamVideoRef"
	| "webcamEnabled"
	| "webcam"
	| "webcamVideoPath"
	| "currentTimeRef"
	| "webcamTimeOffsetMs"
	| "webcamSynchronizedPathRef"
	| "setWebcamSynchronizedPath"
	| "lastWebcamSyncTimeRef"
	| "timelineTime"
	| "clipRegions"
	| "isPlaying"
	| "setWebcamVideoDimensions"
	| "webcamMotionBlurRef"
	| "lastBackgroundSyncTimeRef"
	| "wallpaper"
	| "overlayRef"
	| "selectedZoom"
>;
export function usePlaybackWebcamSync(input: usePlaybackWebcamSyncInput) {
	const {
		pixiReady,
		videoReady,
		applyWebcamBubbleLayout,
		animationStateRef,
		webcamVideoRef,
		webcamEnabled,
		webcam,
		webcamVideoPath,
		currentTimeRef,
		webcamTimeOffsetMs,
		webcamSynchronizedPathRef,
		setWebcamSynchronizedPath,
		lastWebcamSyncTimeRef,
		timelineTime,
		clipRegions,
		isPlaying,
		setWebcamVideoDimensions,
		webcamMotionBlurRef,
		lastBackgroundSyncTimeRef,
		wallpaper,
		overlayRef,
		selectedZoom,
	} = input;

	useEffect(() => {
		if (!pixiReady || !videoReady) return;
		applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
	}, [applyWebcamBubbleLayout, pixiReady, videoReady, animationStateRef]);

	const syncWebcamMedia = useCallback(() => {
		const webcamVideo = webcamVideoRef.current;
		if (!webcamVideo || !webcamEnabled || !webcamVideoPath) {
			return;
		}

		const webcamDuration = Number.isFinite(webcamVideo.duration) ? webcamVideo.duration : null;
		const targetTime = getWebcamMediaTargetTimeSeconds({
			currentTime: currentTimeRef.current / 1000,
			webcamDuration,
			timeOffsetMs: webcamTimeOffsetMs,
			loop: webcam?.loop,
		});
		const mediaTargetTime =
			targetTime <= 0 && webcamDuration !== null && webcamDuration > 0
				? Math.min(1 / 60, webcamDuration)
				: targetTime;

		if (
			webcamSynchronizedPathRef.current !== webcamVideoPath &&
			!isWebcamMediaSynchronized({
				currentTime: webcamVideo.currentTime,
				targetTime: mediaTargetTime,
				readyState: webcamVideo.readyState,
				isSeeking: webcamVideo.seeking,
			})
		) {
			webcamVideo.pause();
			if (
				webcamVideo.readyState >= HTMLMediaElement.HAVE_METADATA &&
				!webcamVideo.seeking &&
				Math.abs(webcamVideo.currentTime - mediaTargetTime) > 0.01
			) {
				try {
					webcamVideo.currentTime = mediaTargetTime;
				} catch {
					// The next media-ready event retries once the source accepts seeks.
				}
			}
			return;
		}

		if (webcamSynchronizedPathRef.current !== webcamVideoPath) {
			webcamSynchronizedPathRef.current = webcamVideoPath;
			setWebcamSynchronizedPath(webcamVideoPath);
			lastWebcamSyncTimeRef.current = targetTime;
		}

		const targetPlaybackRate =
			findClipAtTimelineTime(timelineTime * 1000, clipRegions)?.speed ?? 1;
		if (!supportsPreviewPlaybackRate(targetPlaybackRate)) {
			webcamVideo.pause();
			return;
		}
		enablePitchPreservingPlayback(webcamVideo);
		if (Math.abs(webcamVideo.playbackRate - targetPlaybackRate) > 0.001) {
			webcamVideo.playbackRate = targetPlaybackRate;
		}

		const previousTimelineTime = lastWebcamSyncTimeRef.current;
		if (
			shouldSeekWebcamMedia({
				desiredTime: mediaTargetTime,
				isPlaying,
				isSeeking: webcamVideo.seeking,
				previousTimelineTime,
				timelineTime: targetTime,
				webcamCurrentTime: webcamVideo.currentTime,
			})
		) {
			try {
				webcamVideo.currentTime = mediaTargetTime;
			} catch {
				// no-op
			}
		}

		if (isPlaying) {
			const playPromise = webcamVideo.play();
			if (playPromise) {
				playPromise.catch(() => undefined);
			}
		} else {
			webcamVideo.pause();
		}

		lastWebcamSyncTimeRef.current = targetTime;
	}, [
		timelineTime,
		clipRegions,
		isPlaying,
		webcamEnabled,
		webcam?.loop,
		webcamTimeOffsetMs,
		webcamVideoPath,
		webcamVideoRef,
		currentTimeRef,
		webcamSynchronizedPathRef,
		setWebcamSynchronizedPath,
		lastWebcamSyncTimeRef,
	]);

	const handleWebcamMediaReady = useCallback(
		(event: React.SyntheticEvent<HTMLVideoElement>) => {
			const video = event.currentTarget;
			if (video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2) {
				setWebcamVideoDimensions({
					width: video.videoWidth,
					height: video.videoHeight,
				});
			}
			syncWebcamMedia();
			// Paused preview ticks can finish before the independent camera decoder.
			applyWebcamBubbleLayout(animationStateRef.current.appliedScale || 1);
		},
		[syncWebcamMedia, setWebcamVideoDimensions, applyWebcamBubbleLayout, animationStateRef],
	);

	useEffect(() => {
		syncWebcamMedia();
	}, [syncWebcamMedia]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: The media path intentionally triggers source-specific state reset.
	useEffect(() => {
		webcamMotionBlurRef.current.reset();
		webcamSynchronizedPathRef.current = null;
		setWebcamSynchronizedPath(null);
		setWebcamVideoDimensions(null);
		lastWebcamSyncTimeRef.current = null;
	}, [
		webcamVideoPath,
		webcamMotionBlurRef,
		webcamSynchronizedPathRef,
		setWebcamSynchronizedPath,
		setWebcamVideoDimensions,
		lastWebcamSyncTimeRef,
	]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: The wallpaper identity intentionally resets media synchronization.
	useEffect(() => {
		lastBackgroundSyncTimeRef.current = null;
	}, [wallpaper, lastBackgroundSyncTimeRef]);

	useEffect(() => {
		const overlayEl = overlayRef.current;
		if (!overlayEl) return;
		if (!selectedZoom || selectedZoom.mode !== "manual") {
			overlayEl.style.cursor = "default";
			overlayEl.style.pointerEvents = "none";
			return;
		}
		overlayEl.style.cursor = isPlaying ? "not-allowed" : "crosshair";
		overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
	}, [selectedZoom, isPlaying, overlayRef]);
	return { syncWebcamMedia, handleWebcamMediaReady };
}
