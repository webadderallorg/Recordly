import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { clamp01, cubicBezier, easeOutExpo, easeOutZoom } from "./mathUtils";
import { computeRegionStrength, findDominantRegion } from "./zoomRegionUtils";

// ---------------------------------------------------------------------------
// mathUtils
// ---------------------------------------------------------------------------

describe("clamp01", () => {
	it("passes values in [0,1]", () => {
		expect(clamp01(0.5)).toBe(0.5);
	});
	it("clamps below 0", () => {
		expect(clamp01(-0.1)).toBe(0);
	});
	it("clamps above 1", () => {
		expect(clamp01(1.5)).toBe(1);
	});
});

describe("easeOutZoom", () => {
	it("starts at 0", () => {
		expect(easeOutZoom(0)).toBeCloseTo(0, 4);
	});

	it("ends at 1", () => {
		expect(easeOutZoom(1)).toBeCloseTo(1, 4);
	});

	it("is monotonically increasing", () => {
		let previous = 0;
		for (let t = 0.05; t <= 1; t += 0.05) {
			const current = easeOutZoom(t);
			expect(current).toBeGreaterThanOrEqual(previous);
			previous = current;
		}
	});

	it("has steep initial rise (ease-out character)", () => {
		// At t=0.25 the curve should already be well above linear (0.25)
		expect(easeOutZoom(0.25)).toBeGreaterThan(0.5);
	});
});

describe("easeOutExpo", () => {
	it("starts at 0 and ends at 1", () => {
		expect(easeOutExpo(0)).toBeCloseTo(0, 4);
		expect(easeOutExpo(1)).toBe(1);
	});
});

describe("cubicBezier", () => {
	it("linear bezier returns identity", () => {
		for (let t = 0; t <= 1; t += 0.1) {
			expect(cubicBezier(0.333, 0.333, 0.666, 0.666, t)).toBeCloseTo(t, 1);
		}
	});
});

// ---------------------------------------------------------------------------
// zoomRegionUtils — computeRegionStrength
// ---------------------------------------------------------------------------

describe("computeRegionStrength", () => {
	const region: ZoomRegion = {
		id: "z1",
		startMs: 2000,
		endMs: 5000,
		depth: 2,
		focus: { cx: 0.5, cy: 0.5 },
	};

	it("returns 0 well before the region", () => {
		expect(computeRegionStrength(region, 0)).toBe(0);
	});

	it("returns 0 well after the region", () => {
		expect(computeRegionStrength(region, 10000)).toBe(0);
	});

	it("reaches full strength during the hold phase", () => {
		// Mid-region: after zoom-in completes, before zoom-out starts
		expect(computeRegionStrength(region, 3500)).toBe(1);
	});

	it("rises smoothly during zoom-in", () => {
		// Zoom-in transitions from leadInStart .. zoomInEnd
		// zoomInEnd = startMs + 500, leadInStart = zoomInEnd - 1500 = startMs - 1000
		// So at startMs the transition is partially done
		const s = computeRegionStrength(region, region.startMs);
		expect(s).toBeGreaterThan(0);
		expect(s).toBeLessThan(1);
	});

	it("falls smoothly during zoom-out", () => {
		// Zoom-out now starts 200ms later than the original timing.
		const zoomOutStart = region.endMs - 150;
		const s = computeRegionStrength(region, zoomOutStart + 700);
		expect(s).toBeGreaterThan(0);
		expect(s).toBeLessThan(1);
	});
});

// ---------------------------------------------------------------------------
// zoomRegionUtils — findDominantRegion
// ---------------------------------------------------------------------------

describe("findDominantRegion", () => {
	it("returns null region when no regions exist", () => {
		const result = findDominantRegion([], 1000);
		expect(result.region).toBeNull();
		expect(result.strength).toBe(0);
	});

	it("returns the active region at its hold phase", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 4000, depth: 2, focus: { cx: 0.3, cy: 0.3 } },
		];
		const result = findDominantRegion(regions, 2500);
		expect(result.region).not.toBeNull();
		expect(result.region!.id).toBe("a");
		expect(result.strength).toBe(1);
	});

	it("returns null region outside all regions", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 2000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
		];
		const result = findDominantRegion(regions, 10000);
		expect(result.region).toBeNull();
	});

	it("connects chained zooms when connectZooms is true", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 3000, depth: 2, focus: { cx: 0.2, cy: 0.2 } },
			{ id: "b", startMs: 3500, endMs: 6000, depth: 3, focus: { cx: 0.8, cy: 0.8 } },
		];

		// During the connected transition (between a.endMs + 200 and a.endMs + 1200)
		const result = findDominantRegion(regions, 3200, { connectZooms: true });
		expect(result.strength).toBe(1);
		expect(result.transition).not.toBeNull();

		// Focus should be blending between the two
		if (result.region) {
			expect(result.region.focus.cx).toBeGreaterThan(0.2);
		}
	});

	it("keeps the outgoing region active until the connected transition begins", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 3000, depth: 2, focus: { cx: 0.2, cy: 0.2 } },
			{ id: "b", startMs: 3500, endMs: 6000, depth: 3, focus: { cx: 0.8, cy: 0.8 } },
		];

		const result = findDominantRegion(regions, 3100, { connectZooms: true });
		expect(result.transition).toBeNull();
		expect(result.region?.id).toBe("a");
		expect(result.strength).toBeGreaterThan(0);
	});

	it("keeps the incoming region at full strength after a connected handoff", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 3000, depth: 2, focus: { cx: 0.2, cy: 0.2 } },
			{ id: "b", startMs: 3500, endMs: 6000, depth: 3, focus: { cx: 0.8, cy: 0.8 } },
		];

		const result = findDominantRegion(regions, 4300, { connectZooms: true });
		expect(result.transition).toBeNull();
		expect(result.region?.id).toBe("b");
		expect(result.strength).toBe(1);
	});

	it("does NOT connect zooms with a large gap", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 3000, depth: 2, focus: { cx: 0.2, cy: 0.2 } },
			{ id: "b", startMs: 8000, endMs: 10000, depth: 3, focus: { cx: 0.8, cy: 0.8 } },
		];

		// In the gap — should be no active region
		const result = findDominantRegion(regions, 5000, { connectZooms: true });
		expect(result.region).toBeNull();
	});

	it("holds the next region's focus between connected-transition end and next start", () => {
		const regions: ZoomRegion[] = [
			{ id: "a", startMs: 1000, endMs: 3000, depth: 2, focus: { cx: 0.2, cy: 0.2 } },
			{ id: "b", startMs: 4300, endMs: 7000, depth: 3, focus: { cx: 0.7, cy: 0.7 } },
		];

		// After transition end (3000+200+1000=4200) but before b starts (4300)
		const result = findDominantRegion(regions, 4250, { connectZooms: true });
		expect(result.strength).toBe(1);
		expect(result.region).not.toBeNull();
		expect(result.region!.id).toBe("b");
	});
});

// ---------------------------------------------------------------------------
// ZoomRegion mode field
// ---------------------------------------------------------------------------

describe("ZoomRegion mode field", () => {
	it("accepts manual mode", () => {
		const r: ZoomRegion = {
			id: "m1",
			startMs: 0,
			endMs: 1000,
			depth: 2,
			focus: { cx: 0.5, cy: 0.5 },
			mode: "manual",
		};
		expect(r.mode).toBe("manual");
	});

	it("accepts auto mode", () => {
		const r: ZoomRegion = {
			id: "a1",
			startMs: 0,
			endMs: 1000,
			depth: 2,
			focus: { cx: 0.5, cy: 0.5 },
			mode: "auto",
		};
		expect(r.mode).toBe("auto");
	});

	it("mode is optional", () => {
		const r: ZoomRegion = {
			id: "x1",
			startMs: 0,
			endMs: 1000,
			depth: 2,
			focus: { cx: 0.5, cy: 0.5 },
		};
		expect(r.mode).toBeUndefined();
	});
});

