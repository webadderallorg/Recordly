import { useEffect } from "react";
import type {
	AudioRegion,
	SpeedRegion,
	TrimRegion,
	WebcamFocusRegion,
	WebcamPositionRegion,
	WebcamSizeRegion,
	ZoomRegion,
} from "../../types";
import { normalizeRegionSpan } from "../core/spans";

interface UseTimelineNormalizationParams {
	totalMs: number;
	safeMinDurationMs: number;
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
	webcamSizeRegions: WebcamSizeRegion[];
	webcamFocusRegions: WebcamFocusRegion[];
	webcamPositionRegions: WebcamPositionRegion[];
	onZoomSpanChange: (id: string, span: { start: number; end: number }) => void;
	onTrimSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onSpeedSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onAudioSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onWebcamSizeSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onWebcamFocusSpanChange?: (id: string, span: { start: number; end: number }) => void;
	onWebcamPositionSpanChange?: (id: string, span: { start: number; end: number }) => void;
}

export function useTimelineNormalization({
	totalMs,
	safeMinDurationMs,
	zoomRegions,
	trimRegions,
	speedRegions,
	audioRegions,
	webcamSizeRegions,
	webcamFocusRegions,
	webcamPositionRegions,
	onZoomSpanChange,
	onTrimSpanChange,
	onSpeedSpanChange,
	onAudioSpanChange,
	onWebcamSizeSpanChange,
	onWebcamFocusSpanChange,
	onWebcamPositionSpanChange,
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

		webcamSizeRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onWebcamSizeSpanChange?.(region.id, normalized);
			}
		});

		webcamFocusRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onWebcamFocusSpanChange?.(region.id, normalized);
			}
		});

		webcamPositionRegions.forEach((region) => {
			const normalized = normalizeRegionSpan({
				startMs: region.startMs,
				endMs: region.endMs,
				totalMs,
				minDurationMs: safeMinDurationMs,
			});

			if (normalized.start !== region.startMs || normalized.end !== region.endMs) {
				onWebcamPositionSpanChange?.(region.id, normalized);
			}
		});
	}, [
		totalMs,
		safeMinDurationMs,
		zoomRegions,
		trimRegions,
		speedRegions,
		audioRegions,
		webcamSizeRegions,
		webcamFocusRegions,
		webcamPositionRegions,
		onZoomSpanChange,
		onTrimSpanChange,
		onSpeedSpanChange,
		onAudioSpanChange,
		onWebcamSizeSpanChange,
		onWebcamFocusSpanChange,
		onWebcamPositionSpanChange,
	]);
}
