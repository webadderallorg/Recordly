import { describe, expect, it } from "vitest";
import {
	analyzeZoomMotionBlurStep,
	applyZoomTransform,
	computeZoomTransform,
	createMotionBlurState,
} from "./zoomTransform";

function createStubContainer() {
	return {
		scale: { set: () => undefined },
		position: { set: () => undefined },
	};
}

describe("applyZoomTransform motion blur routing", () => {
	it("keeps pure translation on the directional blur path", () => {
		const motionBlurState = createMotionBlurState();
		const motionBlurFilter = {
			velocity: { x: 0, y: 0 },
			kernelSize: 5,
			offset: 0,
		};
		const zoomBlurFilter = {
			strength: 0,
			center: { x: 0, y: 0 },
			innerRadius: 0,
			radius: -1,
		};

		const sharedParams = {
			cameraContainer: createStubContainer() as never,
			zoomBlurFilter: zoomBlurFilter as never,
			motionBlurFilter: motionBlurFilter as never,
			stageSize: { width: 1280, height: 720 },
			baseMask: { x: 80, y: 60, width: 1120, height: 600 },
			zoomScale: 1,
			focusX: 0.5,
			focusY: 0.5,
			isPlaying: true,
			motionBlurAmount: 1,
			motionBlurState,
		};

		applyZoomTransform({
			...sharedParams,
			transformOverride: { scale: 1, x: 0, y: 0 },
			frameTimeMs: 1000,
		});
		applyZoomTransform({
			...sharedParams,
			transformOverride: { scale: 1, x: 96, y: 24 },
			frameTimeMs: 1016,
		});

		expect(
			Math.hypot(motionBlurFilter.velocity.x, motionBlurFilter.velocity.y),
		).toBeGreaterThan(0);
		expect(zoomBlurFilter.strength).toBe(0);
	});

	it("infers an off-center zoom origin for radial blur", () => {
		const motionBlurState = createMotionBlurState();
		const motionBlurFilter = {
			velocity: { x: 0, y: 0 },
			kernelSize: 5,
			offset: 0,
		};
		const zoomBlurFilter = {
			strength: 0,
			center: { x: 0, y: 0 },
			innerRadius: 0,
			radius: -1,
		};
		const stageSize = { width: 1000, height: 800 };
		const baseMask = { x: 100, y: 100, width: 800, height: 600 };
		const focusX = 0.2;
		const focusY = 0.7;

		applyZoomTransform({
			cameraContainer: createStubContainer() as never,
			zoomBlurFilter: zoomBlurFilter as never,
			motionBlurFilter: motionBlurFilter as never,
			stageSize,
			baseMask,
			zoomScale: 1,
			focusX,
			focusY,
			isPlaying: true,
			motionBlurAmount: 1,
			motionBlurState,
			transformOverride: computeZoomTransform({
				stageSize,
				baseMask,
				zoomScale: 1,
				focusX,
				focusY,
			}),
			frameTimeMs: 1000,
		});
		applyZoomTransform({
			cameraContainer: createStubContainer() as never,
			zoomBlurFilter: zoomBlurFilter as never,
			motionBlurFilter: motionBlurFilter as never,
			stageSize,
			baseMask,
			zoomScale: 1.7,
			focusX,
			focusY,
			isPlaying: true,
			motionBlurAmount: 1,
			motionBlurState,
			transformOverride: computeZoomTransform({
				stageSize,
				baseMask,
				zoomScale: 1.7,
				focusX,
				focusY,
			}),
			frameTimeMs: 1016,
		});

		expect(Math.abs(zoomBlurFilter.strength)).toBeGreaterThan(0);
		expect(Math.hypot(motionBlurFilter.velocity.x, motionBlurFilter.velocity.y)).toBe(0);
		expect(zoomBlurFilter.center.x).toBeCloseTo(stageSize.width / 2, 0);
		expect(zoomBlurFilter.center.y).toBeCloseTo(stageSize.height / 2, 0);
		expect(zoomBlurFilter.radius).toBe(-1);
	});
});

describe("analyzeZoomMotionBlurStep", () => {
	const baseMask = { x: 80, y: 60, width: 1120, height: 600 };
	const stageSize = { width: 1280, height: 720 };

	it("reports zero strength when the camera step is static", () => {
		const result = analyzeZoomMotionBlurStep({
			previousTransform: { scale: 1, x: 0, y: 0 },
			currentTransform: { scale: 1, x: 0, y: 0 },
			baseMask,
			stageSize,
			motionBlurAmount: 1,
			deltaSeconds: 1 / 30,
		});

		expect(result.strength).toBe(0);
		expect(result.centerX).toBeCloseTo(640, 0);
		expect(result.centerY).toBeCloseTo(360, 0);
	});

	it("derives the same radial strength the renderer applies during zoom steps", () => {
		const previous = { scale: 1, x: 0, y: 0 };
		const current = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 1.4,
			zoomProgress: 1,
			focusX: 0.5,
			focusY: 0.5,
		});

		const result = analyzeZoomMotionBlurStep({
			previousTransform: previous,
			currentTransform: current,
			baseMask,
			stageSize,
			motionBlurAmount: 0.35,
			deltaSeconds: 1 / 30,
		});

		expect(result.strength).toBeGreaterThan(0);
		// A zoom about the stage center keeps the blur center at the stage center.
		expect(result.centerX).toBeCloseTo(stageSize.width / 2, 0);
		expect(result.centerY).toBeCloseTo(stageSize.height / 2, 0);
	});

	it("places the blur center at the zoom pivot for off-center zooms", () => {
		const previous = { scale: 1, x: 0, y: 0 };
		const current = computeZoomTransform({
			stageSize,
			baseMask,
			zoomScale: 1.6,
			zoomProgress: 1,
			focusX: 0.25,
			focusY: 0.75,
		});

		const result = analyzeZoomMotionBlurStep({
			previousTransform: previous,
			currentTransform: current,
			baseMask,
			stageSize,
			motionBlurAmount: 0.35,
			deltaSeconds: 1 / 30,
		});

		expect(result.strength).toBeGreaterThan(0);
		expect(result.centerX).toBeLessThan(stageSize.width / 2);
		expect(result.centerY).toBeGreaterThan(stageSize.height / 2);
	});
});
