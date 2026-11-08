import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_PRESETS } from "../../cursorMotionPresets";
import type { ZoomRegion } from "../../types";
import {
	computeRegionStrength,
	findDominantRegion,
	getConnectedZoomEndMs,
} from "../../videoPlayback/zoomRegionUtils";
import { resolveResizeEnd } from "../dnd/engine";
import { ZOOM_ROW_ID } from "./constants";
import {
	getZoomDisplaySpan,
	getZoomMotionSpan,
	getZoomPresentationTiming,
	getZoomResizeSpan,
} from "./zoomPresentation";

describe("zoom block presentation", () => {
	it.each([
		"focused",
		"smooth",
	] as const)("shows %s visible completion while preserving the full exit", (id) => {
		const options = CURSOR_MOTION_PRESETS[id];
		const timing = getZoomPresentationTiming(options);
		const region: ZoomRegion = {
			id: "zoom",
			startMs: 1000,
			endMs: 4000,
			depth: 2,
			focus: { cx: 0.5, cy: 0.5 },
		};
		const original = { ...region };
		const visible = getZoomDisplaySpan({ start: region.startMs, end: region.endMs }, timing);
		expect(visible.start).toBe(region.startMs);
		expect(region.endMs - visible.end).toBeGreaterThan(250);
		// The colored block ends with 1% of the original exit left. No curve samples are cut.
		expect(computeRegionStrength(region, visible.end, options)).toBeCloseTo(0.01, 9);
		const tail = computeRegionStrength(region, (visible.end + region.endMs) / 2, options);
		expect(tail).toBeGreaterThan(0);
		expect(tail).toBeLessThan(0.01);
		expect(computeRegionStrength(region, region.endMs, options)).toBe(0);
		expect(region).toEqual(original);
	});

	it.each([
		1, 10, 50, 100, 500, 1000, 2000, 3000, 10000,
	])("round-trips the displayed resize edge for a %i ms block", (duration) => {
		const timing = getZoomPresentationTiming(CURSOR_MOTION_PRESETS.focused);
		const motion = { start: 1000, end: 1000 + duration };
		const display = getZoomDisplaySpan(motion, timing);
		const restored = getZoomMotionSpan(display, timing);
		expect(restored.start).toBe(motion.start);
		expect(restored.end).toBeCloseTo(motion.end, 5);
		const moved = getZoomDisplaySpan(
			{ start: motion.start + 123, end: motion.end + 123 },
			timing,
		);
		expect(moved.end - moved.start).toBeCloseTo(display.end - display.start, 9);
		const resized = { ...display, end: display.end + 250 };
		expect(getZoomDisplaySpan(getZoomMotionSpan(resized, timing), timing).end).toBeCloseTo(
			resized.end,
			5,
		);
	});

	it.each([
		50, 100, 500, 1000,
	])("keeps a %i ms block editable without a connected minimum", (duration) => {
		const options = { ...CURSOR_MOTION_PRESETS.focused, connectZooms: true };
		const timing = getZoomPresentationTiming(options);
		const first: ZoomRegion = {
			id: "first",
			startMs: 789,
			endMs: 7189,
			depth: 3,
			focus: { cx: 0.35, cy: 0.5 },
		};
		const last = { ...first, id: "last", startMs: 7884, endMs: 7884 + duration };
		const span = { start: last.startMs, end: last.endMs };
		const display = getZoomDisplaySpan(span, timing);
		expect(display.end).toBeGreaterThan(span.start);
		expect(display.end).toBeLessThan(span.end);
		expect(getZoomMotionSpan(display, timing).end).toBeCloseTo(span.end, 5);
		const shorter = { ...display, end: display.start + 10 };
		const resized = getZoomMotionSpan(shorter, timing);
		expect(resized.end - resized.start).toBeLessThan(11);
		expect(getZoomDisplaySpan(resized, timing).end).toBeCloseTo(shorter.end, 5);
		// The connected arrival and full exit belong to playback, never UI minimums.
		const fullEnd = getConnectedZoomEndMs(last, options);
		expect(findDominantRegion([first, last], last.startMs, options).strength).toBe(1);
		expect(
			findDominantRegion([first, last], (last.endMs + fullEnd) / 2, options).strength,
		).toBeGreaterThan(0);
		expect(findDominantRegion([first, last], fullEnd, options).strength).toBe(0);
		expect(last.endMs - last.startMs).toBe(duration);
	});

	it.each([
		50, 500, 1000, 3000,
	])("keeps the other displayed edge fixed when resizing a %i ms block", (duration) => {
		const timing = getZoomPresentationTiming(CURSOR_MOTION_PRESETS.focused);
		const display = getZoomDisplaySpan({ start: 1000, end: 1000 + duration }, timing);
		for (const start of [500, 900, 1010]) {
			const resized = getZoomMotionSpan({ ...display, start }, timing);
			const visible = getZoomDisplaySpan(resized, timing);
			expect(visible.start).toBe(start);
			expect(visible.end).toBeCloseTo(display.end, 5);
		}
	});

	it("uses safe defaults for invalid duration settings", () => {
		expect(
			getZoomPresentationTiming({
				zoomInDurationMs: Number.NaN,
				zoomOutDurationMs: Number.POSITIVE_INFINITY,
			}),
		).toEqual(getZoomPresentationTiming());
	});
});

describe("constrained zoom resizing", () => {
	const timing = getZoomPresentationTiming(CURSOR_MOTION_PRESETS.focused);
	const active = { id: "active", rowId: ZOOM_ROW_ID, start: 1000, end: 1500 };
	const originalDisplay = getZoomDisplaySpan(active, timing);

	it.each([
		{ name: "timeline end", end: 1500, neighbor: false },
		{ name: "following zoom", end: 1501, neighbor: true },
	])("keeps the right visible edge fixed when the left grip reaches the $name", ({
		end,
		neighbor,
	}) => {
		const following = { id: "following", rowId: ZOOM_ROW_ID, start: end, end: 2500 };
		const resized = getZoomResizeSpan({ ...originalDisplay, start: 500 }, timing, "start", {
			start: 0,
			end,
			minDurationMs: 1,
		});
		const resolved = resolveResizeEnd(active.id, resized, {
			totalMs: neighbor ? 3000 : end,
			minItemDurationMs: 1,
			allRegionSpans: neighbor ? [active, following] : [active],
			hasOverlap: (span) =>
				neighbor && span.end > following.start && span.start < following.end,
		});
		expect(resolved).not.toBeNull();
		expect(resized.start).toBeGreaterThan(950);
		expect(resized.end).toBeLessThanOrEqual(end);
		expect(resolved!.start).toBeCloseTo(resized.start, 8);
		expect(getZoomDisplaySpan(resolved!, timing).end).toBeCloseTo(originalDisplay.end, 6);
	});

	it.each([
		"start",
		"end",
	] as const)("enforces the raw minimum when the %s grip crosses the opposite edge", (edge) => {
		const desired =
			edge === "start"
				? { ...originalDisplay, start: originalDisplay.end + 10 }
				: { ...originalDisplay, end: originalDisplay.start - 10 };
		const resized = getZoomResizeSpan(desired, timing, edge, {
			start: 0,
			end: 5000,
			minDurationMs: 200,
		});
		const resolved = resolveResizeEnd(active.id, resized, {
			totalMs: 5000,
			minItemDurationMs: 200,
			allRegionSpans: [active],
			hasOverlap: () => false,
		});
		expect(resolved).not.toBeNull();
		expect(resolved!.end - resolved!.start).toBeCloseTo(200, 8);
		const visible = getZoomDisplaySpan(resolved!, timing);
		if (edge === "start") expect(visible.end).toBeCloseTo(originalDisplay.end, 6);
		else expect(visible.start).toBe(originalDisplay.start);
	});

	it("limits the right grip without moving its fixed left edge", () => {
		const resized = getZoomResizeSpan({ start: 1000, end: 5000 }, timing, "end", {
			start: 500,
			end: 2000,
			minDurationMs: 200,
		});
		expect(resized).toEqual({ start: 1000, end: 2000 });
		expect(getZoomDisplaySpan(resized, timing).start).toBe(1000);
	});

	it.each([
		"start",
		"end",
	] as const)("fits an undersized legacy interval when resizing its %s edge", (edge) => {
		const resized = getZoomResizeSpan({ start: 1075, end: 1080 }, timing, edge, {
			start: 1000,
			end: 1100,
			minDurationMs: 200,
		});
		expect(resized.start).toBeCloseTo(1000, 8);
		expect(resized.end).toBeCloseTo(1100, 8);
		expect(resized.end).toBeLessThanOrEqual(1100);
	});

	it.each([
		"start",
		"end",
	] as const)("keeps fractional %s bounds inside the raw interval", (edge) => {
		const upper = 1500.123456789;
		const display = getZoomDisplaySpan({ start: 1000, end: upper }, timing);
		const resized = getZoomResizeSpan(
			edge === "start" ? { ...display, start: 0 } : { ...display, end: 5000 },
			timing,
			edge,
			{ start: 0, end: upper, minDurationMs: 1 },
		);
		expect(resized.start).toBeGreaterThanOrEqual(0);
		expect(resized.end).toBeLessThanOrEqual(upper);
		if (edge === "start")
			expect(getZoomDisplaySpan(resized, timing).end).toBeCloseTo(display.end, 6);
	});
});
