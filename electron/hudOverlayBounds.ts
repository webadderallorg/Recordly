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

export const HUD_OVERLAY_CORNERS = [
	"top-left",
	"top-right",
	"bottom-left",
	"bottom-right",
	"bottom-center",
] as const;
export type HudOverlayCorner = (typeof HUD_OVERLAY_CORNERS)[number];

// "auto" lets the agent latch decide, "on" is always click-through, and "off" turns the
// agent latch off. "off" never makes the window swallow clicks: the pill is still only
// clickable where the renderer says it is.
export type HudClickThrough = "auto" | "on" | "off";

// The pill is drawn at the bottom-centre of its window, so a corner means parking the
// compact window in that corner rather than moving the pill inside a full-screen window.
export function getHudOverlayCornerBounds(
	workArea: HudOverlayWorkArea,
	corner: HudOverlayCorner,
	fallbackExpanded = false,
): HudOverlayWorkArea {
	const size = getHudOverlayWindowBounds(workArea, false, fallbackExpanded);
	const left = workArea.x;
	const right = workArea.x + workArea.width - size.width;
	const top = workArea.y;
	const bottom = workArea.y + workArea.height - size.height;
	const x = corner.endsWith("left")
		? left
		: corner.endsWith("right")
			? right
			: Math.round(workArea.x + (workArea.width - size.width) / 2);
	const y = corner.startsWith("top") ? top : bottom;
	return { ...size, x, y };
}

export function resolveHudOverlayIgnoreMouse(
	requested: boolean,
	state: {
		sourceSelectionActive: boolean;
		recordingActive: boolean;
		agentActive: boolean;
		clickThrough?: HudClickThrough;
	},
): boolean {
	if (state.clickThrough === "on") return true;
	if (state.agentActive && state.clickThrough !== "off") return true;
	return state.sourceSelectionActive && !state.recordingActive ? true : requested;
}
