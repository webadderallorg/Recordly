import { describe, expect, it } from "vitest";
import type { WebcamSizeRegion } from "./types";
import {
	clampWebcamSizeRegionSize,
	getActiveWebcamSizeRegion,
	getInterpolatedWebcamDimensionsAtTime,
	getInterpolatedWebcamSizeAtTime,
	getNextWebcamSizeRegionId,
	getWebcamSizeAtTime,
	normalizeWebcamSizeRegions,
} from "./webcamSizeRegions";

describe("webcamSizeRegions", () => {
	it("uses base size when there are no active regions", () => {
		expect(getWebcamSizeAtTime(35, [], 1_000)).toBe(35);
	});

	it("uses base size when regions is undefined", () => {
		expect(getWebcamSizeAtTime(35, undefined, 1_000)).toBe(35);
	});

	it("uses active region size", () => {
		const regions: WebcamSizeRegion[] = [{ id: "r1", startMs: 1_000, endMs: 2_000, size: 70 }];

		expect(getWebcamSizeAtTime(35, regions, 1_500)).toBe(70);
	});

	it("treats start as inclusive and end as exclusive", () => {
		const regions: WebcamSizeRegion[] = [{ id: "r1", startMs: 1_000, endMs: 2_000, size: 70 }];

		expect(getWebcamSizeAtTime(35, regions, 1_000)).toBe(70);
		expect(getWebcamSizeAtTime(35, regions, 2_000)).toBe(35);
	});

	it("chooses the overlapping region with the highest startMs", () => {
		const regions: WebcamSizeRegion[] = [
			{ id: "early", startMs: 1_000, endMs: 5_000, size: 50 },
			{ id: "late", startMs: 2_000, endMs: 3_000, size: 80 },
		];

		expect(getActiveWebcamSizeRegion(regions, 2_500)?.id).toBe("late");
		expect(getWebcamSizeAtTime(35, regions, 2_500)).toBe(80);
	});

	it("falls back to base size when time is outside any region", () => {
		const regions: WebcamSizeRegion[] = [{ id: "r1", startMs: 1_000, endMs: 2_000, size: 70 }];

		expect(getActiveWebcamSizeRegion(regions, 500)).toBeNull();
		expect(getWebcamSizeAtTime(35, regions, 500)).toBe(35);
	});

	it("clamps sizes to the valid range", () => {
		expect(clampWebcamSizeRegionSize(5)).toBe(10);
		expect(clampWebcamSizeRegionSize(150)).toBe(100);
		expect(clampWebcamSizeRegionSize(55)).toBe(55);
	});

	it("normalizes valid persisted regions and drops invalid ones", () => {
		const normalized = normalizeWebcamSizeRegions(
			[
				{ id: "bad-duration", startMs: 1_000, endMs: 1_100, size: 50 },
				{
					id: "valid",
					startMs: 1_000.2,
					endMs: 2_000.7,
					size: 120,
					height: 80.4,
					transitionInMs: 250.2,
					transitionOutMs: 300.7,
				},
				{ id: "bad-time", startMs: Number.NaN, endMs: 3_000, size: 40 },
			],
			10_000,
		);

		expect(normalized).toEqual([
			{
				id: "valid",
				startMs: 1_000,
				endMs: 2_001,
				size: 100,
				height: 80.4,
				transitionInMs: 250,
				transitionOutMs: 301,
			},
		]);
	});

	it("drops regions whose duration falls below the minimum after clamping to total duration", () => {
		const normalized = normalizeWebcamSizeRegions(
			[{ id: "r1", startMs: 900, endMs: 2_000, size: 60 }],
			1_000,
		);

		expect(normalized).toEqual([]);
	});

	it("keeps regions when the clamped duration still meets the minimum", () => {
		const normalized = normalizeWebcamSizeRegions(
			[{ id: "r1", startMs: 500, endMs: 5_000, size: 60 }],
			1_000,
		);

		expect(normalized).toEqual([{ id: "r1", startMs: 500, endMs: 1_000, size: 60 }]);
	});

	it("returns an empty array for non-array input", () => {
		expect(normalizeWebcamSizeRegions(undefined)).toEqual([]);
		expect(normalizeWebcamSizeRegions(null)).toEqual([]);
		expect(normalizeWebcamSizeRegions("oops")).toEqual([]);
		expect(normalizeWebcamSizeRegions({ foo: 1 })).toEqual([]);
	});

	it("sorts regions by start and end", () => {
		const normalized = normalizeWebcamSizeRegions([
			{ id: "b", startMs: 4_000, endMs: 5_000, size: 50 },
			{ id: "a", startMs: 1_000, endMs: 2_000, size: 50 },
			{ id: "c", startMs: 1_000, endMs: 1_500, size: 50 },
		]);

		expect(normalized.map((region) => region.id)).toEqual(["c", "a", "b"]);
	});

	it("generates unique ids that do not collide with existing ones", () => {
		const existing: WebcamSizeRegion[] = [
			{ id: "webcam-size-1", startMs: 0, endMs: 1_000, size: 40 },
			{ id: "webcam-size-3", startMs: 2_000, endMs: 3_000, size: 40 },
		];

		expect(getNextWebcamSizeRegionId(existing)).toBe("webcam-size-2");
		expect(getNextWebcamSizeRegionId([])).toBe("webcam-size-1");
	});

	describe("getInterpolatedWebcamSizeAtTime", () => {
		it("uses the base size when there are no regions", () => {
			expect(getInterpolatedWebcamSizeAtTime(35, [], 1_000)).toBe(35);
		});

		it("returns the exact region size in the center of a region", () => {
			const regions: WebcamSizeRegion[] = [
				{ id: "r1", startMs: 1_000, endMs: 3_000, size: 70 },
			];

			expect(getInterpolatedWebcamSizeAtTime(35, regions, 2_000)).toBe(70);
		});

		it("returns an intermediate value in the middle of the ramp-in", () => {
			const regions: WebcamSizeRegion[] = [
				{ id: "r1", startMs: 1_000, endMs: 3_000, size: 70, transitionInMs: 400 },
			];

			const value = getInterpolatedWebcamSizeAtTime(35, regions, 800);
			expect(value).toBeGreaterThan(35);
			expect(value).toBeLessThan(70);
		});

		it("blends consecutive overlapping ramps directly instead of passing through base", () => {
			const regions: WebcamSizeRegion[] = [
				{
					id: "r1",
					startMs: 1_000,
					endMs: 2_000,
					size: 80,
					transitionOutMs: 500,
				},
				{
					id: "r2",
					startMs: 2_300,
					endMs: 3_000,
					size: 60,
					transitionInMs: 500,
				},
			];

			const between = getInterpolatedWebcamSizeAtTime(40, regions, 2_150);
			expect(between).toBeGreaterThan(60);
			expect(between).toBeLessThan(80);
		});

		it("applies easing monotonically through the ramp-in", () => {
			const regions: WebcamSizeRegion[] = [
				{ id: "r1", startMs: 1_000, endMs: 3_000, size: 80, transitionInMs: 400 },
			];
			const samples = [600, 700, 800, 900, 1_000].map((timeMs) =>
				getInterpolatedWebcamSizeAtTime(40, regions, timeMs),
			);

			for (let index = 1; index < samples.length; index += 1) {
				expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]);
			}
			expect(samples[0]).toBeCloseTo(40, 1);
			expect(samples[samples.length - 1]).toBeCloseTo(80, 1);
		});
	});

	describe("getInterpolatedWebcamDimensionsAtTime", () => {
		it("uses independent height values when a region stretches the webcam", () => {
			const regions: WebcamSizeRegion[] = [
				{ id: "r1", startMs: 1_000, endMs: 3_000, size: 40, height: 80 },
			];

			expect(getInterpolatedWebcamDimensionsAtTime(40, 40, regions, 2_000)).toEqual({
				size: 40,
				height: 80,
			});
		});

		it("eases height back to the base height after a stretched region", () => {
			const regions: WebcamSizeRegion[] = [
				{
					id: "r1",
					startMs: 1_000,
					endMs: 2_000,
					size: 40,
					height: 80,
					transitionOutMs: 400,
				},
			];

			const value = getInterpolatedWebcamDimensionsAtTime(40, 40, regions, 2_200);
			expect(value.size).toBeCloseTo(40, 1);
			expect(value.height).toBeGreaterThan(40);
			expect(value.height).toBeLessThan(80);
		});
	});
});
