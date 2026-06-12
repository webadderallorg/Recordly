/**
 * Pure per-pixel math for the webcam greenscreen pipeline.
 *
 * These functions are the reference implementation: the WebGL fragment shader
 * in webcamProcessor.ts mirrors these formulas exactly, so correctness is
 * unit-testable here without a GL context. Any constant or formula change
 * must be applied in both places.
 */

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export interface ColorAdjustments {
	/** -1..1, 0 = neutral */
	brightness: number;
	contrast: number;
	highlights: number;
	shadows: number;
	/** warm (+) / cool (-) white-balance shift */
	temperature: number;
	saturation: number;
}

export interface MaskRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Typical green-screen key color (slightly desaturated pure green). */
export const DEFAULT_KEY_COLOR: Rgb = { r: 0, g: 0.8, b: 0 };

/** Parses "#rrggbb" to normalized RGB; falls back to DEFAULT_KEY_COLOR. */
export function hexToRgb01(hex: string | null | undefined): Rgb {
	const match = typeof hex === "string" ? /^#([0-9a-f]{6})$/i.exec(hex) : null;
	if (!match) {
		return DEFAULT_KEY_COLOR;
	}
	const value = Number.parseInt(match[1], 16);
	return {
		r: ((value >> 16) & 0xff) / 255,
		g: ((value >> 8) & 0xff) / 255,
		b: (value & 0xff) / 255,
	};
}

/** keyStrength 0..1 maps to this chroma-distance tolerance range. */
export const KEY_TOLERANCE_MIN = 0.02;
export const KEY_TOLERANCE_MAX = 0.22;
/** edgeSoftness 0..1 maps to this transition-band width range. */
export const KEY_SOFTNESS_MIN = 0.01;
export const KEY_SOFTNESS_MAX = 0.18;
/** Fixed spill suppression amount (not user exposed). */
export const SPILL_FACTOR = 0.7;
/** mask feather 0..1 maps to a distance band of feather * FEATHER_SCALE. */
export const MASK_FEATHER_SCALE = 0.25;

export function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) {
		return x < edge0 ? 0 : 1;
	}
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** BT.601 chroma coordinates, centered at 0. */
export function rgbToCbCr(rgb: Rgb): { cb: number; cr: number } {
	return {
		cb: -0.169 * rgb.r - 0.331 * rgb.g + 0.5 * rgb.b,
		cr: 0.5 * rgb.r - 0.419 * rgb.g - 0.081 * rgb.b,
	};
}

export function luma(rgb: Rgb): number {
	return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
}

/**
 * Foreground alpha for a pixel: 0 = pure key color (removed), 1 = keep.
 * keyStrength widens the removed chroma range; edgeSoftness widens the
 * partial-alpha transition band.
 */
export function chromaKeyAlpha(
	pixel: Rgb,
	keyColor: Rgb,
	keyStrength: number,
	edgeSoftness: number,
): number {
	const p = rgbToCbCr(pixel);
	const k = rgbToCbCr(keyColor);
	const dist = Math.hypot(p.cb - k.cb, p.cr - k.cr);
	const tolerance = mix(KEY_TOLERANCE_MIN, KEY_TOLERANCE_MAX, keyStrength);
	const softness = mix(KEY_SOFTNESS_MIN, KEY_SOFTNESS_MAX, edgeSoftness);
	return smoothstep(tolerance, tolerance + softness, dist);
}

/**
 * Combined alpha across multiple key colors: a pixel matching ANY key color
 * is removed (minimum alpha wins). Used for unevenly lit screens where one
 * sample can't cover both the bright and shadowed regions.
 */
export function chromaKeyAlphaMulti(
	pixel: Rgb,
	keyColors: Rgb[],
	keyStrength: number,
	edgeSoftness: number,
): number {
	let alpha = 1;
	for (const keyColor of keyColors) {
		alpha = Math.min(alpha, chromaKeyAlpha(pixel, keyColor, keyStrength, edgeSoftness));
	}
	return alpha;
}

/**
 * Green-spill suppression on semi-transparent edge pixels: pulls the green
 * channel down toward max(r, b), proportional to how keyed the pixel is.
 * Never raises green.
 */
export function suppressSpill(pixel: Rgb, alpha: number): Rgb {
	const amount = (1 - alpha) * SPILL_FACTOR;
	if (amount === 0) {
		return pixel;
	}
	const limit = mix(pixel.g, Math.max(pixel.r, pixel.b), amount);
	return { r: pixel.r, g: Math.min(pixel.g, limit), b: pixel.b };
}

/**
 * Garbage-matte alpha at normalized point (x, y): 1 inside the rounded rect,
 * 0 outside, smooth across the feather band. cornerRadius 0..1 is relative to
 * the rect's shorter half-extent.
 */
export function maskAlpha(
	x: number,
	y: number,
	rect: MaskRect,
	cornerRadius: number,
	feather: number,
): number {
	const halfW = rect.width / 2;
	const halfH = rect.height / 2;
	if (halfW <= 0 || halfH <= 0) {
		return 1;
	}
	const radius = Math.min(1, Math.max(0, cornerRadius)) * Math.min(halfW, halfH);
	const cx = rect.x + halfW;
	const cy = rect.y + halfH;
	// Signed distance to a rounded rectangle.
	const qx = Math.abs(x - cx) - (halfW - radius);
	const qy = Math.abs(y - cy) - (halfH - radius);
	const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
	const inside = Math.min(Math.max(qx, qy), 0);
	const sd = outside + inside - radius;
	const band = Math.max(0, feather) * MASK_FEATHER_SCALE + 1e-4;
	return 1 - smoothstep(0, band, sd);
}

function clamp01(v: number): number {
	return Math.min(1, Math.max(0, v));
}

/** temperature 1.0 shifts red up / blue down by this much (and vice versa). */
export const TEMPERATURE_SHIFT = 0.15;

/**
 * Brightness/contrast/temperature/saturation/highlights/shadows, applied in
 * that order. Highlights only affect pixels with luma above mid gray; shadows
 * below. Exact identity when all settings are 0.
 */
export function applyColorAdjustments(pixel: Rgb, adjustments: ColorAdjustments): Rgb {
	const { brightness, contrast, highlights, shadows, temperature, saturation } = adjustments;
	let { r, g, b } = pixel;

	if (brightness !== 0) {
		const shift = brightness * 0.5;
		r += shift;
		g += shift;
		b += shift;
	}

	if (contrast !== 0) {
		const gain = 1 + contrast;
		r = (r - 0.5) * gain + 0.5;
		g = (g - 0.5) * gain + 0.5;
		b = (b - 0.5) * gain + 0.5;
	}

	if (temperature !== 0) {
		// Warm pushes red up and blue down; cool is the mirror image.
		r += temperature * TEMPERATURE_SHIFT;
		b -= temperature * TEMPERATURE_SHIFT;
	}

	if (saturation !== 0) {
		// Lerp away from (saturation < 0) or beyond (saturation > 0) the
		// grayscale point: -1 is fully desaturated, +1 doubles chroma.
		const l = luma({ r, g, b });
		const amount = 1 + saturation;
		r = l + (r - l) * amount;
		g = l + (g - l) * amount;
		b = l + (b - l) * amount;
	}

	if (highlights !== 0 || shadows !== 0) {
		const l = luma({ r, g, b });
		const highlightWeight = smoothstep(0.5, 1, l);
		const shadowWeight = 1 - smoothstep(0, 0.5, l);
		const shift = highlights * 0.5 * highlightWeight + shadows * 0.5 * shadowWeight;
		r += shift;
		g += shift;
		b += shift;
	}

	return { r: clamp01(r), g: clamp01(g), b: clamp01(b) };
}
