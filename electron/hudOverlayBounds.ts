export interface HudOverlayWorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

const NON_PASSTHROUGH_HUD_WIDTH_DIP = 860;
const NON_PASSTHROUGH_HUD_COMPACT_HEIGHT_DIP = 160;
const NON_PASSTHROUGH_HUD_EXPANDED_HEIGHT_DIP = 540;

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

/**
 * On platforms without mouse passthrough the HUD overlay is a compact fallback
 * window that must grow while it is interactive, otherwise popovers such as the
 * camera, source and microphone menus are clipped by the window bounds.
 *
 * Returns the fallback expansion to apply, or `null` when the platform uses
 * real mouse passthrough and the window therefore never needs to resize.
 */
export function getHudOverlayFallbackExpansionForInteraction(
	mousePassthroughSupported: boolean,
	ignoreMouse: boolean,
): boolean | null {
	if (mousePassthroughSupported) {
		return null;
	}

	return !ignoreMouse;
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
