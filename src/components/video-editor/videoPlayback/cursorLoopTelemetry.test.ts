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
});
