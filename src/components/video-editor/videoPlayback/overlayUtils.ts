import { ZOOM_DEPTH_SCALES, type CropRegion, type ZoomFocus, type ZoomRegion } from "../types";
import { clampFocusToStage, projectZoomFocusToViewport } from "./focusUtils";

interface OverlayUpdateParams {
	overlayEl: HTMLDivElement;
	indicatorEl: HTMLDivElement;
	region: ZoomRegion | null;
	focusOverride?: ZoomFocus;
	baseMask: { x: number; y: number; width: number; height: number; sourceCrop?: CropRegion };
	isPlaying: boolean;
}

export function updateOverlayIndicator(params: OverlayUpdateParams) {
	const { overlayEl, indicatorEl, region, focusOverride, baseMask, isPlaying } = params;

	if (!region || region.mode === "auto") {
		indicatorEl.style.display = "none";
		overlayEl.style.pointerEvents = "none";
		return;
	}

	const stageWidth = overlayEl.clientWidth;
	const stageHeight = overlayEl.clientHeight;

	if (!stageWidth || !stageHeight) {
		indicatorEl.style.display = "none";
		overlayEl.style.pointerEvents = "none";
		return;
	}

	if (!baseMask.width || !baseMask.height) {
		indicatorEl.style.display = "none";
		overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
		return;
	}

	const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
	const focus = clampFocusToStage(
		focusOverride ?? projectZoomFocusToViewport(region, baseMask.sourceCrop),
		region.depth,
		{
			width: stageWidth,
			height: stageHeight,
		},
	);

	const indicatorWidth = baseMask.width / zoomScale;
	const indicatorHeight = baseMask.height / zoomScale;

	const rawLeft = baseMask.x + focus.cx * baseMask.width - indicatorWidth / 2;
	const rawTop = baseMask.y + focus.cy * baseMask.height - indicatorHeight / 2;

	const adjustedLeft =
		indicatorWidth >= baseMask.width
			? baseMask.x + (baseMask.width - indicatorWidth) / 2
			: Math.max(baseMask.x, Math.min(baseMask.x + baseMask.width - indicatorWidth, rawLeft));

	const adjustedTop =
		indicatorHeight >= baseMask.height
			? baseMask.y + (baseMask.height - indicatorHeight) / 2
			: Math.max(
					baseMask.y,
					Math.min(baseMask.y + baseMask.height - indicatorHeight, rawTop),
				);

	indicatorEl.style.display = "block";
	indicatorEl.style.width = `${indicatorWidth}px`;
	indicatorEl.style.height = `${indicatorHeight}px`;
	indicatorEl.style.left = `${adjustedLeft}px`;
	indicatorEl.style.top = `${adjustedTop}px`;
	overlayEl.style.pointerEvents = isPlaying ? "none" : "auto";
}
