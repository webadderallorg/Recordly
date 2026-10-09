/**
 * X11 shape-extension support for the HUD window (win.setShape, Linux/X11
 * only): the window stays a constant tall rectangle, but the OS only paints
 * and hit-tests inside the given rects — everything else genuinely falls
 * through to the app below. The bar is one rect; an open popover adds a
 * second one above it. No dead click zones, ever.
 */

/** Padding so the bar's CSS drop shadow and popover borders aren't hard-cut. */
export const HUD_SHAPE_PAD_PX = 10;

export interface HudShapeRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface HudShapeWindowSize {
	width: number;
	height: number;
}

/** Rounds a renderer DOM rect into integers relative to the window. */
export function toShapeRect(rect: {
	top: number;
	left: number;
	right: number;
	bottom: number;
}): HudShapeRect {
	return {
		x: Math.round(rect.left),
		y: Math.round(rect.top),
		width: Math.max(0, Math.round(rect.right - rect.left)),
		height: Math.max(0, Math.round(rect.bottom - rect.top)),
	};
}

/**
 * Expands a rect by the pad on every side, intersected with the window
 * bounds. Degenerate (zero-area) results produce nothing — nothing to show.
 */
export function padShapeRect(
	rect: HudShapeRect,
	windowSize: HudShapeWindowSize,
	pad = HUD_SHAPE_PAD_PX,
): HudShapeRect | null {
	const x1 = Math.max(0, rect.x - pad);
	const y1 = Math.max(0, rect.y - pad);
	const x2 = Math.min(windowSize.width, rect.x + rect.width + pad);
	const y2 = Math.min(windowSize.height, rect.y + rect.height + pad);
	const width = x2 - x1;
	const height = y2 - y1;
	if (width <= 0 || height <= 0) {
		return null;
	}
	return { x: x1, y: y1, width, height };
}

/**
 * The shape rects for the HUD window: the bar column plus, when open, the
 * popover above it. Rects are padded, clamped, and de-duplicated; an empty
 * result means "revert to the full rectangle" (caller decides the fallback).
 */
export function buildHudWindowShape(options: {
	windowSize: HudShapeWindowSize;
	bar: HudShapeRect;
	popover?: HudShapeRect | null;
}): HudShapeRect[] {
	const { windowSize } = options;
	const rects: HudShapeRect[] = [];
	for (const rect of [options.bar, options.popover]) {
		if (!rect) continue;
		const padded = padShapeRect(rect, windowSize);
		if (padded) {
			rects.push(padded);
		}
	}
	return rects;
}

/** Stable key for deduping shape reports renderer-side and main-side. */
export function shapeKey(rects: HudShapeRect[]): string {
	return rects
		.map((r) => `${r.x},${r.y},${r.width},${r.height}`)
		.sort()
		.join("|");
}
