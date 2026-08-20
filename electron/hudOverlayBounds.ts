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

/**
 * While recording, Windows pins the HUD to a small, always-interactive window
 * because focus changes there silently corrupt the WS_EX_TRANSPARENT flag that
 * backs setIgnoreMouseEvents forwarding, which would leave the stop button
 * unclickable.  Every other platform keeps the full-work-area click-through
 * overlay: shrinking it to a fixed rectangle turns the transparent margins
 * around the bar into a dead zone that swallows clicks aimed at the app being
 * recorded, and the bar can only be dragged inside that rectangle so moving it
 * never frees the blocked area.
 */
export function recordingForcesHudOverlayFallback({
	platform,
	recordingActive,
}: {
	platform: string;
	recordingActive: boolean;
}): boolean {
	return recordingActive && platform === "win32";
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
