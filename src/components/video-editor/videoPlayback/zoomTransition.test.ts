import { describe, expect, it } from "vitest";
import { easeOutZoom } from "./mathUtils";
import {
	getZoomTransitionDurationMs,
	getZoomTransitionVisibleDurationMs,
	sampleZoomTransition,
} from "./zoomTransition";

const targetDurations = [200, 200 / 0.7, 200 / 0.49];
type Sample = { timeMs: number; progress: number };

/**
 * Independently integrate the previous camera's default spring (k=100, c=21,
 * m=1) against its eased zoom target using 1 ms Runge–Kutta steps.
 */
function simulatePreviousCamera(targetDurationMs: number): Sample[] {
	const samples: Sample[] = [{ timeMs: 0, progress: 0 }];
	let position = 0;
	let velocity = 0;
	const stepSec = 0.001;
	const acceleration = (timeMs: number, value: number, speed: number) =>
		100 * (easeOutZoom(timeMs / targetDurationMs) - value) - 21 * speed;
	for (let timeMs = 0; timeMs < 1800; timeMs += 1) {
		const a1 = acceleration(timeMs, position, velocity);
		const v2 = velocity + (a1 * stepSec) / 2;
		const a2 = acceleration(timeMs + 0.5, position + (velocity * stepSec) / 2, v2);
		const v3 = velocity + (a2 * stepSec) / 2;
		const a3 = acceleration(timeMs + 0.5, position + (v2 * stepSec) / 2, v3);
		const v4 = velocity + a3 * stepSec;
		const a4 = acceleration(timeMs + 1, position + v3 * stepSec, v4);
		position += (stepSec / 6) * (velocity + 2 * v2 + 2 * v3 + v4);
		velocity += (stepSec / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
		samples.push({ timeMs: timeMs + 1, progress: position });
	}
	return samples;
}

function crossingTime(samples: Sample[], threshold: number): number {
	const index = samples.findIndex((sample) => sample.progress >= threshold);
	if (index <= 0) throw new Error(`No rising crossing for ${threshold}`);
	const before = samples[index - 1];
	const after = samples[index];
	const fraction = (threshold - before.progress) / (after.progress - before.progress);
	return before.timeMs + fraction * (after.timeMs - before.timeMs);
}

describe("bounded zoom transition profiles", () => {
	it.each(
		targetDurations,
	)("locates the visible boundary without changing the %f ms motion profile", (targetDurationMs) => {
		const fullDuration = getZoomTransitionDurationMs(targetDurationMs);
		const before = [0, 0.1, 0.5, 0.9, 0.99, 1].map((progress) =>
			sampleZoomTransition(progress, targetDurationMs),
		);
		const visibleDuration = getZoomTransitionVisibleDurationMs(targetDurationMs);
		expect(fullDuration - visibleDuration).toBeGreaterThan(250);
		expect(sampleZoomTransition(visibleDuration / fullDuration, targetDurationMs)).toBeCloseTo(
			0.99,
			10,
		);
		expect(
			sampleZoomTransition((visibleDuration / fullDuration + 1) / 2, targetDurationMs),
		).toBeGreaterThan(0.99);
		expect(getZoomTransitionDurationMs(targetDurationMs)).toBe(fullDuration);
		expect(
			[0, 0.1, 0.5, 0.9, 0.99, 1].map((progress) =>
				sampleZoomTransition(progress, targetDurationMs),
			),
		).toEqual(before);
	});

	it.each(
		targetDurations,
	)("preserves the previous visible camera timing for a %f ms target", (targetDurationMs) => {
		const previous = simulatePreviousCamera(targetDurationMs);
		const durationMs = getZoomTransitionDurationMs(targetDurationMs);
		const bounded: Sample[] = [];
		for (let timeMs = 0; timeMs <= Math.ceil(durationMs); timeMs += 1) {
			bounded.push({
				timeMs,
				progress: sampleZoomTransition(timeMs / durationMs, targetDurationMs),
			});
		}

		const previous10 = crossingTime(previous, 0.1);
		const previous90 = crossingTime(previous, 0.9);
		const bounded10 = crossingTime(bounded, 0.1);
		const bounded90 = crossingTime(bounded, 0.9);
		expect(Math.abs(bounded10 - previous10)).toBeLessThan(8);
		expect(Math.abs(bounded90 - previous90)).toBeLessThan(8);
		expect(Math.abs(bounded90 - bounded10 - (previous90 - previous10))).toBeLessThan(8);
		// Most visible motion must occupy hundreds of milliseconds, not a few frames.
		expect(bounded90 - bounded10).toBeGreaterThan(350);
		expect(bounded90 - bounded10).toBeLessThan(420);
		// Reserve the complete visible response, including its finite settling tail.
		expect(durationMs).toBeGreaterThan(1000);
		expect(durationMs).toBeLessThan(1300);
		expect(durationMs).toBeGreaterThan(bounded90);
	});

	it.each(
		targetDurations,
	)("is monotonic and reaches exact endpoints for a %f ms target", (targetDurationMs) => {
		expect(sampleZoomTransition(-1, targetDurationMs)).toBe(0);
		expect(sampleZoomTransition(0, targetDurationMs)).toBe(0);
		let previous = 0;
		for (let frame = 1; frame <= 1000; frame += 1) {
			const progress = sampleZoomTransition(frame / 1000, targetDurationMs);
			expect(progress).toBeGreaterThanOrEqual(previous);
			expect(progress).toBeLessThanOrEqual(1);
			previous = progress;
		}
		expect(previous).toBe(1);
		expect(sampleZoomTransition(2, targetDurationMs)).toBe(1);
	});

	it.each(
		targetDurations,
	)("samples independently of playback order and cache history for a %f ms target", (targetDurationMs) => {
		const positions = [0, 0.02, 0.1, 0.25, 0.5, 0.77, 0.95, 1];
		const durationMs = getZoomTransitionDurationMs(targetDurationMs);
		const expected = positions.map((position) =>
			sampleZoomTransition(position, targetDurationMs),
		);
		const repeated = positions.map((position) =>
			sampleZoomTransition(position, targetDurationMs),
		);
		expect(repeated).toEqual(expected);
		const reversed = [...positions]
			.reverse()
			.map((position) => sampleZoomTransition(position, targetDurationMs));
		expect(reversed.reverse()).toEqual(expected);

		// Other renderers/projects can populate and evict cached profiles freely.
		for (let index = 1; index <= 40; index += 1) {
			sampleZoomTransition(0.5, 50 + index * 7);
		}
		expect(getZoomTransitionDurationMs(targetDurationMs)).toBe(durationMs);
		expect(
			positions.map((position) => sampleZoomTransition(position, targetDurationMs)),
		).toEqual(expected);
	});
});
