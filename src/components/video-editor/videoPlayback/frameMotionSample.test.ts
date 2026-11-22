import { describe, expect, it } from "vitest";
import { computeCursorFrameBlur, getFrameMotionSample } from "./frameMotionSample";

const clips = [
	{ id: "a", startMs: 0, endMs: 1000, sourceStartMs: 0, speed: 1 },
	{ id: "b", startMs: 1000, endMs: 2000, sourceStartMs: 10000, speed: 2 },
];
describe("frozen frame motion sampling", () => {
	it("samples the same neighboring frame regardless of scrub direction", () => {
		const sample = getFrameMotionSample(1500, clips)!;
		expect(sample.previousTimeMs).toBeCloseTo(1500 - 1000 / 60);
		expect(sample.previousSourceTimeMs).toBe(10966);
		expect(sample.deltaMs).toBeCloseTo(1000 / 60);
	});
	it("never samples across a cut or a gap", () => {
		expect(getFrameMotionSample(1000, clips)).toBeNull();
		expect(getFrameMotionSample(1005, clips)?.previousTimeMs).toBe(1000);
		expect(getFrameMotionSample(2500, clips)).toBeNull();
		expect(getFrameMotionSample(0, [])).toBeNull();
	});
	it("uses nearby telemetry for cursor blur and clears it for stationary frames or cuts", () => {
		const samples = [
			{ timeMs: 0, cx: 0.2, cy: 0.5 },
			{ timeMs: 1000, cx: 0.8, cy: 0.5 },
		];
		const viewport = { x: 0, y: 0, width: 1000, height: 500 };
		const blur = computeCursorFrameBlur(samples, 500, 500 - 1000 / 60, viewport, 1, 1);
		expect(blur.velocity.x).toBeCloseTo(10);
		expect(blur.velocity.y).toBe(0);
		expect(computeCursorFrameBlur(samples, 500, null, viewport, 1, 1).magnitude).toBe(0);
		expect(computeCursorFrameBlur(samples, 1500, 1483, viewport, 1, 1).magnitude).toBe(0);
	});
	it("does not smear a cursor entering a crop from outside", () => {
		const samples = [
			{ timeMs: 0, cx: 0, cy: 0.5 },
			{ timeMs: 1000, cx: 1, cy: 0.5 },
		];
		expect(
			computeCursorFrameBlur(
				samples,
				500,
				400,
				{
					x: 0,
					y: 0,
					width: 1000,
					height: 500,
					sourceCrop: { x: 0.45, y: 0, width: 0.5, height: 1 },
				},
				1,
				1,
			).magnitude,
		).toBe(0);
	});
});
