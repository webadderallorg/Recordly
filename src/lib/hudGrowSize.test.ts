import { describe, expect, it } from "vitest";
import { computeHudGrowContentSize } from "./hudGrowSize";

const barRect = { top: 20, left: 148, right: 713, bottom: 134 };

describe("computeHudGrowContentSize", () => {
	it("sizes to the bar when idle", () => {
		expect(computeHudGrowContentSize(barRect, null)).toEqual({
			width: 565,
			height: 134,
		});
	});

	it("extends to the popover bottom when a menu is open below the bar", () => {
		const popover = { top: 142, left: 270, right: 590, bottom: 442 };
		expect(computeHudGrowContentSize(barRect, popover)).toEqual({
			width: 565,
			height: 442,
		});
	});

	it("widens when the popover is wider than the bar", () => {
		const wide = { top: 142, left: 20, right: 850, bottom: 442 };
		expect(computeHudGrowContentSize(barRect, wide)?.width).toBe(830);
	});

	it("returns null without a content measurement", () => {
		expect(computeHudGrowContentSize(null, barRect)).toBeNull();
	});

	it("never returns non-positive sizes", () => {
		expect(
			computeHudGrowContentSize({ top: 0, left: 500, right: 500, bottom: 0 }, null),
		).toEqual({ width: 1, height: 1 });
	});
});
