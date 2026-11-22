import { describe, expect, it } from "vitest";
import {
	applyZoomTransform,
	computeDirectionalMotionBlur,
	computeZoomTransform,
	createMotionBlurState,
} from "./zoomTransform";

function createStubContainer() {
	return {
		scale: { set: () => undefined },
		position: { set: () => undefined },
	};
}

describe("computeDirectionalMotionBlur", () => {
	it("normalizes cursor and camera motion to the same 60fps baseline", () => {
		const at60Fps = computeDirectionalMotionBlur({ x: 12, y: 0 }, 0.5, 1 / 60);
		const at30Fps = computeDirectionalMotionBlur({ x: 12, y: 0 }, 0.5, 1 / 30);

		expect(at60Fps.velocity).toEqual({ x: 6, y: 0 });
		expect(at30Fps.velocity).toEqual({ x: 3, y: 0 });
		expect(at60Fps.kernelSize).toBe(13);
		expect(at60Fps.offset).toBeCloseTo(-6 / 32, 6);
	});
});

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

		expect(zoomBlurFilter.strength).toBeGreaterThan(0);
		expect(Math.hypot(motionBlurFilter.velocity.x, motionBlurFilter.velocity.y)).toBe(0);
		expect(zoomBlurFilter.center.x).toBeCloseTo(stageSize.width / 2, 0);
		expect(zoomBlurFilter.center.y).toBeCloseTo(stageSize.height / 2, 0);
		expect(zoomBlurFilter.radius).toBe(-1);
	});

	it("keeps a fast pan directional despite a small scale change", () => {
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
			transformOverride: { scale: 1.01, x: 120, y: 0 },
			frameTimeMs: 1016,
		});

		expect(zoomBlurFilter.strength).toBe(0);
		expect(motionBlurFilter.velocity.x).toBeGreaterThan(0);
	});
});

describe("paused camera frame blur", () => {
	it("reconstructs blur without playback or prior render history and remains stable", () => {
		const motionBlurFilter = { velocity: { x: 0, y: 0 }, kernelSize: 5, offset: 0 };
		const zoomBlurFilter = { strength: 0, center: { x: 0, y: 0 }, innerRadius: 0, radius: -1 };
		const params = {
			cameraContainer: createStubContainer() as never,
			motionBlurFilter: motionBlurFilter as never,
			zoomBlurFilter: zoomBlurFilter as never,
			stageSize: { width: 1000, height: 800 },
			baseMask: { x: 0, y: 0, width: 1000, height: 800 },
			zoomScale: 1,
			focusX: 0.5,
			focusY: 0.5,
			isPlaying: false,
			motionBlurAmount: 1,
			transformOverride: { scale: 1, x: 10, y: 0 },
			motionSample: { previousTransform: { scale: 1, x: 0, y: 0 }, deltaMs: 1000 / 60 },
		};
		applyZoomTransform(params);
		expect(motionBlurFilter.velocity.x).toBeGreaterThan(0);
		const velocity = { ...motionBlurFilter.velocity };
		applyZoomTransform(params);
		expect(motionBlurFilter.velocity).toEqual(velocity);
		applyZoomTransform({ ...params, transformOverride: { scale: 1.01, x: 0, y: 0 } });
		expect(zoomBlurFilter.strength).toBeGreaterThan(0);
		expect(motionBlurFilter.velocity.x).toBe(0);
		applyZoomTransform({ ...params, motionSample: null });
		expect(zoomBlurFilter.strength).toBe(0);
		expect(motionBlurFilter.velocity.x).toBe(0);
	});
});

describe("scene shutter timing matches webcam discontinuities", () => {
	function createScene() {
		const motionBlurFilter = { velocity: { x: 0, y: 0 }, kernelSize: 5, offset: 0 };
		const zoomBlurFilter = { strength: 0, center: { x: 0, y: 0 }, innerRadius: 0, radius: -1 };
		const params = {
			cameraContainer: createStubContainer() as never,
			motionBlurFilter: motionBlurFilter as never,
			zoomBlurFilter: zoomBlurFilter as never,
			stageSize: { width: 1000, height: 800 },
			baseMask: { x: 0, y: 0, width: 1000, height: 800 },
			zoomScale: 1,
			focusX: 0.5,
			focusY: 0.5,
			isPlaying: true,
			motionBlurAmount: 0.5,
			motionBlurState: createMotionBlurState(),
		};
		const render = (timeMs: number, x: number) =>
			applyZoomTransform({
				...params,
				frameTimeMs: timeMs,
				transformOverride: { scale: 1, x, y: 0 },
			});
		return { params, render, motionBlurFilter, zoomBlurFilter };
	}

	it.each([
		-16, 0, 500,
	])("clears a discontinuous %s ms step and resumes from the new pose", (gapMs) => {
		const { render, motionBlurFilter } = createScene();
		render(0, 0);
		render(16, 10);
		expect(motionBlurFilter.velocity.x).toBeGreaterThan(0);
		render(16 + gapMs, 100);
		expect(motionBlurFilter.velocity).toEqual({ x: 0, y: 0 });
		render(32 + gapMs, 110);
		expect(motionBlurFilter.velocity.x).toBeCloseTo(10 * 0.5 * 3 * (1000 / 60 / 16));
	});

	it("holds the shutter when the same content frame is rendered again", () => {
		const { render, motionBlurFilter } = createScene();
		render(0, 0);
		render(16, 10);
		const velocity = { ...motionBlurFilter.velocity };
		const offset = motionBlurFilter.offset;
		render(16, 10);
		expect(motionBlurFilter.velocity).toEqual(velocity);
		expect(motionBlurFilter.offset).toBe(offset);
	});

	it("uses the full valid frame interval instead of inflating blur after a slow frame", () => {
		const { render, motionBlurFilter } = createScene();
		render(0, 0);
		render(90, 54);
		expect(motionBlurFilter.velocity.x).toBeCloseTo(54 * 0.5 * 3 * (1000 / 60 / 90));
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY])("clears an invalid %s timestamp", (timeMs) => {
		const { render, motionBlurFilter } = createScene();
		render(0, 0);
		render(16, 10);
		render(timeMs, 100);
		expect(motionBlurFilter.velocity).toEqual({ x: 0, y: 0 });
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("disables an invalid %s blur amount", (amount) => {
		const { params, render, motionBlurFilter } = createScene();
		render(0, 0);
		render(16, 10);
		applyZoomTransform({
			...params,
			frameTimeMs: 32,
			motionBlurAmount: amount,
			transformOverride: { scale: 1, x: 20, y: 0 },
		});
		expect(motionBlurFilter.velocity).toEqual({ x: 0, y: 0 });
	});

	it.each([
		-16,
		0,
		500,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects an explicit %s ms shutter interval", (deltaMs) => {
		const { params, render, motionBlurFilter, zoomBlurFilter } = createScene();
		render(0, 0);
		render(16, 10);
		applyZoomTransform({
			...params,
			frameTimeMs: 32,
			transformOverride: { scale: 1.1, x: 100, y: 0 },
			motionSample: { previousTransform: { scale: 1, x: 0, y: 0 }, deltaMs },
		});
		expect(motionBlurFilter.velocity).toEqual({ x: 0, y: 0 });
		expect(zoomBlurFilter.strength).toBe(0);
	});
});
