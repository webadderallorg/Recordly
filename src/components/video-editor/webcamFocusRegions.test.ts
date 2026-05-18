import { describe, expect, it } from "vitest";
import type { WebcamFocusRegion } from "./types";
import {
	getActiveWebcamFocusRegion,
	getInterpolatedFocusStateAtTime,
	getNextWebcamFocusRegionId,
	normalizeWebcamFocusRegions,
} from "./webcamFocusRegions";

describe("webcamFocusRegions", () => {
	it("normalizes persisted focus regions and drops invalid values", () => {
		const normalized = normalizeWebcamFocusRegions(
			[
				{ id: "short", startMs: 0, endMs: 100, focusSize: 90 },
				{
					id: "valid",
					startMs: 1_000.2,
					endMs: 3_000.7,
					focusSize: 120,
					screenMode: "pip",
					screenPipSize: 5,
					screenPipCorner: "top-left",
					transitionInMs: 250.4,
					transitionOutMs: 300.6,
				},
			],
			5_000,
		);

		expect(normalized).toEqual([
			{
				id: "valid",
				startMs: 1_000,
				endMs: 3_001,
				focusSize: 100,
				screenMode: "pip",
				screenPipSize: 8,
				screenPipCorner: "top-left",
				transitionInMs: 250,
				transitionOutMs: 301,
			},
		]);
	});

	it("chooses the overlapping active region with the highest start", () => {
		const regions: WebcamFocusRegion[] = [
			{ id: "early", startMs: 1_000, endMs: 5_000, focusSize: 80, screenMode: "pip" },
			{ id: "late", startMs: 2_000, endMs: 3_000, focusSize: 95, screenMode: "hidden" },
		];

		expect(getActiveWebcamFocusRegion(regions, 2_500)?.id).toBe("late");
	});

	it("returns null outside active and transition windows", () => {
		const regions: WebcamFocusRegion[] = [
			{ id: "r1", startMs: 1_000, endMs: 2_000, focusSize: 90, screenMode: "pip" },
		];

		expect(getInterpolatedFocusStateAtTime(40, regions, 300)).toBeNull();
	});

	it("returns full focus state inside the region", () => {
		const regions: WebcamFocusRegion[] = [
			{
				id: "r1",
				startMs: 1_000,
				endMs: 2_000,
				focusSize: 95,
				screenMode: "pip",
				screenPipSize: 20,
			},
		];

		const state = getInterpolatedFocusStateAtTime(40, regions, 1_500, "bottom-right");
		expect(state?.webcamSize).toBe(95);
		expect(state?.screenSize).toBe(20);
		expect(state?.screenCorner).toBe("top-left");
	});

	it("ramps in before a focus region starts", () => {
		const regions: WebcamFocusRegion[] = [
			{
				id: "r1",
				startMs: 1_000,
				endMs: 2_000,
				focusSize: 95,
				screenMode: "hidden",
				transitionInMs: 400,
			},
		];

		const state = getInterpolatedFocusStateAtTime(40, regions, 800);
		expect(state?.webcamSize).toBeGreaterThan(40);
		expect(state?.webcamSize).toBeLessThan(95);
		expect(state?.screenOpacity).toBeGreaterThan(0);
		expect(state?.screenOpacity).toBeLessThan(1);
	});

	it("does not restart the ramp at the focus region start", () => {
		const regions: WebcamFocusRegion[] = [
			{
				id: "r1",
				startMs: 1_000,
				endMs: 2_000,
				focusSize: 95,
				screenMode: "pip",
				screenPipSize: 20,
				transitionInMs: 400,
			},
		];

		const state = getInterpolatedFocusStateAtTime(40, regions, 1_000);
		expect(state?.webcamSize).toBe(95);
		expect(state?.screenSize).toBe(20);
	});

	it("blends connected focus screen state instead of jumping to the next region", () => {
		const regions: WebcamFocusRegion[] = [
			{
				id: "r1",
				startMs: 0,
				endMs: 1_000,
				focusSize: 80,
				screenMode: "pip",
				screenPipSize: 35,
				transitionOutMs: 400,
			},
			{
				id: "r2",
				startMs: 1_200,
				endMs: 2_000,
				focusSize: 100,
				screenMode: "pip",
				screenPipSize: 10,
				transitionInMs: 400,
			},
		];

		const state = getInterpolatedFocusStateAtTime(40, regions, 1_100);
		expect(state?.webcamSize).toBeGreaterThan(80);
		expect(state?.webcamSize).toBeLessThan(100);
		expect(state?.screenSize).toBeGreaterThan(10);
		expect(state?.screenSize).toBeLessThan(35);
	});

	it("ramps out after a focus region ends", () => {
		const regions: WebcamFocusRegion[] = [
			{
				id: "r1",
				startMs: 1_000,
				endMs: 2_000,
				focusSize: 95,
				screenMode: "pip",
				screenPipSize: 20,
				transitionOutMs: 400,
			},
		];

		const state = getInterpolatedFocusStateAtTime(40, regions, 2_200);
		expect(state?.webcamSize).toBeGreaterThan(40);
		expect(state?.webcamSize).toBeLessThan(95);
		expect(state?.screenSize).toBeGreaterThan(20);
		expect(state?.screenSize).toBeLessThan(100);
	});

	it("generates focus ids without collisions", () => {
		expect(
			getNextWebcamFocusRegionId([
				{
					id: "webcam-focus-1",
					startMs: 0,
					endMs: 1_000,
					focusSize: 95,
					screenMode: "pip",
				},
			]),
		).toBe("webcam-focus-2");
	});
});
