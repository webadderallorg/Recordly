import { describe, expect, it } from "vitest";
import { projectCaptionCues } from "../captionTimeline";
import {
	type AnnotationRegion,
	type CaptionCue,
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	getTimelineDurationMs,
	mapTimelineTimeToSourceTime,
	type ZoomRegion,
} from "../types";
import { resolveSceneZoomTarget } from "../videoPlayback/sceneMotion";
import {
	describeExportRangeLimits,
	EXPORT_RANGE_MIN_SPAN_MS,
	readExportRangeArgs,
	resolveExportRange,
	restrictTimelineToRange,
} from "./exportRange";

const SOURCE_DURATION_MS = 60_000;

const clips: ClipRegion[] = [
	{ id: "a", startMs: 0, endMs: 10_000, sourceStartMs: 0, speed: 1 },
	{ id: "b", startMs: 10_000, endMs: 16_000, sourceStartMs: 20_000, speed: 2 },
	{ id: "c", startMs: 16_000, endMs: 21_000, sourceStartMs: 40_000, speed: 1 },
];

const zoomRegions = [
	{
		id: "z1",
		startMs: 11_000,
		endMs: 14_000,
		depth: 3,
		mode: "manual",
		focus: { cx: 0.3, cy: 0.7 },
	},
	{
		id: "z2",
		startMs: 19_000,
		endMs: 20_000,
		depth: 2,
		mode: "manual",
		focus: { cx: 0.6, cy: 0.4 },
	},
] as unknown as ZoomRegion[];

const annotationRegions = [
	{ id: "n-before", startMs: 0, endMs: 5_000 },
	{ id: "n-straddle", startMs: 7_000, endMs: 9_000 },
	{ id: "n-inside", startMs: 12_000, endMs: 13_000 },
	{ id: "n-after", startMs: 19_000, endMs: 20_000 },
] as unknown as AnnotationRegion[];

const captions = [
	{ id: "cue-1", startMs: 9_000, endMs: 21_000, text: "spans a cut" },
	{ id: "cue-2", startMs: 40_500, endMs: 41_500, text: "late" },
] as unknown as CaptionCue[];

const restrict = (fromMs: number, toMs: number, source = clips) =>
	restrictTimelineToRange(
		{
			clipRegions: source,
			trimRegions: [],
			annotationRegions,
			zoomRegions,
			audioRegions: [],
		},
		{ fromMs, toMs },
		SOURCE_DURATION_MS,
	);

describe("readExportRangeArgs", () => {
	it("returns nothing when neither bound is given", () => {
		expect(readExportRangeArgs({})).toBeUndefined();
	});

	it.each([
		[{ fromMs: 1_000 }, /both fromMs and toMs/],
		[{ toMs: 1_000 }, /both fromMs and toMs/],
		[{ fromMs: -1, toMs: 5_000 }, /0 or more/],
		[{ fromMs: 5_000, toMs: 5_000 }, /greater than fromMs/],
		[{ fromMs: 5_000, toMs: 4_000 }, /greater than fromMs/],
		[{ fromMs: 1_000, toMs: 1_050 }, /at least 100 ms/],
		[{ fromMs: Number.NaN, toMs: 5_000 }, /number of milliseconds/],
		[{ fromMs: 0, toMs: Number.POSITIVE_INFINITY }, /number of milliseconds/],
	])("rejects %o", (args, message) => {
		expect(() => readExportRangeArgs(args)).toThrow(message);
	});

	it("accepts the shortest allowed span", () => {
		expect(readExportRangeArgs({ fromMs: 0, toMs: EXPORT_RANGE_MIN_SPAN_MS })).toEqual({
			fromMs: 0,
			toMs: EXPORT_RANGE_MIN_SPAN_MS,
		});
	});
});

describe("resolveExportRange", () => {
	it("reports the edited duration it measured", () => {
		expect(
			resolveExportRange({ fromMs: 8_000, toMs: 18_000 }, clips, SOURCE_DURATION_MS),
		).toEqual({ range: { fromMs: 8_000, toMs: 18_000 }, timelineDurationMs: 21_000 });
	});

	it("refuses a range past the end of the edited timeline", () => {
		expect(() =>
			resolveExportRange({ fromMs: 20_000, toMs: 25_000 }, clips, SOURCE_DURATION_MS),
		).toThrow(/past the end of the edited timeline, which runs to 21000 ms/);
	});

	it("refuses a range that lands entirely inside a cut", () => {
		const gapped: ClipRegion[] = [
			{ id: "a", startMs: 0, endMs: 5_000, sourceStartMs: 0, speed: 1 },
			{ id: "b", startMs: 10_000, endMs: 15_000, sourceStartMs: 30_000, speed: 1 },
		];
		expect(() =>
			resolveExportRange({ fromMs: 6_000, toMs: 9_000 }, gapped, SOURCE_DURATION_MS),
		).toThrow(/whole span was cut.*0–5000 ms, 10000–15000 ms/s);
	});

	it("accepts a range that starts exactly on a cut", () => {
		const gapped: ClipRegion[] = [
			{ id: "a", startMs: 0, endMs: 5_000, sourceStartMs: 0, speed: 1 },
			{ id: "b", startMs: 10_000, endMs: 15_000, sourceStartMs: 30_000, speed: 1 },
		];
		expect(
			resolveExportRange({ fromMs: 5_000, toMs: 12_000 }, gapped, SOURCE_DURATION_MS).range,
		).toEqual({ fromMs: 5_000, toMs: 12_000 });
		const ranged = restrict(5_000, 12_000, gapped);
		expect(ranged.clipRegions).toEqual([
			{ id: "b", startMs: 5_000, endMs: 7_000, sourceStartMs: 30_000, speed: 1 },
		]);
	});
});

describe("restrictTimelineToRange", () => {
	it("keeps the source in-points while moving the clips to the front of the timeline", () => {
		expect(restrict(8_000, 18_000).clipRegions).toEqual([
			{ id: "a", startMs: 0, endMs: 2_000, sourceStartMs: 8_000, speed: 1 },
			{ id: "b", startMs: 2_000, endMs: 8_000, sourceStartMs: 20_000, speed: 2 },
			{ id: "c", startMs: 8_000, endMs: 10_000, sourceStartMs: 40_000, speed: 1 },
		]);
	});

	it("rebases the source in-point by the clip speed inside a speed region", () => {
		const [only] = restrict(12_000, 14_000).clipRegions;
		expect(only).toEqual({
			id: "b",
			startMs: 0,
			endMs: 2_000,
			sourceStartMs: 24_000,
			speed: 2,
		});
		expect(getClipSourceEndMs(only)).toBe(28_000);
	});

	it("makes the source in-point explicit on a clip that never had one", () => {
		const auto: ClipRegion[] = [{ id: "full", startMs: 0, endMs: 21_000, speed: 1 }];
		expect(restrict(0, 21_000, auto).clipRegions).toEqual([
			{ id: "full", startMs: 0, endMs: 21_000, sourceStartMs: 0, speed: 1 },
		]);
		expect(restrict(6_000, 9_000, auto).clipRegions).toEqual([
			{ id: "full", startMs: 0, endMs: 3_000, sourceStartMs: 6_000, speed: 1 },
		]);
	});

	it("leaves a range covering the whole timeline alone", () => {
		const whole = restrict(0, 21_000);
		expect(whole.clipRegions).toEqual(clips);
		expect(whole.zoomRegions).toEqual(zoomRegions);
		expect(whole.annotationRegions).toEqual(annotationRegions);
	});

	it("drops regions outside the range and keeps a straddling one negative", () => {
		const ranged = restrict(8_000, 18_000);
		expect(ranged.annotationRegions).toEqual([
			{ id: "n-straddle", startMs: -1_000, endMs: 1_000 },
			{ id: "n-inside", startMs: 4_000, endMs: 5_000 },
		]);
		expect(ranged.zoomRegions.map(({ id }) => id)).toEqual(["z1"]);
	});

	it("rebuilds the source-clock trims from the clips it kept", () => {
		expect(restrict(12_000, 14_000).trimRegions).toEqual([
			{ id: "trim-gap-1", startMs: 0, endMs: 24_000 },
			{ id: "trim-gap-2", startMs: 28_000, endMs: 60_000 },
		]);
	});
});

describe("a fragment is the full export shifted by fromMs", () => {
	const FROM = 8_000;
	const TO = 18_000;
	const ranged = restrict(FROM, TO);
	const frames = Array.from({ length: (TO - FROM) / 50 }, (_, index) => index * 50);

	it("ends exactly at the span that was asked for", () => {
		expect(getTimelineDurationMs(ranged.clipRegions, SOURCE_DURATION_MS)).toBe(TO - FROM);
	});

	it("shows the same source frame at every output time", () => {
		for (const atMs of frames) {
			expect(mapTimelineTimeToSourceTime(atMs, ranged.clipRegions)).toBe(
				mapTimelineTimeToSourceTime(atMs + FROM, clips),
			);
		}
	});

	it("turns every annotation on and off at the same point in the picture", () => {
		const active = (regions: AnnotationRegion[], atMs: number) =>
			regions
				.filter((region) => atMs >= region.startMs && atMs <= region.endMs)
				.map(({ id }) => id);
		for (const atMs of frames) {
			expect(active(ranged.annotationRegions, atMs)).toEqual(
				active(annotationRegions, atMs + FROM),
			);
		}
	});

	it("puts the camera in the same place at every output time", () => {
		const target = (regions: ZoomRegion[], atMs: number) =>
			resolveSceneZoomTarget({
				zoomRegions: regions,
				timeMs: atMs,
				cursorTimeMs: atMs,
				connectZooms: false,
				zoomInDurationMs: 1_500,
				zoomInOverlapMs: 500,
				zoomOutDurationMs: 1_000,
				zoomClassicMode: false,
				cursorTelemetry: [],
				cursorFollowCamera: undefined,
			});
		for (const atMs of frames) {
			expect(target(ranged.zoomRegions, atMs)).toEqual(target(zoomRegions, atMs + FROM));
		}
	});

	it("places every caption cue at the same point in the picture", () => {
		const fromFull = projectCaptionCues(captions, clips)
			.map((cue) => ({
				id: cue.sourceCueId,
				startMs: Math.max(cue.startMs, FROM) - FROM,
				endMs: Math.min(cue.endMs, TO) - FROM,
			}))
			.filter((cue) => cue.endMs > cue.startMs);
		expect(
			projectCaptionCues(captions, ranged.clipRegions).map((cue) => ({
				id: cue.sourceCueId,
				startMs: cue.startMs,
				endMs: cue.endMs,
			})),
		).toEqual(fromFull);
	});

	it("reads the cursor from the untouched source clock", () => {
		for (const atMs of frames) {
			const sourceMs = mapTimelineTimeToSourceTime(atMs, ranged.clipRegions);
			expect(sourceMs).toBe(mapTimelineTimeToSourceTime(atMs + FROM, clips));
		}
		expect(getClipSourceStartMs(ranged.clipRegions[0])).toBe(FROM);
	});
});

describe("describeExportRangeLimits", () => {
	it("says so when a zoom was already under way at the start of the range", () => {
		expect(describeExportRangeLimits({ fromMs: 12_000, toMs: 14_000 }, zoomRegions)).toEqual([
			expect.stringContaining("already under way at 12000 ms"),
		]);
	});

	it("stays quiet when every zoom starts inside the range", () => {
		expect(describeExportRangeLimits({ fromMs: 8_000, toMs: 18_000 }, zoomRegions)).toEqual([]);
	});
});
