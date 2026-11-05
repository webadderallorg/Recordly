/** Binary units shared by estimated and measured GIF sizes. */
export function formatGifBytes(bytes: number): string {
	const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
	const units = ["B", "KB", "MB", "GB", "TB"];
	const index =
		safeBytes > 0 ? Math.min(Math.floor(Math.log2(safeBytes) / 10), units.length - 1) : 0;
	const unit = Math.max(0, index);
	return unit === 0
		? `${Math.round(safeBytes)} B`
		: `${(safeBytes / 1024 ** unit).toFixed(1)} ${units[unit]}`;
}
