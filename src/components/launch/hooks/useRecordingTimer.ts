import { useEffect, useMemo, useState } from "react";

export function useRecordingTimer(recording: boolean, paused: boolean) {
	const [recordingStart, setRecordingStart] = useState<number | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const [pausedAt, setPausedAt] = useState<number | null>(null);
	const [pausedTotal, setPausedTotal] = useState(0);

	useEffect(() => {
		let timer: NodeJS.Timeout | null = null;
		if (recording) {
			if (!recordingStart) {
				setRecordingStart(Date.now());
				setPausedTotal(0);
			}
			if (paused) {
				if (!pausedAt) setPausedAt(Date.now());
				if (timer) clearInterval(timer);
			} else {
				if (pausedAt) {
					setPausedTotal((prev) => prev + (Date.now() - pausedAt));
					setPausedAt(null);
				}
				timer = setInterval(() => {
					if (recordingStart) {
						setElapsed(Math.floor((Date.now() - recordingStart - pausedTotal) / 1000));
					}
				}, 1000);
			}
		} else {
			setRecordingStart(null);
			setElapsed(0);
			setPausedAt(null);
			setPausedTotal(0);
			if (timer) clearInterval(timer);
		}
		return () => {
			if (timer) clearInterval(timer);
		};
	}, [recording, recordingStart, paused, pausedAt, pausedTotal]);

	const formatTime = useMemo(
		() => (seconds: number) => {
			const m = Math.floor(seconds / 60)
				.toString()
				.padStart(2, "0");
			const s = (seconds % 60).toString().padStart(2, "0");
			return `${m}:${s}`;
		},
		[],
	);

	return { elapsed, formatTime };
}
