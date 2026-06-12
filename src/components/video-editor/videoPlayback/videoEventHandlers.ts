import type React from "react";
import { extensionHost } from "@/lib/extensions";
import { enablePitchPreservingPlayback } from "@/lib/mediaTiming";
import type { SpeedRegion, TrimRegion } from "../types";

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
	magnetEnabledRef: React.MutableRefObject<boolean>;
	/** Fired when the wall-clock gap driver enters (true) or leaves (false) a black gap. */
	onGapStateChange?: (inGap: boolean) => void;
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
		magnetEnabledRef,
		onGapStateChange,
	} = params;
	const presentedFrameVideo = video as PresentedFrameVideoElement;
	let videoFrameRequestId: number | null = null;
	// While a trim-region skip seek is in flight, frame callbacks can still
	// report pre-seek media times. Tracking the seek target lets us ignore
	// those stale observations instead of re-triggering the seek (which caused
	// a skip -> replay loop with a frozen playhead).
	let pendingTrimSkipTargetMs: number | null = null;
	const PENDING_SKIP_EPSILON_MS = 1;
	const USER_SEEK_CLEAR_THRESHOLD_MS = 50;
	// --- Wall-clock gap driver (magnet off) ---
	// With the magnet disabled, trimmed ranges play back as *black time*: on
	// entering a trim region we pause the media element and advance the
	// playhead from performance.now() instead. requestVideoFrameCallback never
	// fires while the video is paused (and scheduleNextUpdate early-returns on
	// paused video), so the driver runs its own requestAnimationFrame loop.
	let gapDrive: {
		regionEndMs: number;
		baseMs: number; // emitted gap position when the wall-clock anchor was taken
		anchorMs: number; // performance.now() at the (re)anchor moment
	} | null = null;
	// Set while the user has paused inside a gap; resuming play restarts the
	// driver from this position instead of the media element's parked time.
	let gapFrozenAtMs: number | null = null;
	let gapAnimationFrameId: number | null = null;
	// The driver's own video.pause() fires a "pause" event that must not be
	// mistaken for a user pause (which would freeze the wall clock).
	let selfPauseSuppressCount = 0;
	enablePitchPreservingPlayback(video);

	const emitTime = (timeValue: number) => {
		currentTimeRef.current = timeValue * 1000;
		onTimeUpdate(timeValue);
		extensionHost.emitEvent({ type: "playback:timeupdate", timeMs: timeValue * 1000 });
	};

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

	// Returns true when the observed time is a stale pre-seek observation that
	// must be ignored; clears the pending target once playback reaches it.
	const isStaleObservationWhileSkipPending = (currentTimeMs: number): boolean => {
		if (pendingTrimSkipTargetMs === null) {
			return false;
		}

		if (currentTimeMs < pendingTrimSkipTargetMs - PENDING_SKIP_EPSILON_MS) {
			return true;
		}

		pendingTrimSkipTargetMs = null;
		return false;
	};

	const skipPastTrimRegion = (trimRegion: TrimRegion) => {
		const skipToTime = trimRegion.endMs / 1000;
		const clampedSkipToTime = Math.min(skipToTime, video.duration);

		pendingTrimSkipTargetMs = clampedSkipToTime * 1000;
		video.currentTime = clampedSkipToTime;
		emitTime(clampedSkipToTime);

		if (clampedSkipToTime >= video.duration) {
			video.pause();
		}
	};

	const pauseVideoForGapDrive = () => {
		if (video.paused || video.ended) {
			return;
		}
		selfPauseSuppressCount += 1;
		video.pause();
	};

	const stopGapTicking = () => {
		if (gapAnimationFrameId !== null) {
			cancelAnimationFrame(gapAnimationFrameId);
			gapAnimationFrameId = null;
		}
	};

	const scheduleGapTick = () => {
		gapAnimationFrameId = requestAnimationFrame(() => {
			gapAnimationFrameId = null;
			gapTick();
		});
	};

	const syncPausedPlayState = () => {
		if (isPlayingRef.current && video.paused) {
			isPlayingRef.current = false;
			onPlayStateChange(false);
		}
	};

	const startGapDrive = (observedTimeMs: number, trimRegion: TrimRegion) => {
		const clampedEntryMs = Math.min(
			Math.max(observedTimeMs, trimRegion.startMs),
			trimRegion.endMs,
		);
		const resumeFromFrozen =
			gapFrozenAtMs !== null &&
			gapFrozenAtMs >= trimRegion.startMs &&
			gapFrozenAtMs < trimRegion.endMs;
		const entryMs = resumeFromFrozen && gapFrozenAtMs !== null ? gapFrozenAtMs : clampedEntryMs;
		gapFrozenAtMs = null;
		stopGapTicking();
		pauseVideoForGapDrive();
		gapDrive = {
			regionEndMs: trimRegion.endMs,
			baseMs: entryMs,
			anchorMs: performance.now(),
		};
		onGapStateChange?.(true);
		emitTime(entryMs / 1000);
		scheduleGapTick();
	};

	const freezeGapDrive = () => {
		const drive = gapDrive;
		if (drive === null) {
			return;
		}
		stopGapTicking();
		gapFrozenAtMs = Math.min(
			drive.baseMs + (performance.now() - drive.anchorMs),
			drive.regionEndMs,
		);
		gapDrive = null;
		isPlayingRef.current = false;
		onPlayStateChange(false);
		emitTime(gapFrozenAtMs / 1000);
	};

	const cancelGapDrive = () => {
		if (gapDrive === null && gapFrozenAtMs === null) {
			return;
		}
		stopGapTicking();
		gapDrive = null;
		gapFrozenAtMs = null;
		onGapStateChange?.(false);
	};

	const finishGapDrive = (regionEndMs: number) => {
		stopGapTicking();
		gapDrive = null;
		gapFrozenAtMs = null;

		const skipToTime = Math.min(regionEndMs / 1000, video.duration);
		pendingTrimSkipTargetMs = skipToTime * 1000;
		video.currentTime = skipToTime;
		emitTime(skipToTime);
		onGapStateChange?.(false);

		if (skipToTime >= video.duration) {
			isPlayingRef.current = false;
			onPlayStateChange(false);
			return;
		}
		Promise.resolve(video.play()).catch(() => undefined);
	};

	function gapTick() {
		const drive = gapDrive;
		if (drive === null) {
			return;
		}

		if (!allowPlaybackRef.current) {
			// The editor's pause control cannot fire a media "pause" event while
			// the driver already holds the element paused; the allow-playback ref
			// is the reliable pause signal in that state.
			freezeGapDrive();
			return;
		}

		if (magnetEnabledRef.current) {
			// The magnet was re-enabled mid-gap: gaps are skipped again, so stop
			// driving black time — seek to the gap end and resume real playback.
			finishGapDrive(drive.regionEndMs);
			return;
		}

		const positionMs = drive.baseMs + (performance.now() - drive.anchorMs);
		if (positionMs >= drive.regionEndMs) {
			finishGapDrive(drive.regionEndMs);
			return;
		}

		emitTime(positionMs / 1000);
		scheduleGapTick();
	}

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

		if (gapDrive !== null) {
			// The wall-clock driver owns the playhead while a gap is playing. A
			// stray play() while driving would resume trimmed footage underneath
			// the black overlay — re-pause and stay in charge.
			pauseVideoForGapDrive();
			return;
		}

		const presentedTime = getPresentedTime(metadata);
		const currentTimeMs = presentedTime * 1000;

		if (isStaleObservationWhileSkipPending(currentTimeMs)) {
			scheduleNextUpdate();
			return;
		}

		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		// If we're in a trim region during playback, skip to the end of it
		if (activeTrimRegion && !video.paused && !video.ended) {
			if (magnetEnabledRef.current === false) {
				// Magnet off: the gap is kept as black time — hand the playhead to
				// the wall-clock driver instead of seeking past the region.
				startGapDrive(currentTimeMs, activeTrimRegion);
				return;
			}
			skipPastTrimRegion(activeTrimRegion);
		} else {
			// Apply playback speed from active speed region
			const activeSpeedRegion = findActiveSpeedRegion(currentTimeMs);
			enablePitchPreservingPlayback(video);
			video.playbackRate = activeSpeedRegion ? activeSpeedRegion.speed : 1;
			emitTime(presentedTime);
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
		scheduleNextUpdate();
	};

	const handlePause = () => {
		if (selfPauseSuppressCount > 0) {
			// Pause initiated by the gap driver itself — playback continues as
			// black time, so neither play state nor the playhead should change.
			selfPauseSuppressCount -= 1;
			return;
		}

		if (gapDrive !== null) {
			// User pause mid-gap: freeze the wall clock, retain progress.
			freezeGapDrive();
			return;
		}

		isPlayingRef.current = false;
		onPlayStateChange(false);
		cancelScheduledUpdate();
		emitTime(video.currentTime);
	};

	const handleSeeked = () => {
		isSeekingRef.current = false;

		const currentTimeMs = video.currentTime * 1000;

		if (isStaleObservationWhileSkipPending(currentTimeMs)) {
			return;
		}

		const activeTrimRegion = findActiveTrimRegion(currentTimeMs);

		if (magnetEnabledRef.current === false) {
			// Magnet off: gaps are playable black time, never skipped.
			if (activeTrimRegion) {
				if (isPlayingRef.current && allowPlaybackRef.current) {
					// Scrubbed into a gap while playing — drive from the scrub spot.
					startGapDrive(currentTimeMs, activeTrimRegion);
				} else {
					syncPausedPlayState();
					emitTime(video.currentTime);
				}
				return;
			}

			// A canceled gap drive leaves the element paused; if the editor still
			// intends to play, resume real playback at the seek target.
			if (isPlayingRef.current && allowPlaybackRef.current && video.paused && !video.ended) {
				Promise.resolve(video.play()).catch(() => undefined);
			} else {
				syncPausedPlayState();
			}
			emitTime(video.currentTime);
			return;
		}

		// Never leave the preview parked on removed footage after a seek.
		if (activeTrimRegion) {
			skipPastTrimRegion(activeTrimRegion);
		} else {
			emitTime(video.currentTime);
		}
	};

	const handleSeeking = () => {
		isSeekingRef.current = true;

		// Any user seek cancels an active or frozen gap drive; handleSeeked
		// restarts it when the target lands inside a gap while playing.
		cancelGapDrive();

		// A seek that targets somewhere other than our pending skip target is
		// user-initiated (scrub) — the in-flight skip no longer applies.
		const currentTimeMs = video.currentTime * 1000;
		if (
			pendingTrimSkipTargetMs !== null &&
			Math.abs(currentTimeMs - pendingTrimSkipTargetMs) > USER_SEEK_CLEAR_THRESHOLD_MS
		) {
			pendingTrimSkipTargetMs = null;
		}

		emitTime(video.currentTime);
	};

	return {
		dispose: () => {
			cancelScheduledUpdate();
			stopGapTicking();
		},
		handlePlay,
		handlePause,
		handleSeeked,
		handleSeeking,
	};
}
