import { describe, expect, it } from "vitest";
import {
	isAutoMotionAllowed,
	resolveMotionAnimationPlayback,
} from "./motionAnimation";

describe("resolveMotionAnimationPlayback", () => {
	const sample = {
		cursorSway: 0.4,
		cursorMotionBlur: 0.6,
		zoomMotionBlur: 0.35,
		zoomClassicMode: false,
		cursorClickBounce: 2,
	};

	it("passes values through when motion animation is enabled", () => {
		expect(resolveMotionAnimationPlayback(true, sample)).toEqual(sample);
	});

	it("zeros sway, blur, bounce and forces classic mode when disabled", () => {
		expect(resolveMotionAnimationPlayback(false, sample)).toEqual({
			cursorSway: 0,
			cursorMotionBlur: 0,
			zoomMotionBlur: 0,
			zoomClassicMode: true,
			cursorClickBounce: 0,
		});
	});
});

describe("isAutoMotionAllowed", () => {
	it("requires both the motion animation gate and auto-zoom preference", () => {
		expect(isAutoMotionAllowed(true, true)).toBe(true);
		expect(isAutoMotionAllowed(true, false)).toBe(false);
		expect(isAutoMotionAllowed(false, true)).toBe(false);
		expect(isAutoMotionAllowed(false, false)).toBe(false);
	});
});
