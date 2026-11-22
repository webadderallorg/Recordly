import { describe, expect, it } from "vitest";
import type { ClipRegion, CursorTelemetryPoint } from "../types";
import {
	computeCursorFollowFocus,
	createCursorFollowCameraState,
} from "../videoPlayback/cursorFollowCamera";
import { computeRegionStrength } from "../videoPlayback/zoomRegionUtils";
import {
	buildInteractionZoomSuggestions,
	CLICK_CLUSTER_MERGE_GAP_MS,
	CLICK_CLUSTER_PAD_MS,
} from "./zoomSuggestionUtils";

function makeClick(
	timeMs: number,
	cx = 0.5,
	cy = 0.5,
	interactionType: CursorTelemetryPoint["interactionType"] = "click",
): CursorTelemetryPoint {
	return { timeMs, cx, cy, interactionType };
}

function makeMove(timeMs: number, cx = 0.5, cy = 0.5): CursorTelemetryPoint {
	return { timeMs, cx, cy, interactionType: "move" };
}

/** Wraps click samples with surrounding move events to mimic real mixed telemetry. */
function withMoves(clicks: CursorTelemetryPoint[], totalMs: number): CursorTelemetryPoint[] {
	return [makeMove(0), ...clicks, makeMove(totalMs)];
}

const TOTAL_MS = 30_000;

describe("auto zooms on edited clips", () => {
	function suggest(presses: CursorTelemetryPoint[], clips: ClipRegion[], totalMs: number) {
		return buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(presses, 14018),
			clipRegions: clips,
			totalMs,
			defaultDurationMs: 1000,
		});
	}

	it("places retained recording clicks on a left-trimmed timeline instead of its end", () => {
		const clip = { id: "clip", startMs: 0, endMs: 3712, sourceStartMs: 5988, speed: 1 };
		const result = suggest(
			[
				makeClick(2000),
				makeClick(2050, 0.5, 0.5, "mouseup"),
				makeClick(8000, 0.6, 0.4),
				makeClick(8080, 0.6, 0.4, "mouseup"),
				makeClick(12000),
				makeClick(12050, 0.5, 0.5, "mouseup"),
			],
			[clip],
			3712,
		);
		expect(result).toEqual({
			status: "ok",
			suggestions: [{ start: 1432, end: 2592, focus: { cx: 0.6, cy: 0.4 } }],
		});
	});

	it("scales click and release times by clip speed before padding the timeline block", () => {
		const result = suggest(
			[makeClick(8000), makeClick(8160, 0.5, 0.5, "mouseup")],
			[{ id: "fast", startMs: 1000, endMs: 5000, sourceStartMs: 4000, speed: 2 }],
			5000,
		);
		expect(result.suggestions).toEqual([
			{ start: 2420, end: 3580, focus: { cx: 0.5, cy: 0.5 } },
		]);
	});

	it("projects reordered and duplicated source independently in timeline order", () => {
		const result = suggest(
			[
				makeClick(3000, 0.3),
				makeClick(3020, 0.3, 0.5, "mouseup"),
				makeClick(9000, 0.7),
				makeClick(9020, 0.7, 0.5, "mouseup"),
			],
			[
				{ id: "repeat", startMs: 4000, endMs: 6000, sourceStartMs: 8000, speed: 1 },
				{ id: "early", startMs: 2000, endMs: 4000, sourceStartMs: 2000, speed: 1 },
				{ id: "late", startMs: 0, endMs: 2000, sourceStartMs: 8000, speed: 1 },
			],
			6000,
		);
		expect(result.suggestions).toEqual([
			{ start: 480, end: 1520, focus: { cx: 0.7, cy: 0.5 } },
			{ start: 2480, end: 3520, focus: { cx: 0.3, cy: 0.5 } },
			{ start: 4480, end: 5520, focus: { cx: 0.7, cy: 0.5 } },
		]);
	});

	it("clips an ongoing hold to the kept source interval and keeps padding inside its clip", () => {
		const result = suggest(
			[
				{ ...makeClick(1000, 0.3), mouseButton: 1 },
				{ ...makeClick(7000, 0.8, 0.5, "mouseup"), mouseButton: 1 },
			],
			[{ id: "held", startMs: 2000, endMs: 5000, sourceStartMs: 3000, speed: 1 }],
			5000,
		);
		expect(result.suggestions).toEqual([
			{ start: 2000, end: 5000, focus: { cx: 0.3, cy: 0.5 } },
		]);
	});

	it("does not manufacture zooms from clicks or releases entirely outside the kept interval", () => {
		const result = suggest(
			[
				makeClick(1000),
				makeClick(3000, 0.5, 0.5, "mouseup"),
				makeClick(6000),
				makeClick(6050, 0.5, 0.5, "mouseup"),
			],
			[{ id: "kept", startMs: 0, endMs: 3000, sourceStartMs: 3000, speed: 1 }],
			3000,
		);
		expect(result).toEqual({ status: "no-interactions", suggestions: [] });
	});
});

describe("buildInteractionZoomSuggestions (click-cluster logic)", () => {
	it.each([
		{ click: 5000, release: 5080, total: TOTAL_MS, start: 4000, end: 6000 },
		{ click: 200, release: 250, total: TOTAL_MS, start: 0, end: 2000 },
		{ click: 29800, release: 29850, total: TOTAL_MS, start: 28000, end: 30000 },
		{ click: 200, release: 250, total: 1500, start: 0, end: 1500 },
	])("fits a two-second click zoom at $click ms in a $total ms recording", (scenario) => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(scenario.click), makeClick(scenario.release, 0.5, 0.5, "mouseup")],
				scenario.total,
			),
			totalMs: scenario.total,
			defaultDurationMs: 2000,
		});
		expect(result.suggestions).toEqual([
			{ start: scenario.start, end: scenario.end, focus: { cx: 0.5, cy: 0.5 } },
		]);
	});

	function suggest(presses: CursorTelemetryPoint[], totalMs = TOTAL_MS) {
		return buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(presses, totalMs),
			totalMs,
			defaultDurationMs: 3000,
		});
	}

	it("keeps one auto zoom active from down through a long drag and release", () => {
		const telemetry = [
			{ ...makeClick(2000, 0.2, 0.3), mouseButton: 1 as const },
			makeMove(8000, 0.5, 0.5),
			{ ...makeClick(14000, 0.8, 0.7, "mouseup"), mouseButton: 1 as const },
		];
		const result = suggest(telemetry);
		expect(result.suggestions).toEqual([
			{ start: 1500, end: 14500, focus: { cx: 0.2, cy: 0.3 } },
		]);
		const region = {
			id: "held",
			startMs: 1500,
			endMs: 14500,
			depth: 2 as const,
			focus: { cx: 0.2, cy: 0.3 },
		};
		for (const time of [5000, 8000, 12000]) expect(computeRegionStrength(region, time)).toBe(1);
		expect(computeRegionStrength(region, 14000)).toBeGreaterThan(0);
		expect(computeRegionStrength(region, 18000)).toBe(0);
		const camera = createCursorFollowCameraState();
		computeCursorFollowFocus(
			camera,
			telemetry,
			5000,
			2,
			computeRegionStrength(region, 5000),
			region.focus,
		);
		const focus = computeCursorFollowFocus(
			camera,
			telemetry,
			12000,
			2,
			computeRegionStrength(region, 12000),
			region.focus,
		);
		expect(focus.cx).toBeGreaterThan(region.focus.cx);
		expect(focus.cy).toBeGreaterThan(region.focus.cy);
	});

	it("centers a recorded click-down rather than the middle of its press/release interval", () => {
		const telemetry = withMoves(
			[makeClick(5000), makeClick(5080, 0.5, 0.5, "mouseup")],
			TOTAL_MS,
		);
		const original = structuredClone(telemetry);
		const [suggestion] = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 1000,
		}).suggestions;
		expect(suggestion).toMatchObject({ start: 4420, end: 5580 });
		expect((suggestion.start + suggestion.end) / 2).toBe(5000);
		const strength = computeRegionStrength(
			{
				id: "centered",
				startMs: suggestion.start,
				endMs: suggestion.end,
				depth: 2,
				focus: suggestion.focus,
			},
			5000,
			{ zoomInDurationMs: 200, zoomOutDurationMs: 200 / 0.7 },
		);
		// Short suggestions keep their click anchor while overlapping ramps stay shallow.
		expect(strength).toBeGreaterThan(0);
		expect(strength).toBeLessThan(1);
		expect(telemetry).toEqual(original);
	});

	it("centers a cluster on the strongest click that chooses the focus", () => {
		const [suggestion] = suggest([
			makeClick(6000, 0.2, 0.3),
			makeClick(8000, 0.8, 0.7, "double-click"),
		]).suggestions;
		expect(suggestion.focus).toEqual({ cx: 0.8, cy: 0.7 });
		expect((suggestion.start + suggestion.end) / 2).toBe(8000);
		expect(suggestion.start).toBeLessThan(6000);
		expect(suggestion.end).toBeGreaterThan(8000);
	});

	it("can center a held click without losing its drag or release", () => {
		const [suggestion] = suggest([
			{ ...makeClick(9000), mouseButton: 1 },
			{ ...makeClick(13000, 0.8, 0.7, "mouseup"), mouseButton: 1 },
		]).suggestions;
		expect((suggestion.start + suggestion.end) / 2).toBe(9000);
		expect(suggestion.start).toBeLessThanOrEqual(9000 - CLICK_CLUSTER_PAD_MS);
		expect(suggestion.end).toBeGreaterThanOrEqual(13000 + CLICK_CLUSTER_PAD_MS);
	});

	it("preserves recording boundaries when a click cannot be centered", () => {
		for (const [click, release] of [
			[200, 250],
			[29800, 29850],
		]) {
			const [suggestion] = suggest([
				makeClick(click),
				makeClick(release, 0.5, 0.5, "mouseup"),
			]).suggestions;
			expect(suggestion.start).toBe(click < TOTAL_MS / 2 ? 0 : TOTAL_MS - 3000);
			expect(suggestion.end - suggestion.start).toBe(3000);
		}
	});

	it("keeps existing blocks intact when centering would intrude into them", () => {
		const reservedSpans = [{ start: 4000, end: 4500 }];
		const [suggestion] = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(5000), makeClick(5050, 0.5, 0.5, "mouseup")],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 1000,
			reservedSpans,
		}).suggestions;
		expect(suggestion).toMatchObject({ start: 4500, end: 5550 });
		expect(reservedSpans).toEqual([{ start: 4000, end: 4500 }]);
	});

	it("preserves room for neighboring click blocks and their connected pan", () => {
		const suggestions = suggest([
			makeClick(3000),
			makeClick(6000),
			makeClick(8000),
		]).suggestions;
		expect(suggestions).toHaveLength(2);
		expect(suggestions[0]).toMatchObject({ start: 1500, end: 4500 });
		expect(suggestions[1]).toMatchObject({ start: 5500, end: 8500 });
		expect(suggestions[1].start - suggestions[0].end).toBeGreaterThanOrEqual(
			CLICK_CLUSTER_PAD_MS,
		);
	});

	it("keeps stationary holds active too", () => {
		const result = suggest([makeClick(2000), makeClick(14000, 0.5, 0.5, "mouseup")]);
		expect(result.suggestions).toMatchObject([{ start: 1500, end: 14500 }]);
	});

	it("merges a click near the release of a long hold into the same interaction cluster", () => {
		const result = suggest([
			makeClick(2000),
			makeClick(12000, 0.5, 0.5, "mouseup"),
			makeClick(14000),
		]);
		expect(result.suggestions).toHaveLength(1);
		expect(result.suggestions[0]).toMatchObject({ start: 1500, end: 14500 });
	});

	it("does not let an unrelated button release shorten the hold", () => {
		const result = suggest([
			{ ...makeClick(2000), mouseButton: 1 },
			{ ...makeClick(4000, 0.5, 0.5, "right-click"), mouseButton: 2 },
			{ ...makeClick(4100, 0.5, 0.5, "mouseup"), mouseButton: 2 },
			{ ...makeClick(14000, 0.5, 0.5, "mouseup"), mouseButton: 1 },
		]);
		expect(result.suggestions).toMatchObject([{ start: 1500, end: 14500 }]);
	});

	it("extends a known held button without a release to the end of the recording", () => {
		expect(suggest([{ ...makeClick(2000), mouseButton: 1 }]).suggestions).toMatchObject([
			{ start: 1500, end: TOTAL_MS },
		]);
	});

	it("pairs each repeated click with its own release", () => {
		const result = suggest([
			makeClick(2000),
			makeClick(2050, 0.5, 0.5, "mouseup"),
			makeClick(10000),
			makeClick(18000, 0.5, 0.5, "mouseup"),
		]);
		expect(result.suggestions).toMatchObject([
			{ start: 500, end: 3500 },
			{ start: 9500, end: 18500 },
		]);
	});

	it("checks reserved spans against the whole hold, including its later portion", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves(
				[makeClick(2000), makeClick(14000, 0.5, 0.5, "mouseup")],
				TOTAL_MS,
			),
			totalMs: TOTAL_MS,
			defaultDurationMs: 3000,
			reservedSpans: [{ start: 10000, end: 11000 }],
		});
		expect(result.status).toBe("no-slots");
	});
	it("uses the requested duration centered on a single isolated click", () => {
		const telemetry = withMoves([makeClick(5_000)], TOTAL_MS);

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toHaveLength(1);

		const [s] = result.suggestions;
		expect(s.start).toBe(3500);
		expect(s.end).toBe(6500);
	});

	it("accepts a single explicit click sample without needing surrounding moves", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: [makeClick(5_000)],
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toHaveLength(1);
	});

	it.each([
		"right-click",
		"middle-click",
	] as const)("accepts %s telemetry like a standard click", (interactionType) => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([makeClick(5_000, 0.5, 0.5, interactionType)], TOTAL_MS),
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toHaveLength(1);

		const [suggestion] = result.suggestions;
		expect(suggestion.start).toBe(3500);
		expect(suggestion.end).toBe(6500);
	});

	it("merges two clicks within 2500ms into one zoom track", () => {
		const telemetry = withMoves(
			[makeClick(4_000), makeClick(4_000 + CLICK_CLUSTER_MERGE_GAP_MS - 1)],
			TOTAL_MS,
		);

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toHaveLength(1);

		const [s] = result.suggestions;
		const lastClickMs = 4_000 + CLICK_CLUSTER_MERGE_GAP_MS - 1;
		expect((s.start + s.end) / 2).toBe(4_000);
		expect(s.start).toBeLessThan(4_000 - CLICK_CLUSTER_PAD_MS);
		expect(s.end).toBe(lastClickMs + CLICK_CLUSTER_PAD_MS);
	});

	it("splits two clicks more than 2500ms apart into separate zoom tracks", () => {
		const click1 = 3_000;
		const click2 = 3_000 + CLICK_CLUSTER_MERGE_GAP_MS + 1; // just outside the merge gap

		const telemetry = withMoves([makeClick(click1), makeClick(click2)], TOTAL_MS);

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toHaveLength(2);

		const [a, b] = result.suggestions;
		expect(a.start).toBe(click1 - 1500);
		expect(a.end).toBe(click1 + 1500);
		expect(b.end - b.start).toBe(3000);
		expect(b.start - a.end).toBeGreaterThanOrEqual(CLICK_CLUSTER_PAD_MS);
		expect(b.start).toBeLessThanOrEqual(click2 - CLICK_CLUSTER_PAD_MS);
		expect(b.end).toBeGreaterThanOrEqual(click2 + CLICK_CLUSTER_PAD_MS);
	});

	it("chains multiple clicks: 3 in a row within 2500ms each become one track", () => {
		// click at 0, 2000, 4000 — each gap is 2000ms < 2500ms
		const telemetry = withMoves([makeClick(0), makeClick(2_000), makeClick(4_000)], TOTAL_MS);

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		expect(result.suggestions).toHaveLength(1);

		const [s] = result.suggestions;
		expect(s.start).toBe(0); // clamped to 0 (would be -500)
		expect(s.end).toBe(4_000 + CLICK_CLUSTER_PAD_MS);
	});

	it("returns no-interactions when there are no click telemetry points", () => {
		// Move events only — no clicks
		const telemetry: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move" },
			{ timeMs: 1_000, cx: 0.5, cy: 0.5, interactionType: "move" },
			{ timeMs: 2_000, cx: 0.6, cy: 0.6, interactionType: "move" },
			{ timeMs: TOTAL_MS, cx: 0.6, cy: 0.6, interactionType: "move" },
		];

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("no-interactions");
		expect(result.suggestions).toHaveLength(0);
	});

	it("ignores dwell-derived click-like heuristics when there are no explicit clicks", () => {
		const telemetry: CursorTelemetryPoint[] = [
			makeMove(0, 0.5, 0.5),
			makeMove(200, 0.5005, 0.5005),
			makeMove(400, 0.5008, 0.5008),
			makeMove(600, 0.501, 0.501),
		];

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: telemetry,
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("no-interactions");
		expect(result.suggestions).toHaveLength(0);
	});

	it("skips clusters that overlap reserved spans", () => {
		const click = 5_000;

		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([makeClick(click)], TOTAL_MS),
			totalMs: TOTAL_MS,
			defaultDurationMs: 3_000,
			reservedSpans: [{ start: 4_000, end: 6_000 }], // overlaps the cluster window
		});

		expect(result.status).toBe("no-slots");
		expect(result.suggestions).toHaveLength(0);
	});

	it("clamps start to 0 and end to totalMs at video boundaries", () => {
		const result = buildInteractionZoomSuggestions({
			cursorTelemetry: withMoves([makeClick(200)], 1_000),
			totalMs: 1_000,
			defaultDurationMs: 3_000,
		});

		expect(result.status).toBe("ok");
		const [s] = result.suggestions;
		expect(s.start).toBeGreaterThanOrEqual(0);
		expect(s.end).toBeLessThanOrEqual(1_000);
	});
});
