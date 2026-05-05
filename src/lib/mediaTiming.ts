export function clampMediaTimeToDuration(targetTime: number, duration?: number | null): number {
	const safeTargetTime = Math.max(0, targetTime);
	if (!Number.isFinite(duration) || duration === null || duration === undefined) {
		return safeTargetTime;
	}

	return Math.max(0, Math.min(safeTargetTime, Math.max(0, duration)));
}

const MIN_COMPANION_AUDIO_DELAY_SECONDS = 0.025;
const MAX_INFERRED_COMPANION_AUDIO_DELAY_SECONDS = 0.5;

export function estimateCompanionAudioStartDelaySeconds(
	timelineDuration?: number | null,
	audioDuration?: number | null,
	recordedStartDelayMs?: number | null,
): number {
	if (Number.isFinite(recordedStartDelayMs) && (recordedStartDelayMs ?? 0) >= 0) {
		return Math.max(0, recordedStartDelayMs ?? 0) / 1000;
	}

	if (!Number.isFinite(timelineDuration) || !Number.isFinite(audioDuration)) {
		return 0;
	}

	const safeTimelineDuration = Math.max(0, timelineDuration ?? 0);
	const safeAudioDuration = Math.max(0, audioDuration ?? 0);
	const estimatedDelaySeconds = safeTimelineDuration - safeAudioDuration;

	if (
		estimatedDelaySeconds <= MIN_COMPANION_AUDIO_DELAY_SECONDS ||
		estimatedDelaySeconds > MAX_INFERRED_COMPANION_AUDIO_DELAY_SECONDS
	) {
		return 0;
	}

	return estimatedDelaySeconds;
}

export function getMediaSyncPlaybackRate({
	basePlaybackRate,
	currentTime,
	targetTime,
	toleranceSeconds = 0.015,
	correctionWindowSeconds = 2,
	maxAdjustment = 0.08,
}: {
	basePlaybackRate: number;
	currentTime: number;
	targetTime: number;
	toleranceSeconds?: number;
	correctionWindowSeconds?: number;
	maxAdjustment?: number;
}): number {
	const safeBasePlaybackRate =
		Number.isFinite(basePlaybackRate) && basePlaybackRate > 0 ? basePlaybackRate : 1;

	if (!Number.isFinite(currentTime) || !Number.isFinite(targetTime)) {
		return safeBasePlaybackRate;
	}

	const driftSeconds = targetTime - currentTime;
	if (Math.abs(driftSeconds) <= toleranceSeconds) {
		return safeBasePlaybackRate;
	}

	const safeCorrectionWindow = correctionWindowSeconds > 0 ? correctionWindowSeconds : 2;
	const safeMaxAdjustment = Math.max(0, maxAdjustment);
	const adjustment = Math.max(
		-safeMaxAdjustment,
		Math.min(safeMaxAdjustment, driftSeconds / safeCorrectionWindow),
	);

	return Math.max(0.1, safeBasePlaybackRate + adjustment);
}

type PitchPreservingMediaElement = HTMLMediaElement & {
	preservesPitch?: boolean;
	mozPreservesPitch?: boolean;
	webkitPreservesPitch?: boolean;
};

export function enablePitchPreservingPlayback(media: HTMLMediaElement) {
	const pitchMedia = media as PitchPreservingMediaElement;
	pitchMedia.preservesPitch = true;
	pitchMedia.mozPreservesPitch = true;
	pitchMedia.webkitPreservesPitch = true;
}

export function getEffectiveVideoStreamDurationSeconds({
	duration,
	streamDuration,
}: {
	duration?: number | null;
	streamDuration?: number | null;
}): number {
	if (Number.isFinite(streamDuration) && (streamDuration ?? 0) > 0) {
		return Math.max(0, streamDuration ?? 0);
	}

	if (Number.isFinite(duration) && (duration ?? 0) > 0) {
		return Math.max(0, duration ?? 0);
	}

	return 0;
}

export function getEffectiveRecordingDurationMs({
	startTimeMs,
	endTimeMs,
	accumulatedPausedDurationMs = 0,
	pauseStartedAtMs = null,
}: {
	startTimeMs: number;
	endTimeMs: number;
	accumulatedPausedDurationMs?: number;
	pauseStartedAtMs?: number | null;
}): number {
	if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
		return 0;
	}

	const safeStartTime = Math.max(0, startTimeMs);
	const safeEndTime = Math.max(safeStartTime, endTimeMs);
	const activePauseDuration =
		Number.isFinite(pauseStartedAtMs) && pauseStartedAtMs !== null
			? Math.max(0, safeEndTime - pauseStartedAtMs)
			: 0;

	return Math.max(
		0,
		safeEndTime -
			safeStartTime -
			Math.max(0, accumulatedPausedDurationMs) -
			activePauseDuration,
	);
}
