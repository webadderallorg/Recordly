/**
 * Auto key-color detection (CorridorKey-style heuristic): sample the frame's
 * border ring — where the screen lives, away from the speaker — and find the
 * dominant saturated green or blue chroma cluster. Returns null when no
 * confident screen color exists so callers can fall back to the eyedropper.
 */

import { rgbToCbCr } from "./chromaKeyMath";

/** Fraction of width/height treated as the border sampling ring. */
const BORDER_RING_FRACTION = 0.18;
/** Minimum chroma magnitude for a pixel to count as "screen-colored". */
const MIN_CHROMA_MAGNITUDE = 0.08;
/** Minimum fraction of ring pixels that must agree for a confident result. */
const MIN_CLUSTER_FRACTION = 0.2;

function isScreenChroma(cb: number, cr: number): "green" | "blue" | null {
	if (Math.hypot(cb, cr) < MIN_CHROMA_MAGNITUDE) {
		return null;
	}
	// Green screens: strongly negative Cr with negative Cb.
	if (cr < -MIN_CHROMA_MAGNITUDE * 0.75 && cb < 0.05) {
		return "green";
	}
	// Blue screens: strongly positive Cb.
	if (cb > MIN_CHROMA_MAGNITUDE && cr < 0.05) {
		return "blue";
	}
	return null;
}

/**
 * Detects the dominant screen color from RGBA pixel data (e.g. a canvas
 * getImageData of the webcam frame). Returns "#rrggbb" or null when no
 * dominant green/blue screen region is found.
 */
export function detectKeyColorFromPixels(
	data: Uint8ClampedArray,
	width: number,
	height: number,
): string | null {
	if (width <= 0 || height <= 0 || data.length < width * height * 4) {
		return null;
	}

	const ringX = Math.max(1, Math.round(width * BORDER_RING_FRACTION));
	const ringY = Math.max(1, Math.round(height * BORDER_RING_FRACTION));
	// Subsample for speed; the ring of a 1080p frame is still thousands of pixels.
	const step = Math.max(1, Math.round(Math.min(width, height) / 240));

	let sampled = 0;
	const clusters: Record<"green" | "blue", { count: number; r: number; g: number; b: number }> = {
		green: { count: 0, r: 0, g: 0, b: 0 },
		blue: { count: 0, r: 0, g: 0, b: 0 },
	};

	for (let y = 0; y < height; y += step) {
		const inYRing = y < ringY || y >= height - ringY;
		for (let x = 0; x < width; x += step) {
			if (!inYRing && x >= ringX && x < width - ringX) {
				continue;
			}
			sampled += 1;
			const i = (y * width + x) * 4;
			const r = data[i] / 255;
			const g = data[i + 1] / 255;
			const b = data[i + 2] / 255;
			const { cb, cr } = rgbToCbCr({ r, g, b });
			const kind = isScreenChroma(cb, cr);
			if (kind) {
				const cluster = clusters[kind];
				cluster.count += 1;
				cluster.r += r;
				cluster.g += g;
				cluster.b += b;
			}
		}
	}

	if (sampled === 0) {
		return null;
	}

	const winner = clusters.green.count >= clusters.blue.count ? clusters.green : clusters.blue;
	if (winner.count / sampled < MIN_CLUSTER_FRACTION) {
		return null;
	}

	const toHex = (v: number) =>
		Math.round(Math.min(1, Math.max(0, v / winner.count)) * 255)
			.toString(16)
			.padStart(2, "0");
	return `#${toHex(winner.r)}${toHex(winner.g)}${toHex(winner.b)}`;
}
