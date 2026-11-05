import { describe, expect, it } from "vitest";
import type { CursorTelemetryPoint } from "../types";
import { getCursorPressState } from "./cursorPress";

const point = (
	timeMs: number,
	interactionType: CursorTelemetryPoint["interactionType"],
	mouseButton?: 1 | 2 | 3,
): CursorTelemetryPoint => ({ timeMs, cx: timeMs / 10000, cy: 0.5, interactionType, mouseButton });

describe("held cursor presses", () => {
	it("holds for an arbitrarily long drag and releases at the recorded up position", () => {
		const samples = [point(100, "click", 1), point(4000, "move"), point(5000, "mouseup", 1)];
		expect(getCursorPressState(samples, 50, 350).pressed).toBe(false);
		expect(getCursorPressState(samples, 4000, 350)).toMatchObject({
			pressed: true,
			bounceProgress: 0.5,
		});
		expect(getCursorPressState(samples, 5000, 350)).toMatchObject({
			pressed: false,
			releaseAgeMs: 0,
			sample: samples[2],
		});
		expect(getCursorPressState(samples, 5500, 350).bounceProgress).toBe(0);
		// Seeking backwards must reconstruct the held state.
		expect(getCursorPressState(samples, 2000, 350).pressed).toBe(true);
	});

	it("keeps another button held when one button is released", () => {
		const samples = [
			point(0, "click", 1),
			point(100, "right-click", 2),
			point(200, "mouseup", 2),
			point(1000, "mouseup", 1),
		];
		expect(getCursorPressState(samples, 500, 350)).toMatchObject({
			pressed: true,
			sample: samples[0],
		});
		expect(getCursorPressState(samples, 1000, 350)).toMatchObject({
			pressed: false,
			releaseAgeMs: 0,
			sample: samples[3],
		});
	});

	it("keeps explicit unmatched downs held through the end of recording", () => {
		const samples = [point(0, "middle-click", 3), point(5000, "move")];
		expect(getCursorPressState(samples, 4000, 350).pressed).toBe(true);
	});

	it("retains old unpaired click pulses and supports old paired down/up recordings", () => {
		expect(getCursorPressState([point(0, "click")], 1000, 350)).toMatchObject({
			pressed: false,
			bounceProgress: 0,
		});
		const samples = [point(0, "click"), point(3000, "mouseup")];
		expect(getCursorPressState(samples, 2000, 350).pressed).toBe(true);
		expect(getCursorPressState(samples, 3000, 350).pressed).toBe(false);
	});

	it("handles quick and double clicks without losing the release or sticking", () => {
		const samples = [
			point(0, "click", 1),
			point(20, "mouseup", 1),
			point(100, "double-click", 1),
			point(150, "mouseup", 1),
		];
		expect(getCursorPressState(samples, 20, 350).bounceProgress).toBeCloseTo(20 / 350);
		expect(getCursorPressState(samples, 120, 350).pressed).toBe(true);
		expect(getCursorPressState(samples, 1000, 350)).toMatchObject({
			pressed: false,
			bounceProgress: 0,
		});
	});
});
