export interface HudOverlayWorkArea {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface HudOverlayRegion {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const NON_PASSTHROUGH_HUD_WIDTH_DIP = 860;
const NON_PASSTHROUGH_HUD_COMPACT_HEIGHT_DIP = 160;
const NON_PASSTHROUGH_HUD_EXPANDED_HEIGHT_DIP = 540;

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function getX11HudRecordingShape(
	regions: HudOverlayRegion[],
	{ width, height }: Pick<HudOverlayWorkArea, "width" | "height">,
): HudOverlayWorkArea[] {
	// The X11 shape clips painting as well as hit testing. Leave room for shadows.
	const padding = 8;
	return regions.flatMap((region) => {
		if (!region) return [];
		const { left, top, right, bottom } = region;
		if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
			return [];
		}
		const x = clamp(Math.floor(left - padding), 0, width);
		const y = clamp(Math.floor(top - padding), 0, height);
		const endX = clamp(Math.ceil(right + padding), 0, width);
		const endY = clamp(Math.ceil(bottom + padding), 0, height);
		return endX > x && endY > y ? [{ x, y, width: endX - x, height: endY - y }] : [];
	});
}

export function getHudOverlayWindowBounds(
	workArea: HudOverlayWorkArea,
	mousePassthroughSupported: boolean,
	fallbackExpanded = false,
	draggedBounds?: HudOverlayWorkArea,
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

	if (draggedBounds) {
		return {
			width,
			height,
			x: clamp(draggedBounds.x, workArea.x, workArea.x + workArea.width - width),
			y: clamp(
				draggedBounds.y + draggedBounds.height - height,
				workArea.y,
				workArea.y + workArea.height - height,
			),
		};
	}

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
	return getHudOverlayWindowBounds(workArea, false, fallbackExpanded, currentBounds);
}
