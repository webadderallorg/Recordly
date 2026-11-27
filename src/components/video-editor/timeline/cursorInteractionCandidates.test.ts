import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { detectZoomDwellCandidates } from "./cursorInteractionCandidates";

describe("detectZoomDwellCandidates", () => {
	it("measures a visible dwell through the hide timestamp while excluding the hidden sample position", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.2, cy: 0.4, cursorVisible: true },
			{ timeMs: 300, cx: 0.2, cy: 0.4 },
			{ timeMs: 600, cx: 0.9, cy: 0.9, cursorVisible: false },
		];

		expect(detectZoomDwellCandidates(samples)).toEqual([
			{
				centerTimeMs: 300,
				focus: { cx: 0.2, cy: 0.4 },
				strength: 600,
			},
		]);
	});

	it("preserves existing endpoints for movement boundaries and trailing visible runs", () => {
		const samples: CursorTelemetryPoint[] = [
			{ timeMs: 0, cx: 0.1, cy: 0.1, cursorVisible: true },
			{ timeMs: 500, cx: 0.1, cy: 0.1 },
			{ timeMs: 700, cx: 0.6, cy: 0.6 },
			{ timeMs: 1300, cx: 0.6, cy: 0.6 },
		];

		expect(detectZoomDwellCandidates(samples)).toEqual([
			{
				centerTimeMs: 250,
				focus: { cx: 0.1, cy: 0.1 },
				strength: 500,
			},
			{
				centerTimeMs: 1000,
				focus: { cx: 0.6, cy: 0.6 },
				strength: 600,
			},
		]);
	});
});
