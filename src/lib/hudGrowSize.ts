interface HudDomRect {
	top: number;
	left: number;
	right: number;
	bottom: number;
}

/**
 * Window content size for grow mode (bar anchored to the window's top): the
 * height spans from the window top down to the lowest visible element (the
 * bar when idle, the open popover's bottom edge when a menu is open below
 * it), the width spans the widest element. The window's top-left stays
 * pinned by the compositor on resize, so the bar never moves.
 */
export function computeHudGrowContentSize(
	contentRect: HudDomRect | null,
	popoverRect: HudDomRect | null,
): { width: number; height: number } | null {
	if (!contentRect) {
		return null;
	}
	const bottom = Math.max(contentRect.bottom, popoverRect?.bottom ?? contentRect.bottom);
	const left = Math.min(contentRect.left, popoverRect?.left ?? contentRect.left);
	const right = Math.max(contentRect.right, popoverRect?.right ?? contentRect.right);
	const height = Math.max(1, Math.ceil(bottom));
	const width = Math.max(1, Math.ceil(right - left));
	return { width, height };
}
