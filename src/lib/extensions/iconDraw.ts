import * as PhosphorIcons from "@phosphor-icons/react";

type IconWeight = "thin" | "light" | "regular" | "bold" | "fill";
const missingIconPathCache = new Set<string>();

function resolveIconComponent(name: string): {
	iconName: string;
	icon: { render?: (props: { weight: string }, ref: unknown) => unknown };
} | null {
	const iconLibrary = PhosphorIcons as Record<string, unknown>;
	const iconName =
		typeof iconLibrary[name] !== "undefined"
			? name
			: typeof iconLibrary[`${name}Icon`] !== "undefined"
				? `${name}Icon`
				: null;
	if (!iconName) {
		return null;
	}

	return {
		iconName,
		icon: iconLibrary[iconName] as {
			render?: (props: { weight: string }, ref: unknown) => unknown;
		},
	};
}

function toNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

function parsePointList(value: unknown): Array<{ x: number; y: number }> {
	if (typeof value !== "string") return [];
	const nums = value
		.trim()
		.split(/[\s,]+/)
		.map((part) => Number(part))
		.filter((n) => Number.isFinite(n));
	const points: Array<{ x: number; y: number }> = [];
	for (let i = 0; i + 1 < nums.length; i += 2) {
		points.push({ x: nums[i], y: nums[i + 1] });
	}
	return points;
}

function collectPathData(node: unknown, output: Path2D): number {
	if (!node) return 0;
	if (Array.isArray(node)) {
		let added = 0;
		for (const child of node) added += collectPathData(child, output);
		return added;
	}
	if (typeof node !== "object") return 0;

	const maybeNode = node as {
		type?: unknown;
		props?: {
			d?: unknown;
			children?: unknown;
			x1?: unknown;
			y1?: unknown;
			x2?: unknown;
			y2?: unknown;
			points?: unknown;
			cx?: unknown;
			cy?: unknown;
			r?: unknown;
			rx?: unknown;
			ry?: unknown;
			x?: unknown;
			y?: unknown;
			width?: unknown;
			height?: unknown;
		};
	};
	const props = maybeNode.props;

	let added = 0;
	if (maybeNode.type === "path" && typeof props?.d === "string") {
		output.addPath(new Path2D(props.d));
		added += 1;
	} else if (maybeNode.type === "line") {
		const x1 = toNumber(props?.x1);
		const y1 = toNumber(props?.y1);
		const x2 = toNumber(props?.x2);
		const y2 = toNumber(props?.y2);
		if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
			output.moveTo(x1, y1);
			output.lineTo(x2, y2);
			added += 1;
		}
	} else if (maybeNode.type === "polyline" || maybeNode.type === "polygon") {
		const points = parsePointList(props?.points);
		if (points.length > 0) {
			output.moveTo(points[0].x, points[0].y);
			for (let i = 1; i < points.length; i += 1) {
				output.lineTo(points[i].x, points[i].y);
			}
			if (maybeNode.type === "polygon") {
				output.closePath();
			}
			added += 1;
		}
	} else if (maybeNode.type === "circle") {
		const cx = toNumber(props?.cx);
		const cy = toNumber(props?.cy);
		const r = toNumber(props?.r);
		if (cx !== null && cy !== null && r !== null) {
			output.arc(cx, cy, r, 0, Math.PI * 2);
			added += 1;
		}
	} else if (maybeNode.type === "ellipse") {
		const cx = toNumber(props?.cx);
		const cy = toNumber(props?.cy);
		const rx = toNumber(props?.rx);
		const ry = toNumber(props?.ry);
		if (cx !== null && cy !== null && rx !== null && ry !== null) {
			output.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
			added += 1;
		}
	} else if (maybeNode.type === "rect") {
		const x = toNumber(props?.x) ?? 0;
		const y = toNumber(props?.y) ?? 0;
		const width = toNumber(props?.width);
		const height = toNumber(props?.height);
		const rxRaw = toNumber(props?.rx);
		const ryRaw = toNumber(props?.ry);
		if (width !== null && height !== null) {
			const resolvedRxRaw = rxRaw ?? ryRaw ?? 0;
			const resolvedRyRaw = ryRaw ?? rxRaw ?? 0;
			const rx = Math.max(0, Math.min(resolvedRxRaw, width / 2));
			const ry = Math.max(0, Math.min(resolvedRyRaw, height / 2));
			if (rx === 0 && ry === 0) {
				output.rect(x, y, width, height);
			} else {
				const right = x + width;
				const bottom = y + height;
				output.moveTo(x + rx, y);
				output.lineTo(right - rx, y);
				output.ellipse(right - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
				output.lineTo(right, bottom - ry);
				output.ellipse(right - rx, bottom - ry, rx, ry, 0, 0, Math.PI / 2);
				output.lineTo(x + rx, bottom);
				output.ellipse(x + rx, bottom - ry, rx, ry, 0, Math.PI / 2, Math.PI);
				output.lineTo(x, y + ry);
				output.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, (3 * Math.PI) / 2);
				output.closePath();
			}
			added += 1;
		}
	}
	added += collectPathData(props?.children, output);
	return added;
}

export function resolveIconPath(
	name: string,
	weight: IconWeight,
	cache: Map<string, Path2D>,
): Path2D | null {
	const cacheKey = `${name}:${weight}`;
	if (missingIconPathCache.has(cacheKey)) {
		return null;
	}
	const cached = cache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const resolved = resolveIconComponent(name);
	if (!resolved) {
		console.warn(`[extensions] Icon ${name} not found in Phosphor library`);
		missingIconPathCache.add(cacheKey);
		return null;
	}

	try {
		const element = resolved.icon.render?.({ weight }, null) as
			| { props?: { weights?: Map<string, { props?: { children?: unknown } }> } }
			| undefined;
		const weights = element?.props?.weights;
		const definition = weights?.get(weight);
		const children = definition?.props?.children;
		const combinedPath = new Path2D();
		const shapeCount = collectPathData(children, combinedPath);

		if (shapeCount === 0) {
			console.warn(`[extensions] No path data found for ${name}:${weight}`, {
				iconName: resolved.iconName,
				element,
				children,
			});
			missingIconPathCache.add(cacheKey);
			return null;
		}
		cache.set(cacheKey, combinedPath);
		return combinedPath;
	} catch (err) {
		console.error(`[extensions] Failed to extract path for icon ${name}:`, err);
		missingIconPathCache.add(cacheKey);
		return null;
	}
}
