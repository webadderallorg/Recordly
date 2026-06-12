import { describe, expect, it } from "vitest";
import type { WebcamMaskPoint } from "@/components/video-editor/types";
import {
	evaluateCubicBezier,
	findClosestPointOnPath,
	getSegmentCount,
	insertPointIntoSegment,
	makeCornerPoint,
	makeSmoothPoint,
	type PathPoint,
	segmentControls,
} from "./maskPath";

const CORNER_TRIANGLE: WebcamMaskPoint[] = [
	{ x: 0.1, y: 0.1 },
	{ x: 0.9, y: 0.1 },
	{ x: 0.5, y: 0.9 },
];

const CURVED_SQUARE: WebcamMaskPoint[] = [
	{ x: 0.2, y: 0.2, inX: 0.1, inY: 0.3, outX: 0.3, outY: 0.1 },
	{ x: 0.8, y: 0.2, inX: 0.7, inY: 0.1, outX: 0.9, outY: 0.3 },
	{ x: 0.8, y: 0.8, inX: 0.9, inY: 0.7, outX: 0.7, outY: 0.9 },
	{ x: 0.2, y: 0.8, inX: 0.3, inY: 0.9, outX: 0.1, outY: 0.7 },
];

function samplePath(points: WebcamMaskPoint[], segmentIndex: number, t: number): PathPoint {
	const a = points[segmentIndex];
	const b = points[(segmentIndex + 1) % points.length];
	const { c0, c1 } = segmentControls(a, b);
	return evaluateCubicBezier({ x: a.x, y: a.y }, c0, c1, { x: b.x, y: b.y }, t);
}

describe("evaluateCubicBezier", () => {
	it("hits the endpoints at t=0 and t=1", () => {
		const p0 = { x: 0.1, y: 0.2 };
		const p1 = { x: 0.9, y: 0.7 };
		const c0 = { x: 0.4, y: 0 };
		const c1 = { x: 0.6, y: 1 };
		expect(evaluateCubicBezier(p0, c0, c1, p1, 0)).toEqual(p0);
		expect(evaluateCubicBezier(p0, c0, c1, p1, 1)).toEqual(p1);
	});

	it("degenerates to the straight segment when controls sit on the anchors", () => {
		const p0 = { x: 0.1, y: 0.1 };
		const p1 = { x: 0.9, y: 0.5 };
		for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
			const point = evaluateCubicBezier(p0, p0, p1, p1, t);
			// Degenerate cubics reparametrize the chord: s = t²(3 - 2t).
			const s = t * t * (3 - 2 * t);
			expect(point.x).toBeCloseTo(p0.x + (p1.x - p0.x) * s, 12);
			expect(point.y).toBeCloseTo(p0.y + (p1.y - p0.y) * s, 12);
		}
	});
});

describe("segmentControls", () => {
	it("uses anchors as controls for corner points", () => {
		const { c0, c1 } = segmentControls(CORNER_TRIANGLE[0], CORNER_TRIANGLE[1]);
		expect(c0).toEqual({ x: 0.1, y: 0.1 });
		expect(c1).toEqual({ x: 0.9, y: 0.1 });
	});

	it("uses out/in handles when present", () => {
		const { c0, c1 } = segmentControls(CURVED_SQUARE[0], CURVED_SQUARE[1]);
		expect(c0).toEqual({ x: 0.3, y: 0.1 });
		expect(c1).toEqual({ x: 0.7, y: 0.1 });
	});
});

describe("getSegmentCount", () => {
	it("counts one closed segment per anchor", () => {
		expect(getSegmentCount([])).toBe(0);
		expect(getSegmentCount([{ x: 0, y: 0 }])).toBe(0);
		expect(getSegmentCount(CORNER_TRIANGLE)).toBe(3);
		expect(getSegmentCount(CURVED_SQUARE)).toBe(4);
	});
});

describe("findClosestPointOnPath", () => {
	it("returns null for fewer than 2 anchors", () => {
		expect(findClosestPointOnPath([], { x: 0.5, y: 0.5 })).toBeNull();
		expect(findClosestPointOnPath([{ x: 0.5, y: 0.5 }], { x: 0.5, y: 0.5 })).toBeNull();
	});

	it("finds the obvious nearby segment on a corner triangle", () => {
		// Just below the top edge (segment 0: (0.1,0.1) -> (0.9,0.1)).
		const result = findClosestPointOnPath(CORNER_TRIANGLE, { x: 0.5, y: 0.13 });
		expect(result).not.toBeNull();
		expect(result?.segmentIndex).toBe(0);
		expect(result?.point.x).toBeCloseTo(0.5, 2);
		expect(result?.point.y).toBeCloseTo(0.1, 6);
		expect(result?.distance).toBeCloseTo(0.03, 3);
	});

	it("includes the closing segment from last to first anchor", () => {
		// Near the left edge of the triangle (closing segment 2: (0.5,0.9) -> (0.1,0.1)).
		const result = findClosestPointOnPath(CORNER_TRIANGLE, { x: 0.25, y: 0.45 });
		expect(result?.segmentIndex).toBe(2);
		expect(result?.distance).toBeLessThan(0.05);
	});
});

describe("insertPointIntoSegment", () => {
	it("keeps the endpoints and stays on the original curve at t=0.5", () => {
		const original = CURVED_SQUARE;
		const next = insertPointIntoSegment(original, 0, 0.5);
		expect(next).toHaveLength(5);
		expect(next[0].x).toBe(original[0].x);
		expect(next[0].y).toBe(original[0].y);
		expect(next[2].x).toBe(original[1].x);
		expect(next[2].y).toBe(original[1].y);

		// The inserted anchor lies on the original curve at t=0.5.
		const expectedSplit = samplePath(original, 0, 0.5);
		expect(next[1].x).toBeCloseTo(expectedSplit.x, 12);
		expect(next[1].y).toBeCloseTo(expectedSplit.y, 12);

		// The two new sub-segments reproduce the original curve.
		for (const t of [0.2, 0.4, 0.6, 0.8]) {
			const before = samplePath(original, 0, t * 0.5);
			const firstHalf = samplePath(next, 0, t);
			expect(firstHalf.x).toBeCloseTo(before.x, 9);
			expect(firstHalf.y).toBeCloseTo(before.y, 9);

			const after = samplePath(original, 0, 0.5 + t * 0.5);
			const secondHalf = samplePath(next, 1, t);
			expect(secondHalf.x).toBeCloseTo(after.x, 9);
			expect(secondHalf.y).toBeCloseTo(after.y, 9);
		}
	});

	it("splits the closing segment in place", () => {
		const next = insertPointIntoSegment(CURVED_SQUARE, 3, 0.5);
		expect(next).toHaveLength(5);
		// First anchor stays first; the split point is appended after the last anchor.
		expect(next[0].x).toBe(CURVED_SQUARE[0].x);
		const expectedSplit = samplePath(CURVED_SQUARE, 3, 0.5);
		expect(next[4].x).toBeCloseTo(expectedSplit.x, 12);
		expect(next[4].y).toBeCloseTo(expectedSplit.y, 12);
	});

	it("inserts a handle-free midpoint on a straight corner segment", () => {
		const next = insertPointIntoSegment(CORNER_TRIANGLE, 0, 0.5);
		expect(next).toHaveLength(4);
		expect(next[0]).toEqual(CORNER_TRIANGLE[0]);
		expect(next[2]).toEqual(CORNER_TRIANGLE[1]);
		expect(next[1].x).toBeCloseTo(0.5, 12);
		expect(next[1].y).toBeCloseTo(0.1, 12);
		expect(next[1].inX).toBeUndefined();
		expect(next[1].outX).toBeUndefined();
	});

	it("returns the input array for out-of-range segments", () => {
		expect(insertPointIntoSegment(CORNER_TRIANGLE, 3, 0.5)).toBe(CORNER_TRIANGLE);
		expect(insertPointIntoSegment(CORNER_TRIANGLE, -1, 0.5)).toBe(CORNER_TRIANGLE);
	});
});

describe("makeSmoothPoint / makeCornerPoint", () => {
	it("creates symmetric-direction handles along the neighbor tangent", () => {
		const next = makeSmoothPoint(CORNER_TRIANGLE, 1);
		const point = next[1];
		expect(point.inX).toBeDefined();
		expect(point.outX).toBeDefined();

		// Handles are collinear with the anchor (opposite directions).
		const inDx = (point.inX as number) - point.x;
		const inDy = (point.inY as number) - point.y;
		const outDx = (point.outX as number) - point.x;
		const outDy = (point.outY as number) - point.y;
		expect(inDx * outDy - inDy * outDx).toBeCloseTo(0, 12);
		expect(inDx * outDx + inDy * outDy).toBeLessThan(0);

		// Quarter of the distance to each neighbor.
		const previous = CORNER_TRIANGLE[0];
		const following = CORNER_TRIANGLE[2];
		expect(Math.hypot(inDx, inDy)).toBeCloseTo(
			Math.hypot(point.x - previous.x, point.y - previous.y) / 4,
			12,
		);
		expect(Math.hypot(outDx, outDy)).toBeCloseTo(
			Math.hypot(following.x - point.x, following.y - point.y) / 4,
			12,
		);
	});

	it("round-trips back to the original corner point", () => {
		const smoothed = makeSmoothPoint(CORNER_TRIANGLE, 1);
		const cornered = makeCornerPoint(smoothed, 1);
		expect(cornered).toEqual(CORNER_TRIANGLE);
	});

	it("returns the input array for invalid indices", () => {
		expect(makeSmoothPoint(CORNER_TRIANGLE, 5)).toBe(CORNER_TRIANGLE);
		expect(makeCornerPoint(CORNER_TRIANGLE, -1)).toBe(CORNER_TRIANGLE);
	});
});
