import type React from "react";
import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import type { FreezeRegion, SpeedRegion, TrimRegion } from "../types";
import {
	createFreezeHoldClock,
	findFreezeRegionAtTime,
	findFreezeRegionToHold,
	rearmCompletedFreezeIds,
} from "./freezeHold";

interface PresentedFrameMetadata {
	mediaTime?: number;
}

type PresentedFrameVideoElement = HTMLVideoElement & {
	requestVideoFrameCallback?: (
		callback: (now: DOMHighResTimeStamp, metadata: PresentedFrameMetadata) => void,
	) => number;
	cancelVideoFrameCallback?: (handle: number) => void;
};

interface VideoEventHandlersParams {
	video: HTMLVideoElement;
	isSeekingRef: React.MutableRefObject<boolean>;
	isPlayingRef: React.MutableRefObject<boolean>;
	allowPlaybackRef: React.MutableRefObject<boolean>;
	currentTimeRef: React.MutableRefObject<number>;
	timeUpdateAnimationRef: React.MutableRefObject<number | null>;
	onPlayStateChange: (playing: boolean) => void;
	onTimeUpdate: (time: number) => void;
	trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
	speedRegionsRef: React.MutableRefObject<SpeedRegion[]>;
	freezeRegionsRef: React.MutableRefObject<FreezeRegion[]>;
	/** Receives the held time while a freeze frame is on screen, and null once it ends. */
	onFreezeHoldChange: (elapsedMs: number | null) => void;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
	const {
		video,
		isSeekingRef,
		isPlayingRef,
		allowPlaybackRef,
		currentTimeRef,
		timeUpdateAnimationRef,
		onPlayStateChange,
		onTimeUpdate,
		trimRegionsRef,
		speedRegionsRef,
		freezeRegionsRef,
		onFreezeHoldChange,
	} = params;
	const presentedFrameVideo = video as PresentedFrameVideoElement;
	let videoFrameRequestId: number | null = null;
	let lastPresentedTimeMs: number | null = null;
	let completedFreezeIds = new Set<string>();
	// A hold pauses and seeks the video element itself. Those events must not look like the
	// user pausing or scrubbing, which would stop playback or cancel the hold.
	let ignoreNextPauseEvent = false;
	let holdSnapSeekPending = false;
	enablePitchPreservingPlayback(video);

	const emitTime = (timeValue: number) => {
		currentTimeRef.current = timeValue * 1000;
		onTimeUpdate(timeValue);
	};

	const markPlaybackStopped = () => {
		isPlayingRef.current = false;
		onPlayStateChange(false);
	};

	const freezeHoldClock = createFreezeHoldClock({
		now: () => performance.now(),
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame: (handle) => cancelAnimationFrame(handle),
		onTick: (_freezeRegion, elapsedMs) => onFreezeHoldChange(elapsedMs),
		onComplete: (freezeRegion) => {
			completedFreezeIds.add(freezeRegion.id);
			onFreezeHoldChange(null);
			if (allowPlaybackRef.current && isPlayingRef.current) {
				video.play().catch(markPlaybackStopped);
			}
		},
	});

	// Helper function to check if current time is within a trim region
	const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
		const trimRegions = trimRegionsRef.current;
		return (
			trimRegions.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	// Helper function to find the active speed region at the current time
	const findActiveSpeedRegion = (currentTimeMs: number): SpeedRegion | null => {
		return (
			speedRegionsRef.current.find(
				(region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs,
			) || null
		);
	};

	const skipPastTrimRegion = (trimRegion: TrimRegion) => {
		const skipToTime = trimRegion.endMs / 1000;
		const clampedSkipToTime = Math.min(skipToTime, video.duration);

		video.currentTime = clampedSkipToTime;
		emitTime(clampedSkipToTime);

		if (clampedSkipToTime >= video.duration) {
			video.pause();
		}
	};

	const cancelScheduledUpdate = () => {
		if (timeUpdateAnimationRef.current !== null) {
			cancelAnimationFrame(timeUpdateAnimationRef.current);
			timeUpdateAnimationRef.current = null;
		}

		if (
			videoFrameRequestId !== null &&
			typeof presentedFrameVideo.cancelVideoFrameCallback === "function"
		) {
			presentedFrameVideo.cancelVideoFrameCallback(videoFrameRequestId);
			videoFrameRequestId = null;
		}
	};

	const beginFreezeHold = (freezeRegion: FreezeRegion) => {
		cancelScheduledUpdate();
		if (!video.paused) {
			ignoreNextPauseEvent = true;
			video.pause();
		}

		const heldTimeSeconds = freezeRegion.sourceMs / 1000;
		if (Math.abs(video.currentTime - heldTimeSeconds) > 0.001) {
			holdSnapSeekPending = true;
			video.currentTime = heldTimeSeconds;
		}
		emitTime(heldTimeSeconds);
		lastPresentedTimeMs = freezeRegion.sourceMs;
		freezeHoldClock.start(freezeRegion);
		onFreezeHoldChange(0);
	};

	const cancelFreezeHold = () => {
		if (!freezeHoldClock.getActiveFreeze()) {
			return false;
		}

		const wasRunning = freezeHoldClock.isRunning();
		freezeHoldClock.cancel();
		onFreezeHoldChange(null);
		return wasRunning;
	};

	const scheduleNextUpdate = () => {
		if (video.paused || video.ended) {
			return;
		}

		// Align editor state with the frame Chromium actually presented instead of
		// polling `currentTime` on a generic animation frame.
		if (typeof presentedFrameVideo.requestVideoFrameCallback === "function") {
			videoFrameRequestId = presentedFrameVideo.requestVideoFrameCallback(
				(_now, metadata) => {
					videoFrameRequestId = null;
					updateTime(metadata);
				},
			);
			return;
		}

		timeUpdateAnimationRef.current = requestAnimationFrame(() => {
			timeUpdateAnimationRef.current = null;
			updateTime();
		});
	};

	function getPresentedTime(metadata?: PresentedFrameMetadata): number {
		const mediaTime = metadata?.mediaTime;
		return Number.isFinite(mediaTime) ? (mediaTime ?? 0) : video.currentTime;
	}

	function updateTime(metadata?: PresentedFrameMetadata) {
		if (!video) return;

		const presentedTime = getPresentedTime(metadata);
		const currentTimeMs = presentedTime * 1000;
		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// If we're in a trim region during playback, skip to the end of it
		if (activeTrimRegion && !video.paused && !video.ended) {
			skipPastTrimRegion(activeTrimRegion);
		} else {
			completedFreezeIds = rearmCompletedFreezeIds(
				freezeRegionsRef.current,
				completedFreezeIds,
				currentTimeMs,
			);
			const freezeRegion =
				!video.paused && !video.ended
					? findFreezeRegionToHold({
							freezeRegions: freezeRegionsRef.current,
							previousTimeMs: lastPresentedTimeMs,
							currentTimeMs,
							completedFreezeIds,
						})
					: null;
			if (freezeRegion) {
				beginFreezeHold(freezeRegion);
				return;
			}

			// Apply playback speed from active speed region
			const activeSpeedRegion = findActiveSpeedRegion(currentTimeMs);
			enablePitchPreservingPlayback(video);
			video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
			emitTime(presentedTime);
			lastPresentedTimeMs = currentTimeMs;
		}

		scheduleNextUpdate();
	}

	const handlePlay = () => {
		if (!allowPlaybackRef.current) {
			video.pause();
			return;
		}

		isPlayingRef.current = true;
		onPlayStateChange(true);
		cancelScheduledUpdate();

		const startTimeMs = video.currentTime * 1000;
		const freezeAtStart = findFreezeRegionAtTime(
			freezeRegionsRef.current,
			startTimeMs,
			completedFreezeIds,
		);
		if (freezeAtStart) {
			beginFreezeHold(freezeAtStart);
			return;
		}

		lastPresentedTimeMs = startTimeMs;
		scheduleNextUpdate();
	};

	const handlePause = () => {
		if (ignoreNextPauseEvent) {
			ignoreNextPauseEvent = false;
			return;
		}

		markPlaybackStopped();
		cancelScheduledUpdate();
		emitTime(video.currentTime);
	};

	const handleSeeked = () => {
		isSeekingRef.current = false;
		if (holdSnapSeekPending) {
			holdSnapSeekPending = false;
			emitTime(video.currentTime);
			return;
		}

		const currentTimeMs = video.currentTime * 1000;
		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// Never leave the preview parked on removed footage after a seek.
		if (activeTrimRegion) {
			skipPastTrimRegion(activeTrimRegion);
		} else {
			emitTime(video.currentTime);
		}
	};

	const handleSeeking = () => {
		isSeekingRef.current = true;
		if (!holdSnapSeekPending) {
			// Any other seek starts playback over from a new position: holds can play again,
			// and a hold that was running gives way to normal playback at the new position.
			lastPresentedTimeMs = null;
			completedFreezeIds = new Set();
			if (cancelFreezeHold() && allowPlaybackRef.current) {
				video.play().catch(markPlaybackStopped);
			}
		}
		emitTime(video.currentTime);
	};

	const pauseFreezeHold = () => {
		if (!freezeHoldClock.pause()) {
			return false;
		}

		markPlaybackStopped();
		return true;
	};

	const resumeFreezeHold = () => {
		if (!freezeHoldClock.resume()) {
			return false;
		}

		isPlayingRef.current = true;
		onPlayStateChange(true);
		return true;
	};

	const dispose = () => {
		cancelScheduledUpdate();
		cancelFreezeHold();
	};

	return {
		dispose,
		handlePlay,
		handlePause,
		handleSeeked,
		handleSeeking,
		/** Pauses a running freeze frame hold. Returns false when no hold is running. */
		pauseFreezeHold,
		/** Resumes a paused freeze frame hold. Returns false when no hold is paused. */
		resumeFreezeHold,
	};
}
