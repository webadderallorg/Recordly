import {
	type AnnotationRegion,
	type AudioRegion,
	type ClipRegion,
	clipsToTrims,
	getClipSourceStartMs,
	getTimelineDurationMs,
	sortClipRegions,
	type TrimRegion,
	type ZoomRegion,
} from "../types";

export const EXPORT_RANGE_MIN_SPAN_MS = 100;
const CAMERA_SETTLE_MS = 1500;

export type ExportRange = { fromMs: number; toMs: number };

export type RangedTimeline = {
	clipRegions: ClipRegion[];
	trimRegions: TrimRegion[];
	annotationRegions: AnnotationRegion[];
	zoomRegions: ZoomRegion[];
	audioRegions: AudioRegion[];
};

function requireMs(name: string, value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${name} must be a number of milliseconds, not ${JSON.stringify(value)}.`);
	}
	return value;
}

export function readExportRangeArgs(args: {
	fromMs?: number;
	toMs?: number;
}): ExportRange | undefined {
	const given = [args.fromMs, args.toMs].filter((value) => value !== undefined).length;
	if (given === 0) return undefined;
	if (given === 1) {
		throw new Error(
			"Pass both fromMs and toMs to export a range, or neither for the whole video.",
		);
	}
	const fromMs = requireMs("fromMs", args.fromMs);
	const toMs = requireMs("toMs", args.toMs);
	if (fromMs < 0) throw new Error(`fromMs must be 0 or more, not ${fromMs}.`);
	if (toMs <= fromMs) throw new Error(`toMs (${toMs}) must be greater than fromMs (${fromMs}).`);
	if (toMs - fromMs < EXPORT_RANGE_MIN_SPAN_MS) {
		throw new Error(
			`A range must cover at least ${EXPORT_RANGE_MIN_SPAN_MS} ms, and ${fromMs}–${toMs} covers ${toMs - fromMs} ms.`,
		);
	}
	return { fromMs, toMs };
}

export function resolveExportRange(
	range: ExportRange,
	clipRegions: ClipRegion[],
	sourceDurationMs: number,
): { range: ExportRange; timelineDurationMs: number } {
	const timelineDurationMs = getTimelineDurationMs(clipRegions, sourceDurationMs);
	if (range.toMs > timelineDurationMs) {
		throw new Error(
			`toMs ${Math.round(range.toMs)} is past the end of the edited timeline, which runs to ${Math.round(timelineDurationMs)} ms.`,
		);
	}
	const kept = clipRegions
		.filter((clip) => clip.endMs > range.fromMs && clip.startMs < range.toMs)
		.filter((clip) => clip.endMs > clip.startMs);
	if (kept.length === 0) {
		const spans = sortClipRegions(clipRegions)
			.map((clip) => `${Math.round(clip.startMs)}–${Math.round(clip.endMs)} ms`)
			.join(", ");
		throw new Error(
			`Nothing is left on the timeline between ${Math.round(range.fromMs)} ms and ${Math.round(range.toMs)} ms — that whole span was cut. The kept spans are ${spans || "none"}.`,
		);
	}
	return { range, timelineDurationMs };
}

export function describeExportRangeLimits(range: ExportRange, zoomRegions: ZoomRegion[]): string[] {
	const settling = zoomRegions.some(
		(zoom) => zoom.startMs < range.fromMs && zoom.endMs > range.fromMs - CAMERA_SETTLE_MS,
	);
	return settling
		? [
				`A zoom was already under way at ${Math.round(range.fromMs)} ms. The camera and cursor springs start this fragment at rest, so the first ${CAMERA_SETTLE_MS} ms of camera movement settles into place instead of arriving mid-flight as it does in a full export. Annotation, caption and zoom timings are unaffected.`,
			]
		: [];
}

export function restrictTimelineToRange(
	timeline: RangedTimeline,
	range: ExportRange,
	sourceDurationMs: number,
): RangedTimeline {
	const { fromMs, toMs } = range;
	const clipRegions = sortClipRegions(timeline.clipRegions).flatMap((clip) => {
		const startMs = Math.max(clip.startMs, fromMs);
		const endMs = Math.min(clip.endMs, toMs);
		if (endMs <= startMs) return [];
		const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
		return [
			{
				...clip,
				sourceStartMs: Math.round(
					getClipSourceStartMs(clip) + (startMs - clip.startMs) * speed,
				),
				startMs: startMs - fromMs,
				endMs: endMs - fromMs,
			},
		];
	});
	const shift = <T extends { startMs: number; endMs: number }>(regions: T[]): T[] =>
		regions.flatMap((region) =>
			region.endMs <= fromMs || region.startMs >= toMs
				? []
				: [{ ...region, startMs: region.startMs - fromMs, endMs: region.endMs - fromMs }],
		);
	return {
		clipRegions,
		trimRegions: clipsToTrims(clipRegions, Math.max(0, Math.round(sourceDurationMs))),
		annotationRegions: shift(timeline.annotationRegions),
		zoomRegions: shift(timeline.zoomRegions),
		audioRegions: shift(timeline.audioRegions),
	};
}
