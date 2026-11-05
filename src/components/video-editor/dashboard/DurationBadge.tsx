export function formatThumbnailDuration(seconds: number | undefined): string | null {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
	const total = Math.floor(seconds);
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	const remaining = String(total % 60).padStart(2, "0");
	return hours
		? `${hours}:${String(minutes).padStart(2, "0")}:${remaining}`
		: `${minutes}:${remaining}`;
}

export function DurationBadge({ seconds }: { seconds: number | undefined }) {
	const duration = formatThumbnailDuration(seconds);
	if (!duration) return null;
	return (
		<span
			data-thumbnail-duration
			className="pointer-events-none absolute bottom-2 right-2 z-10 rounded bg-black/80 px-1.5 py-0.5 text-xs font-semibold leading-none text-white tabular-nums"
		>
			{duration}
		</span>
	);
}
