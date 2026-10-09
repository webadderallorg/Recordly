export const PLATE_MIN_ALPHA = 0.5;

const NAMED_COLORS: Record<string, string> = {
	white: "#ffffff",
	black: "#000000",
	red: "#ff0000",
	green: "#008000",
	blue: "#0000ff",
	yellow: "#ffff00",
	orange: "#ffa500",
	purple: "#800080",
	gray: "#808080",
	grey: "#808080",
};

export type Rgba = { r: number; g: number; b: number; a: number };

export type PlateCandidate = {
	type?: string;
	startMs: number;
	endMs: number;
	content?: string;
	textContent?: string;
	style?: { fillBox?: boolean; backgroundColor?: string };
};

export function parseColor(value: unknown): Rgba | null {
	if (typeof value !== "string") return null;
	let text = value.trim().toLowerCase();
	if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
	text = NAMED_COLORS[text] ?? text;
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text)?.[1];
	if (hex) {
		const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
		const n = Number.parseInt(full, 16);
		return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
	}
	const rgb =
		/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
	if (!rgb) return null;
	const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
	const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
	if (r > 255 || g > 255 || b > 255 || !(a >= 0 && a <= 1)) return null;
	return { r, g, b, a };
}

function luminance({ r, g, b }: Rgba) {
	const [lr, lg, lb] = [r, g, b].map((channel) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: Rgba, b: Rgba) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

export function isPlate(annotation: PlateCandidate) {
	if (annotation.type !== "text" || !annotation.style?.fillBox) return false;
	if ((annotation.textContent ?? annotation.content ?? "").trim()) return false;
	const fill = parseColor(annotation.style.backgroundColor);
	return fill !== null && fill.a >= PLATE_MIN_ALPHA;
}

export function cardSpans(annotations: PlateCandidate[]) {
	return annotations.filter(isPlate).map(({ startMs, endMs }) => ({ startMs, endMs }));
}
