import { getSquirclePathPoints } from "../../../src/lib/geometry/squircle";

export function isPointInsidePolygon(
	x: number,
	y: number,
	points: Array<{ x: number; y: number }>,
) {
	let inside = false;
	for (
		let index = 0, previousIndex = points.length - 1;
		index < points.length;
		previousIndex = index++
	) {
		const current = points[index];
		const previous = points[previousIndex];
		const intersects =
			current.y > y !== previous.y > y &&
			x < ((previous.x - current.x) * (y - current.y)) / (previous.y - current.y) + current.x;

		if (intersects) {
			inside = !inside;
		}
	}

	return inside;
}

export function createNativeSquircleMaskPgmBuffer(
	width: number,
	height: number,
	radius: number,
): Buffer {
	const safeWidth = Math.max(1, Math.round(width));
	const safeHeight = Math.max(1, Math.round(height));
	const clampedRadius = Math.min(Math.max(0, radius), Math.min(safeWidth, safeHeight) / 2);
	const header = Buffer.from(`P5\n${safeWidth} ${safeHeight}\n255\n`, "ascii");
	const pixels = Buffer.alloc(safeWidth * safeHeight, 255);

	if (clampedRadius <= 0.5) {
		return Buffer.concat([header, pixels]);
	}

	const points = getSquirclePathPoints({
		x: 0,
		y: 0,
		width: safeWidth,
		height: safeHeight,
		radius: clampedRadius,
	});
	const samples = [
		[0.25, 0.25],
		[0.75, 0.25],
		[0.25, 0.75],
		[0.75, 0.75],
	] as const;

	for (let y = 0; y < safeHeight; y += 1) {
		for (let x = 0; x < safeWidth; x += 1) {
			let coveredSamples = 0;
			for (const [sampleX, sampleY] of samples) {
				if (isPointInsidePolygon(x + sampleX, y + sampleY, points)) {
					coveredSamples += 1;
				}
			}
			pixels[y * safeWidth + x] = Math.round((coveredSamples / samples.length) * 255);
		}
	}

	return Buffer.concat([header, pixels]);
}
