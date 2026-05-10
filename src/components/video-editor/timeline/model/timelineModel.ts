import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	TrimRegion,
	ZoomRegion,
} from "../../types";
import { CLIP_ROW_ID, TRIM_ROW_ID, ZOOM_ROW_ID } from "../core/constants";
import {
	getAnnotationTrackIndex,
	getAnnotationTrackRowId,
	getAudioTrackIndex,
	getAudioTrackRowId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "../core/rows";
import type { TimelineRegionSpan, TimelineRenderItem } from "../core/timelineTypes";

export function getAnnotationLabel(region: AnnotationRegion): string {
	if (region.type === "text") {
		const preview = region.content.trim() || "Empty text";
		return preview.length > 20 ? `${preview.substring(0, 20)}...` : preview;
	}
	if (region.type === "image") {
		return "Image";
	}
	return "Annotation";
}

export function getAudioLabel(region: AudioRegion): string {
	return (
		region.audioPath
			.split(/[\\/]/)
			.pop()
			?.replace(/\.[^.]+$/, "") || "Audio"
	);
}

export function buildTimelineItems(params: {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
}): TimelineRenderItem[] {
	const { zoomRegions, trimRegions, clipRegions, annotationRegions, audioRegions } = params;
	const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
		id: region.id,
		rowId: ZOOM_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: `Zoom ${index + 1}`,
		zoomDepth: region.depth,
		zoomMode: region.mode ?? "auto",
		variant: "zoom",
	}));

	const trims: TimelineRenderItem[] = trimRegions.map((region, index) => ({
		id: region.id,
		rowId: TRIM_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: `Trim ${index + 1}`,
		variant: "trim",
	}));

	const clips: TimelineRenderItem[] = clipRegions.map((region, index) => ({
		id: region.id,
		rowId: CLIP_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: `Clip ${index + 1}`,
		variant: "clip",
	}));

	const annotations: TimelineRenderItem[] = annotationRegions.map((region) => ({
		id: region.id,
		rowId: getAnnotationTrackRowId(region.trackIndex ?? 0),
		span: { start: region.startMs, end: region.endMs },
		label: getAnnotationLabel(region),
		variant: "annotation",
	}));

	const audios: TimelineRenderItem[] = audioRegions.map((region) => ({
		id: region.id,
		rowId: getAudioTrackRowId(region.trackIndex ?? 0),
		span: { start: region.startMs, end: region.endMs },
		label: getAudioLabel(region),
		variant: "audio",
	}));

	return [...zooms, ...trims, ...clips, ...annotations, ...audios];
}

export function buildAllRegionSpans(params: {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	audioRegions: AudioRegion[];
}): TimelineRegionSpan[] {
	const { zoomRegions, trimRegions, clipRegions, audioRegions } = params;
	const zooms = zoomRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: ZOOM_ROW_ID,
	}));
	const trims = trimRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: TRIM_ROW_ID,
	}));
	const clips = clipRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: CLIP_ROW_ID,
	}));
	const audios = audioRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: getAudioTrackRowId(r.trackIndex ?? 0),
	}));
	return [...zooms, ...trims, ...clips, ...audios];
}

export function resolveDropRowId(
	id: string,
	proposedRowId: string,
	timelineItems: TimelineRenderItem[],
) {
	const currentRowId = timelineItems.find((item) => item.id === id)?.rowId;
	if (!currentRowId) {
		return proposedRowId;
	}

	if (isAnnotationTrackRowId(currentRowId)) {
		return isAnnotationTrackRowId(proposedRowId)
			? getAnnotationTrackRowId(getAnnotationTrackIndex(proposedRowId))
			: currentRowId;
	}

	if (isAudioTrackRowId(currentRowId)) {
		return isAudioTrackRowId(proposedRowId)
			? getAudioTrackRowId(getAudioTrackIndex(proposedRowId))
			: currentRowId;
	}

	return currentRowId;
}
