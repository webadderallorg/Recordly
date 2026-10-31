export type AreaRect = { x: number; y: number; width: number; height: number };
export type AreaHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const AREA_HANDLES: AreaHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** Matches MIN_CAPTURE_AREA_SIZE in electron/ipc/sourceArea.ts. */
export const MIN_AREA_SIZE = 32;

type Bounds = { width: number; height: number };

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

/**
 * Puts the origin at the top-left corner when a drag went up or left, and keeps
 * the rectangle inside the overlay.
 */
export function normalizeAreaRect(rect: AreaRect, bounds: Bounds): AreaRect {
	const left = clamp(Math.min(rect.x, rect.x + rect.width), 0, bounds.width);
	const right = clamp(Math.max(rect.x, rect.x + rect.width), 0, bounds.width);
	const top = clamp(Math.min(rect.y, rect.y + rect.height), 0, bounds.height);
	const bottom = clamp(Math.max(rect.y, rect.y + rect.height), 0, bounds.height);
	return {
		x: Math.round(left),
		y: Math.round(top),
		width: Math.round(right - left),
		height: Math.round(bottom - top),
	};
}

/** Moves the rectangle by a drag offset without letting it leave the overlay. */
export function moveAreaRect(rect: AreaRect, dx: number, dy: number, bounds: Bounds): AreaRect {
	return {
		...rect,
		x: clamp(Math.round(rect.x + dx), 0, Math.max(0, bounds.width - rect.width)),
		y: clamp(Math.round(rect.y + dy), 0, Math.max(0, bounds.height - rect.height)),
	};
}

/** Drags one edge or corner; dragging past the opposite edge flips the rectangle. */
export function resizeAreaRect(
	rect: AreaRect,
	handle: AreaHandle,
	dx: number,
	dy: number,
	bounds: Bounds,
): AreaRect {
	let left = rect.x;
	let top = rect.y;
	let right = rect.x + rect.width;
	let bottom = rect.y + rect.height;
	if (handle.includes("w")) left += dx;
	if (handle.includes("e")) right += dx;
	if (handle.includes("n")) top += dy;
	if (handle.includes("s")) bottom += dy;
	return normalizeAreaRect(
		{ x: left, y: top, width: right - left, height: bottom - top },
		bounds,
	);
}

export function rectContains(rect: AreaRect, x: number, y: number): boolean {
	return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

/** The frontmost entry under the point, from a list ordered front to back. */
export function frontmostAt<T extends { rect: AreaRect }>(
	entries: T[],
	x: number,
	y: number,
): T | null {
	return entries.find((entry) => rectContains(entry.rect, x, y)) ?? null;
}
