import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_PRESETS } from "../cursorMotionPresets";
import type { ZoomRegion } from "../types";
import {
	computeRegionStrength,
	findDominantRegion,
	getConnectedZoomEndMs,
	getZoomRegionTiming,
} from "./zoomRegionUtils";
import { getZoomTransitionDurationMs } from "./zoomTransition";

const region: ZoomRegion = {
	id: "zoom",
	startMs: 1000,
	endMs: 4000,
	depth: 2,
	focus: { cx: 0.4, cy: 0.6 },
};

describe("zoom timeline duration", () => {
	it("keeps Regular and Smooth zoom timings alongside the requested 230ms click default", () => {
		const { focused, smooth } = CURSOR_MOTION_PRESETS;
		expect(focused.zoomInDurationMs).toBe(200);
		expect(focused.zoomOutDurationMs).toBeCloseTo(200 / 0.7);
		expect(smooth.zoomInDurationMs).toBeCloseTo(200 / 0.7);
		expect(smooth.zoomOutDurationMs).toBeCloseTo(200 / 0.49);
		expect(focused.cursorClickBounceDuration).toBe(230);
		expect(smooth.cursorClickBounceDuration).toBe(230);
	});

	it.each(["focused", "smooth"] as const)("contains every phase of %s inside its block", (id) => {
		const preset = CURSOR_MOTION_PRESETS[id];
		const strength = (time: number) => computeRegionStrength(region, time, preset);
		for (const time of [0, 999, 1000, 4000, 4001, 5000]) expect(strength(time)).toBe(0);
		const timing = getZoomRegionTiming(region, preset);
		expect(timing.zoomInEnd - region.startMs).toBeGreaterThan(1000);
		expect(region.endMs - timing.zoomOutStart).toBeGreaterThan(1000);
		expect(strength(timing.zoomInEnd)).toBe(1);
		expect(strength(timing.zoomOutStart)).toBe(1);
		const exitMidpoint = (timing.zoomOutStart + region.endMs) / 2;
		expect(strength(exitMidpoint)).toBeGreaterThan(0);
		expect(strength(exitMidpoint)).toBeLessThan(1);
	});

	it("keeps transition clocks fixed while short blocks overlap their ramps", () => {
		const options = { zoomInDurationMs: 200, zoomOutDurationMs: 300 };
		const entry = getZoomTransitionDurationMs(200);
		const exit = getZoomTransitionDurationMs(300);
		for (const duration of [50, 100, 500, 1000, 2000, 3000]) {
			const short = { ...region, endMs: region.startMs + duration };
			const timing = getZoomRegionTiming(short, options);
			expect(timing.zoomInEnd - short.startMs).toBeCloseTo(entry);
			expect(short.endMs - timing.zoomOutStart).toBeCloseTo(exit);
			if (duration < entry + exit) expect(timing.zoomOutStart).toBeLessThan(timing.zoomInEnd);
		}
	});

	it.each([
		"focused",
		"smooth",
	] as const)("shortening a %s block never advances either transition", (id) => {
		const options = CURSOR_MOTION_PRESETS[id];
		const long = { ...region, endMs: 10000 };
		for (const duration of [50, 100, 500, 1000, 1500, 2000]) {
			const short = { ...region, endMs: region.startMs + duration };
			const alignedEnd = { ...region, startMs: short.endMs - 9000, endMs: short.endMs };
			let peak = 0;
			for (let time = short.startMs; time < short.endMs; time += 1) {
				const strength = computeRegionStrength(short, time, options);
				expect(strength).toBeLessThanOrEqual(
					computeRegionStrength(long, time, options) + 1e-12,
				);
				expect(strength).toBeLessThanOrEqual(
					computeRegionStrength(alignedEnd, time, options) + 1e-12,
				);
				peak = Math.max(peak, strength);
			}
			expect(peak).toBeGreaterThan(0);
			expect(peak).toBeLessThan(1);
			expect(computeRegionStrength(short, short.endMs, options)).toBe(0);
		}
	});

	it("rejects empty/reversed blocks and safely defaults invalid durations", () => {
		expect(computeRegionStrength({ ...region, endMs: 999 }, 1000)).toBe(0);
		expect(computeRegionStrength({ ...region, endMs: 1000 }, 1000)).toBe(0);
		expect(
			Number.isFinite(computeRegionStrength(region, 2000, { zoomInDurationMs: Number.NaN })),
		).toBe(true);
	});
});

describe("connected zoom duration", () => {
	const next: ZoomRegion = { ...region, id: "next", startMs: 4500, endMs: 7000, depth: 4 };
	const options = {
		connectZooms: true,
		zoomInDurationMs: 200,
		zoomOutDurationMs: 300,
		connectedZoomDurationMs: 1000,
	};

	it.each([
		[100, 200, 100],
		[3000, 500, 100],
		[100, 200, 3000],
		[6400, 695, 1000],
	])("shares one uncompressed envelope across blocks %i / gap %i / %i", (firstDuration, gap, lastDuration) => {
		const first = { ...region, startMs: 789, endMs: 789 + firstDuration };
		const last = {
			...next,
			startMs: first.endMs + gap,
			endMs: first.endMs + gap + lastDuration,
		};
		const chain = { startMs: first.startMs, endMs: getConnectedZoomEndMs(last, options) };
		const times = new Set<number>([
			first.startMs,
			first.endMs - 0.001,
			first.endMs,
			first.endMs + 0.001,
			last.startMs - 0.001,
			last.startMs,
			last.startMs + 0.001,
			last.endMs - 0.001,
			last.endMs,
		]);
		for (let t = chain.startMs; t <= chain.endMs; t += 1000 / 60) times.add(t);
		for (const time of times) {
			expect(findDominantRegion([first, last], time, options).strength).toBeCloseTo(
				computeRegionStrength(chain, time, options),
				10,
			);
		}
	});

	it("reaches the saved project's second 1.8x target before its full fixed exit", () => {
		const first = { ...region, startMs: 789, endMs: 7189, depth: 3 as const };
		const last = { ...first, id: "last", startMs: 7884, endMs: 8884 };
		const settings = { ...options, ...CURSOR_MOTION_PRESETS.focused };
		const exitMs = getZoomTransitionDurationMs(settings.zoomOutDurationMs);
		expect(findDominantRegion([first, last], last.startMs, settings).strength).toBe(1);
		for (const elapsed of [0, 50, 200, 500, 1000]) {
			const expected = computeRegionStrength(
				{ startMs: first.startMs, endMs: last.startMs + exitMs },
				last.startMs + elapsed,
				settings,
			);
			expect(
				findDominantRegion([first, last], last.startMs + elapsed, settings).strength,
			).toBeCloseTo(expected, 10);
		}
		expect(
			findDominantRegion([first, last], last.endMs + 50, settings).strength,
		).toBeGreaterThan(0);
		expect(findDominantRegion([first, last], last.startMs + exitMs, settings).strength).toBe(0);
	});

	it("uses the configured goal duration without adding a simulated spring tail", () => {
		const later = { ...next, startMs: 5500, endMs: 8000 };
		const settings = { ...options, connectedZoomDurationMs: 200 };
		const mid = findDominantRegion([region, later], 4100, settings);
		expect(mid.transition?.progress).toBeGreaterThan(0.9);
		expect(mid.transition?.progress).toBeLessThan(1);
		expect(findDominantRegion([region, later], 4199, settings).transition).not.toBeNull();
		const end = findDominantRegion([region, later], 4200, settings);
		expect(end.transition).toBeNull();
		expect(end.completedTransition?.progress).toBe(1);
		expect(end.region?.id).toBe(later.id);
	});

	it("keeps connected timing independent of isolated zoom-in/out durations", () => {
		for (const timeMs of [4000, 4100, 4250, 4499, 4500]) {
			const fast = findDominantRegion([region, next], timeMs, options);
			const slow = findDominantRegion([region, next], timeMs, {
				...options,
				zoomInDurationMs: 200 / 0.7,
				zoomOutDurationMs: 200 / 0.49,
			});
			expect(slow.transition).toEqual(fast.transition);
			expect(slow.blendedScale).toEqual(fast.blendedScale);
			expect(slow.region?.focus).toEqual(fast.region?.focus);
		}
	});

	it("interpolates depth continuously over the configured handoff", () => {
		const startMs = region.endMs;
		const endMs = Math.min(next.startMs, startMs + options.connectedZoomDurationMs);
		const before = findDominantRegion([region, next], startMs - 0.001, options);
		const start = findDominantRegion([region, next], startMs, options);
		const middle = findDominantRegion([region, next], (startMs + endMs) / 2, options);
		const end = findDominantRegion([region, next], endMs, options);
		expect(before.region?.id).toBe(region.id);
		expect(before.transition).toBeNull();
		expect(start.blendedScale).toBe(1.5);
		expect(start.strength).toBeCloseTo(before.strength);
		expect(middle.blendedScale).toBeGreaterThan(1.5);
		expect(middle.blendedScale).toBeLessThan(2.2);
		expect(end.transition).toBeNull();
		expect(end.region?.id).toBe("next");
		expect(end.strength).toBe(1);
	});

	it("holds outgoing framing until the block ends and finishes before the incoming block", () => {
		for (const time of [3000, 3500, 3999]) {
			const result = findDominantRegion([region, next], time, options);
			expect(result.transition).toBeNull();
			expect(result.region?.id).toBe("zoom");
			expect(result.strength).toBe(1);
		}
		for (const time of [4500, 4501, 5000]) {
			const result = findDominantRegion([region, next], time, options);
			expect(result.transition).toBeNull();
			expect(result.region?.id).toBe("next");
			expect(result.strength).toBe(1);
		}
	});

	it("holds the incoming framing when the pan finishes before a longer gap ends", () => {
		const later = { ...next, startMs: 5500, endMs: 8000 };
		const panEnd = region.endMs + options.connectedZoomDurationMs;
		expect(panEnd).toBeLessThan(later.startMs);
		const result = findDominantRegion([region, later], panEnd + 10, options);
		expect(result.transition).toBeNull();
		expect(result.region?.id).toBe("next");
		expect(result.strength).toBe(1);
		expect(result.completedTransition?.progress).toBe(1);
	});

	it("does not invent a pan interval for touching or overlapping blocks", () => {
		for (const startMs of [3900, 4000]) {
			const touching = { ...next, startMs };
			const result = findDominantRegion([region, touching], 4000, options);
			expect(result.transition).toBeNull();
			expect(result.completedTransition).toBeUndefined();
		}
	});

	it("obeys the connection gap limit", () => {
		const result = findDominantRegion([region, next], 4200, {
			...options,
			connectedZoomGapMs: 400,
		});
		expect(result.region).toBeNull();
	});

	it.each([
		4550, 4600,
	])("does not resurrect a connected exit after an unconnected block at %i interrupts it", (startMs) => {
		const short = { ...next, endMs: 4600 };
		const last = { ...short, id: "last", startMs, endMs: 4700, depth: 3 as const };
		expect(findDominantRegion([region, short, last], 4601, options).region?.id).toBe(last.id);
		for (const time of [4700, 4701, 5000]) {
			expect(findDominantRegion([region, short, last], time, options).strength).toBe(0);
		}
	});
});
