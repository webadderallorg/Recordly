import type { Span } from "dnd-timeline";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "../../types";

export type RegionWithSpan = ZoomRegion | TrimRegion | ClipRegion | SpeedRegion | AudioRegion;

export function normalizeRegionSpans<T extends RegionWithSpan>(
	regions: T[],
	totalMs: number,
	safeMinDurationMs: number,
	onSpanChange?: (id: string, span: Span) => void,
) {
	if (!onSpanChange || totalMs === 0 || safeMinDurationMs <= 0) {
		return;
	}

	for (const region of regions) {
		const clampedStart = Math.max(0, Math.min(region.startMs, totalMs));
		const minEnd = clampedStart + safeMinDurationMs;
		const clampedEnd = Math.min(totalMs, Math.max(minEnd, region.endMs));
		const normalizedStart = Math.max(0, Math.min(clampedStart, totalMs - safeMinDurationMs));
		const normalizedEnd = Math.max(minEnd, Math.min(clampedEnd, totalMs));

		if (normalizedStart !== region.startMs || normalizedEnd !== region.endMs) {
			onSpanChange(region.id, { start: normalizedStart, end: normalizedEnd });
		}
	}
}

export function deleteSelectedRegion(
	selectedId: string | null | undefined,
	onDelete: ((id: string) => void) | undefined,
	onSelect: ((id: string | null) => void) | undefined,
) {
	if (!selectedId || !onDelete || !onSelect) return;
	onDelete(selectedId);
	onSelect(null);
}

export function hasOverlapForSpan(
	newSpan: Span,
	excludeId: string | undefined,
	annotationRegions: AnnotationRegion[],
	zoomRegions: ZoomRegion[],
	trimRegions: TrimRegion[],
	clipRegions: ClipRegion[],
	speedRegions: SpeedRegion[],
	audioRegions: AudioRegion[],
) {
	if (annotationRegions.some((region) => region.id === excludeId)) {
		return false;
	}

	const checkOverlap = (regions: RegionWithSpan[]) =>
		regions.some(
			(region) => region.id !== excludeId && newSpan.end > region.startMs && newSpan.start < region.endMs,
		);

	if (zoomRegions.some((region) => region.id === excludeId)) {
		return checkOverlap(zoomRegions);
	}
	if (trimRegions.some((region) => region.id === excludeId)) {
		return checkOverlap(trimRegions);
	}
	if (clipRegions.some((region) => region.id === excludeId)) {
		return checkOverlap(clipRegions);
	}
	if (speedRegions.some((region) => region.id === excludeId)) {
		return checkOverlap(speedRegions);
	}
	if (audioRegions.some((region) => region.id === excludeId)) {
		return checkOverlap(audioRegions);
	}

	return false;
}