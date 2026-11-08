type GradientContext = Pick<
	CanvasRenderingContext2D,
	"createLinearGradient" | "createRadialGradient"
> &
	Partial<Pick<CanvasRenderingContext2D, "fillStyle">>;
type ColorStop = { color: string; position: number | null };

/** Split CSS function arguments without splitting rgb()/hsl() color components. */
function splitArguments(value: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < value.length; index++) {
		if (value[index] === "(") depth++;
		if (value[index] === ")") depth--;
		if (depth < 0) return [];
		if (value[index] === "," && depth === 0) {
			parts.push(value.slice(start, index).trim());
			start = index + 1;
		}
	}
	if (depth !== 0) return [];
	parts.push(value.slice(start).trim());
	return parts;
}

function parseStop(value: string): ColorStop[] | null {
	const match = value.match(
		/^(#[\da-f]{3,8}|(?:rgba?|hsla?)\([^()]+\)|[a-z]+)(?:\s+(-?\d*\.?\d+)%)?(?:\s+(-?\d*\.?\d+)%)?$/i,
	);
	if (!match) return null;
	const color = match[1];
	if (
		color.startsWith("#") &&
		!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)
	) {
		return null;
	}
	return [match[2], ...(match[3] === undefined ? [] : [match[3]])].map((position) => ({
		color,
		position: position === undefined ? null : Number(position) / 100,
	}));
}

/** CSS fixes decreasing positions, then evenly distributes omitted stops. */
function resolveStops(parts: string[]): Array<{ color: string; position: number }> | null {
	const stops: ColorStop[] = [];
	for (const part of parts) {
		const parsed = parseStop(part);
		if (!parsed) return null;
		stops.push(...parsed);
	}
	if (stops.length < 2) return null;
	stops[0].position ??= 0;
	stops[stops.length - 1].position ??= 1;
	let previousPosition = -Infinity;
	for (const stop of stops) {
		if (stop.position !== null) {
			if (!Number.isFinite(stop.position)) return null;
			stop.position = Math.max(previousPosition, stop.position);
			previousPosition = stop.position;
		}
	}
	let start = 0;
	for (let end = 1; end < stops.length; end++) {
		if (stops[end].position === null) continue;
		const from = stops[start].position!;
		const to = stops[end].position!;
		for (let index = start + 1; index < end; index++) {
			stops[index].position = from + ((to - from) * (index - start)) / (end - start);
		}
		start = end;
	}
	return stops as Array<{ color: string; position: number }>;
}

function linearDirection(header: string, width: number, height: number): number | null {
	header = header.toLowerCase();
	const angle = header.match(/^(-?\d*\.?\d+)(deg|turn|rad|grad)$/i);
	if (angle) {
		const value = Number(angle[1]);
		return (
			value *
			({ deg: Math.PI / 180, turn: Math.PI * 2, rad: 1, grad: Math.PI / 200 }[
				angle[2].toLowerCase()
			] ?? 0)
		);
	}
	const match = header.match(/^to\s+(top|bottom|left|right)(?:\s+(top|bottom|left|right))?$/i);
	if (!match) return null;
	const sides = match.slice(1).filter(Boolean);
	const horizontal = sides.includes("right") ? 1 : sides.includes("left") ? -1 : 0;
	const vertical = sides.includes("bottom") ? 1 : sides.includes("top") ? -1 : 0;
	if (sides.length === 2 && (!horizontal || !vertical)) return null;
	// Corner keywords use a gradient line perpendicular to the other diagonal.
	return Math.atan2(horizontal * (vertical ? height : 1), -vertical * (horizontal ? width : 1));
}

function radialGeometry(header: string, width: number, height: number) {
	header = header.toLowerCase();
	const match = header.match(
		/^circle(?:\s+(closest-side|farthest-side|closest-corner|farthest-corner))?(?:\s+at\s+(.+))?$/i,
	);
	if (!match) return null;
	const position = (match[2] ?? "50% 50%").trim().split(/\s+/);
	if (position.length > 2) return null;
	if (/^(top|bottom)$/i.test(position[0])) {
		if (position.length === 1) position.unshift("center");
		else position.reverse();
	}
	const coordinate = (value: string, size: number, low: string, high: string) => {
		if (value === low) return 0;
		if (value === high) return size;
		if (value === "center") return size / 2;
		if (/^-?\d*\.?\d+%$/.test(value)) return (Number.parseFloat(value) * size) / 100;
		if (/^-?\d*\.?\d+px$/.test(value)) return Number.parseFloat(value);
		return null;
	};
	const x = coordinate(position[0].toLowerCase(), width, "left", "right");
	const y = coordinate((position[1] ?? "center").toLowerCase(), height, "top", "bottom");
	if (x === null || y === null) return null;
	const distances = (match[1] ?? "farthest-corner").endsWith("side")
		? [Math.abs(x), Math.abs(width - x), Math.abs(y), Math.abs(height - y)]
		: [
				Math.hypot(x, y),
				Math.hypot(width - x, y),
				Math.hypot(x, height - y),
				Math.hypot(width - x, height - y),
			];
	const radius = (match[1] ?? "farthest-corner").startsWith("closest")
		? Math.min(...distances)
		: Math.max(...distances);
	return radius > 0 ? { x, y, radius } : null;
}

type Rgba = [number, number, number, number];
function parseRgba(color: string): Rgba | null {
	if (color === "transparent") return [0, 0, 0, 0];
	if (color.startsWith("#")) {
		let hex = color.slice(1);
		if (hex.length === 3 || hex.length === 4)
			hex = [...hex].map((value) => value + value).join("");
		if (hex.length === 6) hex += "ff";
		if (hex.length !== 8) return null;
		return [
			Number.parseInt(hex.slice(0, 2), 16),
			Number.parseInt(hex.slice(2, 4), 16),
			Number.parseInt(hex.slice(4, 6), 16),
			Number.parseInt(hex.slice(6, 8), 16) / 255,
		];
	}
	const match = color.match(/^rgba?\(([^)]+)\)$/i);
	if (!match) return null;
	const values = match[1].trim().split(/\s*[,/]\s*|\s+/);
	if (values.length !== 3 && values.length !== 4) return null;
	const rgb = values
		.slice(0, 3)
		.map((value) =>
			Math.max(0, Math.min(255, Number.parseFloat(value) * (value.endsWith("%") ? 2.55 : 1))),
		);
	const alphaValue = values[3] ?? "1";
	const alpha = Math.max(
		0,
		Math.min(1, Number.parseFloat(alphaValue) / (alphaValue.endsWith("%") ? 100 : 1)),
	);
	return [...rgb, alpha].every(Number.isFinite) ? [rgb[0], rgb[1], rgb[2], alpha] : null;
}

function rgbaColor(ctx: GradientContext, color: string): Rgba | null {
	const parsed = parseRgba(color);
	if (parsed || typeof ctx.fillStyle !== "string") return parsed;
	// Canvas canonicalizes named and HSL colors without a separate raster/readback.
	const previous = ctx.fillStyle;
	try {
		ctx.fillStyle = color;
		return parseRgba(ctx.fillStyle);
	} finally {
		ctx.fillStyle = previous;
	}
}

/** Canvas equivalent of the linear and circular radial gradients offered in the editor. */
export function createCssGradientBackground(
	ctx: GradientContext,
	css: string,
	width: number,
	height: number,
): CanvasGradient | null {
	if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return null;
	const match = css.trim().match(/^(linear|radial)-gradient\((.*)\)$/is);
	if (!match) return null;
	const type = match[1].toLowerCase();
	const parts = splitArguments(match[2]);
	let header = type === "linear" ? "180deg" : "circle farthest-corner";
	if (
		parts[0] &&
		(!parseStop(parts[0]) || (type === "radial" && /^circle(?:\s|$)/i.test(parts[0])))
	)
		header = parts.shift()!;
	const stops = resolveStops(parts);
	if (!stops) return null;
	try {
		let gradient: CanvasGradient;
		let minimum = Math.min(0, stops[0].position);
		let maximum = Math.max(1, stops[stops.length - 1].position);
		if (type === "linear") {
			const angle = linearDirection(header, width, height);
			if (angle === null || !Number.isFinite(angle)) return null;
			const dx = Math.sin(angle);
			const dy = -Math.cos(angle);
			const length = Math.abs(width * dx) + Math.abs(height * dy);
			gradient = ctx.createLinearGradient(
				width / 2 + dx * length * (minimum - 0.5),
				height / 2 + dy * length * (minimum - 0.5),
				width / 2 + dx * length * (maximum - 0.5),
				height / 2 + dy * length * (maximum - 0.5),
			);
		} else {
			const geometry = radialGeometry(header, width, height);
			// Negative circular radii need color interpolation at zero; unsupported here.
			if (!geometry || minimum < 0) return null;
			minimum = 0;
			maximum = Math.max(1, maximum);
			gradient = ctx.createRadialGradient(
				geometry.x,
				geometry.y,
				0,
				geometry.x,
				geometry.y,
				geometry.radius * maximum,
			);
		}
		const colors = stops.map((stop) => rgbaColor(ctx, stop.color));
		for (let index = 0; index < stops.length; index++) {
			const stop = stops[index];
			const previous = stops[index - 1];
			const from = colors[index - 1];
			const to = colors[index];
			if (previous && previous.position < stop.position && from && to && from[3] !== to[3]) {
				// CSS interpolates premultiplied alpha; CanvasGradient interpolates
				// straight colors. Intermediate stops preserve translucent presets.
				for (let sample = 1; sample < 32; sample++) {
					const progress = sample / 32;
					const alpha = from[3] * (1 - progress) + to[3] * progress;
					const rgb = [0, 1, 2].map((channel) =>
						alpha > 0
							? (from[channel] * from[3] * (1 - progress) +
									to[channel] * to[3] * progress) /
								alpha
							: 0,
					);
					const position =
						previous.position + (stop.position - previous.position) * progress;
					gradient.addColorStop(
						(position - minimum) / (maximum - minimum),
						`rgba(${rgb.join(",")},${alpha})`,
					);
				}
			}
			gradient.addColorStop((stop.position - minimum) / (maximum - minimum), stop.color);
		}
		return gradient;
	} catch {
		// Canvas validates color syntax; unsupported colors must not escape as exceptions.
		return null;
	}
}

export function drawCssGradientBackground(
	ctx: CanvasRenderingContext2D,
	css: string,
	width: number,
	height: number,
): boolean {
	const gradient = createCssGradientBackground(ctx, css, width, height);
	if (!gradient) return false;
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, width, height);
	return true;
}
