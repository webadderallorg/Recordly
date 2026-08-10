export interface HudInteractiveBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export function mergeHudInteractiveBounds(
	bounds: Array<HudInteractiveBounds | null | undefined>,
): HudInteractiveBounds | null {
	const presentBounds = bounds.filter((value): value is HudInteractiveBounds => Boolean(value));
	if (presentBounds.length === 0) {
		return null;
	}

	return presentBounds.reduce((merged, current) => ({
		left: Math.min(merged.left, current.left),
		top: Math.min(merged.top, current.top),
		right: Math.max(merged.right, current.right),
		bottom: Math.max(merged.bottom, current.bottom),
	}));
}

export function shouldRestoreHudMousePassthroughAfterDrag(
	bounds: HudInteractiveBounds | null,
	clientX: number,
	clientY: number,
): boolean {
	if (!bounds) {
		return true;
	}

	return (
		clientX < bounds.left ||
		clientX > bounds.right ||
		clientY < bounds.top ||
		clientY > bounds.bottom
	);
}

export function shouldRestoreHudMousePassthrough({
	isMouseOverHud,
	popoverOpen,
	isHudDragging,
	isWebcamPreviewDragging,
	webcamPreviewPointerDown,
}: {
	isMouseOverHud: boolean;
	popoverOpen: boolean;
	isHudDragging: boolean;
	isWebcamPreviewDragging: boolean;
	webcamPreviewPointerDown: boolean;
}): boolean {
	return (
		!isMouseOverHud &&
		!popoverOpen &&
		!isHudDragging &&
		!isWebcamPreviewDragging &&
		!webcamPreviewPointerDown
	);
}
