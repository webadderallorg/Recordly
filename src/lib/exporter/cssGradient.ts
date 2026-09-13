export interface CssColorStop {
	color: string;
	offset: number;
}

export interface LinearGradientGeometry {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface RadialGradientGeometry {
	cx: number;
	cy: number;
	radius: number;
}

type RadialSize = "closest-side" | "farthest-side" | "closest-corner" | "farthest-corner";

const LINEAR_PRELUDE_PATTERN = /^(to\s|[-+]?[\d.]+(deg|rad|turn|grad)\b)/i;
const RADIAL_PRELUDE_PATTERN = /^(circle|ellipse|closest-|farthest-|at\s)/i;
const COLOR_TOKEN_PATTERN =
	/^(#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^)]*\)|[a-z]+)/i;

/** Splits CSS function arguments on top-level commas, keeping `rgba(1, 2, 3)` intact. */
export function splitCssGradientArguments(params: string): string[] {
	const parts: string[] = [];
	let current = "";
	let depth = 0;

	for (const char of params) {
		if (char === "(") depth++;
		if (char === ")") depth = Math.max(0, depth - 1);
		if (char === "," && depth === 0) {
			parts.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current.trim());

	return parts.filter(Boolean);
}

function parsePercentOrPx(token: string, referenceLength: number): number | null {
	const match = token.match(/^([-+]?[\d.]+)(%|px)?$/);
	if (!match) {
		return null;
	}
	const value = Number.parseFloat(match[1]);
	if (match[2] === "px") {
		return referenceLength > 0 ? value / referenceLength : 0;
	}
	return value / 100;
}

function parseColorStop(
	part: string,
	referenceLength: number,
): { color: string; offsets: number[] } | null {
	const colorMatch = part.match(COLOR_TOKEN_PATTERN);
	if (!colorMatch) {
		return null;
	}
	const offsets = part
		.slice(colorMatch[0].length)
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((token) => parsePercentOrPx(token, referenceLength))
		.filter((offset): offset is number => offset !== null);
	return { color: colorMatch[0], offsets };
}

/** Resolves CSS color stops into canvas offsets in [0, 1], interpolating missing positions. */
export function resolveColorStops(parts: string[], referenceLength: number): CssColorStop[] {
	const stops: Array<{ color: string; offset: number | null }> = [];
	for (const part of parts) {
		const parsed = parseColorStop(part, referenceLength);
		if (!parsed) continue;
		if (parsed.offsets.length === 0) {
			stops.push({ color: parsed.color, offset: null });
			continue;
		}
		for (const offset of parsed.offsets) {
			stops.push({ color: parsed.color, offset });
		}
	}
	if (stops.length === 0) {
		return [];
	}

	stops[0].offset ??= 0;
	stops[stops.length - 1].offset ??= 1;
	fillMissingOffsets(stops);

	let previousOffset = 0;
	return stops.map(({ color, offset }) => {
		previousOffset = Math.max(previousOffset, offset ?? previousOffset);
		return { color, offset: Math.min(1, Math.max(0, previousOffset)) };
	});
}

function fillMissingOffsets(stops: Array<{ offset: number | null }>): void {
	let lastKnownIndex = 0;
	for (let index = 1; index < stops.length; index++) {
		const offset = stops[index].offset;
		if (offset === null) continue;
		const startOffset = stops[lastKnownIndex].offset ?? 0;
		const gap = index - lastKnownIndex;
		for (let missing = 1; missing < gap; missing++) {
			stops[lastKnownIndex + missing].offset =
				startOffset + ((offset - startOffset) * missing) / gap;
		}
		lastKnownIndex = index;
	}
}

function parseAngleDegrees(token: string): number | null {
	const match = token.match(/^([-+]?[\d.]+)(deg|rad|turn|grad)$/i);
	if (!match) {
		return null;
	}
	const value = Number.parseFloat(match[1]);
	const unit = match[2].toLowerCase();
	if (unit === "rad") return (value * 180) / Math.PI;
	if (unit === "turn") return value * 360;
	if (unit === "grad") return value * 0.9;
	return value;
}

function parseSideOrCornerDegrees(prelude: string, width: number, height: number): number {
	const sides = prelude
		.toLowerCase()
		.replace(/^to\s+/, "")
		.split(/\s+/);
	const horizontal = sides.includes("right") ? 1 : sides.includes("left") ? -1 : 0;
	const vertical = sides.includes("bottom") ? 1 : sides.includes("top") ? -1 : 0;
	// Corner directions point perpendicular to the opposite diagonal, per the CSS spec.
	const dx = vertical === 0 ? horizontal : horizontal * height;
	const dy = horizontal === 0 ? vertical : vertical * width;
	return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

export function getLinearGradientGeometry(
	angleDegrees: number,
	width: number,
	height: number,
): LinearGradientGeometry {
	const radians = (angleDegrees * Math.PI) / 180;
	const directionX = Math.sin(radians);
	const directionY = -Math.cos(radians);
	const halfLength = (Math.abs(width * directionX) + Math.abs(height * directionY)) / 2;
	const centerX = width / 2;
	const centerY = height / 2;
	return {
		x0: centerX - directionX * halfLength,
		y0: centerY - directionY * halfLength,
		x1: centerX + directionX * halfLength,
		y1: centerY + directionY * halfLength,
	};
}

function parsePositionComponent(token: string | undefined, length: number): number {
	const keywordOffsets: Record<string, number> = {
		left: 0,
		top: 0,
		center: 0.5,
		right: 1,
		bottom: 1,
	};
	if (!token) {
		return length / 2;
	}
	const keyword = keywordOffsets[token.toLowerCase()];
	if (keyword !== undefined) {
		return keyword * length;
	}
	const offset = parsePercentOrPx(token, length);
	return offset === null ? length / 2 : offset * length;
}

function getRadialRadius(
	size: RadialSize,
	cx: number,
	cy: number,
	width: number,
	height: number,
): number {
	const sideDistances = [cx, width - cx, cy, height - cy].map(Math.abs);
	const cornerDistances = [
		[0, 0],
		[width, 0],
		[0, height],
		[width, height],
	].map(([x, y]) => Math.hypot(x - cx, y - cy));
	if (size === "closest-side") return Math.min(...sideDistances);
	if (size === "farthest-side") return Math.max(...sideDistances);
	if (size === "closest-corner") return Math.min(...cornerDistances);
	return Math.max(...cornerDistances);
}

/**
 * Canvas radial gradients are circular, so ellipse shapes are approximated by a circle of
 * the same sizing keyword; explicit radius lengths fall back to farthest-corner.
 */
export function getRadialGradientGeometry(
	prelude: string,
	width: number,
	height: number,
): RadialGradientGeometry {
	const [shapeAndSize, position = ""] = prelude.toLowerCase().split(/\bat\b/);
	const size = (shapeAndSize.match(/(closest|farthest)-(side|corner)/)?.[0] ??
		"farthest-corner") as RadialSize;
	const [xToken, yToken] = position.trim().split(/\s+/).filter(Boolean);
	const cx = parsePositionComponent(xToken, width);
	const cy = parsePositionComponent(yToken, height);
	return { cx, cy, radius: Math.max(1, getRadialRadius(size, cx, cy, width, height)) };
}

function splitPrelude(
	type: "linear" | "radial",
	parts: string[],
): { prelude: string | null; stopParts: string[] } {
	const pattern = type === "linear" ? LINEAR_PRELUDE_PATTERN : RADIAL_PRELUDE_PATTERN;
	if (parts.length > 0 && pattern.test(parts[0])) {
		return { prelude: parts[0], stopParts: parts.slice(1) };
	}
	return { prelude: null, stopParts: parts };
}

function createLinearCanvasGradient(
	ctx: CanvasRenderingContext2D,
	prelude: string | null,
	size: { width: number; height: number },
): { gradient: CanvasGradient; lineLength: number } {
	const angle = !prelude
		? 180
		: (parseAngleDegrees(prelude) ??
			parseSideOrCornerDegrees(prelude, size.width, size.height));
	const { x0, y0, x1, y1 } = getLinearGradientGeometry(angle, size.width, size.height);
	return {
		gradient: ctx.createLinearGradient(x0, y0, x1, y1),
		lineLength: Math.hypot(x1 - x0, y1 - y0),
	};
}

/** Builds a canvas gradient matching a CSS `linear-gradient()` / `radial-gradient()` string. */
export function createCanvasGradientFromCss(
	ctx: CanvasRenderingContext2D,
	css: string,
	size: { width: number; height: number },
): CanvasGradient | null {
	const match = css.trim().match(/^(linear|radial)-gradient\((.+)\)$/is);
	if (!match) {
		return null;
	}
	const type = match[1].toLowerCase() as "linear" | "radial";
	const { prelude, stopParts } = splitPrelude(type, splitCssGradientArguments(match[2]));

	let gradient: CanvasGradient;
	let referenceLength: number;
	if (type === "linear") {
		({ gradient, lineLength: referenceLength } = createLinearCanvasGradient(
			ctx,
			prelude,
			size,
		));
	} else {
		const { cx, cy, radius } = getRadialGradientGeometry(
			prelude ?? "",
			size.width,
			size.height,
		);
		gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
		referenceLength = radius;
	}

	const stops = resolveColorStops(stopParts, referenceLength);
	if (stops.length === 0) {
		return null;
	}
	addColorStops(gradient, stops);
	return gradient;
}

function addColorStops(gradient: CanvasGradient, stops: CssColorStop[]): void {
	const validStops = stops.filter(({ color, offset }) => {
		try {
			gradient.addColorStop(offset, color);
			return true;
		} catch (error) {
			console.warn(`[cssGradient] Skipping invalid color stop "${color}":`, error);
			return false;
		}
	});
	if (validStops.length === 1) {
		gradient.addColorStop(validStops[0].offset === 0 ? 1 : 0, validStops[0].color);
	}
}
