import { describe, expect, it } from "vitest";
import {
	getTeleprompterDefaultBounds,
	TELEPROMPTER_DEFAULT_HEIGHT,
	TELEPROMPTER_DEFAULT_WIDTH,
	TELEPROMPTER_TOP_MARGIN,
} from "./teleprompterBounds";

describe("getTeleprompterDefaultBounds", () => {
	it("centers horizontally at the top of the work area", () => {
		const bounds = getTeleprompterDefaultBounds({ x: 0, y: 25, width: 1440, height: 875 });

		expect(bounds.width).toBe(TELEPROMPTER_DEFAULT_WIDTH);
		expect(bounds.height).toBe(TELEPROMPTER_DEFAULT_HEIGHT);
		expect(bounds.x).toBe(Math.round((1440 - TELEPROMPTER_DEFAULT_WIDTH) / 2));
		expect(bounds.y).toBe(25 + TELEPROMPTER_TOP_MARGIN);
	});

	it("respects work area offsets on secondary displays", () => {
		const bounds = getTeleprompterDefaultBounds({ x: 1440, y: 100, width: 1920, height: 1080 });

		expect(bounds.x).toBe(1440 + Math.round((1920 - TELEPROMPTER_DEFAULT_WIDTH) / 2));
		expect(bounds.y).toBe(100 + TELEPROMPTER_TOP_MARGIN);
	});

	it("clamps to small work areas", () => {
		const bounds = getTeleprompterDefaultBounds({ x: 0, y: 0, width: 400, height: 300 });

		expect(bounds.width).toBe(400);
		expect(bounds.height).toBe(300);
		expect(bounds.x).toBe(0);
	});
});
