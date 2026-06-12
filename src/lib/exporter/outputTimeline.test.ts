import { describe, expect, it } from "vitest";
import { buildOutputTimeline, outputDurationMs, sourceToOutputMs } from "./outputTimeline";

const trims = [{ id: "t", startMs: 2000, endMs: 5000 }];

describe("buildOutputTimeline", () => {
	it("removes gaps when gapsAsBlack is false", () => {
		const slices = buildOutputTimeline(10000, trims, [], false);
		expect(slices).toEqual([
			{
				kind: "source",
				sourceStartMs: 0,
				sourceEndMs: 2000,
				outputStartMs: 0,
				outputEndMs: 2000,
				speed: 1,
			},
			{
				kind: "source",
				sourceStartMs: 5000,
				sourceEndMs: 10000,
				outputStartMs: 2000,
				outputEndMs: 7000,
				speed: 1,
			},
		]);
	});

	it("emits black slices when gapsAsBlack is true", () => {
		const slices = buildOutputTimeline(10000, trims, [], true);
		expect(slices).toEqual([
			{
				kind: "source",
				sourceStartMs: 0,
				sourceEndMs: 2000,
				outputStartMs: 0,
				outputEndMs: 2000,
				speed: 1,
			},
			{
				kind: "black",
				sourceStartMs: 2000,
				sourceEndMs: 5000,
				outputStartMs: 2000,
				outputEndMs: 5000,
				speed: 1,
			},
			{
				kind: "source",
				sourceStartMs: 5000,
				sourceEndMs: 10000,
				outputStartMs: 5000,
				outputEndMs: 10000,
				speed: 1,
			},
		]);
	});

	it("applies speed regions inside source slices", () => {
		const slices = buildOutputTimeline(
			10000,
			trims,
			[{ id: "s", startMs: 0, endMs: 2000, speed: 2 }],
			true,
		);
		expect(slices[0]).toEqual({
			kind: "source",
			sourceStartMs: 0,
			sourceEndMs: 2000,
			outputStartMs: 0,
			outputEndMs: 1000,
			speed: 2,
		});
		expect(slices[1].outputStartMs).toBe(1000);
		expect(slices[1].outputEndMs).toBe(4000); // black duration unaffected by speed
	});

	it("preserves leading/trailing gaps", () => {
		const slices = buildOutputTimeline(10000, [{ id: "a", startMs: 0, endMs: 1000 }], [], true);
		expect(slices[0].kind).toBe("black");
		expect(slices[0].outputStartMs).toBe(0);
	});
});

describe("sourceToOutputMs / outputDurationMs", () => {
	it("maps source times through black gaps", () => {
		const slices = buildOutputTimeline(10000, trims, [], true);
		expect(sourceToOutputMs(slices, 1000)).toBe(1000);
		expect(sourceToOutputMs(slices, 6000)).toBe(6000);
		expect(outputDurationMs(slices)).toBe(10000);
	});

	it("maps source times when gaps removed", () => {
		const slices = buildOutputTimeline(10000, trims, [], false);
		expect(sourceToOutputMs(slices, 6000)).toBe(3000);
		expect(outputDurationMs(slices)).toBe(7000);
	});
});
