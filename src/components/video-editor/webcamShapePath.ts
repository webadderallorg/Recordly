import { getSquirclePathPoints, getSquircleSvgPath } from "@/lib/geometry/squircle";
import type { WebcamShape } from "./types";
import { getWebcamShapeExponent } from "./webcamOverlay";

interface WebcamContour {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
	shape?: WebcamShape;
}

/** The same rounded arcs and square contour used by the Canvas compositor. */
export function getWebcamShapeSvgPath(contour: WebcamContour): string {
	const { x, y, width, height, shape } = contour;
	if (shape !== "circle" && shape !== "rectangle")
		return getSquircleSvgPath({ ...contour, exponent: getWebcamShapeExponent(shape) });
	const r = Math.max(0, Math.min(contour.radius, width / 2, height / 2));
	return `M ${x + r} ${y} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${y + r} V ${y + height - r} A ${r} ${r} 0 0 1 ${x + width - r} ${y + height} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + height - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

// Keep preview/compositor clipping consistent with CSS circle()/inset() curves.
/** Append one closed contour; callers begin the path and choose clip/fill. */
export function traceWebcamShapeOnCanvas(ctx: CanvasRenderingContext2D, contour: WebcamContour) {
	const { x, y, width, height, shape } = contour;
	if (shape === "circle" || shape === "rectangle") {
		const r = Math.max(0, Math.min(contour.radius, width / 2, height / 2));
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + width, y, x + width, y + height, r);
		ctx.arcTo(x + width, y + height, x, y + height, r);
		ctx.arcTo(x, y + height, x, y, r);
		ctx.arcTo(x, y, x + width, y, r);
		ctx.closePath();
		return;
	}
	const points = getSquirclePathPoints({ ...contour, exponent: getWebcamShapeExponent(shape) });
	if (!points.length) return;
	ctx.moveTo(points[0].x, points[0].y);
	for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
	ctx.closePath();
}
