import { clampMediaTimeToDuration } from "@/lib/mediaTiming";

export function getWebcamPreviewTargetTimeSeconds({
	currentTime,
	webcamDuration,
	timeOffsetMs,
}: {
	currentTime: number;
	webcamDuration?: number | null;
	timeOffsetMs?: number | null;
}): number {
	const safeOffsetMs = Number.isFinite(timeOffsetMs) ? (timeOffsetMs ?? 0) : 0;
	const shiftedTime = currentTime + safeOffsetMs / 1000;
	return clampMediaTimeToDuration(shiftedTime, webcamDuration);
}
