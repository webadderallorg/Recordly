export interface HudOverlayWorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

const NON_PASSTHROUGH_HUD_WIDTH_DIP = 860;
export const NON_PASSTHROUGH_HUD_COMPACT_HEIGHT_DIP = 160;
export const NON_PASSTHROUGH_HUD_EXPANDED_HEIGHT_DIP = 540;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function getHudOverlayWindowBounds(
	workArea: HudOverlayWorkArea,
	mousePassthroughSupported: boolean,
	fallbackExpanded = false,
): HudOverlayWorkArea {
	if (mousePassthroughSupported) {
		return { ...workArea };
	}

	const width = Math.min(workArea.width, NON_PASSTHROUGH_HUD_WIDTH_DIP);
	const height = Math.min(
		workArea.height,
		fallbackExpanded
			? NON_PASSTHROUGH_HUD_EXPANDED_HEIGHT_DIP
			: NON_PASSTHROUGH_HUD_COMPACT_HEIGHT_DIP,
	);

	return {
		x: Math.round(workArea.x + (workArea.width - width) / 2),
		y: Math.round(workArea.y + workArea.height - height),
		width,
		height,
	};
}

export function shouldExpandHudOverlayFallback({
	fallbackExpanded,
	recordingActive,
	webcamPreviewVisible,
}: {
	fallbackExpanded: boolean;
	recordingActive: boolean;
	webcamPreviewVisible: boolean;
}): boolean {
	return fallbackExpanded || (recordingActive && webcamPreviewVisible);
}

export function resizeHudOverlayFallbackBounds(
	workArea: HudOverlayWorkArea,
	currentBounds: HudOverlayWorkArea,
	fallbackExpanded: boolean,
): HudOverlayWorkArea {
	const nextBounds = getHudOverlayWindowBounds(workArea, false, fallbackExpanded);
	const maxX = workArea.x + workArea.width - nextBounds.width;
	const maxY = workArea.y + workArea.height - nextBounds.height;

	return {
		...nextBounds,
		x: clamp(currentBounds.x, workArea.x, maxX),
		y: clamp(currentBounds.y + currentBounds.height - nextBounds.height, workArea.y, maxY),
	};
}

/**
 * Bar-aware drag clamp for shape-mode Linux dragging: the window is a tall
 * rectangle with the bar anchored somewhere inside it (bottom in practice),
 * so the window-manager's window-level reachability clamp does not keep the
 * bar on screen. Constrains the dragged window position so the bar's rect
 * (window-relative) always stays fully inside the work area.
 */
export function clampHudDragToWorkArea(
	workArea: HudOverlayWorkArea,
	position: { x: number; y: number },
	barRect: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
	const minX = workArea.x - barRect.x;
	const maxX = workArea.x + workArea.width - barRect.x - barRect.width;
	const minY = workArea.y - barRect.y;
	const maxY = workArea.y + workArea.height - barRect.y - barRect.height;
	return {
		x: Math.min(Math.max(position.x, minX), Math.max(minX, maxX)),
		y: Math.min(Math.max(position.y, minY), Math.max(minY, maxY)),
	};
}
