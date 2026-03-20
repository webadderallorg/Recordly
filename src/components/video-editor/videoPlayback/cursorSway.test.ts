import { describe, expect, it } from "vitest";

import {
	computeCursorSwayRotation,
	fromCursorSwaySliderValue,
	toCursorSwaySliderValue,
} from "./cursorSway";

describe("computeCursorSwayRotation", () => {
	it("returns zero when sway is disabled or there is no movement", () => {
		expect(computeCursorSwayRotation(120, 0, 16, 0)).toBe(0);
		expect(computeCursorSwayRotation(0, 0, 16, 1)).toBe(0);
	});

	it("leans with the motion direction", () => {
		expect(computeCursorSwayRotation(120, 0, 16, 1)).toBeGreaterThan(0);
		expect(computeCursorSwayRotation(-120, 0, 16, 1)).toBeLessThan(0);
		expect(computeCursorSwayRotation(0, 120, 16, 1)).toBeGreaterThan(0);
		expect(computeCursorSwayRotation(0, -120, 16, 1)).toBeLessThan(0);
	});

	it("increases with faster movement for the same direction", () => {
		const slow = Math.abs(computeCursorSwayRotation(24, 0, 48, 1));
		const fast = Math.abs(computeCursorSwayRotation(120, 0, 16, 1));

		expect(fast).toBeGreaterThan(slow);
	});

	it("maps a 2x slider value to a 6x sway intensity", () => {
		expect(computeCursorSwayRotation(-140, 0, 100, 2)).toBeCloseTo(-(Math.PI / 3), 6);
	});

	it("maps a 1x slider value to the previous 2x sway strength", () => {
		expect(fromCursorSwaySliderValue(1)).toBe(2);
		expect(toCursorSwaySliderValue(2)).toBe(1);
	});
});
