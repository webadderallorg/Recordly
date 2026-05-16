import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	WebcamFocusRegion,
	WebcamPositionRegion,
	WebcamSizeRegion,
	ZoomRegion,
} from "../../types";
import {
	CLIP_ROW_ID,
	WEBCAM_FOCUS_ROW_ID,
	WEBCAM_POSITION_ROW_ID,
	WEBCAM_SIZE_ROW_ID,
	ZOOM_ROW_ID,
} from "../core/constants";
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
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	webcamSizeRegions?: WebcamSizeRegion[];
	webcamFocusRegions?: WebcamFocusRegion[];
	webcamPositionRegions?: WebcamPositionRegion[];
}): TimelineRenderItem[] {
	const {
		zoomRegions,
		clipRegions,
		annotationRegions,
		audioRegions,
		webcamSizeRegions = [],
		webcamFocusRegions = [],
		webcamPositionRegions = [],
	} = params;
	const zooms: TimelineRenderItem[] = zoomRegions.map((region, index) => ({
		id: region.id,
		rowId: ZOOM_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: `Zoom ${index + 1}`,
		zoomDepth: region.depth,
		zoomMode: region.mode ?? "auto",
		variant: "zoom",
	}));

	const clips: TimelineRenderItem[] = clipRegions.map((region, index) => {
		const displayDurationMs = Math.max(0, region.endMs - region.startMs);
		const speed = Number.isFinite(region.speed) && region.speed > 0 ? region.speed : 1;
		const sourceEndMs = region.startMs + displayDurationMs * speed;

		return {
			id: region.id,
			rowId: CLIP_ROW_ID,
			span: { start: region.startMs, end: region.endMs },
			sourceSpan: { start: region.startMs, end: sourceEndMs },
			label: `Clip ${index + 1}`,
			showSourceAudio: region.showSourceAudio,
			muted: Boolean(region.muted),
			variant: "clip",
		};
	});

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
		audioPath: region.audioPath,
		audioGain: region.volume,
		audioNormalize: Boolean(region.normalize),
		variant: "audio",
	}));

	const webcamSizes: TimelineRenderItem[] = webcamSizeRegions.map((region) => ({
		id: region.id,
		rowId: WEBCAM_SIZE_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label:
			region.height !== undefined && Math.round(region.height) !== Math.round(region.size)
				? `${Math.round(region.size)}x${Math.round(region.height)}%`
				: `${Math.round(region.size)}%`,
		webcamSizePercent: region.size,
		webcamHeightPercent: region.height,
		variant: "webcam-size",
	}));

	const webcamFocuses: TimelineRenderItem[] = webcamFocusRegions.map((region) => ({
		id: region.id,
		rowId: WEBCAM_FOCUS_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: `Focus ${Math.round(region.focusSize)}%`,
		webcamFocusPercent: region.focusSize,
		variant: "webcam-focus",
	}));

	const webcamPositions: TimelineRenderItem[] = webcamPositionRegions.map((region) => ({
		id: region.id,
		rowId: WEBCAM_POSITION_ROW_ID,
		span: { start: region.startMs, end: region.endMs },
		label: `${Math.round(region.positionX * 100)},${Math.round(region.positionY * 100)}`,
		webcamPositionX: region.positionX,
		webcamPositionY: region.positionY,
		variant: "webcam-position",
	}));

	return [
		...zooms,
		...clips,
		...annotations,
		...audios,
		...webcamSizes,
		...webcamFocuses,
		...webcamPositions,
	];
}

export function buildAllRegionSpans(params: {
	zoomRegions: ZoomRegion[];
	clipRegions: ClipRegion[];
	audioRegions: AudioRegion[];
	webcamSizeRegions?: WebcamSizeRegion[];
	webcamFocusRegions?: WebcamFocusRegion[];
	webcamPositionRegions?: WebcamPositionRegion[];
}): TimelineRegionSpan[] {
	const {
		zoomRegions,
		clipRegions,
		audioRegions,
		webcamSizeRegions = [],
		webcamFocusRegions = [],
		webcamPositionRegions = [],
	} = params;
	const zooms = zoomRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: ZOOM_ROW_ID,
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
	const webcamSizes = webcamSizeRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: WEBCAM_SIZE_ROW_ID,
	}));
	const webcamFocuses = webcamFocusRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: WEBCAM_FOCUS_ROW_ID,
	}));
	const webcamPositions = webcamPositionRegions.map((r) => ({
		id: r.id,
		start: r.startMs,
		end: r.endMs,
		rowId: WEBCAM_POSITION_ROW_ID,
	}));
	return [...zooms, ...clips, ...audios, ...webcamSizes, ...webcamFocuses, ...webcamPositions];
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
