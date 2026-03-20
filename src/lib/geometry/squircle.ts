import type { Graphics } from "pixi.js";

interface SquircleRect {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
}

interface SquirclePoint {
	x: number;
	y: number;
}

const SQUIRCLE_EXPONENT = 4.5;
const SQUIRCLE_SEGMENTS_PER_CORNER = 10;

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function getClampedRadius(width: number, height: number, radius: number) {
	return clamp(radius, 0, Math.min(width, height) / 2);
}

function getSuperellipsePoint(
	centerX: number,
	centerY: number,
	radius: number,
	angle: number,
) {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	const exponent = 2 / SQUIRCLE_EXPONENT;

	return {
		x: centerX + Math.sign(cos) * radius * Math.pow(Math.abs(cos), exponent),
		y: centerY + Math.sign(sin) * radius * Math.pow(Math.abs(sin), exponent),
	};
}

export function getSquirclePathPoints({
	x,
	y,
	width,
	height,
	radius,
}: SquircleRect): SquirclePoint[] {
	if (width <= 0 || height <= 0) {
		return [];
	}

	const clampedRadius = getClampedRadius(width, height, radius);
	if (clampedRadius <= 0.5) {
		return [
			{ x, y },
			{ x: x + width, y },
			{ x: x + width, y: y + height },
			{ x, y: y + height },
		];
	}

	const points: SquirclePoint[] = [{ x: x + clampedRadius, y }];
	const corners = [
		{ centerX: x + width - clampedRadius, centerY: y + clampedRadius, start: -Math.PI / 2, end: 0 },
		{ centerX: x + width - clampedRadius, centerY: y + height - clampedRadius, start: 0, end: Math.PI / 2 },
		{ centerX: x + clampedRadius, centerY: y + height - clampedRadius, start: Math.PI / 2, end: Math.PI },
		{ centerX: x + clampedRadius, centerY: y + clampedRadius, start: Math.PI, end: (Math.PI * 3) / 2 },
	];

	for (const corner of corners) {
		for (let index = 1; index <= SQUIRCLE_SEGMENTS_PER_CORNER; index += 1) {
			const t = index / SQUIRCLE_SEGMENTS_PER_CORNER;
			const angle = corner.start + (corner.end - corner.start) * t;
			points.push(
				getSuperellipsePoint(
					corner.centerX,
					corner.centerY,
					clampedRadius,
					angle,
				),
			);
		}
	}

	return points;
}

export function getSquircleSvgPath(rect: SquircleRect) {
	const points = getSquirclePathPoints(rect);
	if (points.length === 0) {
		return "";
	}

	const [firstPoint, ...remainingPoints] = points;
	return `M ${firstPoint.x} ${firstPoint.y} ${remainingPoints
		.map((point) => `L ${point.x} ${point.y}`)
		.join(" ")} Z`;
}

export function drawSquircleOnCanvas(
	ctx: CanvasRenderingContext2D,
	rect: SquircleRect,
) {
	const points = getSquirclePathPoints(rect);
	if (points.length === 0) {
		return;
	}

	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let index = 1; index < points.length; index += 1) {
		ctx.lineTo(points[index].x, points[index].y);
	}
	ctx.closePath();
}

export function drawSquircleOnGraphics(graphics: Graphics, rect: SquircleRect) {
	const points = getSquirclePathPoints(rect);
	if (points.length === 0) {
		return;
	}

	graphics.moveTo(points[0].x, points[0].y);
	for (let index = 1; index < points.length; index += 1) {
		graphics.lineTo(points[index].x, points[index].y);
	}
	graphics.closePath();
}