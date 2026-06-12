/**
 * Pure cubic-bezier math for the webcam pen mask path. Anchors are
 * WebcamMaskPoint values in normalized source coordinates; in/out handles are
 * ABSOLUTE coordinates, and a point without handles is a corner point (the
 * anchor itself acts as the control point, so a segment between two corner
 * points degenerates to a straight line).
 *
 * The closest-point sampling/refinement and the de Casteljau split are ported
 * from OpenCut's freeform mask path (MIT licensed).
 */

import type { WebcamMaskPoint } from "@/components/video-editor/types";

export interface PathPoint {
	x: number;
	y: number;
}

export interface ClosestPathPoint {
	segmentIndex: number;
	t: number;
	distance: number;
	point: PathPoint;
}

function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
	};
}

function distanceSquared(a: PathPoint, b: PathPoint): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

function clampUnit(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/** Evaluates a cubic bezier (anchors p0/p1, controls c0/c1) at parameter t. */
export function evaluateCubicBezier(
	p0: PathPoint,
	c0: PathPoint,
	c1: PathPoint,
	p1: PathPoint,
	t: number,
): PathPoint {
	const oneMinusT = 1 - t;
	return {
		x:
			oneMinusT ** 3 * p0.x +
			3 * oneMinusT ** 2 * t * c0.x +
			3 * oneMinusT * t ** 2 * c1.x +
			t ** 3 * p1.x,
		y:
			oneMinusT ** 3 * p0.y +
			3 * oneMinusT ** 2 * t * c0.y +
			3 * oneMinusT * t ** 2 * c1.y +
			t ** 3 * p1.y,
	};
}

/**
 * Control points of the closed-path segment from anchor `a` to anchor `b`:
 * a corner point contributes its own anchor, so corner→corner is a straight
 * line.
 */
export function segmentControls(
	a: WebcamMaskPoint,
	b: WebcamMaskPoint,
): { c0: PathPoint; c1: PathPoint } {
	return {
		c0:
			a.outX !== undefined && a.outY !== undefined
				? { x: a.outX, y: a.outY }
				: { x: a.x, y: a.y },
		c1:
			b.inX !== undefined && b.inY !== undefined
				? { x: b.inX, y: b.inY }
				: { x: b.x, y: b.y },
	};
}

/** Number of segments in the closed path (one per anchor, incl. last→first). */
export function getSegmentCount(points: WebcamMaskPoint[]): number {
	return points.length < 2 ? 0 : points.length;
}

function evaluateSegment(points: WebcamMaskPoint[], segmentIndex: number, t: number): PathPoint {
	const a = points[segmentIndex];
	const b = points[(segmentIndex + 1) % points.length];
	const { c0, c1 } = segmentControls(a, b);
	return evaluateCubicBezier({ x: a.x, y: a.y }, c0, c1, { x: b.x, y: b.y }, t);
}

/**
 * Finds the closest point on the closed path to `target` by sampling each
 * segment then locally refining around the best sample (OpenCut's approach).
 * Returns null when the path has fewer than 2 anchors.
 */
export function findClosestPointOnPath(
	points: WebcamMaskPoint[],
	target: PathPoint,
): ClosestPathPoint | null {
	const segmentCount = getSegmentCount(points);
	if (segmentCount === 0) {
		return null;
	}

	const sampleCount = 24;
	let bestSegmentIndex = 0;
	let bestT = 0;
	let bestDistanceSquared = Number.POSITIVE_INFINITY;

	for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
		for (let step = 0; step <= sampleCount; step++) {
			const t = step / sampleCount;
			const point = evaluateSegment(points, segmentIndex, t);
			const candidate = distanceSquared(target, point);
			if (candidate < bestDistanceSquared) {
				bestDistanceSquared = candidate;
				bestSegmentIndex = segmentIndex;
				bestT = t;
			}
		}
	}

	let searchStep = 1 / sampleCount;
	for (let iteration = 0; iteration < 8; iteration++) {
		for (const t of [bestT - searchStep, bestT + searchStep].map(clampUnit)) {
			const point = evaluateSegment(points, bestSegmentIndex, t);
			const candidate = distanceSquared(target, point);
			if (candidate < bestDistanceSquared) {
				bestDistanceSquared = candidate;
				bestT = t;
			}
		}
		searchStep /= 2;
	}

	const clampedT = Math.min(0.999, Math.max(0.001, bestT));
	const point = evaluateSegment(points, bestSegmentIndex, clampedT);
	return {
		segmentIndex: bestSegmentIndex,
		t: clampedT,
		distance: Math.sqrt(distanceSquared(target, point)),
		point,
	};
}

/** True when the handle position is so close to the anchor it carries no curvature. */
function isDegenerateHandle(handle: PathPoint, anchor: PathPoint): boolean {
	return distanceSquared(handle, anchor) < 1e-12;
}

/**
 * Splits segment `segmentIndex` at parameter `t` with a de Casteljau split
 * (ported from OpenCut), returning a new points array whose curve is
 * unchanged: the neighbors get tightened handles and the inserted anchor gets
 * the split's interior handles. Handles that collapse onto their anchor
 * (straight-line splits between corner points) are omitted so corner points
 * stay corners.
 */
export function insertPointIntoSegment(
	points: WebcamMaskPoint[],
	segmentIndex: number,
	t: number,
): WebcamMaskPoint[] {
	const segmentCount = getSegmentCount(points);
	if (segmentIndex < 0 || segmentIndex >= segmentCount) {
		return points;
	}

	const startIndex = segmentIndex;
	const endIndex = (segmentIndex + 1) % points.length;
	const startPoint = points[startIndex];
	const endPoint = points[endIndex];
	const clampedT = Math.min(0.999, Math.max(0.001, t));

	const p0 = { x: startPoint.x, y: startPoint.y };
	const p3 = { x: endPoint.x, y: endPoint.y };
	const { c0: p1, c1: p2 } = segmentControls(startPoint, endPoint);
	const p01 = lerpPoint(p0, p1, clampedT);
	const p12 = lerpPoint(p1, p2, clampedT);
	const p23 = lerpPoint(p2, p3, clampedT);
	const p012 = lerpPoint(p01, p12, clampedT);
	const p123 = lerpPoint(p12, p23, clampedT);
	const splitPoint = lerpPoint(p012, p123, clampedT);

	const nextStart: WebcamMaskPoint = { ...startPoint };
	if (isDegenerateHandle(p01, p0)) {
		delete nextStart.outX;
		delete nextStart.outY;
	} else {
		nextStart.outX = p01.x;
		nextStart.outY = p01.y;
	}

	const nextEnd: WebcamMaskPoint = { ...endPoint };
	if (isDegenerateHandle(p23, p3)) {
		delete nextEnd.inX;
		delete nextEnd.inY;
	} else {
		nextEnd.inX = p23.x;
		nextEnd.inY = p23.y;
	}

	// A corner→corner segment is a straight line; the split handles would be
	// collinear noise, so insert a plain corner point instead.
	const straightSegment =
		startPoint.outX === undefined &&
		startPoint.outY === undefined &&
		endPoint.inX === undefined &&
		endPoint.inY === undefined;
	const inserted: WebcamMaskPoint = { x: splitPoint.x, y: splitPoint.y };
	if (!straightSegment) {
		inserted.inX = p012.x;
		inserted.inY = p012.y;
		inserted.outX = p123.x;
		inserted.outY = p123.y;
	}

	const nextPoints = [...points];
	nextPoints[startIndex] = nextStart;
	nextPoints[endIndex] = nextEnd;
	nextPoints.splice(startIndex + 1, 0, inserted);
	return nextPoints;
}

/**
 * Gives the anchor at `index` symmetric handles along the average tangent of
 * its closed-path neighbors, sized to a quarter of the distance to each
 * neighbor. No-op for paths with fewer than 2 anchors.
 */
export function makeSmoothPoint(points: WebcamMaskPoint[], index: number): WebcamMaskPoint[] {
	if (index < 0 || index >= points.length || points.length < 2) {
		return points;
	}

	const anchor = points[index];
	const previous = points[(index - 1 + points.length) % points.length];
	const next = points[(index + 1) % points.length];
	const tangent = { x: next.x - previous.x, y: next.y - previous.y };
	const tangentLength = Math.hypot(tangent.x, tangent.y);
	if (tangentLength < 1e-9) {
		return points;
	}

	const direction = { x: tangent.x / tangentLength, y: tangent.y / tangentLength };
	const inLength = Math.hypot(anchor.x - previous.x, anchor.y - previous.y) / 4;
	const outLength = Math.hypot(next.x - anchor.x, next.y - anchor.y) / 4;

	const nextPoints = [...points];
	nextPoints[index] = {
		x: anchor.x,
		y: anchor.y,
		inX: anchor.x - direction.x * inLength,
		inY: anchor.y - direction.y * inLength,
		outX: anchor.x + direction.x * outLength,
		outY: anchor.y + direction.y * outLength,
	};
	return nextPoints;
}

/** Strips the handles from the anchor at `index`, turning it into a corner point. */
export function makeCornerPoint(points: WebcamMaskPoint[], index: number): WebcamMaskPoint[] {
	if (index < 0 || index >= points.length) {
		return points;
	}
	const nextPoints = [...points];
	nextPoints[index] = { x: points[index].x, y: points[index].y };
	return nextPoints;
}
