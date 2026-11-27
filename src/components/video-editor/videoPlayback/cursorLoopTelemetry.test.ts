import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { buildLoopedCursorTelemetry } from "./cursorLoopTelemetry";
import { isRecordedCursorVisible } from "./cursorPosition";

describe("buildLoopedCursorTelemetry", () => {
	it("seeds visibility and interpolated position from timelineStartClampedMs without letting a later hide overwrite the start", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.2, cy: 0.2, cursorType: "arrow", cursorVisible: true },
			{ timeMs: 100, cx: 0.4, cy: 0.4, cursorVisible: false },
			{ timeMs: 500, cx: 0.8, cy: 0.8, cursorType: "pointer", cursorVisible: true },
			{ timeMs: 1000, cx: 0.8, cy: 0.8 },
		];

		const looped = buildLoopedCursorTelemetry(samples, 1000, 50);

		expect(looped[0]?.timeMs).toBe(50);
		expect(looped[0]?.cx).toBeCloseTo(0.3);
		expect(looped[0]?.cy).toBeCloseTo(0.3);
		expect(isRecordedCursorVisible(looped, 50)).toBe(true);

		const hideSample = looped.find((sample) => sample.cursorVisible === false);
		expect(hideSample).toBeDefined();
		expect(hideSample!.timeMs).toBeGreaterThan(50);

		const lastSample = looped[looped.length - 1];
		expect(lastSample?.cx).toBeCloseTo(0.3);
		expect(lastSample?.cy).toBeCloseTo(0.3);
	});

	it("preserves boundary-aligned start samples and compressed post-start hide transitions", () => {
		const boundarySamples: CursorTelemetryPoint[] = [
			{ timeMs: 100, cx: 0.25, cy: 0.25, cursorType: "arrow", cursorVisible: true },
			{ timeMs: 300, cx: 0.25, cy: 0.25, cursorVisible: false },
			{ timeMs: 600, cx: 0.75, cy: 0.75, cursorVisible: true },
			{ timeMs: 1200, cx: 0.75, cy: 0.75 },
		];
		const boundaryLooped = buildLoopedCursorTelemetry(boundarySamples, 1200, 100);
		expect(boundaryLooped[0]?.timeMs).toBe(100);
		expect(boundaryLooped[0]?.cx).toBeCloseTo(0.25);
		expect(isRecordedCursorVisible(boundaryLooped, 100)).toBe(true);

		const compressedSamples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.1, cy: 0.1, cursorType: "arrow", cursorVisible: true },
			{ timeMs: 51, cx: 0.2, cy: 0.2, cursorVisible: false },
			{ timeMs: 10000, cx: 0.9, cy: 0.9, cursorVisible: true },
		];
		const compressedLooped = buildLoopedCursorTelemetry(compressedSamples, 10000, 50);
		expect(isRecordedCursorVisible(compressedLooped, 50)).toBe(true);
		expect(
			compressedLooped.find((sample) => sample.cursorVisible === false)?.timeMs,
		).toBeGreaterThan(50);
	});
	it.each([
		650, 720, 721,
	])("keeps source visibility when the return would erase edges in the window ending at %i ms", (endMs) => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.25, cy: 0.25, cursorVisible: true },
			{ timeMs: 100, cx: 0.25, cy: 0.25, cursorVisible: false },
			{ timeMs: 400, cx: 0.5, cy: 0.5, cursorVisible: true },
			{ timeMs: 600, cx: 0.75, cy: 0.75 },
		];
		const looped = buildLoopedCursorTelemetry(samples, endMs, 50);
		expect(isRecordedCursorVisible(looped, 50)).toBe(true);
		expect(isRecordedCursorVisible(looped, 100)).toBe(false);
		expect(isRecordedCursorVisible(looped, 400)).toBe(true);
	});

	it("retains close hide and show events even when a longer loop rounds them to the same time", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.25, cy: 0.25, cursorVisible: true },
			{ timeMs: 100, cx: 0.25, cy: 0.25, cursorVisible: false },
			{ timeMs: 101, cx: 0.5, cy: 0.5, cursorVisible: true },
			{ timeMs: 990, cx: 0.75, cy: 0.75 },
		];
		const looped = buildLoopedCursorTelemetry(samples, 1000, 50);
		expect(isRecordedCursorVisible(looped, 100)).toBe(false);
		expect(isRecordedCursorVisible(looped, 101)).toBe(true);
	});

	it("still loops when a hide and show already share the same source timestamp", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.25, cy: 0.25, cursorVisible: true },
			{ timeMs: 100, cx: 0.25, cy: 0.25, cursorVisible: false },
			{ timeMs: 100, cx: 0.5, cy: 0.5, cursorVisible: true },
			{ timeMs: 990, cx: 0.75, cy: 0.75 },
		];
		const looped = buildLoopedCursorTelemetry(samples, 1000, 50);
		expect(looped.at(-1)).toMatchObject({ timeMs: 1000, cx: 0.25, cy: 0.25 });
	});

	it("uses the first in-window position for legacy recordings", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.1, cy: 0.2 },
			{ timeMs: 200, cx: 0.5, cy: 0.6 },
			{ timeMs: 1000, cx: 0.9, cy: 0.8 },
		];
		const looped = buildLoopedCursorTelemetry(samples, 1000, 50);
		expect(looped[0]).toMatchObject({ timeMs: 50, cx: 0.5, cy: 0.6 });
		expect(looped.at(-1)).toMatchObject({ timeMs: 1000, cx: 0.5, cy: 0.6 });
	});
});
