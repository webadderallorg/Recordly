import { drawSquircleOnCanvas, getSquircleSvgPath } from "@/lib/geometry/squircle";
import type { WebcamShape } from "./types";
import { getWebcamShapeExponent } from "./webcamOverlay";

// A translucent bevel catches light without covering the camera image. Widths
// scale with the camera, so preview and full-resolution exports agree.
const GLASS_STOPS = [
	[0, "rgba(255,255,255,0.8)"],
	[0.35, "rgba(255,255,255,0.24)"],
	[0.65, "rgba(15,23,42,0.16)"],
	[1, "rgba(255,255,255,0.5)"],
] as const;

export function getWebcamGlassRimWidth(width: number, height: number): number {
	return Math.max(0, Math.min(width, height)) * 0.012;
}

let cachedImage: { key: string; image: string } | undefined;

export function getWebcamGlassRimImage(
	width: number,
	height: number,
	radius: number,
	shape?: WebcamShape,
): string {
	const key = `${width}:${height}:${radius}:${shape}`;
	if (cachedImage?.key === key) return cachedImage.image;
	const path = getSquircleSvgPath({
		x: 0,
		y: 0,
		width,
		height,
		radius,
		exponent: getWebcamShapeExponent(shape),
	});
	const rim = getWebcamGlassRimWidth(width, height);
	const stops = GLASS_STOPS.map(
		([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`,
	).join("");
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="${height}">${stops}</linearGradient><clipPath id="c"><path d="${path}"/></clipPath></defs><g clip-path="url(#c)" fill="none"><path d="${path}" stroke="url(#g)" stroke-width="${rim * 2}"/><path d="${path}" stroke="rgba(255,255,255,0.55)" stroke-width="${rim * 0.4}"/></g></svg>`;
	const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
	cachedImage = { key, image };
	return image;
}

export function drawWebcamGlassRim(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	radius: number,
	shape?: WebcamShape,
): void {
	if (width <= 0 || height <= 0) return;
	ctx.save();
	drawSquircleOnCanvas(ctx, {
		x: 0,
		y: 0,
		width,
		height,
		radius,
		exponent: getWebcamShapeExponent(shape),
	});
	ctx.clip();
	const gradient = ctx.createLinearGradient(0, 0, width, height);
	for (const [offset, color] of GLASS_STOPS) gradient.addColorStop(offset, color);
	const rim = getWebcamGlassRimWidth(width, height);
	ctx.strokeStyle = gradient;
	ctx.lineWidth = rim * 2;
	ctx.stroke();
	ctx.strokeStyle = "rgba(255,255,255,0.55)";
	ctx.lineWidth = rim * 0.4;
	ctx.stroke();
	ctx.restore();
}
