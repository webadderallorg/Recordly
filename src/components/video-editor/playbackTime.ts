export function formatPlaybackTime(seconds: number) {
	const tenths = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 10)) : 0;
	const minutes = Math.floor(tenths / 600);
	const wholeSeconds = Math.floor((tenths % 600) / 10);
	return `${minutes}:${String(wholeSeconds).padStart(2, "0")}.${tenths % 10}`;
}
