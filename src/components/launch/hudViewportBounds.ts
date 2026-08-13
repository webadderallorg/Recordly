export interface HudOffset {
	x: number;
	y: number;
}

export interface HudViewportBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface HudViewportSize {
	width: number;
	height: number;
}

function clampOffsetAxis(offset: number, start: number, end: number, viewportSize: number) {
	if (start < 0) {
		return offset - start;
	}

	if (end > viewportSize) {
		return offset + viewportSize - end;
	}

	return offset;
}

export function clampHudOffsetToViewport(
	offset: HudOffset,
	bounds: HudViewportBounds,
	viewport: HudViewportSize,
): HudOffset {
	return {
		x: clampOffsetAxis(offset.x, bounds.left, bounds.right, viewport.width),
		y: clampOffsetAxis(offset.y, bounds.top, bounds.bottom, viewport.height),
	};
}
