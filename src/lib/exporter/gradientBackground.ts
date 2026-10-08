/**
 * Parsing for CSS gradient strings used as editor backgrounds so the export
 * pipeline can reproduce them on a canvas.
 *
 * The renderers used to parse gradients with a naive `params.split(",")`, which
 * is wrong for two reasons:
 *   1. It splits the commas *inside* `rgba()`/`hsla()` color functions, turning
 *      `rgba(114,167,232,1)` into the fragments `rgba(114`, `167`, `232`, `1)`.
 *      `addColorStop` then receives the literal `"rgba"` and throws, so the
 *      whole background fell back to solid black in the exported video.
 *   2. It used the split-token index for the colour-stop offset, so a leading
 *      direction token (`120deg`, `to right`, …) pushed the first colour to
 *      offset 0.5 instead of 0 and the explicit `0%/100%` stops were ignored.
 *
 * This module tokenizes the gradient parenthesis-aware, strips the optional
 * leading direction/shape descriptor, and honours explicit percentage stops
 * (distributing evenly when they are omitted) so exports match the editor
 * preview. It is pure (no canvas/DOM) and therefore unit-testable.
 */

export interface GradientColorStop {
	color: string;
	/** Normalized stop offset in the [0, 1] range. */
	position: number;
}

export interface ParsedGradientBackground {
	type: "linear" | "radial";
	stops: GradientColorStop[];
}

const GRADIENT_PATTERN = /^(linear|radial)-gradient\((.+)\)$/s;

// Leading token describing the gradient line for a linear gradient
// (`to bottom`, `120deg`, `0.25turn`, …) rather than a colour stop.
const LINEAR_DIRECTION_PATTERN = /^(to\s|[+-]?\d*\.?\d+(deg|grad|rad|turn)\b)/i;

// Leading token describing the shape/size/position of a radial gradient
// (`circle`, `ellipse farthest-corner`, `at 10% 20%`, a length/percentage, …).
const RADIAL_CONFIG_PATTERN =
	/^(circle\b|ellipse\b|closest-|farthest-|at\s|[+-]?\d*\.?\d+(px|%|em|rem|vw|vh|vmin|vmax)\b)/i;

// Colour at the start of a colour-stop token. rgba()/hsla() keep their inner
// commas intact because tokenization is parenthesis-aware.
const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)/;

// Trailing explicit stop position, e.g. the `43.9%` in `rgba(…) 43.9%`.
const PERCENT_POSITION_PATTERN = /(-?\d*\.?\d+)%\s*$/;

function splitTopLevelCommas(input: string): string[] {
	const tokens: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of input) {
		if (char === "(") {
			depth += 1;
		} else if (char === ")") {
			depth = Math.max(0, depth - 1);
		}
		if (char === "," && depth === 0) {
			tokens.push(current);
			current = "";
		} else {
			current += char;
		}
	}
	tokens.push(current);
	return tokens.map((token) => token.trim()).filter((token) => token.length > 0);
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	if (value < 0) {
		return 0;
	}
	if (value > 1) {
		return 1;
	}
	return value;
}

/**
 * Parses a CSS `linear-gradient(...)` / `radial-gradient(...)` string into the
 * gradient type and its normalized colour stops. Returns `null` when the input
 * is not a recognizable gradient or contains no usable colour stops.
 */
export function parseGradientBackground(value: string): ParsedGradientBackground | null {
	const match = value.trim().match(GRADIENT_PATTERN);
	if (!match) {
		return null;
	}

	const type = match[1] as "linear" | "radial";
	const tokens = splitTopLevelCommas(match[2]);
	if (tokens.length === 0) {
		return null;
	}

	// Drop a single leading direction/shape descriptor so it is not mistaken
	// for a colour stop (e.g. `to right` would otherwise match as the named
	// colour `to`).
	const directionPattern = type === "linear" ? LINEAR_DIRECTION_PATTERN : RADIAL_CONFIG_PATTERN;
	const colorTokens = directionPattern.test(tokens[0]) ? tokens.slice(1) : tokens;

	const rawStops = colorTokens
		.map((token) => {
			const colorMatch = token.match(COLOR_PATTERN);
			if (!colorMatch) {
				return null;
			}
			const positionMatch = token.match(PERCENT_POSITION_PATTERN);
			return {
				color: colorMatch[1],
				position: positionMatch ? Number(positionMatch[1]) / 100 : Number.NaN,
			};
		})
		.filter((stop): stop is { color: string; position: number } => stop !== null);

	const count = rawStops.length;
	if (count === 0) {
		return null;
	}

	// Resolve offsets: explicit percentages win, the first/last default to
	// 0/1, and interior gaps are interpolated between their neighbours (CSS
	// colour-stop semantics).
	const positions = rawStops.map((stop) => stop.position);
	if (Number.isNaN(positions[0])) {
		positions[0] = 0;
	}
	if (Number.isNaN(positions[count - 1])) {
		positions[count - 1] = count === 1 ? 0 : 1;
	}
	let index = 0;
	while (index < count) {
		if (!Number.isNaN(positions[index])) {
			index += 1;
			continue;
		}
		let end = index;
		while (end < count && Number.isNaN(positions[end])) {
			end += 1;
		}
		const previous = positions[index - 1];
		const next = positions[end];
		const span = end - (index - 1);
		for (let gap = index; gap < end; gap += 1) {
			positions[gap] = previous + ((next - previous) * (gap - (index - 1))) / span;
		}
		index = end;
	}

	// Clamp into [0, 1] and keep offsets non-decreasing so `addColorStop` never
	// rejects an out-of-range or out-of-order value.
	let runningMax = 0;
	const stops = rawStops.map((stop, stopIndex) => {
		let position = clamp01(positions[stopIndex]);
		if (position < runningMax) {
			position = runningMax;
		}
		runningMax = position;
		return { color: stop.color, position };
	});

	return { type, stops };
}
