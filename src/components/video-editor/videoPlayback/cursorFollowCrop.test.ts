import { describe, expect, it } from "vitest";
import type { CropRegion, CursorFollowCropSettings, CursorTelemetryPoint } from "../types";
import {
	computeCursorFollowCrop,
	createCursorFollowCropState,
} from "./cursorFollowCrop";

const BASE_CROP: CropRegion = { x: 0, y: 0, width: 0.75, height: 0.75 };

const settings = (overrides: Partial<CursorFollowCropSettings> = {}): CursorFollowCropSettings => ({
	enabled: true,
	safeZoneRatio: 0.25,
	smoothness: 0,
	previewMode: "source",
	trackTextCursor: false,
	...overrides,
});

const sample = (
	timeMs: number,
	cx: number,
	cy: number,
	cursorType?: CursorTelemetryPoint["cursorType"],
): CursorTelemetryPoint => ({
	timeMs,
	cx,
	cy,
	interactionType: "move",
	cursorType,
});

describe("computeCursorFollowCrop", () => {
	it("keeps the viewport inside [0, 1] when the cursor walks toward an edge", () => {
		const state = createCursorFollowCropState();
		const samples = [sample(0, 0.5, 0.5), sample(1000, 1.0, 1.0)];

		const result = computeCursorFollowCrop(state, samples, 1000, BASE_CROP, settings());

		expect(result.width).toBeCloseTo(BASE_CROP.width);
		expect(result.height).toBeCloseTo(BASE_CROP.height);
		expect(result.x).toBeGreaterThanOrEqual(0);
		expect(result.x).toBeLessThanOrEqual(1 - BASE_CROP.width + 1e-6);
		expect(result.y).toBeGreaterThanOrEqual(0);
		expect(result.y).toBeLessThanOrEqual(1 - BASE_CROP.height + 1e-6);
	});

	it("holds the viewport while the cursor stays inside the safe zone", () => {
		const state = createCursorFollowCropState();
		const samples = [sample(0, 0.4, 0.4), sample(100, 0.42, 0.42)];

		const initial = computeCursorFollowCrop(state, samples, 0, BASE_CROP, settings());
		const after = computeCursorFollowCrop(state, samples, 100, BASE_CROP, settings());

		expect(after.x).toBeCloseTo(initial.x);
		expect(after.y).toBeCloseTo(initial.y);
	});

	it("reinitializes when time goes backwards (scrubbing)", () => {
		const state = createCursorFollowCropState();
		const samples = [sample(0, 0.5, 0.5), sample(5000, 0.95, 0.95)];

		const forward = computeCursorFollowCrop(state, samples, 5000, BASE_CROP, settings());
		const backward = computeCursorFollowCrop(state, samples, 0, BASE_CROP, settings());

		expect(forward.x).not.toBeCloseTo(backward.x);
		expect(state.initialized).toBe(true);
		expect(state.lastTimeMs).toBe(0);
	});

	it("falls back to base x/y when there is no telemetry", () => {
		const state = createCursorFollowCropState();
		const base: CropRegion = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };
		const result = computeCursorFollowCrop(state, [], 100, base, settings());
		expect(result.x).toBeCloseTo(0.1);
		expect(result.y).toBeCloseTo(0.2);
	});
});

describe("computeCursorFollowCrop — trackTextCursor", () => {
	it("stays in mouse mode when mouse is actively moving", () => {
		const state = createCursorFollowCropState();
		// Samples spread across 400ms window — lots of movement, text cursor type
		const samples = [
			sample(0, 0.1, 0.1, "text"),
			sample(100, 0.3, 0.1, "text"),
			sample(200, 0.5, 0.2, "text"),
			sample(300, 0.7, 0.3, "text"),
		];
		const cfg = settings({ trackTextCursor: true, smoothness: 0 });

		// Initialize
		computeCursorFollowCrop(state, samples, 0, BASE_CROP, cfg);
		// Drive forward past debounce threshold — but mouse keeps moving
		computeCursorFollowCrop(state, samples, 300, BASE_CROP, cfg);

		expect(state.focusMode).toBe("mouse");
	});

	it("switches to text mode after debounce when mouse is still and cursor type is text", () => {
		const state = createCursorFollowCropState();
		// Mouse stationary at 0.5, 0.5 with text cursor for 1000ms
		const staticSamples: CursorTelemetryPoint[] = [];
		for (let t = 0; t <= 1000; t += 33) {
			staticSamples.push(sample(t, 0.5, 0.5, "text"));
		}
		const cfg = settings({ trackTextCursor: true, smoothness: 0 });

		// Initialize at t=0
		computeCursorFollowCrop(state, staticSamples, 0, BASE_CROP, cfg);
		// Should be in text mode after 700ms+ of stillness
		computeCursorFollowCrop(state, staticSamples, 800, BASE_CROP, cfg);

		expect(state.focusMode).toBe("text");
	});

	it("immediately snaps back to mouse mode when movement is detected in text mode", () => {
		const state = createCursorFollowCropState();

		// Phase 1: stationary with text cursor — enter text mode
		const staticSamples: CursorTelemetryPoint[] = [];
		for (let t = 0; t <= 800; t += 33) {
			staticSamples.push(sample(t, 0.5, 0.5, "text"));
		}
		// Phase 2: mouse starts moving
		const movingSamples = [
			...staticSamples,
			sample(900, 0.5, 0.5, "arrow"),
			sample(950, 0.6, 0.5, "arrow"),
			sample(1000, 0.7, 0.5, "arrow"),
		];

		const cfg = settings({ trackTextCursor: true, smoothness: 0 });

		computeCursorFollowCrop(state, staticSamples, 0, BASE_CROP, cfg);
		computeCursorFollowCrop(state, staticSamples, 800, BASE_CROP, cfg);
		expect(state.focusMode).toBe("text");

		// Now advance time with mouse moving
		computeCursorFollowCrop(state, movingSamples, 1000, BASE_CROP, cfg);
		expect(state.focusMode).toBe("mouse");
	});

	it("does not switch to text mode when mouse is stationary but cursor type is not text", () => {
		const state = createCursorFollowCropState();
		const staticArrowSamples: CursorTelemetryPoint[] = [];
		for (let t = 0; t <= 1000; t += 33) {
			staticArrowSamples.push(sample(t, 0.5, 0.5, "arrow"));
		}
		const cfg = settings({ trackTextCursor: true, smoothness: 0 });

		computeCursorFollowCrop(state, staticArrowSamples, 0, BASE_CROP, cfg);
		computeCursorFollowCrop(state, staticArrowSamples, 800, BASE_CROP, cfg);

		expect(state.focusMode).toBe("mouse");
	});

	it("pans to center the I-beam (typing spot) once in text mode", () => {
		const state = createCursorFollowCropState();
		// Mouse parked off-center at 0.8, 0.8 with a text cursor, held still.
		const staticSamples: CursorTelemetryPoint[] = [];
		for (let t = 0; t <= 4000; t += 33) {
			staticSamples.push(sample(t, 0.8, 0.8, "text"));
		}
		// smoothness 0 so the eased move resolves in a single step per frame.
		const cfg = settings({ trackTextCursor: true, smoothness: 0 });

		computeCursorFollowCrop(state, staticSamples, 0, BASE_CROP, cfg);
		// Drive well past the debounce so we're in text mode and the ease settles.
		let result = computeCursorFollowCrop(state, staticSamples, 800, BASE_CROP, cfg);
		for (let t = 900; t <= 4000; t += 100) {
			result = computeCursorFollowCrop(state, staticSamples, t, BASE_CROP, cfg);
		}

		expect(state.focusMode).toBe("text");
		// Centered target = cursor - viewport/2, clamped to [0, 1 - size].
		const maxX = 1 - BASE_CROP.width;
		const maxY = 1 - BASE_CROP.height;
		expect(result.x).toBeCloseTo(Math.min(maxX, 0.8 - BASE_CROP.width / 2), 2);
		expect(result.y).toBeCloseTo(Math.min(maxY, 0.8 - BASE_CROP.height / 2), 2);
	});

	it("resets focusMode to mouse on re-initialization (time scrubbed backwards)", () => {
		const state = createCursorFollowCropState();
		const staticSamples: CursorTelemetryPoint[] = [];
		for (let t = 0; t <= 1000; t += 33) {
			staticSamples.push(sample(t, 0.5, 0.5, "text"));
		}
		const cfg = settings({ trackTextCursor: true, smoothness: 0 });

		computeCursorFollowCrop(state, staticSamples, 0, BASE_CROP, cfg);
		computeCursorFollowCrop(state, staticSamples, 800, BASE_CROP, cfg);
		expect(state.focusMode).toBe("text");

		// Scrub backwards
		computeCursorFollowCrop(state, staticSamples, 0, BASE_CROP, cfg);
		expect(state.focusMode).toBe("mouse");
	});
});
