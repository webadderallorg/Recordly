export type Rectangle = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type PixelCaptureRegion = Rectangle & {
	scaleFactor: number;
};

export type Point = { x: number; y: number };

const MIN_CAPTURE_SIZE = 2;

function clamp(value: number, minimum: number, maximum: number) {
	return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Keep a display-local region inside its display and normalize negative drag
 * directions. Electron display coordinates are density-independent points.
 */
export function normalizeCaptureRegion(region: Rectangle, displayBounds: Rectangle): Rectangle {
	const rawLeft = region.width < 0 ? region.x + region.width : region.x;
	const rawTop = region.height < 0 ? region.y + region.height : region.y;
	const rawWidth = Math.abs(region.width);
	const rawHeight = Math.abs(region.height);
	const left = clamp(rawLeft, 0, Math.max(0, displayBounds.width - MIN_CAPTURE_SIZE));
	const top = clamp(rawTop, 0, Math.max(0, displayBounds.height - MIN_CAPTURE_SIZE));
	const width = clamp(
		rawWidth,
		MIN_CAPTURE_SIZE,
		Math.max(MIN_CAPTURE_SIZE, displayBounds.width - left),
	);
	const height = clamp(
		rawHeight,
		MIN_CAPTURE_SIZE,
		Math.max(MIN_CAPTURE_SIZE, displayBounds.height - top),
	);

	return { x: left, y: top, width, height };
}

/** Convert Electron points into even physical pixels suitable for H.264 encoders. */
export function toPixelCaptureRegion(
	region: Rectangle,
	displayBounds: Rectangle,
	scaleFactor: number,
): PixelCaptureRegion {
	const normalized = normalizeCaptureRegion(region, displayBounds);
	const resolvedScaleFactor = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
	const maxWidth = Math.max(
		MIN_CAPTURE_SIZE,
		Math.floor(displayBounds.width * resolvedScaleFactor),
	);
	const maxHeight = Math.max(
		MIN_CAPTURE_SIZE,
		Math.floor(displayBounds.height * resolvedScaleFactor),
	);
	const x = clamp(Math.round(normalized.x * resolvedScaleFactor), 0, maxWidth - MIN_CAPTURE_SIZE);
	const y = clamp(
		Math.round(normalized.y * resolvedScaleFactor),
		0,
		maxHeight - MIN_CAPTURE_SIZE,
	);
	const makeEven = (value: number) => Math.max(MIN_CAPTURE_SIZE, Math.floor(value / 2) * 2);
	const width = Math.min(
		makeEven(normalized.width * resolvedScaleFactor),
		makeEven(maxWidth - x),
	);
	const height = Math.min(
		makeEven(normalized.height * resolvedScaleFactor),
		makeEven(maxHeight - y),
	);

	return { x, y, width, height, scaleFactor: resolvedScaleFactor };
}

export function normalizePointWithinRegion(point: Point, region: Rectangle) {
	return {
		cx: clamp((point.x - region.x) / Math.max(1, region.width), 0, 1),
		cy: clamp((point.y - region.y) / Math.max(1, region.height), 0, 1),
	};
}
