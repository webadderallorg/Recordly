import { describe, expect, it } from "vitest";
import { DEFAULT_ZOOM_MOTION_BLUR_TUNING } from "../types";
import { analyzeCameraStep, computeTransformQuad } from "./cameraMotionBlur";

describe("camera motion dominance", () => {
	const baseMask = { x: 0, y: 0, width: 800, height: 600 };

	function analyze(
		scale: number,
		centerMoveX: number,
		centerMoveY = 0,
		tuning = DEFAULT_ZOOM_MOTION_BLUR_TUNING,
	) {
		return analyzeCameraStep({
			previousQuad: computeTransformQuad(baseMask, { scale: 1, x: 0, y: 0 }),
			currentQuad: computeTransformQuad(baseMask, {
				scale,
				x: centerMoveX - (scale - 1) * 400,
				y: centerMoveY - (scale - 1) * 300,
			}),
			stageSize: { width: 1000, height: 800 },
			motionBlurAmount: 0.5,
			motionBlurTuning: tuning,
			deltaSeconds: 1 / 60,
		});
	}

	it.each([1.01, 0.99])("routes fast pans with scale %s in either direction", (scale) => {
		for (const direction of [-1, 1]) {
			const result = analyze(scale, direction * 120, direction * 24);
			expect(result.mode).toBe("move");
			expect(result.moveBlurVelocity.x * direction).toBeGreaterThan(0);
			expect(result.zoomStrength).toBe(0);
		}
	});

	it.each([1.01, 0.99])("preserves off-centre zooms with scale %s", (scale) => {
		// Zoom around the top-left corner: the centre moves, but resizing dominates.
		const result = analyze(scale, (scale - 1) * 400, (scale - 1) * 300);
		expect(result.mode).toBe("zoom");
		expect(result.zoomStrength).toBeGreaterThan(0);
		expect(result.moveBlurVelocity).toEqual({ x: 0, y: 0 });
		expect(result.zoomCenter.x).toBeCloseTo(0);
		expect(result.zoomCenter.y).toBeCloseTo(0);
	});

	it.each([
		[9, "zoom"],
		[10, "move"],
		[11, "move"],
	] as const)("routes %s px movement against a 10 px size change to %s", (move, mode) => {
		// An 800x600 card growing by 1% has a (8, 6) px size delta of length 10.
		expect(analyze(1.01, move).mode).toBe(mode);
	});

	it("selects the active mode when the dominant motion is below its velocity threshold", () => {
		expect(
			analyze(1.01, 120, 0, {
				...DEFAULT_ZOOM_MOTION_BLUR_TUNING,
				panVelocityThreshold: 10_000,
			}).mode,
		).toBe("zoom");
		expect(
			analyze(1.01, 1, 0, {
				...DEFAULT_ZOOM_MOTION_BLUR_TUNING,
				zoomVelocityThreshold: 1,
			}).mode,
		).toBe("move");
	});

	it("uses a 25% shorter pan exposure while retaining direction and saved tuning", () => {
		const result = analyze(1, 120, 24);
		expect(result.moveBlurVelocity).toEqual({ x: 180, y: 36 });
		expect(result.moveBlurOffset).toBeCloseTo(-Math.hypot(180, 36) / 32);
		const custom = analyze(1, 120, 24, {
			...DEFAULT_ZOOM_MOTION_BLUR_TUNING,
			maxDirectionalBlurPx: DEFAULT_ZOOM_MOTION_BLUR_TUNING.maxDirectionalBlurPx * 2,
		});
		expect(custom.moveBlurVelocity).toEqual({ x: 360, y: 72 });
	});

	it("clears both blur paths when neither motion is active", () => {
		const result = analyze(1, 0);
		expect(result.mode).toBeNull();
		expect(result.moveBlurVelocity).toEqual({ x: 0, y: 0 });
		expect(result.zoomStrength).toBe(0);
	});
});
