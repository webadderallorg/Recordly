import { describe, expect, it } from "vitest";
import type { CursorFollowCropSettings, CursorTelemetryPoint } from "../types";
import {
	computeCursorTextZoom,
	createCursorTextZoomState,
	DEFAULT_TEXT_ZOOM_DEPTH_SCALE,
} from "./cursorTextZoom";

const settings = (overrides: Partial<CursorFollowCropSettings> = {}): CursorFollowCropSettings => ({
	enabled: false,
	safeZoneRatio: 0.25,
	smoothness: 0.5,
	previewMode: "source",
	trackTextCursor: false,
	textZoomEnabled: true,
	...overrides,
});

const sample = (
	timeMs: number,
	cx: number,
	cy: number,
	cursorType?: CursorTelemetryPoint["cursorType"],
): CursorTelemetryPoint => ({ timeMs, cx, cy, interactionType: "move", cursorType });

const staticTextSamples = (toMs: number, cx = 0.7, cy = 0.6): CursorTelemetryPoint[] => {
	const samples: CursorTelemetryPoint[] = [];
	for (let t = 0; t <= toMs; t += 33) {
		samples.push(sample(t, cx, cy, "text"));
	}
	return samples;
};

describe("computeCursorTextZoom", () => {
	it("stays inactive while disabled", () => {
		const state = createCursorTextZoomState();
		const samples = staticTextSamples(1000);
		const cfg = settings({ textZoomEnabled: false });

		computeCursorTextZoom(state, samples, 0, cfg);
		const result = computeCursorTextZoom(state, samples, 800, cfg);

		expect(result.active).toBe(false);
		expect(result.scale).toBe(1);
	});

	it("engages on the typing spot after the debounce when the mouse is still", () => {
		const state = createCursorTextZoomState();
		const samples = staticTextSamples(1000, 0.7, 0.6);
		const cfg = settings();

		computeCursorTextZoom(state, samples, 0, cfg);
		const result = computeCursorTextZoom(state, samples, 800, cfg);

		expect(result.active).toBe(true);
		expect(result.scale).toBeCloseTo(DEFAULT_TEXT_ZOOM_DEPTH_SCALE);
		expect(result.focus.cx).toBeCloseTo(0.7);
		expect(result.focus.cy).toBeCloseTo(0.6);
	});

	it("does not engage when the cursor type is not text", () => {
		const state = createCursorTextZoomState();
		const samples: CursorTelemetryPoint[] = [];
		for (let t = 0; t <= 1000; t += 33) samples.push(sample(t, 0.5, 0.5, "arrow"));
		const cfg = settings();

		computeCursorTextZoom(state, samples, 0, cfg);
		const result = computeCursorTextZoom(state, samples, 800, cfg);

		expect(result.active).toBe(false);
	});

	it("disengages immediately when the mouse moves", () => {
		const state = createCursorTextZoomState();
		const still = staticTextSamples(800, 0.5, 0.5);
		const cfg = settings();

		computeCursorTextZoom(state, still, 0, cfg);
		expect(computeCursorTextZoom(state, still, 800, cfg).active).toBe(true);

		const moving = [
			...still,
			sample(900, 0.5, 0.5, "arrow"),
			sample(950, 0.65, 0.5, "arrow"),
			sample(1000, 0.8, 0.5, "arrow"),
		];
		const result = computeCursorTextZoom(state, moving, 1000, cfg);
		expect(result.active).toBe(false);
		expect(result.scale).toBe(1);
	});

	it("respects a custom depth", () => {
		const state = createCursorTextZoomState();
		const samples = staticTextSamples(1000);
		const cfg = settings({ textZoomDepth: 2.2 });

		computeCursorTextZoom(state, samples, 0, cfg);
		const result = computeCursorTextZoom(state, samples, 800, cfg);

		expect(result.active).toBe(true);
		expect(result.scale).toBeCloseTo(2.2);
	});

	it("engages immediately when scrubbed onto a still typing moment (works when paused)", () => {
		const state = createCursorTextZoomState();
		const samples = staticTextSamples(4000, 0.7, 0.6);
		const cfg = settings();

		// Single call at a paused time well past any movement — should engage
		// without needing several frames of forward playback to debounce.
		const result = computeCursorTextZoom(state, samples, 2000, cfg);
		expect(result.active).toBe(true);
		expect(result.focus.cx).toBeCloseTo(0.7);
	});

	it("stays inactive right after a mouse move, even when scrubbed there", () => {
		const state = createCursorTextZoomState();
		// Mouse moves up to t=500, then holds still with a text cursor.
		const samples: CursorTelemetryPoint[] = [
			sample(0, 0.2, 0.2, "arrow"),
			sample(200, 0.4, 0.3, "arrow"),
			sample(500, 0.7, 0.6, "arrow"),
		];
		for (let t = 533; t <= 3000; t += 33) samples.push(sample(t, 0.7, 0.6, "text"));
		const cfg = settings();

		// Scrub to just after the move: within the debounce window → inactive.
		expect(computeCursorTextZoom(state, samples, 560, cfg).active).toBe(false);
		// Advance past the debounce → engages.
		expect(computeCursorTextZoom(state, samples, 1400, cfg).active).toBe(true);
	});
});
