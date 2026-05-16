import { describe, expect, it } from "vitest";
import type { WebcamPositionRegion } from "./types";
import {
	clampWebcamPositionCoordinate,
	getActiveWebcamPositionRegion,
	getInterpolatedWebcamPositionAtTime,
	getNextWebcamPositionRegionId,
	getWebcamPositionAtTime,
	normalizeWebcamPositionRegions,
} from "./webcamPositionRegions";

const base = { positionX: 1, positionY: 1 };

describe("webcamPositionRegions", () => {
	it("uses base position when there are no active regions", () => {
		expect(getWebcamPositionAtTime(base, [], 1_000)).toEqual(base);
	});

	it("uses base position when regions is undefined", () => {
		expect(getWebcamPositionAtTime(base, undefined, 1_000)).toEqual(base);
	});

	it("uses active region position", () => {
		const regions: WebcamPositionRegion[] = [
			{ id: "r1", startMs: 1_000, endMs: 2_000, positionX: 0.2, positionY: 0.3 },
		];

		expect(getWebcamPositionAtTime(base, regions, 1_500)).toEqual({
			positionX: 0.2,
			positionY: 0.3,
		});
	});

	it("treats start as inclusive and end as exclusive", () => {
		const regions: WebcamPositionRegion[] = [
			{ id: "r1", startMs: 1_000, endMs: 2_000, positionX: 0.4, positionY: 0.5 },
		];

		expect(getWebcamPositionAtTime(base, regions, 1_000)).toEqual({
			positionX: 0.4,
			positionY: 0.5,
		});
		expect(getWebcamPositionAtTime(base, regions, 2_000)).toEqual(base);
	});

	it("chooses the overlapping region with the highest startMs", () => {
		const regions: WebcamPositionRegion[] = [
			{ id: "early", startMs: 1_000, endMs: 5_000, positionX: 0.1, positionY: 0.1 },
			{ id: "late", startMs: 2_000, endMs: 3_000, positionX: 0.8, positionY: 0.9 },
		];

		expect(getActiveWebcamPositionRegion(regions, 2_500)?.id).toBe("late");
		expect(getWebcamPositionAtTime(base, regions, 2_500)).toEqual({
			positionX: 0.8,
			positionY: 0.9,
		});
	});

	it("falls back to base position when time is outside any region", () => {
		const regions: WebcamPositionRegion[] = [
			{ id: "r1", startMs: 1_000, endMs: 2_000, positionX: 0.2, positionY: 0.2 },
		];

		expect(getActiveWebcamPositionRegion(regions, 500)).toBeNull();
		expect(getWebcamPositionAtTime(base, regions, 500)).toEqual(base);
	});

	it("clamps coordinates to the 0-1 range", () => {
		expect(clampWebcamPositionCoordinate(-0.5, 1)).toBe(0);
		expect(clampWebcamPositionCoordinate(1.5, 0)).toBe(1);
		expect(clampWebcamPositionCoordinate(0.42, 1)).toBe(0.42);
		expect(clampWebcamPositionCoordinate(Number.NaN, 0.7)).toBe(0.7);
	});

	it("normalizes valid persisted regions and drops invalid ones", () => {
		const normalized = normalizeWebcamPositionRegions(
			[
				{
					id: "bad-duration",
					startMs: 1_000,
					endMs: 1_100,
					positionX: 0.5,
					positionY: 0.5,
				},
				{
					id: "valid",
					startMs: 1_000.2,
					endMs: 2_000.7,
					positionX: 1.5,
					positionY: -0.2,
					transitionInMs: 250.2,
					transitionOutMs: 300.7,
				},
				{
					id: "bad-time",
					startMs: Number.NaN,
					endMs: 3_000,
					positionX: 0.3,
					positionY: 0.3,
				},
			],
			10_000,
		);

		expect(normalized).toEqual([
			{
				id: "valid",
				startMs: 1_000,
				endMs: 2_001,
				positionX: 1,
				positionY: 0,
				transitionInMs: 250,
				transitionOutMs: 301,
			},
		]);
	});

	it("drops regions whose duration falls below the minimum after clamping to total duration", () => {
		const normalized = normalizeWebcamPositionRegions(
			[{ id: "r1", startMs: 900, endMs: 2_000, positionX: 0.5, positionY: 0.5 }],
			1_000,
		);

		expect(normalized).toEqual([]);
	});

	it("returns an empty array for non-array input", () => {
		expect(normalizeWebcamPositionRegions(undefined)).toEqual([]);
		expect(normalizeWebcamPositionRegions(null)).toEqual([]);
		expect(normalizeWebcamPositionRegions("oops")).toEqual([]);
	});

	it("sorts regions by start and end", () => {
		const normalized = normalizeWebcamPositionRegions([
			{ id: "b", startMs: 4_000, endMs: 5_000, positionX: 0.5, positionY: 0.5 },
			{ id: "a", startMs: 1_000, endMs: 2_000, positionX: 0.5, positionY: 0.5 },
			{ id: "c", startMs: 1_000, endMs: 1_500, positionX: 0.5, positionY: 0.5 },
		]);

		expect(normalized.map((region) => region.id)).toEqual(["c", "a", "b"]);
	});

	it("generates unique ids that do not collide with existing ones", () => {
		const existing: WebcamPositionRegion[] = [
			{ id: "webcam-position-1", startMs: 0, endMs: 1_000, positionX: 1, positionY: 1 },
			{ id: "webcam-position-3", startMs: 2_000, endMs: 3_000, positionX: 1, positionY: 1 },
		];

		expect(getNextWebcamPositionRegionId(existing)).toBe("webcam-position-2");
		expect(getNextWebcamPositionRegionId([])).toBe("webcam-position-1");
	});

	describe("getInterpolatedWebcamPositionAtTime", () => {
		it("uses the base position when there are no regions", () => {
			expect(getInterpolatedWebcamPositionAtTime(base, [], 1_000)).toEqual(base);
		});

		it("returns the exact region position in the center of a region", () => {
			const regions: WebcamPositionRegion[] = [
				{ id: "r1", startMs: 1_000, endMs: 3_000, positionX: 0.2, positionY: 0.7 },
			];

			expect(getInterpolatedWebcamPositionAtTime(base, regions, 2_000)).toEqual({
				positionX: 0.2,
				positionY: 0.7,
			});
		});

		it("returns an intermediate value in the middle of the ramp-in", () => {
			const regions: WebcamPositionRegion[] = [
				{
					id: "r1",
					startMs: 1_000,
					endMs: 3_000,
					positionX: 0.2,
					positionY: 0.2,
					transitionInMs: 400,
				},
			];

			const value = getInterpolatedWebcamPositionAtTime(base, regions, 800);
			expect(value.positionX).toBeGreaterThan(0.2);
			expect(value.positionX).toBeLessThan(1);
			expect(value.positionY).toBeGreaterThan(0.2);
			expect(value.positionY).toBeLessThan(1);
		});

		it("applies easing monotonically through the ramp-in", () => {
			const regions: WebcamPositionRegion[] = [
				{
					id: "r1",
					startMs: 1_000,
					endMs: 3_000,
					positionX: 0,
					positionY: 0,
					transitionInMs: 400,
				},
			];
			const samples = [600, 700, 800, 900, 1_000].map((timeMs) =>
				getInterpolatedWebcamPositionAtTime({ positionX: 1, positionY: 1 }, regions, timeMs),
			);

			for (let index = 1; index < samples.length; index += 1) {
				expect(samples[index].positionX).toBeLessThanOrEqual(samples[index - 1].positionX);
				expect(samples[index].positionY).toBeLessThanOrEqual(samples[index - 1].positionY);
			}
			expect(samples[0].positionX).toBeCloseTo(1, 1);
			expect(samples[samples.length - 1].positionX).toBeCloseTo(0, 1);
		});
	});
});
