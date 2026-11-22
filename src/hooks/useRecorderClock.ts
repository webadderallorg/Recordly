import { useCallback, useRef } from "react";
import { getEffectiveRecordingDurationMs } from "@/lib/mediaTiming";
export function useRecorderClock() {
	const startTime = useRef<number>(0);

	const accumulatedPausedDurationMs = useRef(0);

	const pauseStartedAtMs = useRef<number | null>(null);

	const resetRecordingClock = useCallback((startedAt: number) => {
		startTime.current = startedAt;
		accumulatedPausedDurationMs.current = 0;
		pauseStartedAtMs.current = null;
	}, []);

	const markRecordingPaused = useCallback((pausedAt: number) => {
		if (pauseStartedAtMs.current === null) {
			pauseStartedAtMs.current = pausedAt;
		}
	}, []);

	const markRecordingResumed = useCallback((resumedAt: number) => {
		if (pauseStartedAtMs.current === null) {
			return;
		}

		const pauseStart = pauseStartedAtMs.current;
		const pauseDurationMs = Math.max(0, resumedAt - pauseStart);
		accumulatedPausedDurationMs.current += pauseDurationMs;
		pauseStartedAtMs.current = null;
	}, []);

	const getRecordingDurationMs = useCallback((endedAt: number) => {
		return getEffectiveRecordingDurationMs({
			startTimeMs: startTime.current,
			endTimeMs: endedAt,
			accumulatedPausedDurationMs: accumulatedPausedDurationMs.current,
			pauseStartedAtMs: pauseStartedAtMs.current,
		});
	}, []);

	return {
		resetRecordingClock,
		markRecordingPaused,
		markRecordingResumed,
		getRecordingDurationMs,
	};
}
