import { getClampedCornerRadius } from "../../../src/lib/geometry/squircle";

export function createNativeSquircleMaskPgmBuffer(
	width: number,
	height: number,
	radius: number,
): Buffer {
	const safeWidth = Math.max(1, Math.round(width));
	const safeHeight = Math.max(1, Math.round(height));
	const r = getClampedCornerRadius(safeWidth, safeHeight, radius);
	const header = Buffer.from(`P5\n${safeWidth} ${safeHeight}\n255\n`, "ascii");
	const pixels = Buffer.alloc(safeWidth * safeHeight, 255);

	const samples = [0.25, 0.75];
	const extent = Math.ceil(r);
	const radiusToFourth = r ** 4;
	// Rasterize one corner and mirror it. All pixels along the straight edges are opaque.
	const distances = Array.from({ length: extent }, (_, pixel) =>
		samples.map((offset) => Math.max(0, r - pixel - offset) ** 4),
	);
	for (let y = 0; y < extent; y += 1) {
		const topRow = y * safeWidth;
		const bottomRow = (safeHeight - 1 - y) * safeWidth;
		for (let x = 0; x < extent; x += 1) {
			let coverage = 0;
			for (const dx of distances[x]) {
				for (const dy of distances[y]) {
					// The same exponent-four corner as the preview and Canvas masks.
					if (dx + dy <= radiusToFourth) coverage += 1;
				}
			}
			const alpha = Math.round((coverage * 255) / 4);
			const right = safeWidth - 1 - x;
			pixels[topRow + x] = pixels[topRow + right] = alpha;
			pixels[bottomRow + x] = pixels[bottomRow + right] = alpha;
		}
	}

	return Buffer.concat([header, pixels]);
}
