import type { Range, Span } from "dnd-timeline";
import { useCallback, useMemo, type RefObject, type WheelEvent } from "react";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "../../types";
import {
	getAnnotationTrackRowId,
	getAudioTrackRowId,
	normalizeWheelDeltaToPixels,
	type TimelineRenderItem,
} from "./shared";

interface UseTimelineEditorTimelineParams {
	totalMs: number;
	range: Range;
	setRange: (updater: Range | ((previous: Range) => Range)) => void;
	timelineContainerRef: RefObject<HTMLDivElement>;
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
	onZoomSpanChange: (id: string, span: Span) => void;
	onTrimSpanChange?: (id: string, span: Span) => void;
	onClipSpanChange?: (id: string, span: Span) => void;
	onAnnotationSpanChange?: (id: string, span: Span) => void;
	onSpeedSpanChange?: (id: string, span: Span) => void;
	onAudioSpanChange?: (id: string, span: Span) => void;
}

export function useTimelineEditorTimeline({
	totalMs,
	range,
	setRange,
	timelineContainerRef,
	zoomRegions,
	trimRegions,
	clipRegions,
	annotationRegions,
	speedRegions,
	audioRegions,
	onZoomSpanChange,
	onTrimSpanChange,
	onClipSpanChange,
	onAnnotationSpanChange,
	onSpeedSpanChange,
	onAudioSpanChange,
}: UseTimelineEditorTimelineParams) {
	const clampedRange = useMemo<Range>(() => {
		if (totalMs === 0) {
			return range;
		}

		return {
			start: Math.max(0, Math.min(range.start, totalMs)),
			end: Math.min(range.end, totalMs),
		};
	}, [range, totalMs]);

	const timelineItems = useMemo<TimelineRenderItem[]>(() => {
		const zooms = zoomRegions.map((region, index) => ({
			id: region.id,
			rowId: "row-zoom",
			span: { start: region.startMs, end: region.endMs },
			label: `Zoom ${index + 1}`,
			zoomDepth: region.depth,
			zoomMode: region.mode ?? "auto",
			variant: "zoom" as const,
		}));

		const clips = clipRegions.map((region, index) => ({
			id: region.id,
			rowId: "row-clip",
			span: { start: region.startMs, end: region.endMs },
			label: `Clip ${index + 1}`,
			variant: "clip" as const,
		}));

		const annotations = annotationRegions.map((region) => ({
			id: region.id,
			rowId: getAnnotationTrackRowId(region.trackIndex ?? 0),
			span: { start: region.startMs, end: region.endMs },
			label:
				region.type === "text"
					? (() => {
							const preview = region.content.trim() || "Empty text";
							return preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
						})()
					: region.type === "image"
						? "Image"
						: "Annotation",
			variant: "annotation" as const,
		}));

		const audios = audioRegions.map((region) => ({
			id: region.id,
			rowId: getAudioTrackRowId(region.trackIndex ?? 0),
			span: { start: region.startMs, end: region.endMs },
			label:
				region.audioPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "Audio",
			variant: "audio" as const,
		}));

		return [...zooms, ...clips, ...annotations, ...audios];
	}, [annotationRegions, audioRegions, clipRegions, zoomRegions]);

	const allRegionSpans = useMemo(
		() => [
			...zoomRegions.map((region) => ({
				id: region.id,
				start: region.startMs,
				end: region.endMs,
				rowId: "row-zoom",
			})),
			...clipRegions.map((region) => ({
				id: region.id,
				start: region.startMs,
				end: region.endMs,
				rowId: "row-clip",
			})),
			...audioRegions.map((region) => ({
				id: region.id,
				start: region.startMs,
				end: region.endMs,
				rowId: getAudioTrackRowId(region.trackIndex ?? 0),
			})),
		],
		[audioRegions, clipRegions, zoomRegions],
	);

	const handleItemSpanChange = useCallback(
		(id: string, span: Span) => {
			if (zoomRegions.some((region) => region.id === id)) {
				onZoomSpanChange(id, span);
			} else if (trimRegions.some((region) => region.id === id)) {
				onTrimSpanChange?.(id, span);
			} else if (clipRegions.some((region) => region.id === id)) {
				onClipSpanChange?.(id, span);
			} else if (annotationRegions.some((region) => region.id === id)) {
				onAnnotationSpanChange?.(id, span);
			} else if (speedRegions.some((region) => region.id === id)) {
				onSpeedSpanChange?.(id, span);
			} else if (audioRegions.some((region) => region.id === id)) {
				onAudioSpanChange?.(id, span);
			}
		},
		[
			annotationRegions,
			audioRegions,
			clipRegions,
			onAnnotationSpanChange,
			onAudioSpanChange,
			onClipSpanChange,
			onSpeedSpanChange,
			onTrimSpanChange,
			onZoomSpanChange,
			speedRegions,
			trimRegions,
			zoomRegions,
		],
	);

	const panTimelineRange = useCallback(
		(deltaMs: number) => {
			if (!Number.isFinite(deltaMs) || deltaMs === 0 || totalMs <= 0) {
				return;
			}

			setRange((previous) => {
				const visibleSpan = Math.max(1, previous.end - previous.start);
				const maxStart = Math.max(0, totalMs - visibleSpan);
				const nextStart = Math.max(0, Math.min(previous.start + deltaMs, maxStart));

				return {
					start: nextStart,
					end: nextStart + visibleSpan,
				};
			});
		},
		[setRange, totalMs],
	);

	const handleTimelineWheel = useCallback(
		(event: WheelEvent<HTMLDivElement>) => {
			if (event.ctrlKey || event.metaKey || totalMs <= 0) {
				return;
			}

			const rawHorizontalDelta =
				Math.abs(event.deltaX) > 0
					? event.deltaX
					: event.shiftKey && Math.abs(event.deltaY) > 0
						? event.deltaY
						: 0;

			if (rawHorizontalDelta === 0) {
				return;
			}

			const containerWidth = timelineContainerRef.current?.clientWidth ?? 0;
			const visibleRangeMs = clampedRange.end - clampedRange.start;
			if (containerWidth <= 0 || visibleRangeMs <= 0) {
				return;
			}

			event.preventDefault();
			const horizontalDeltaPx = normalizeWheelDeltaToPixels(rawHorizontalDelta, event.deltaMode);
			const deltaMs = (horizontalDeltaPx / containerWidth) * visibleRangeMs;
			panTimelineRange(deltaMs);
		},
		[clampedRange.end, clampedRange.start, panTimelineRange, timelineContainerRef, totalMs],
	);

	return {
		clampedRange,
		timelineItems,
		allRegionSpans,
		handleItemSpanChange,
		handleTimelineWheel,
	};
}