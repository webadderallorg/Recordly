import { describe, expect, it } from "vitest";
import { getSquirclePathPoints } from "./squircle";

describe("squircle paths", () => {
	it("meets the straight sides at both tangencies of every corner", () => {
		const points = getSquirclePathPoints({ x: 3, y: 7, width: 320, height: 160, radius: 60 });
		expect(points.filter(({ y }) => y === 7).map(({ x }) => x)).toEqual([263, 63]);
		expect(points.filter(({ x }) => x === 323).map(({ y }) => y)).toEqual([67, 107]);
		expect(points.filter(({ y }) => y === 167).map(({ x }) => x)).toEqual([263, 63]);
		expect(points.filter(({ x }) => x === 3).map(({ y }) => y)).toEqual([107, 67]);
	});

	it("keeps fractional radii and clamps to half the shorter edge", () => {
		const rect = { x: 0, y: 0, width: 12, height: 6 };
		expect(getSquirclePathPoints({ ...rect, radius: 0 })).toHaveLength(4);
		expect(getSquirclePathPoints({ ...rect, radius: 0.25 }).length).toBeGreaterThan(4);
		const clamped = getSquirclePathPoints({ ...rect, radius: 99 });
		expect(clamped).toEqual(getSquirclePathPoints({ ...rect, radius: 3 }));
		expect(clamped.filter(({ x, y }) => x === 12 && y === 3)).toHaveLength(1);
	});
});
