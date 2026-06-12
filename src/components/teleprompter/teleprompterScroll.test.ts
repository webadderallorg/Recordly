import { describe, expect, it } from "vitest";
import {
	advanceScrollTop,
	DEFAULT_FONT_SIZE_INDEX,
	DEFAULT_SPEED_INDEX,
	FONT_SIZES,
	SPEED_LEVELS,
	stepIndex,
} from "./teleprompterScroll";

describe("advanceScrollTop", () => {
	it("advances proportionally to elapsed time and speed", () => {
		expect(advanceScrollTop(100, 60, 1000)).toBeCloseTo(160);
		expect(advanceScrollTop(100, 60, 500)).toBeCloseTo(130);
		expect(advanceScrollTop(0, 30, 16.7)).toBeCloseTo(0.501, 3);
	});

	it("ignores invalid elapsed time", () => {
		expect(advanceScrollTop(100, 60, 0)).toBe(100);
		expect(advanceScrollTop(100, 60, -5)).toBe(100);
		expect(advanceScrollTop(100, 60, Number.NaN)).toBe(100);
	});
});

describe("stepIndex", () => {
	it("steps within bounds", () => {
		expect(stepIndex(3, 1, SPEED_LEVELS.length)).toBe(4);
		expect(stepIndex(3, -1, SPEED_LEVELS.length)).toBe(2);
	});

	it("clamps at the ends", () => {
		expect(stepIndex(0, -1, SPEED_LEVELS.length)).toBe(0);
		expect(stepIndex(SPEED_LEVELS.length - 1, 1, SPEED_LEVELS.length)).toBe(
			SPEED_LEVELS.length - 1,
		);
	});
});

describe("level tables", () => {
	it("has strictly increasing speeds and sane defaults", () => {
		for (let i = 1; i < SPEED_LEVELS.length; i++) {
			expect(SPEED_LEVELS[i]).toBeGreaterThan(SPEED_LEVELS[i - 1]);
		}
		expect(DEFAULT_SPEED_INDEX).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_SPEED_INDEX).toBeLessThan(SPEED_LEVELS.length);
		expect(DEFAULT_FONT_SIZE_INDEX).toBeGreaterThanOrEqual(0);
		expect(DEFAULT_FONT_SIZE_INDEX).toBeLessThan(FONT_SIZES.length);
	});
});
