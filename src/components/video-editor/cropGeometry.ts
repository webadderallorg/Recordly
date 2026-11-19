import type { CropRegion } from "./types";

export type CropHandle = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move";
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const MIN = 0.02;

/** Fit a pixel aspect ratio inside a normalized crop, preserving its center. */
export function fitCropRatio(crop: CropRegion, ratio: number, sourceRatio: number): CropRegion {
	const r = ratio / sourceRatio;
	const width = Math.min(crop.width, crop.height * r);
	const height = width / r;
	return {
		x: crop.x + (crop.width - width) / 2,
		y: crop.y + (crop.height - height) / 2,
		width,
		height,
	};
}

/** Resize about the opposite edge/corner; ratio is measured in source pixels. */
export function dragCrop(
	crop: CropRegion,
	handle: CropHandle,
	dx: number,
	dy: number,
	ratio: number | null,
	sourceRatio: number,
): CropRegion {
	if (handle === "move")
		return {
			...crop,
			x: clamp(crop.x + dx, 0, 1 - crop.width),
			y: clamp(crop.y + dy, 0, 1 - crop.height),
		};
	const west = handle.includes("w"),
		east = handle.includes("e");
	const north = handle.includes("n"),
		south = handle.includes("s");
	let left = west
		? clamp(crop.x + dx, 0, crop.x + crop.width - Math.min(MIN, crop.width))
		: crop.x;
	let right = east
		? clamp(crop.x + crop.width + dx, crop.x + Math.min(MIN, crop.width), 1)
		: crop.x + crop.width;
	let top = north
		? clamp(crop.y + dy, 0, crop.y + crop.height - Math.min(MIN, crop.height))
		: crop.y;
	let bottom = south
		? clamp(crop.y + crop.height + dy, crop.y + Math.min(MIN, crop.height), 1)
		: crop.y + crop.height;
	if (ratio) {
		const r = ratio / sourceRatio;
		const ax = west ? right : east ? left : crop.x + crop.width / 2;
		const ay = north ? bottom : south ? top : crop.y + crop.height / 2;
		const maxWidth = west ? ax : east ? 1 - ax : 2 * Math.min(ax, 1 - ax);
		const maxHeight = north ? ay : south ? 1 - ay : 2 * Math.min(ay, 1 - ay);
		const requestedWidth =
			(west || east) && (!(north || south) || Math.abs(dx) >= Math.abs(dy * r))
				? right - left
				: (bottom - top) * r;
		const max = Math.min(maxWidth, maxHeight * r);
		const width = clamp(requestedWidth, Math.min(MIN, max), max);
		const height = width / r;
		left = west ? ax - width : east ? ax : ax - width / 2;
		right = left + width;
		top = north ? ay - height : south ? ay : ay - height / 2;
		bottom = top + height;
	}
	return { x: left, y: top, width: right - left, height: bottom - top };
}
