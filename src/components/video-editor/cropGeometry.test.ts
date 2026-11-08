import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { dragCrop, fitCropRatio, type CropHandle } from "./cropGeometry";

const full = { x: 0, y: 0, width: 1, height: 1 };
const handles: CropHandle[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se", "move"];
describe("direct crop geometry", () => {
	it("snaps to a pixel square on landscape and portrait sources", () => {
		for (const source of [16 / 9, 9 / 16]) {
			for (const handle of handles.filter((handle) => handle !== "move")) {
				const crop = dragCrop(full, handle, -0.15, -0.2, 1, source);
				expect((crop.width * source) / crop.height).toBeCloseTo(1);
			}
		}
	});
	it("keeps the opposite corner anchored", () => {
		const crop = dragCrop(full, "nw", 0.2, 0.3, 1, 16 / 9);
		expect(crop.x + crop.width).toBeCloseTo(1);
		expect(crop.y + crop.height).toBeCloseTo(1);
	});
	it("fits custom ratios about the existing crop center", () => {
		const crop = fitCropRatio({ x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, 9 / 16, 16 / 9);
		expect(crop.x + crop.width / 2).toBeCloseTo(0.5);
		expect(crop.y + crop.height / 2).toBeCloseTo(0.5);
		expect((crop.width * (16 / 9)) / crop.height).toBeCloseTo(9 / 16);
	});
	it("moves without resizing and stays within the source", () => {
		expect(
			dragCrop({ x: 0.2, y: 0.2, width: 0.4, height: 0.3 }, "move", 5, -5, 1, 16 / 9),
		).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.3 });
	});
	it("keeps arbitrary drags inside the source with positive dimensions and exact ratios", () => {
		fc.assert(
			fc.property(
				fc.double({ min: 0.05, max: 20, noNaN: true }),
				fc.double({ min: 0.3, max: 3, noNaN: true }),
				fc.double({ min: -2, max: 2, noNaN: true }),
				fc.double({ min: -2, max: 2, noNaN: true }),
				fc.constantFrom(...handles),
				(ratio, source, dx, dy, handle) => {
					const initial = fitCropRatio(
						{ x: 0.1, y: 0.15, width: 0.8, height: 0.7 },
						ratio,
						source,
					);
					for (const lock of [null, ratio, 1]) {
						const crop = dragCrop(initial, handle, dx, dy, lock, source);
						expect(crop.x).toBeGreaterThanOrEqual(-1e-10);
						expect(crop.y).toBeGreaterThanOrEqual(-1e-10);
						expect(crop.width).toBeGreaterThan(0);
						expect(crop.height).toBeGreaterThan(0);
						expect(crop.x + crop.width).toBeLessThanOrEqual(1 + 1e-10);
						expect(crop.y + crop.height).toBeLessThanOrEqual(1 + 1e-10);
						if (lock && handle !== "move")
							expect((crop.width * source) / crop.height).toBeCloseTo(lock, 7);
					}
				},
			),
			{ numRuns: 1000 },
		);
	});
});
