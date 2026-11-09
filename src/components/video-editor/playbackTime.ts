export function formatPlaybackTime(seconds: number) {
	const totalMs = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
	const minutes = Math.floor(totalMs / 60000);
	const wholeSeconds = Math.floor((totalMs % 60000) / 1000);
	const milliseconds = totalMs % 1000;
	return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
