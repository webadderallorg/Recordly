// Preserve native scrolling except for progress still owed at the top boundary.
export function resolveShowcaseRewind({ scrollY, deltaY, start, distance, progressDistance, progress }) {
	// Browsers may round scrollTo to a device pixel below the fractional boundary.
	if (deltaY >= 0 || scrollY < start - 1 || scrollY + deltaY >= start || progress <= 0) return null;
	const nativeRewind = Math.max(0, Math.min(distance, scrollY - start));
	const remaining = progress * progressDistance - nativeRewind;
	if (remaining <= 0) return null;
	const held = Math.min(start - scrollY - deltaY, remaining);
	return {
		scrollY: scrollY + deltaY + held,
		progress: Math.max(0, remaining - held) / progressDistance,
	};
}
