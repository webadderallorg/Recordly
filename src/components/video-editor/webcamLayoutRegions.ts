export type WebcamLayoutMode = "screen" | "camera-full";

export interface WebcamLayoutEvent {
	timeMs: number;
	mode: WebcamLayoutMode;
}

export interface WebcamLayoutRegion {
	id: string;
	startMs: number;
	endMs: number;
}

interface SizeLike {
	width: number;
	height: number;
}

export interface LetterboxRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Shared padding fraction used by both the preview and export renderers for camera-full layout. */
export const CAMERA_FULL_PADDING_FRACTION = 0.04;

export type WebcamLayoutStyle = "fit" | "fill";

export const MIN_WEBCAM_LAYOUT_REGION_MS = 100;

export function normalizeWebcamLayoutStyle(value: unknown): WebcamLayoutStyle {
	return value === "fill" ? "fill" : "fit";
}

/** Largest content-aspect rect that fully covers the frame, centered (crops overflow). */
export function getCoverRect(content: SizeLike, frame: SizeLike): LetterboxRect {
	if (
		!Number.isFinite(content.width) ||
		!Number.isFinite(content.height) ||
		content.width <= 0 ||
		content.height <= 0
	) {
		return { x: 0, y: 0, width: frame.width, height: frame.height };
	}
	const scale = Math.max(frame.width / content.width, frame.height / content.height);
	const width = content.width * scale;
	const height = content.height * scale;
	return {
		x: (frame.width - width) / 2,
		y: (frame.height - height) / 2,
		width,
		height,
	};
}

/**
 * Smallest rect with the frame's aspect ratio that contains (or, when the
 * source is too small on an axis, covers as much as possible of) the given
 * rect, centered on the rect and clamped to the source bounds.
 *
 * Used by the camera-full "fill" style: the webcam crop region is stored as a
 * pixel-square viewport for the corner bubble, so cover-fitting it directly
 * into a 16:9 frame would discard ~44% of the crop. Expanding the crop to the
 * frame aspect first keeps the user's chosen focal center while showing as
 * much of the camera as the frame allows (a ~16:9 camera filling a 16:9
 * output barely crops). Shared by the preview and the export renderer so both
 * produce the same framing.
 */
export function expandRectToAspect(
	rect: LetterboxRect,
	source: SizeLike,
	frame: SizeLike,
): LetterboxRect {
	const aspect = frame.width / frame.height;
	if (
		!Number.isFinite(aspect) ||
		aspect <= 0 ||
		!Number.isFinite(source.width) ||
		!Number.isFinite(source.height) ||
		source.width <= 0 ||
		source.height <= 0 ||
		rect.width <= 0 ||
		rect.height <= 0
	) {
		return { ...rect };
	}

	// Grow the short axis to reach the frame aspect, then clamp to the source
	// while preserving the aspect (the off-axis shrinks if the source is too
	// small to contain the expansion).
	let width = Math.max(rect.width, rect.height * aspect);
	let height = width / aspect;
	if (width > source.width) {
		width = source.width;
		height = width / aspect;
	}
	if (height > source.height) {
		height = source.height;
		width = height * aspect;
	}

	const centerX = rect.x + rect.width / 2;
	const centerY = rect.y + rect.height / 2;
	const x = Math.min(Math.max(centerX - width / 2, 0), Math.max(0, source.width - width));
	const y = Math.min(Math.max(centerY - height / 2, 0), Math.max(0, source.height - height));

	return { x, y, width, height };
}

/**
 * Clamps a dragged/resized camera segment span against its neighbors and the
 * video duration. Returns null when the span cannot fit anywhere valid.
 */
export function clampWebcamLayoutSpan(
	span: { startMs: number; endMs: number },
	regions: WebcamLayoutRegion[],
	ownId: string,
	durationMs: number,
): { startMs: number; endMs: number } | null {
	const others = regions
		.filter((region) => region.id !== ownId)
		.sort((a, b) => a.startMs - b.startMs);

	let startMs = Math.max(0, Math.round(span.startMs));
	let endMs = Math.min(durationMs, Math.round(span.endMs));

	for (const other of others) {
		// Clamp the span out of each overlapping neighbor, preferring the side
		// the span already leans toward.
		const overlaps = startMs < other.endMs && endMs > other.startMs;
		if (!overlaps) continue;
		if (startMs >= other.startMs) {
			startMs = Math.max(startMs, other.endMs);
		} else {
			endMs = Math.min(endMs, other.startMs);
		}
	}

	// If clamping inverted the span (startMs pushed past endMs), placement is impossible.
	if (startMs >= endMs) return null;

	if (endMs - startMs < MIN_WEBCAM_LAYOUT_REGION_MS) {
		endMs = startMs + MIN_WEBCAM_LAYOUT_REGION_MS;
		if (endMs > durationMs) return null;
		// Re-check the stretched span against neighbors.
		for (const other of others) {
			if (startMs < other.endMs && endMs > other.startMs) return null;
		}
	}

	return { startMs, endMs };
}

function isValidEvent(event: WebcamLayoutEvent): boolean {
	return (
		Number.isFinite(event.timeMs) &&
		event.timeMs >= 0 &&
		(event.mode === "screen" || event.mode === "camera-full")
	);
}

/**
 * Converts recording-time toggle events into camera-full regions. Recording
 * starts in "screen" mode implicitly; an unterminated camera-full segment
 * runs to MAX_SAFE_INTEGER (renderers clamp to the video duration).
 */
export function eventsToWebcamLayoutRegions(events: WebcamLayoutEvent[]): WebcamLayoutRegion[] {
	const sorted = events.filter(isValidEvent).sort((a, b) => a.timeMs - b.timeMs);
	const regions: WebcamLayoutRegion[] = [];
	let openStartMs: number | null = null;

	for (const event of sorted) {
		if (event.mode === "camera-full") {
			if (openStartMs === null) {
				openStartMs = event.timeMs;
			}
		} else if (openStartMs !== null) {
			if (event.timeMs > openStartMs) {
				regions.push({
					id: `webcam-layout-${openStartMs}-${event.timeMs}`,
					startMs: openStartMs,
					endMs: event.timeMs,
				});
			}
			openStartMs = null;
		}
	}

	if (openStartMs !== null) {
		regions.push({
			id: `webcam-layout-${openStartMs}-end`,
			startMs: openStartMs,
			endMs: Number.MAX_SAFE_INTEGER,
		});
	}

	return regions;
}

export function isCameraFullAtMs(regions: WebcamLayoutRegion[], timeMs: number): boolean {
	return regions.some((region) => timeMs >= region.startMs && timeMs < region.endMs);
}

/** Largest content-aspect rect centered inside frame minus padding on all sides. */
export function getLetterboxRect(
	content: SizeLike,
	frame: SizeLike,
	paddingPx: number,
): LetterboxRect {
	const availableWidth = Math.max(0, frame.width - paddingPx * 2);
	const availableHeight = Math.max(0, frame.height - paddingPx * 2);
	if (
		!Number.isFinite(content.width) ||
		!Number.isFinite(content.height) ||
		content.width <= 0 ||
		content.height <= 0
	) {
		return { x: paddingPx, y: paddingPx, width: availableWidth, height: availableHeight };
	}

	const scale = Math.min(availableWidth / content.width, availableHeight / content.height);
	const width = content.width * scale;
	const height = content.height * scale;
	return {
		x: paddingPx + (availableWidth - width) / 2,
		y: paddingPx + (availableHeight - height) / 2,
		width,
		height,
	};
}
