import { describe, expect, it } from "vitest";
import { CURSOR_MOTION_PRESETS, isCinematicZoomMotion } from "../cursorMotionPresets";
import {
	getZoomDisplaySpan,
	getZoomMotionSpan,
	getZoomPresentationTiming,
} from "../timeline/core/zoomPresentation";
import type { ZoomRegion } from "../types";
import { computeCameraTransform } from "./cameraTransform";
import { createCursorFollowCameraState } from "./cursorFollowCamera";
import { createSpringState, getZoomSpringConfig } from "./motionSmoothing";
import { resolveSceneZoomTarget } from "./sceneMotion";
import { computeRegionStrength, getZoomRegionTiming } from "./zoomRegionUtils";
import { getZoomTransitionDurationMs, sampleZoomTransition } from "./zoomTransition";

const cinematic = CURSOR_MOTION_PRESETS.smooth;
const region: ZoomRegion = {
	id: "zoom",
	startMs: 1000,
	endMs: 6000,
	depth: 3,
	mode: "manual",
	focus: { cx: 0.5, cy: 0.5 },
};

describe("Cinematic zoom weight", () => {
	it("requires both Cinematic timings so Focused's shared exit duration is unaffected", () => {
		expect(isCinematicZoomMotion(cinematic)).toBe(true);
		expect(isCinematicZoomMotion(CURSOR_MOTION_PRESETS.focused)).toBe(false);
		expect(isCinematicZoomMotion({ zoomInDurationMs: cinematic.zoomInDurationMs })).toBe(false);
		expect(getZoomSpringConfig(0.5)).toMatchObject({ stiffness: 100, damping: 21, mass: 1 });
		const weighted = getZoomSpringConfig(0.5, undefined, true);
		expect(weighted.mass).toBe(1.6);
		expect(weighted.damping / (2 * Math.sqrt(weighted.stiffness * weighted.mass))).toBeCloseTo(
			1.05,
		);
	});
	it.each([
		cinematic.zoomInDurationMs,
		cinematic.zoomOutDurationMs,
	])("gently accelerates and settles over a longer response for %f ms timing", (duration) => {
		const originalDuration = getZoomTransitionDurationMs(duration);
		const weightedDuration = getZoomTransitionDurationMs(duration, true);
		expect(weightedDuration).toBeGreaterThan(originalDuration);
		for (const time of [50, 100, 200, 400])
			expect(sampleZoomTransition(time / weightedDuration, duration, true)).toBeLessThan(
				sampleZoomTransition(time / originalDuration, duration),
			);
		let previous = 0;
		for (let i = 0; i <= 1000; i++) {
			const value = sampleZoomTransition(i / 1000, duration, true);
			expect(value).toBeGreaterThanOrEqual(previous);
			expect(value).toBeLessThanOrEqual(1);
			previous = value;
		}
		expect(previous).toBe(1);
		const expected = [0.2, 0.8, 0.1, 0.9].map((p) => sampleZoomTransition(p, duration, true));
		for (let i = 0; i < 40; i++) getZoomTransitionDurationMs(20 + i * 13, i % 2 === 0);
		expect([0.2, 0.8, 0.1, 0.9].map((p) => sampleZoomTransition(p, duration, true))).toEqual(
			expected,
		);
	});
	it("keeps both weighted ramps within authored bounds and the visible timeline edge consistent", () => {
		const timing = getZoomRegionTiming(region, cinematic);
		expect(timing.zoomInEnd - region.startMs).toBe(
			getZoomTransitionDurationMs(cinematic.zoomInDurationMs, true),
		);
		expect(region.endMs - timing.zoomOutStart).toBeCloseTo(
			getZoomTransitionDurationMs(cinematic.zoomOutDurationMs, true),
		);
		expect(computeRegionStrength(region, timing.zoomInEnd, cinematic)).toBe(1);
		for (const time of [0, 999, 1000, 6000, 6001])
			expect(computeRegionStrength(region, time, cinematic)).toBe(0);
		const presentation = getZoomPresentationTiming(cinematic);
		for (const duration of [100, 1000, 5000]) {
			const authored = { start: 1000, end: 1000 + duration };
			const visible = getZoomDisplaySpan(authored, presentation);
			expect(getZoomMotionSpan(visible, presentation).end).toBeCloseTo(authored.end, 5);
		}
		const visible = getZoomDisplaySpan(
			{ start: region.startMs, end: region.endMs },
			presentation,
		);
		expect(visible.end).toBe(region.endMs);
		expect(computeRegionStrength(region, visible.end, cinematic)).toBe(0);
	});
	it("carries the same weight through connected camera moves", () => {
		const next = {
			...region,
			id: "next",
			startMs: 6500,
			endMs: 10000,
			focus: { cx: 0.7, cy: 0.5 },
		};
		const target = resolveSceneZoomTarget({
			...cinematic,
			zoomRegions: [region, next],
			timeMs: 6250,
			connectZooms: true,
			cursorFollowCamera: createCursorFollowCameraState(),
		});
		expect(target.cinematic).toBe(true);
		expect(target.connected).toBe(true);
		const simulate = (weighted: boolean) => {
			const springScale = createSpringState(1.5),
				springX = createSpringState(0.4),
				springY = createSpringState(0.5);
			const options = {
				stageSize: { width: 1000, height: 600 },
				baseMask: { x: 0, y: 0, width: 1000, height: 600 },
				springScale,
				springX,
				springY,
				deltaMs: 1000 / 60,
			};
			computeCameraTransform({
				...options,
				target: {
					scale: 1.5,
					focus: { cx: 0.4, cy: 0.5 },
					progress: 1,
					connected: true,
					cinematic: weighted,
				},
				snap: true,
			});
			for (let i = 0; i < 12; i++)
				computeCameraTransform({
					...options,
					target: {
						scale: 1.8,
						focus: { cx: 0.6, cy: 0.5 },
						progress: 1,
						connected: true,
						cinematic: weighted,
					},
				});
			return { scale: springScale.value, x: springX.value };
		};
		const weighted = simulate(true),
			regular = simulate(false);
		expect(weighted.scale).toBeGreaterThan(1.5);
		expect(weighted.scale).toBeLessThan(regular.scale);
		expect(weighted.x).toBeLessThan(regular.x);
	});
});
