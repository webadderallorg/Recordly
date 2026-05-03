import { describe, expect, it } from "vitest";
import { roundNativeStaticLayoutContentSize } from "./nativeStaticLayoutGeometry";

describe("roundNativeStaticLayoutContentSize", () => {
	it("keeps even dimensions inside the floating layout bounds", () => {
		expect(
			roundNativeStaticLayoutContentSize({
				width: 1766.4,
				height: 993.6,
			}),
		).toEqual({ width: 1764, height: 992 });
	});

	it("avoids independently rounding width and height into aspect drift", () => {
		const rounded = roundNativeStaticLayoutContentSize({
			width: 1766.4,
			height: 993.6,
		});
		const independentAspect = 1766 / 994;
		const roundedAspect = rounded.width / rounded.height;
		const targetAspect = 1766.4 / 993.6;

		expect(Math.abs(roundedAspect - targetAspect)).toBeLessThan(
			Math.abs(independentAspect - targetAspect),
		);
	});

	it("handles integer even layouts without changing them", () => {
		expect(
			roundNativeStaticLayoutContentSize({
				width: 1600,
				height: 900,
			}),
		).toEqual({ width: 1600, height: 900 });
	});
});
