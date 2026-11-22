import type { WebcamShape } from "./types";
import { getWebcamShapeSvgPath, traceWebcamShapeOnCanvas } from "./webcamShapePath";

/** The wallpaper tiles' translucent outline; image refraction is a separate effect. */
export const GLASS_RIM_COLOR = "rgb(255 255 255 / 26%)";
/** Layout pixels at a 300px short edge; proportional scaling preserves export parity. */
export const WEBCAM_GLASS_RIM_WIDTH = 0.75;

export function getWebcamGlassRimWidth(width: number, height: number): number {
	const size = Math.min(width, height);
	return Number.isFinite(size) ? (Math.max(0, size) / 300) * WEBCAM_GLASS_RIM_WIDTH : 0;
}

interface WebcamGlassContour {
	x?: number;
	y?: number;
	width: number;
	height: number;
	radius: number;
	shape?: WebcamShape;
}

export function getWebcamGlassRimPath(contour: WebcamGlassContour): string {
	return getWebcamShapeSvgPath({ x: 0, y: 0, ...contour });
}

/** Call inside the footage's shape clip, so the centered stroke paints inward only. */
export function drawWebcamGlassRim(ctx: CanvasRenderingContext2D, contour: WebcamGlassContour) {
	const width = getWebcamGlassRimWidth(contour.width, contour.height);
	if (width <= 0) return;
	ctx.save();
	ctx.beginPath();
	traceWebcamShapeOnCanvas(ctx, { x: 0, y: 0, ...contour });
	ctx.strokeStyle = GLASS_RIM_COLOR;
	ctx.lineWidth = width * 2;
	ctx.stroke();
	ctx.restore();
}
