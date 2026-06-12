export type SceneStyleMode = "fill" | "framed";

export interface SceneStyleEvent {
	timeMs: number;
	mode: SceneStyleMode;
}

export interface FillFrameRegion {
	id: string;
	startMs: number;
	endMs: number;
}

/** Duration of the framed <-> fill animation, centered on each region boundary. */
export const FILL_FRAME_TRANSITION_MS = 400;

function isValidEvent(event: SceneStyleEvent): boolean {
	return (
		Number.isFinite(event.timeMs) &&
		event.timeMs >= 0 &&
		(event.mode === "fill" || event.mode === "framed")
	);
}

/**
 * Converts recording-time toggle events into fill-frame regions. Recording
 * starts in "framed" mode implicitly; an unterminated fill segment runs to
 * MAX_SAFE_INTEGER (renderers clamp to the video duration).
 */
export function eventsToFillFrameRegions(events: SceneStyleEvent[]): FillFrameRegion[] {
	const sorted = events.filter(isValidEvent).sort((a, b) => a.timeMs - b.timeMs);
	const regions: FillFrameRegion[] = [];
	let openStartMs: number | null = null;

	for (const event of sorted) {
		if (event.mode === "fill") {
			if (openStartMs === null) {
				openStartMs = event.timeMs;
			}
		} else if (openStartMs !== null) {
			if (event.timeMs > openStartMs) {
				regions.push({
					id: `fill-frame-${openStartMs}-${event.timeMs}`,
					startMs: openStartMs,
					endMs: event.timeMs,
				});
			}
			openStartMs = null;
		}
	}

	if (openStartMs !== null) {
		regions.push({
			id: `fill-frame-${openStartMs}-end`,
			startMs: openStartMs,
			endMs: Number.MAX_SAFE_INTEGER,
		});
	}

	return regions;
}

export function isFillFrameAtMs(regions: FillFrameRegion[], timeMs: number): boolean {
	return regions.some((region) => timeMs >= region.startMs && timeMs < region.endMs);
}

function smoothstep(x: number): number {
	const t = Math.min(1, Math.max(0, x));
	return t * t * (3 - 2 * t);
}

/**
 * Eased fill-frame progress at a moment: 0 outside all regions, 1 deep
 * inside, and a smoothstep ramp centered on each region boundary (half the
 * transition before the boundary, half after). Ramps are capped at the region
 * midpoint so very short regions still peak at 1.
 */
export function fillFrameProgressAtMs(
	regions: FillFrameRegion[],
	timeMs: number,
	transitionMs = FILL_FRAME_TRANSITION_MS,
): number {
	if (transitionMs <= 0) {
		return isFillFrameAtMs(regions, timeMs) ? 1 : 0;
	}

	const half = transitionMs / 2;
	let progress = 0;

	for (const region of regions) {
		const midMs = (region.startMs + region.endMs) / 2;
		const rampInStartMs = region.startMs - half;
		const rampInEndMs = Math.min(region.startMs + half, midMs);
		const rampOutStartMs = Math.max(region.endMs - half, midMs);
		const rampOutEndMs = region.endMs + half;
		if (timeMs <= rampInStartMs || timeMs >= rampOutEndMs) continue;

		const rampIn = smoothstep((timeMs - rampInStartMs) / (rampInEndMs - rampInStartMs));
		const rampOut = smoothstep((rampOutEndMs - timeMs) / (rampOutEndMs - rampOutStartMs));
		progress = Math.max(progress, Math.min(rampIn, rampOut));
	}

	return progress;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Sanitizes persisted/imported regions: keeps well-formed entries, clamps and
 * rounds times, sorts by start, and drops overlaps (the earlier region wins).
 */
export function normalizeFillFrameRegions(value: unknown): FillFrameRegion[] {
	if (!Array.isArray(value)) return [];

	const candidates = value
		.filter((region): region is FillFrameRegion =>
			Boolean(
				region &&
					typeof region === "object" &&
					typeof (region as FillFrameRegion).id === "string" &&
					isFiniteNumber((region as FillFrameRegion).startMs) &&
					isFiniteNumber((region as FillFrameRegion).endMs) &&
					(region as FillFrameRegion).startMs < (region as FillFrameRegion).endMs,
			),
		)
		.map((region) => ({
			id: region.id,
			startMs: Math.max(0, Math.round(region.startMs)),
			endMs: Math.round(region.endMs),
		}))
		.filter((region) => region.startMs < region.endMs)
		.sort((a, b) => a.startMs - b.startMs);

	const regions: FillFrameRegion[] = [];
	let previousEndMs = Number.NEGATIVE_INFINITY;
	for (const region of candidates) {
		if (region.startMs < previousEndMs) continue;
		regions.push(region);
		previousEndMs = region.endMs;
	}
	return regions;
}

/**
 * Starts a fill-frame region at the playhead, running to the next region (or
 * endLimitMs). Returns the regions unchanged when the playhead is already
 * inside a region or there is no room before the limit.
 */
export function startFillFrameRegionAtMs(
	regions: FillFrameRegion[],
	timeMs: number,
	endLimitMs: number,
): FillFrameRegion[] {
	if (isFillFrameAtMs(regions, timeMs)) return regions;

	let endMs = endLimitMs;
	for (const region of regions) {
		if (region.startMs >= timeMs && region.startMs < endMs) {
			endMs = region.startMs;
		}
	}
	if (endMs <= timeMs) return regions;

	return [...regions, { id: `fill-frame-${timeMs}-${endMs}`, startMs: timeMs, endMs }].sort(
		(a, b) => a.startMs - b.startMs,
	);
}

/**
 * Ends the active fill-frame region at the playhead by truncating its end
 * (dropping it when that empties the region). Unchanged outside any region.
 */
export function endFillFrameRegionAtMs(
	regions: FillFrameRegion[],
	timeMs: number,
): FillFrameRegion[] {
	if (!isFillFrameAtMs(regions, timeMs)) return regions;

	const next: FillFrameRegion[] = [];
	for (const region of regions) {
		if (timeMs >= region.startMs && timeMs < region.endMs) {
			if (timeMs > region.startMs) {
				next.push({ ...region, endMs: timeMs });
			}
		} else {
			next.push(region);
		}
	}
	return next;
}
