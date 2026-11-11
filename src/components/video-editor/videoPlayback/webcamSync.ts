import { clampMediaTimeToDuration } from "@/lib/mediaTiming";

const HAVE_CURRENT_DATA_READY_STATE = 2;

/**
 * Maps the editor timeline time to the corresponding webcam media timestamp,
 * accounting for the webcam start offset and whether the footage repeats.
 */
export function getWebcamMediaTargetTimeSeconds({
	currentTime,
	webcamDuration,
	timeOffsetMs,
	loop,
}: {
	currentTime: number;
	webcamDuration?: number | null;
	timeOffsetMs?: number | null;
	loop?: boolean;
}): number {
	const safeOffsetMs = Number.isFinite(timeOffsetMs) ? (timeOffsetMs ?? 0) : 0;
	const shiftedTime = currentTime - safeOffsetMs / 1000;
	if (loop && webcamDuration != null && Number.isFinite(webcamDuration) && webcamDuration > 0) {
		return Math.max(0, shiftedTime) % webcamDuration;
	}
	return clampMediaTimeToDuration(shiftedTime, webcamDuration);
}

export const getWebcamPreviewTargetTimeSeconds = getWebcamMediaTargetTimeSeconds;

/** Older projects only identify recorded webcam footage by its paired filename. */
export function shouldLoopWebcamSource(
	videoPath: string | null,
	webcamPath: string | null,
	timeOffsetMs = 0,
): boolean {
	if (!videoPath || !webcamPath || timeOffsetMs !== 0) return false;
	const stem = (path: string) => path.replace(/\\/g, "/").replace(/\.[^./]+$/, "");
	const videoStem = stem(videoPath);
	const webcamStem = stem(webcamPath);
	return webcamStem !== videoStem && webcamStem !== `${videoStem}-webcam`;
}

export function isWebcamMediaSynchronized({
	currentTime,
	targetTime,
	readyState,
	isSeeking,
	toleranceSeconds = 0.12,
}: {
	currentTime: number;
	targetTime: number;
	readyState: number;
	isSeeking: boolean;
	toleranceSeconds?: number;
}): boolean {
	return (
		readyState >= HAVE_CURRENT_DATA_READY_STATE &&
		!isSeeking &&
		Math.abs(currentTime - targetTime) <= toleranceSeconds
	);
}

/**
 * Decides whether the webcam media element needs a corrective seek for the
 * current preview frame, while avoiding repeated seeks during active media seeks.
 */
export function shouldSeekWebcamMedia({
	desiredTime,
	isPlaying,
	isSeeking,
	previousTimelineTime,
	timelineTime,
	webcamCurrentTime,
}: {
	desiredTime: number;
	isPlaying: boolean;
	isSeeking: boolean;
	previousTimelineTime: number | null;
	timelineTime: number;
	webcamCurrentTime: number;
}): boolean {
	if (isSeeking) {
		return false;
	}

	const timelineJumped =
		previousTimelineTime === null || Math.abs(timelineTime - previousTimelineTime) > 0.25;
	const driftThreshold = isPlaying ? 0.35 : 0.01;

	return timelineJumped || Math.abs(webcamCurrentTime - desiredTime) > driftThreshold;
}

/** Missing ranges means an original recording; an empty list means no webcam frames. */
export function isWebcamVisibleAtSourceTime(
	webcam: { visibleRanges?: { startMs: number; endMs: number }[] } | undefined,
	sourceTimeSeconds: number,
): boolean {
	return (
		!webcam?.visibleRanges ||
		webcam.visibleRanges.some(
			({ startMs, endMs }) =>
				sourceTimeSeconds * 1000 >= startMs && sourceTimeSeconds * 1000 < endMs,
		)
	);
}
