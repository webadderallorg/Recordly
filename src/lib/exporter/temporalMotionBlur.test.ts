import { describe, expect, it } from "vitest";
import {
	buildTemporalSampleOffsetsUs,
	buildTemporalSamplePlanUs,
	getTemporalMotionBlurConfig,
} from "./temporalMotionBlur";

describe("temporalMotionBlur", () => {
	it("disables temporal blur for zero strength", () => {
		expect(getTemporalMotionBlurConfig(0)).toBeNull();
		expect(getTemporalMotionBlurConfig(undefined)).toBeNull();
	});

	it("uses an odd number of centered samples", () => {
		const config = getTemporalMotionBlurConfig(1);

		expect(config).not.toBeNull();
		expect(config?.sampleCount).toBe(5);
		expect(config?.sampleCount % 2).toBe(1);
		expect(config?.shutterFraction).toBeGreaterThan(0.24);
	});

	it("caps the automatic sample budget to keep exports responsive", () => {
		const config = getTemporalMotionBlurConfig(2);

		expect(config).not.toBeNull();
		expect(config?.sampleCount).toBe(5);
	});

	it("builds symmetric shutter offsets around the frame center", () => {
		const offsets = buildTemporalSampleOffsetsUs(33_333.333, {
			sampleCount: 5,
			shutterFraction: 0.9,
		});

		expect(offsets).toHaveLength(5);
		expect(offsets[2]).toBeCloseTo(0, 6);
		expect(offsets[0]).toBeCloseTo(-offsets[4], 6);
		expect(offsets[1]).toBeCloseTo(-offsets[3], 6);
	});

	it("accepts explicit shutter and odd sample overrides", () => {
		const config = getTemporalMotionBlurConfig(0.35, {
			sampleCount: 60,
			shutterFraction: 3,
		});

		expect(config).not.toBeNull();
		expect(config?.sampleCount).toBe(61);
		expect(config?.shutterFraction).toBeCloseTo(3, 6);
	});

	it("allows experimental multi-frame shutter windows", () => {
		const offsets = buildTemporalSampleOffsetsUs(33_333.333, {
			sampleCount: 61,
			shutterFraction: 3,
		});

		expect(offsets).toHaveLength(61);
		expect(offsets[30]).toBeCloseTo(0, 6);
		expect(offsets[0]).toBeCloseTo(-50_000, 0);
		expect(offsets[60]).toBeCloseTo(50_000, 0);
	});

	it("builds normalized sample weights with a center bias", () => {
		const config = getTemporalMotionBlurConfig(1.2);
		expect(config).not.toBeNull();

		const plan = buildTemporalSamplePlanUs(33_333.333, config!);
		const totalWeight = plan.reduce((sum, sample) => sum + sample.weight, 0);
		const centerSample = plan[Math.floor(plan.length / 2)];
		const edgeSample = plan[0];

		expect(totalWeight).toBeCloseTo(1, 6);
		expect(centerSample?.weight ?? 0).toBeGreaterThan(edgeSample?.weight ?? 0);
		expect(plan.map((sample) => sample.offsetUs)).toContain(0);
	});

});
