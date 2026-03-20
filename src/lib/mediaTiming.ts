export function clampMediaTimeToDuration(
  targetTime: number,
  duration?: number | null,
): number {
  const safeTargetTime = Math.max(0, targetTime);
  if (!Number.isFinite(duration) || duration === null || duration === undefined) {
    return safeTargetTime;
  }

  return Math.max(0, Math.min(safeTargetTime, Math.max(0, duration)));
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