import { describe, expect, it } from "vitest";
import {
	getWebcamMotionSamples,
	WebcamMotionBlur,
	type WebcamMotionLayout,
} from "./webcamMotionBlur";

const large: WebcamMotionLayout = { x: 400, y: 200, width: 200, height: 200, radius: 100 };
const small: WebcamMotionLayout = { x: 420, y: 220, width: 180, height: 180, radius: 90 };

describe("camera resize motion blur", () => {
	it.each([
		[large, small],
		[small, large],
	])("samples a trailing shutter for growing and shrinking", (previous, current) => {
		const samples = getWebcamMotionSamples(previous, current, 1000 / 60, 0.25);
		expect(samples[0]).toEqual(current);
		expect(samples.at(-1)).toEqual(previous);
		// Bottom-right anchoring stays fixed through the whole shutter.
		for (const sample of samples) {
			expect(sample.x + sample.width).toBe(600);
			expect(sample.y + sample.height).toBe(400);
			expect(sample.radius).toBe(sample.width / 2);
		}
	});

	it("normalizes shutter distance across frame rates", () => {
		const halfway = { x: 410, y: 210, width: 190, height: 190, radius: 95 };
		const at60 = getWebcamMotionSamples(halfway, small, 1000 / 60, 0.25);
		const at30 = getWebcamMotionSamples(large, small, 1000 / 30, 0.25);
		expect(at60.at(-1)).toEqual(at30.at(-1));
		expect(at60).toHaveLength(at30.length);
	});

	it.each([
		"top-left",
		"bottom-right",
	])("keeps eight samples for short and long %s anchored resize trails", (anchor) => {
		const short = { ...large, width: 196, height: 196, radius: 98 };
		const long = { ...large, width: 180, height: 180, radius: 90 };
		if (anchor === "bottom-right") {
			short.x += 4;
			short.y += 4;
			long.x += 20;
			long.y += 20;
		}
		for (const current of [short, long]) {
			for (const [previous, next] of [
				[large, current],
				[current, large],
			]) {
				const samples = getWebcamMotionSamples(previous, next, 1000 / 60, 0.25);
				expect(samples).toHaveLength(8);
				expect(samples[0]).toEqual(next);
				expect(samples.at(-1)).toEqual(previous);
			}
		}
	});

	it("clears blur at rest, with the effect off, and across seeks or cuts", () => {
		expect(getWebcamMotionSamples(large, large, 16, 1)).toEqual([]);
		expect(getWebcamMotionSamples(large, small, 16, 0)).toEqual([]);
		expect(getWebcamMotionSamples(large, small, 16, Number.NaN)).toEqual([]);
		expect(getWebcamMotionSamples(large, small, -16, 1)).toEqual([]);
		expect(getWebcamMotionSamples(large, small, 500, 1)).toEqual([]);
		expect(getWebcamMotionSamples(large, { ...small, width: 56 }, 16, 1)).toEqual([]);
	});

	it("does not allocate a canvas for stationary, paused, or disabled frames", () => {
		const blur = new WebcamMotionBlur();
		const options = {
			layout: large,
			source: {} as CanvasImageSource,
			sourceWidth: 200,
			sourceHeight: 200,
			mirror: false,
			shadow: 0,
			amount: 0.35,
			playing: true,
			timeMs: 0,
		};
		expect(blur.render(options)).toBeNull();
		expect(blur.render({ ...options, timeMs: 16 })).toBeNull();
		expect(blur.render({ ...options, layout: small, timeMs: 32, playing: false })).toBeNull();
		expect(blur.render({ ...options, layout: small, timeMs: 48 })).toBeNull();
		expect(blur.render({ ...options, timeMs: 64, amount: 0 })).toBeNull();
	});
});
