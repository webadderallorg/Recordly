import { useEffect } from "react";
import { normalizeRegionSpan } from "../core/spans";
import type { AudioRegion, SpeedRegion, TrimRegion, ZoomRegion } from "../../types";

interface UseTimelineNormalizationParams {
	totalMs: number;
	safeMinDurationMs: number;
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
	onZoomSpanChange: (id: string, span: { start: number; end: number }) => void;
	onTrimSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onSpeedSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onAudioSpanChange?: (id: string, span: { start: number; end: number }) => void;
}

export function useTimelineNormalization({
	totalMs,
	safeMinDurationMs,
	zoomRegions,
	trimRegions,
	speedRegions,
	audioRegions,
	onZoomSpanChange,
	onTrimSpanChange,
	onSpeedSpanChange,
	onAudioSpanChange,
}: UseTimelineNormalizationParams) {
	useEffect(() => {
		if (totalMs === 0 || safeMinDurationMs <= 0) {
			return;
		}

		zoomRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onZoomSpanChange(region.id, normalized);
			}
		});

		trimRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onTrimSpanChange?.(region.id, normalized);
			}
		});

		speedRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onSpeedSpanChange?.(region.id, normalized);
			}
		});

		audioRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onAudioSpanChange?.(region.id, normalized);
			}
		});
	}, [
		totalMs,
		safeMinDurationMs,
		zoomRegions,
		trimRegions,
		speedRegions,
		audioRegions,
		onZoomSpanChange,
		onTrimSpanChange,
		onSpeedSpanChange,
		onAudioSpanChange,
	]);
}
