import { describe, expect, it } from "vitest";
import { frontmostAt, moveAreaRect, normalizeAreaRect, resizeAreaRect } from "./areaGeometry";

const bounds = { width: 1000, height: 800 };

describe("area geometry", () => {
	it("normalizes drags that go up or left", () => {
		expect(normalizeAreaRect({ x: 300, y: 200, width: -100, height: -50 }, bounds)).toEqual({
			x: 200,
			y: 150,
			width: 100,
			height: 50,
		});
	});

	it("clamps rectangles to the overlay", () => {
		expect(normalizeAreaRect({ x: 900, y: 700, width: 300, height: 300 }, bounds)).toEqual({
			x: 900,
			y: 700,
			width: 100,
			height: 100,
		});
		expect(
			moveAreaRect({ x: 100, y: 100, width: 200, height: 200 }, 2000, -500, bounds),
		).toEqual({
			x: 800,
			y: 0,
			width: 200,
			height: 200,
		});
	});

	it("resizes from an edge or corner and flips past the opposite edge", () => {
		const rect = { x: 100, y: 100, width: 200, height: 100 };
		expect(resizeAreaRect(rect, "se", 50, 20, bounds)).toEqual({
			x: 100,
			y: 100,
			width: 250,
			height: 120,
		});
		expect(resizeAreaRect(rect, "w", 300, 0, bounds)).toEqual({
			x: 300,
			y: 100,
			width: 100,
			height: 100,
		});
		expect(resizeAreaRect(rect, "n", 0, -150, bounds)).toEqual({
			x: 100,
			y: 0,
			width: 200,
			height: 200,
		});
	});
});

describe("frontmostAt", () => {
	const back = { id: "back", rect: { x: 0, y: 0, width: 800, height: 600 } };
	const front = { id: "front", rect: { x: 100, y: 100, width: 200, height: 200 } };

	it("finds the frontmost window under a point", () => {
		expect(frontmostAt([front, back], 150, 150)?.id).toBe("front");
		expect(frontmostAt([front, back], 500, 500)?.id).toBe("back");
	});

	it("finds nothing over the desktop", () => {
		expect(frontmostAt([front, back], 900, 700)).toBeNull();
	});
});
