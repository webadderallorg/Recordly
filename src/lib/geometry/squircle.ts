import type { Graphics } from "pixi.js";

interface SquircleRect {
	x: number;
	y: number;
	width: number;
	height: number;
	radius: number;
	exponent?: number;
}

interface SquirclePoint {
	x: number;
	y: number;
}

// CSS corner-shape: squircle is a quarter superellipse with exponent 4.
const SQUIRCLE_EXPONENT = 4;

// Match the cutout of the old arc at the corner's diagonal.
export const SQUIRCLE_RADIUS_SCALE = 1.84;

export function getSquircleCssRadius(radius: number | string): string {
	const length = typeof radius === "number" ? `${radius}px` : radius;
	return `calc(${length} * var(--recordly-corner-radius-scale, 1))`;
}

export function getClampedCornerRadius(width: number, height: number, radius: number) {
	const limit = Math.min(width, height) / 2;
	if (!Number.isFinite(limit) || !Number.isFinite(radius)) return 0;
	return Math.max(0, Math.min(radius, limit));
}

export function getSquirclePathPoints({
	x,
	y,
	width,
	height,
	radius,
	exponent = SQUIRCLE_EXPONENT,
}: SquircleRect): SquirclePoint[] {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return [];

	const r = getClampedCornerRadius(width, height, radius);
	const right = x + width;
	const bottom = y + height;
	if (r === 0) {
		return [
			{ x, y },
			{ x: right, y },
			{ x: right, y: bottom },
			{ x, y: bottom },
		];
	}

	// More segments on large corners keep their edges smooth at export resolution.
	const segments = Math.min(96, Math.max(8, 2 * Math.ceil(Math.sqrt(r))));
	const topRight: SquirclePoint[] = [];
	const bottomRight: SquirclePoint[] = [];
	const bottomLeft: SquirclePoint[] = [];
	const topLeft: SquirclePoint[] = [];
	for (let index = 0; index <= segments; index += 1) {
		const angle = (Math.PI / 2) * (index / segments);
		const u = index === 0 ? 0 : Math.sin(angle);
		const v = index === segments ? 0 : Math.cos(angle);
		const scale = r / (u ** exponent + v ** exponent) ** (1 / exponent);
		const dx = u * scale;
		const dy = v * scale;

		// Include both tangencies so the path between corners stays straight.
		topRight.push({ x: right - r + dx, y: y + (r - dy) });
		bottomRight.push({ x: right - (r - dy), y: bottom - r + dx });
		bottomLeft.push({ x: x + r - dx, y: bottom - (r - dy) });
		topLeft.push({ x: x + (r - dy), y: y + r - dx });
	}

	const points = [...topRight, ...bottomRight, ...bottomLeft, ...topLeft];
	return points.filter((point, index) => {
		const previous = points[(index + points.length - 1) % points.length];
		return point.x !== previous.x || point.y !== previous.y;
	});
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

export function drawSquircleOnCanvas(ctx: CanvasRenderingContext2D, rect: SquircleRect) {
	const points = getSquirclePathPoints(rect);
	ctx.beginPath();
	if (points.length === 0) {
		return;
	}

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
