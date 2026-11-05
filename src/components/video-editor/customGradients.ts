export interface CustomGradient {
	angle: number;
	colors: string[];
}

export const DEFAULT_CUSTOM_GRADIENT: CustomGradient = {
	angle: 135,
	colors: ["#635bff", "#22d3ee"],
};
export const MAX_GRADIENT_COLORS = 5;
const MAX_CUSTOM_GRADIENTS = 50;
const HEX_COLOR = /^#[\da-f]{6}$/i;

export function createCustomGradient({ angle, colors }: CustomGradient): string {
	const direction = ((Math.round(angle) % 360) + 360) % 360;
	const stops = colors.map(
		(color, index) =>
			`${color.toLowerCase()} ${Number(((index / (colors.length - 1)) * 100).toFixed(2))}%`,
	);
	return `linear-gradient(${direction}deg, ${stops.join(", ")})`;
}

/** Only accept the bounded, plain-color gradients authored by our controls. */
export function parseCustomGradient(value: unknown): CustomGradient | null {
	if (typeof value !== "string" || value.length > 500) return null;
	const match = value.match(/^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg,\s*(.+)\)$/);
	if (!match) return null;
	const angle = Number(match[1]);
	if (!Number.isFinite(angle)) return null;
	const stops = match[2].split(",").map((stop) => stop.trim());
	if (stops.length < 2 || stops.length > MAX_GRADIENT_COLORS) return null;
	const colors: string[] = [];
	for (const [index, stop] of stops.entries()) {
		const parts = stop.split(/\s+/);
		const expected = (index / (stops.length - 1)) * 100;
		if (
			parts.length !== 2 ||
			!HEX_COLOR.test(parts[0]) ||
			!/^\d+(?:\.\d+)?%$/.test(parts[1]) ||
			Math.abs(Number(parts[1].slice(0, -1)) - expected) > 0.01
		)
			return null;
		colors.push(parts[0].toLowerCase());
	}
	return { angle: ((Math.round(angle) % 360) + 360) % 360, colors };
}

export function normalizeCustomGradients(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const gradients = value.flatMap((item) => {
		const parsed = parseCustomGradient(item);
		return parsed ? [createCustomGradient(parsed)] : [];
	});
	return [...new Set(gradients)].slice(0, MAX_CUSTOM_GRADIENTS);
}
