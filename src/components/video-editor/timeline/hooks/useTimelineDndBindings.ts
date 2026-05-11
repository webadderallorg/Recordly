import type { Span } from "dnd-timeline";
import { useCallback, useMemo } from "react";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	SpeedRegion,
	TrimRegion,
	ZoomRegion,
} from "../../types";
import type { TimelineRenderItem } from "../core/timelineTypes";
import { getAnnotationTrackIndex, getAudioTrackIndex, isAnnotationTrackRowId, isAudioTrackRowId } from "../core/rows";
import { spansOverlap } from "../core/spans";
import { buildAllRegionSpans, buildTimelineItems, resolveDropRowId } from "../model/timelineModel";

interface UseTimelineDndBindingsParams {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	speedRegions: SpeedRegion[];
	audioRegions: AudioRegion[];
	onZoomSpanChange: (id: string, span: Span) => void;
	onTrimSpanChange?: (id: string, span: Span) => void;
	onClipSpanChange?: (id: string, span: Span) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onSpeedSpanChange?: (id: string, span: Span) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
}

type TimelineItemKind = "zoom" | "trim" | "clip" | "annotation" | "speed" | "audio" | null;

export function useTimelineDndBindings({
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
}: UseTimelineDndBindingsParams) {
	const resolveItemKind = useCallback(
		(id: string): TimelineItemKind => {
			if (zoomRegions.some((r) => r.id === id)) return "zoom";
			if (trimRegions.some((r) => r.id === id)) return "trim";
			if (clipRegions.some((r) => r.id === id)) return "clip";
			if (annotationRegions.some((r) => r.id === id)) return "annotation";
			if (speedRegions.some((r) => r.id === id)) return "speed";
			if (audioRegions.some((r) => r.id === id)) return "audio";
			return null;
		},
		[zoomRegions, trimRegions, clipRegions, annotationRegions, speedRegions, audioRegions],
	);

	const resolveTrackIndex = useCallback(
		(kind: "annotation" | "audio", id: string, rowId?: string): number => {
			if (kind === "annotation") {
				return rowId && isAnnotationTrackRowId(rowId)
					? getAnnotationTrackIndex(rowId)
					: (annotationRegions.find((region) => region.id === id)?.trackIndex ?? 0);
			}
			return rowId && isAudioTrackRowId(rowId)
				? getAudioTrackIndex(rowId)
				: (audioRegions.find((region) => region.id === id)?.trackIndex ?? 0);
		},
		[annotationRegions, audioRegions],
	);

	const hasOverlap = useCallback(
		(newSpan: Span, excludeId?: string, rowId?: string): boolean => {
			if (!excludeId) return false;
			const itemKind = resolveItemKind(excludeId);

			if (itemKind === "annotation") return false;

			const checkOverlap = (
				regions: (ZoomRegion | TrimRegion | ClipRegion | SpeedRegion | AudioRegion)[],
			) =>
				regions.some((region) => {
					if (region.id === excludeId) return false;
					return spansOverlap(newSpan, { start: region.startMs, end: region.endMs });
				});

			if (itemKind === "zoom") return checkOverlap(zoomRegions);
			if (itemKind === "trim") return checkOverlap(trimRegions);
			if (itemKind === "clip") return checkOverlap(clipRegions);
			if (itemKind === "speed") return checkOverlap(speedRegions);

			if (itemKind === "audio") {
				const activeTrackIndex = resolveTrackIndex("audio", excludeId, rowId);
				return checkOverlap(
					audioRegions.filter((region) => (region.trackIndex ?? 0) === activeTrackIndex),
				);
			}

			return false;
		},
		[
			resolveItemKind,
			resolveTrackIndex,
			zoomRegions,
			trimRegions,
			clipRegions,
			audioRegions,
			speedRegions,
		],
	);

	const timelineItems = useMemo<TimelineRenderItem[]>(
		() =>
			buildTimelineItems({
				zoomRegions,
				clipRegions,
				annotationRegions,
				audioRegions,
			}),
		[zoomRegions, clipRegions, annotationRegions, audioRegions],
	);

	const allRegionSpans = useMemo(
		() =>
			buildAllRegionSpans({
				zoomRegions,
				clipRegions,
				audioRegions,
			}),
		[zoomRegions, clipRegions, audioRegions],
	);

	const getResolvedDropRowId = useCallback(
		(id: string, proposedRowId: string) => resolveDropRowId(id, proposedRowId, timelineItems),
		[timelineItems],
	);

	const handleItemSpanChange = useCallback(
		(id: string, span: Span, rowId?: string) => {
			const itemKind = resolveItemKind(id);
			if (itemKind === "zoom") {
				onZoomSpanChange(id, span);
			} else if (itemKind === "trim") {
				onTrimSpanChange?.(id, span);
			} else if (itemKind === "clip") {
				onClipSpanChange?.(id, span);
			} else if (itemKind === "annotation") {
				const nextTrackIndex = resolveTrackIndex("annotation", id, rowId);
				onAnnotationSpanChange?.(id, span, nextTrackIndex);
			} else if (itemKind === "speed") {
				onSpeedSpanChange?.(id, span);
			} else if (itemKind === "audio") {
				const nextTrackIndex = resolveTrackIndex("audio", id, rowId);
				onAudioSpanChange?.(id, span, nextTrackIndex);
			}
		},
		[
			resolveItemKind,
			resolveTrackIndex,
			onZoomSpanChange,
			onTrimSpanChange,
			onClipSpanChange,
			onAnnotationSpanChange,
			onSpeedSpanChange,
			onAudioSpanChange,
		],
	);

	return {
		hasOverlap,
		timelineItems,
		allRegionSpans,
		getResolvedDropRowId,
		handleItemSpanChange,
	};
}
