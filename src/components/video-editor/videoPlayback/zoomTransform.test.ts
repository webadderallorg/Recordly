import { describe, expect, it } from "vitest";

import { computeFocusFromTransform, computeZoomTransform } from "./zoomTransform";

// Geometry for a 16:9 (1920×1080) recording laid out inside a 1:1 (1080×1080)
// editor canvas with no padding. The video display rect is letterboxed
// vertically: 1080×607.5 starting at y = 236.25.
const STAGE_16_9_IN_1_1 = { width: 1080, height: 1080 } as const;
const BASE_MASK_16_9_IN_1_1 = { x: 0, y: 236.25, width: 1080, height: 607.5 } as const;

// Geometry for a recording that exactly fills the canvas (no padding,
// no aspect mismatch).
const STAGE_FULL = { width: 1920, height: 1080 } as const;
const BASE_MASK_FULL = { x: 0, y: 0, width: 1920, height: 1080 } as const;

function visibleStageRect(
	transform: { scale: number; x: number; y: number },
	stage: { width: number; height: number },
) {
	const top = -transform.y / transform.scale;
	const left = -transform.x / transform.scale;
	return {
		left,
		top,
		right: left + stage.width / transform.scale,
		bottom: top + stage.height / transform.scale,
	};
}

describe("computeZoomTransform", () => {
	it("returns identity transform when geometry is degenerate", () => {
		expect(
			computeZoomTransform({
				stageSize: { width: 0, height: 0 },
				baseMask: { x: 0, y: 0, width: 0, height: 0 },
				zoomScale: 2,
				focusX: 0.5,
				focusY: 0.5,
			}),
		).toEqual({ scale: 1, x: 0, y: 0 });
	});

	it("centers a centered focus on the canvas (full-canvas video)", () => {
		const transform = computeZoomTransform({
			stageSize: STAGE_FULL,
			baseMask: BASE_MASK_FULL,
			zoomScale: 2,
			focusX: 0.5,
			focusY: 0.5,
		});

		// Focus at video center → scaled center stays at canvas center.
		expect(transform.scale).toBe(2);
		expect(transform.x).toBeCloseTo(STAGE_FULL.width / 2 - (BASE_MASK_FULL.width / 2) * 2, 6);
		expect(transform.y).toBeCloseTo(STAGE_FULL.height / 2 - (BASE_MASK_FULL.height / 2) * 2, 6);
	});

	it("scales the offset linearly with zoomProgress", () => {
		const full = computeZoomTransform({
			stageSize: STAGE_FULL,
			baseMask: BASE_MASK_FULL,
			zoomScale: 2,
			focusX: 0.5,
			focusY: 0.5,
		});
		const half = computeZoomTransform({
			stageSize: STAGE_FULL,
			baseMask: BASE_MASK_FULL,
			zoomScale: 2,
			zoomProgress: 0.5,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(half.x).toBeCloseTo(full.x * 0.5, 6);
		expect(half.y).toBeCloseTo(full.y * 0.5, 6);
		expect(half.scale).toBeCloseTo(1.5, 6);
	});

	it("keeps the visible window inside baseMask when focus is at the top edge of a 16:9 recording on a 1:1 canvas", () => {
		// Without clamping, focus.cy = 0 would pan the camera so the top edge
		// of the displayed video sits at canvas center, dragging the letterbox
		// padding into the upper half of the visible canvas.
		const transform = computeZoomTransform({
			stageSize: STAGE_16_9_IN_1_1,
			baseMask: BASE_MASK_16_9_IN_1_1,
			zoomScale: 2,
			focusX: 0.5,
			focusY: 0,
		});

		const visible = visibleStageRect(transform, STAGE_16_9_IN_1_1);
		expect(visible.top).toBeGreaterThanOrEqual(BASE_MASK_16_9_IN_1_1.y - 1e-6);
		expect(visible.bottom).toBeLessThanOrEqual(
			BASE_MASK_16_9_IN_1_1.y + BASE_MASK_16_9_IN_1_1.height + 1e-6,
		);
	});

	it("keeps the visible window inside baseMask when focus is at the bottom edge", () => {
		const transform = computeZoomTransform({
			stageSize: STAGE_16_9_IN_1_1,
			baseMask: BASE_MASK_16_9_IN_1_1,
			zoomScale: 2,
			focusX: 0.5,
			focusY: 1,
		});

		const visible = visibleStageRect(transform, STAGE_16_9_IN_1_1);
		expect(visible.top).toBeGreaterThanOrEqual(BASE_MASK_16_9_IN_1_1.y - 1e-6);
		expect(visible.bottom).toBeLessThanOrEqual(
			BASE_MASK_16_9_IN_1_1.y + BASE_MASK_16_9_IN_1_1.height + 1e-6,
		);
	});

	it("does not move focus that already sits inside the safe region", () => {
		// At zoomScale=2 on a 1:1 canvas wrapping 16:9, the safe vertical range
		// for focusStagePxY is roughly [506.25, 573.75]. cy=0.5 maps to 540.
		const safeFocusY = 0.5;
		const transform = computeZoomTransform({
			stageSize: STAGE_16_9_IN_1_1,
			baseMask: BASE_MASK_16_9_IN_1_1,
			zoomScale: 2,
			focusX: 0.5,
			focusY: safeFocusY,
		});

		const expectedFocusPxY =
			BASE_MASK_16_9_IN_1_1.y + safeFocusY * BASE_MASK_16_9_IN_1_1.height;
		const expectedY = STAGE_16_9_IN_1_1.height / 2 - expectedFocusPxY * 2;
		expect(transform.y).toBeCloseTo(expectedY, 6);
	});

	it("snaps focus to the baseMask center axis when the visible window is larger than baseMask", () => {
		// At zoomScale=1 the visible window equals the canvas (1080×1080),
		// which is taller than the 16:9 video display rect (607.5). No vertical
		// clamp range exists, so focus snaps vertically to baseMask center.
		const transform = computeZoomTransform({
			stageSize: STAGE_16_9_IN_1_1,
			baseMask: BASE_MASK_16_9_IN_1_1,
			zoomScale: 1,
			focusX: 0.5,
			focusY: 0,
		});

		const baseMaskCenterY = BASE_MASK_16_9_IN_1_1.y + BASE_MASK_16_9_IN_1_1.height / 2;
		// At zoomScale=1 with progress=1: x = stageCenter - focusPx * 1.
		const expectedY = STAGE_16_9_IN_1_1.height / 2 - baseMaskCenterY;
		expect(transform.y).toBeCloseTo(expectedY, 6);
	});

	it("treats zoomScale<=0 defensively without dividing by zero", () => {
		const transform = computeZoomTransform({
			stageSize: STAGE_FULL,
			baseMask: BASE_MASK_FULL,
			zoomScale: 0,
			focusX: 0.5,
			focusY: 0.5,
		});
		expect(Number.isFinite(transform.x)).toBe(true);
		expect(Number.isFinite(transform.y)).toBe(true);
	});
});

describe("computeFocusFromTransform", () => {
	it("recovers the focus produced by computeZoomTransform for an unconstrained focus", () => {
		const focusX = 0.4;
		const focusY = 0.6;
		const zoomScale = 2;
		const transform = computeZoomTransform({
			stageSize: STAGE_FULL,
			baseMask: BASE_MASK_FULL,
			zoomScale,
			focusX,
			focusY,
		});
		const recovered = computeFocusFromTransform({
			stageSize: STAGE_FULL,
			baseMask: BASE_MASK_FULL,
			zoomScale,
			x: transform.x,
			y: transform.y,
		});
		expect(recovered.cx).toBeCloseTo(focusX, 6);
		expect(recovered.cy).toBeCloseTo(focusY, 6);
	});

	it("recovers the clamped focus for an out-of-safe-range input on a letterboxed canvas", () => {
		const zoomScale = 2;
		const transform = computeZoomTransform({
			stageSize: STAGE_16_9_IN_1_1,
			baseMask: BASE_MASK_16_9_IN_1_1,
			zoomScale,
			focusX: 0.5,
			focusY: 0,
		});
		const recovered = computeFocusFromTransform({
			stageSize: STAGE_16_9_IN_1_1,
			baseMask: BASE_MASK_16_9_IN_1_1,
			zoomScale,
			x: transform.x,
			y: transform.y,
		});

		// Recovered cy should sit at the upper end of the safe range, not at 0.
		expect(recovered.cy).toBeGreaterThan(0);
		expect(recovered.cy).toBeLessThanOrEqual(0.5);
		expect(recovered.cx).toBeCloseTo(0.5, 6);
	});
});
