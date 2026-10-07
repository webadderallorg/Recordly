import type {
	AreaCapturePick,
	CaptureArea,
	CapturePick,
	CapturePickerWindow,
	SelectedSource,
} from "./types";

/** Smallest area worth recording, in points. */
export const MIN_CAPTURE_AREA_SIZE = 32;

type PickerDisplay = { id: number; bounds: CaptureArea };

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates what a capture-picker window reports. An area must have a usable size
 * and lie on the display it was drawn on; a window must be one the picker offered;
 * a screen must be a connected display.
 */
export function normalizeCapturePick(
	input: unknown,
	displays: PickerDisplay[],
	windows: CapturePickerWindow[],
): CapturePick | null {
	if (!input || typeof input !== "object") return null;
	const candidate = input as Record<string, unknown>;
	const record = candidate.record === true;
	const display = displays.find((entry) => entry.id === candidate.displayId);
	if (!display) return null;

	if (candidate.kind === "screen") {
		return { kind: "screen", displayId: display.id, record };
	}

	if (candidate.kind === "window") {
		const window = windows.find((entry) => entry.id === candidate.windowId);
		return window
			? { kind: "window", windowId: window.id, displayId: display.id, record }
			: null;
	}

	if (candidate.kind !== "area") return null;
	const { x, y, width, height } = candidate;
	if (
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		!isFiniteNumber(width) ||
		!isFiniteNumber(height)
	) {
		return null;
	}
	const left = Math.max(display.bounds.x, Math.round(x));
	const top = Math.max(display.bounds.y, Math.round(y));
	const right = Math.min(display.bounds.x + display.bounds.width, Math.round(x + width));
	const bottom = Math.min(display.bounds.y + display.bounds.height, Math.round(y + height));
	// Whole, even sizes map the area onto screen pixels one to one at any display
	// scale, so the recording is never resampled.
	const areaWidth = right - left - ((right - left) % 2);
	const areaHeight = bottom - top - ((bottom - top) % 2);
	if (areaWidth < MIN_CAPTURE_AREA_SIZE || areaHeight < MIN_CAPTURE_AREA_SIZE) {
		return null;
	}

	return {
		kind: "area",
		x: left,
		y: top,
		width: areaWidth,
		height: areaHeight,
		displayId: display.id,
		record,
	};
}

export function createAreaSource(pick: AreaCapturePick): SelectedSource {
	return {
		id: `area:${pick.displayId}`,
		name: `Area ${pick.width}×${pick.height}`,
		display_id: String(pick.displayId),
		sourceType: "area",
		area: { x: pick.x, y: pick.y, width: pick.width, height: pick.height },
	};
}

/** The same source the window list offers for this window. */
export function createWindowSource(window: CapturePickerWindow): SelectedSource {
	const title = window.title || window.appName || "Window";
	return {
		id: window.id,
		name: title,
		display_id: window.display_id ?? "",
		sourceType: "window",
		appName: window.appName || undefined,
		windowTitle: title,
	};
}

export function getSourceArea(source: SelectedSource | null | undefined): CaptureArea | null {
	if (!source?.id?.startsWith("area:") || !source.area) return null;
	const { x, y, width, height } = source.area;
	return [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
		? { x, y, width, height }
		: null;
}
