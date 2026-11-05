export type CaptionRgb = readonly [number, number, number];
export type CaptionColor = { rgb: CaptionRgb; alpha: number };

export function parseCaptionColor(value: string | null): CaptionColor | null {
	if (!value) return null;
	const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
	if (hex) {
		const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
		return {
			rgb: [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as CaptionRgb,
			alpha: 1,
		};
	}
	const rgba = value.match(/^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/i);
	return rgba
		? { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4] ?? 1) }
		: null;
}

export function compositeCaptionColor(color: CaptionColor, behind: CaptionRgb): CaptionRgb {
	return color.rgb.map(
		(channel, i) => channel * color.alpha + behind[i] * (1 - color.alpha),
	) as unknown as CaptionRgb;
}

export function captionContrastRatio(a: CaptionRgb, b: CaptionRgb) {
	const luminance = (rgb: CaptionRgb) =>
		rgb
			.map((value) => {
				const channel = value / 255;
				return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			})
			.reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
	const x = luminance(a),
		y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Preserve the chosen color when readable; otherwise use the stronger neutral. */
export function readableCaptionColor(requested: string, backgrounds: readonly CaptionRgb[]) {
	const minimum = (rgb: CaptionRgb) =>
		Math.min(...backgrounds.map((bg) => captionContrastRatio(rgb, bg)));
	const color = parseCaptionColor(requested);
	if (color && minimum(color.rgb) >= 4.5) return requested;
	return minimum([255, 255, 255]) >= minimum([0, 0, 0]) ? "#FFFFFF" : "#000000";
}
