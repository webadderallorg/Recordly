import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import {
	DEFAULT_CURSOR_IDLE_HIDE,
	getCursorIdleOpacity,
	normalizeCursorIdleHideSettings,
} from "./cursorIdleVisibility";

const point = (timeMs: number, cx = 0.5): CursorTelemetryPoint => ({ timeMs, cx, cy: 0.5 });
const opacity = (samples: CursorTelemetryPoint[], time: number) =>
	getCursorIdleOpacity(samples, time);

describe("cursor idle visibility", () => {
	it("qualifies long recorded pauses and waits half a second before fading", () => {
		const samples = [point(0, 0.1), point(1000), point(2000), point(4000), point(4500, 0.9)];
		expect(opacity(samples, 900)).toBe(1);
		expect(opacity(samples, 1000)).toBe(1);
		expect(opacity(samples, 1499)).toBe(1);
		expect(opacity(samples, 1500)).toBe(1);
		expect(opacity(samples, 1650)).toBeCloseTo(0.5);
		expect(opacity(samples, 1800)).toBe(0);
		expect(opacity(samples, 3500)).toBe(0);
		// Movement starts between the final stationary sample and the next one.
		expect(opacity(samples, 4000)).toBe(0);
		expect(opacity(samples, 4075)).toBeCloseTo(0.5);
		expect(opacity(samples, 4150)).toBe(1);
	});
	it("keeps short pauses visible and uses the configurable qualifying duration", () => {
		const short = [point(0), point(1500), point(1600, 0.8)];
		expect(opacity(short, 700)).toBe(1);
		expect(
			getCursorIdleOpacity(short, 800, {
				...DEFAULT_CURSOR_IDLE_HIDE,
				idleThresholdMs: 1000,
			}),
		).toBe(0);
	});
	it("fades initial and trailing idle periods and evaluates backwards seeks deterministically", () => {
		const samples = [point(0), point(2500)];
		expect([2400, 650, 0, 4000, 650].map((time) => opacity(samples, time))).toEqual([
			0, 0.5, 1, 0, 0.5,
		]);
	});
	it("ignores tiny jitter but counts cumulative slow movement as activity", () => {
		const jitter = Array.from({ length: 31 }, (_, i) => point(i * 100, 0.5 + (i % 2) * 0.0002));
		expect(opacity(jitter, 1000)).toBe(0);
		const slow = Array.from({ length: 31 }, (_, i) => point(i * 100, 0.5 + i * 0.0005));
		expect(opacity(slow, 1000)).toBe(1);
	});
	it("fades in on a click and keeps a held mouse button visible until release", () => {
		const samples: CursorTelemetryPoint[] = [
			point(0),
			point(3000),
			{ ...point(3100), interactionType: "click", mouseButton: 1 },
			point(5000),
			point(6000),
			{ ...point(6100), interactionType: "mouseup", mouseButton: 1 },
			point(9000),
		];
		expect(opacity(samples, 2000)).toBe(0);
		expect(opacity(samples, 3100)).toBe(0);
		expect(opacity(samples, 3175)).toBeCloseTo(0.5);
		expect(opacity(samples, 3250)).toBe(1);
		expect(opacity(samples, 5000)).toBe(1);
		expect(opacity(samples, 6100)).toBe(1);
		expect(opacity(samples, 6750)).toBeCloseTo(0.5);
		expect(opacity(samples, 7000)).toBe(0);
	});
	it("fades in deterministically when seeking in either direction", () => {
		const samples = [point(0), point(3000), point(3200, 0.8)];
		expect(
			[3150, 3075, 2999, 3000, 3037.5, 3112.5, 3075].map((time) => opacity(samples, time)),
		).toEqual([1, 0.5, 0, 0, 0.15625, 0.84375, 0.5]);
	});
	it("recovers from partial opacity without a jump if a custom fade is interrupted", () => {
		const samples = [point(0), point(600), point(610, 0.8), point(700, 0.9)];
		const settings = { ...DEFAULT_CURSOR_IDLE_HIDE, idleThresholdMs: 500 };
		const value = (time: number) => getCursorIdleOpacity(samples, time, settings);
		const start = value(600);
		expect(start).toBeGreaterThan(0);
		expect(start).toBeLessThan(1);
		expect(Math.abs(value(599.999) - start)).toBeLessThan(0.00001);
		expect(value(675)).toBeCloseTo(start + (1 - start) * 0.5);
		expect(value(750)).toBe(1);
	});
	it("continues fading in when another long pause begins during the reveal", () => {
		const samples = [
			point(0),
			point(3000),
			point(3100, 0.8),
			point(6000, 0.8),
			point(6200, 0.2),
		];
		expect(opacity(samples, 3100)).toBeCloseTo(20 / 27);
		expect(Math.abs(opacity(samples, 3099.999) - opacity(samples, 3100))).toBeLessThan(0.00001);
		expect(opacity(samples, 3150)).toBe(1);
		expect(opacity(samples, 3900)).toBe(0);
	});
	it("supports disabling and avoids inferring idle from insufficient telemetry", () => {
		expect(
			getCursorIdleOpacity([point(0), point(4000)], 1000, {
				...DEFAULT_CURSOR_IDLE_HIDE,
				enabled: false,
			}),
		).toBe(1);
		expect(opacity([], 5000)).toBe(1);
		expect(opacity([point(0)], 5000)).toBe(1);
	});
	it("does not backdate an idle interval into a sparsely sampled held interaction", () => {
		const samples: CursorTelemetryPoint[] = [
			{ ...point(0), interactionType: "click", mouseButton: 1 },
			{ ...point(4000), interactionType: "mouseup", mouseButton: 1 },
			point(6500),
		];
		expect(opacity(samples, 3000)).toBe(1);
		expect(opacity(samples, 4650)).toBeCloseTo(0.5);
	});
	it("respects simultaneous buttons and legacy down/up pairs without button IDs", () => {
		const samples: CursorTelemetryPoint[] = [
			{ ...point(0), interactionType: "click", mouseButton: 1 },
			{ ...point(1000), interactionType: "right-click", mouseButton: 2 },
			{ ...point(5000), interactionType: "mouseup", mouseButton: 2 },
			{ ...point(9000), interactionType: "mouseup", mouseButton: 1 },
			point(12000),
		];
		expect(opacity(samples, 3000)).toBe(1);
		expect(opacity(samples, 7000)).toBe(1);
		expect(opacity(samples, 9800)).toBe(0);
		const legacy: CursorTelemetryPoint[] = [
			{ ...point(0), interactionType: "click" },
			{ ...point(5000), interactionType: "mouseup" },
			point(8000),
		];
		expect(opacity(legacy, 3000)).toBe(1);
		expect(opacity(legacy, 5800)).toBe(0);
	});
	it("supports custom delays including an immediate fade and preserves short-pause visibility", () => {
		const samples = [point(0), point(3000)];
		expect(
			getCursorIdleOpacity(samples, 150, { ...DEFAULT_CURSOR_IDLE_HIDE, fadeDelayMs: 0 }),
		).toBeCloseTo(0.5);
		expect(
			getCursorIdleOpacity(samples, 1100, { ...DEFAULT_CURSOR_IDLE_HIDE, fadeDelayMs: 1000 }),
		).toBeGreaterThan(0);
		expect(
			getCursorIdleOpacity(samples, 1300, { ...DEFAULT_CURSOR_IDLE_HIDE, fadeDelayMs: 1000 }),
		).toBe(0);
		expect(normalizeCursorIdleHideSettings({ fadeDelayMs: -1 }).fadeDelayMs).toBe(0);
		expect(normalizeCursorIdleHideSettings({ fadeDelayMs: Number.NaN }).fadeDelayMs).toBe(500);
	});

	it("rebuilds an appended telemetry index and sanitizes saved settings", () => {
		const samples = [point(0), point(1000)];
		expect(opacity(samples, 800)).toBe(1);
		samples.push(point(3000));
		expect(opacity(samples, 800)).toBe(0);
		expect(normalizeCursorIdleHideSettings(undefined)).toEqual(DEFAULT_CURSOR_IDLE_HIDE);
		expect(
			normalizeCursorIdleHideSettings({
				enabled: false,
				idleThresholdMs: -5,
				fadeDurationMs: Infinity,
				movementTolerancePx: 99,
			}),
		).toEqual({
			enabled: false,
			idleThresholdMs: 500,
			fadeDelayMs: 500,
			fadeDurationMs: 300,
			movementTolerancePx: 10,
		});
	});
});
