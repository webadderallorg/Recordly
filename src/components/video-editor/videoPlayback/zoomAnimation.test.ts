import { describe, expect, it } from "vitest";
import type { ZoomRegion } from "../types";
import { clamp01, cubicBezier, easeOutExpo, easeOutZoom } from "./mathUtils";
import {
	clampDeltaMs,
	createSpringState,
	getCursorSpringConfig,
	getZoomSpringConfig,
	resetSpringState,
	type SpringConfig,
	type SpringState,
	stepSpringValue,
} from "./motionSmoothing";
import { computeRegionStrength, findDominantRegion } from "./zoomRegionUtils";

// ---------------------------------------------------------------------------
// motionSmoothing — spring state helpers
// ---------------------------------------------------------------------------

describe("createSpringState", () => {
	it("returns uninitialized state at 0", () => {
		const s = createSpringState();
		expect(s).toEqual({ value: 0, velocity: 0, initialized: false });
	});

	it("accepts a custom initial value", () => {
		const s = createSpringState(5);
		expect(s.value).toBe(5);
		expect(s.initialized).toBe(false);
	});
});

describe("resetSpringState", () => {
	it("clears velocity and initialized flag", () => {
		const s: SpringState = { value: 3, velocity: 10, initialized: true };
		resetSpringState(s);
		expect(s.velocity).toBe(0);
		expect(s.initialized).toBe(false);
		expect(s.value).toBe(3); // kept
	});

	it("resets value when provided", () => {
		const s: SpringState = { value: 3, velocity: 10, initialized: true };
		resetSpringState(s, 7);
		expect(s.value).toBe(7);
		expect(s.velocity).toBe(0);
	});
});

describe("clampDeltaMs", () => {
	it("passes through a normal 16ms frame", () => {
		expect(clampDeltaMs(16.67)).toBeCloseTo(16.67, 2);
	});

	it("clamps negative delta to fallback", () => {
		expect(clampDeltaMs(-1)).toBeCloseTo(1000 / 60, 2);
	});

	it("clamps zero delta to fallback", () => {
		expect(clampDeltaMs(0)).toBeCloseTo(1000 / 60, 2);
	});

	it("clamps NaN to fallback", () => {
		expect(clampDeltaMs(Number.NaN)).toBeCloseTo(1000 / 60, 2);
	});

	it("clamps excessively large delta to 80ms", () => {
		expect(clampDeltaMs(500)).toBe(80);
	});
});

// ---------------------------------------------------------------------------
// motionSmoothing — stepSpringValue
// ---------------------------------------------------------------------------

describe("stepSpringValue", () => {
	const config: SpringConfig = {
		stiffness: 320,
		damping: 40,
		mass: 0.92,
		restDelta: 0.0005,
		restSpeed: 0.015,
	};

	it("snaps to target on first tick (initialization)", () => {
		const s = createSpringState();
		const result = stepSpringValue(s, 1, 16, config);
		expect(result).toBe(1);
		expect(s.initialized).toBe(true);
	});

	it("converges toward the target over many ticks", () => {
		const s = createSpringState();
		stepSpringValue(s, 0, 16, config); // init at 0

		// Drive toward 1 over many frames
		for (let i = 0; i < 200; i++) {
			stepSpringValue(s, 1, 16, config);
		}

		expect(s.value).toBeCloseTo(1, 3);
	});

	it("converges within reasonable time for default zoom config", () => {
		const zoomConfig = getZoomSpringConfig(1.0);
		const s = createSpringState();
		stepSpringValue(s, 0, 16, zoomConfig); // init at 0

		let frames = 0;
		while (Math.abs(s.value - 1) > 0.001 && frames < 500) {
			stepSpringValue(s, 1, 16, zoomConfig);
			frames++;
		}

		// Should converge well within 500 frames (~8 seconds)
		// High damping (ζ ≈ 2) settles without overshoot but takes longer
		expect(frames).toBeLessThan(400); // ~6.5s at 60fps
		expect(s.value).toBeCloseTo(1, 2);
	});

	it("handles target change mid-animation", () => {
		const s = createSpringState();
		stepSpringValue(s, 0.5, 16, config);

		// Animate toward 1
		for (let i = 0; i < 30; i++) {
			stepSpringValue(s, 1, 16, config);
		}
		const midway = s.value;
		expect(midway).toBeGreaterThan(0.5);

		// Reverse direction toward 0
		for (let i = 0; i < 200; i++) {
			stepSpringValue(s, 0, 16, config);
		}
		expect(s.value).toBeCloseTo(0, 2);
	});

	it("settles exactly at target when within rest thresholds", () => {
		const s = createSpringState();
		stepSpringValue(s, 0, 16, config);

		// Manually place near target
		s.value = 0.9999;
		s.velocity = 0;
		stepSpringValue(s, 1, 16, config);

		expect(s.value).toBe(1);
		expect(s.velocity).toBe(0);
	});

	it("does not produce NaN or Infinity values", () => {
		const s = createSpringState();
		stepSpringValue(s, 0, 16, config);

		for (let i = 0; i < 300; i++) {
			stepSpringValue(s, Math.sin(i * 0.1), 16, config);
			expect(Number.isFinite(s.value)).toBe(true);
			expect(Number.isFinite(s.velocity)).toBe(true);
		}
	});
});

// ---------------------------------------------------------------------------
// motionSmoothing — spring configs
// ---------------------------------------------------------------------------

describe("getZoomSpringConfig", () => {
	it("returns snap-like config at smoothness 0", () => {
		const c = getZoomSpringConfig(0);
		expect(c.stiffness).toBe(1000);
		expect(c.damping).toBe(100);
	});

	it("returns the default mapped config at smoothness 0.5", () => {
		const c = getZoomSpringConfig(0.5);
		expect(c.stiffness).toBe(100);
		expect(c.mass).toBeCloseTo(1, 2);
	});

	it("returns the max mapped config at smoothness 1.0", () => {
		const c = getZoomSpringConfig(1.0);
		expect(c.stiffness).toBe(50);
		expect(c.mass).toBeCloseTo(2, 2);
	});

	it("clamps values above 1.0 to the max config", () => {
		expect(getZoomSpringConfig(2.0)).toEqual(getZoomSpringConfig(1.0));
	});

	it("clamps values far above 1.0 to the max config", () => {
		const c = getZoomSpringConfig(5);
		expect(c).toEqual(getZoomSpringConfig(1.0));
	});

	it("defaults to 0.5 when called without arguments", () => {
		expect(getZoomSpringConfig()).toEqual(getZoomSpringConfig(0.5));
	});
});

describe("getCursorSpringConfig", () => {
	it("returns stiff config at 0 (no smoothing)", () => {
		const c = getCursorSpringConfig(0);
		expect(c.stiffness).toBe(1000);
	});

	it("returns config in legacy range at 0.25", () => {
		const c = getCursorSpringConfig(0.25);
		expect(c.stiffness).toBeLessThan(760);
		expect(c.stiffness).toBeGreaterThan(300);
	});

	it("returns config in extended range at 1.5", () => {
		const c = getCursorSpringConfig(1.5);
		expect(c.stiffness).toBeLessThan(340);
		expect(c.mass).toBeGreaterThan(1);
	});

	it("clamps at max smoothing", () => {
		expect(getCursorSpringConfig(999)).toEqual(getCursorSpringConfig(2));
	});
});

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

// ---------------------------------------------------------------------------
// Spring physics — damping regimes
// ---------------------------------------------------------------------------

describe("spring damping regimes", () => {
	it("underdamped spring overshoots then converges", () => {
		// Low damping → expect overshoot
		const config: SpringConfig = {
			stiffness: 300,
			damping: 10,
			mass: 1,
			restDelta: 0.0005,
			restSpeed: 0.015,
		};
		const s = createSpringState();
		stepSpringValue(s, 0, 16, config);

		let maxValue = 0;
		for (let i = 0; i < 500; i++) {
			stepSpringValue(s, 1, 16, config);
			if (s.value > maxValue) maxValue = s.value;
		}

		// Should have overshot past 1 at some point
		expect(maxValue).toBeGreaterThan(1.01);
		// But should converge
		expect(s.value).toBeCloseTo(1, 1);
	});

	it("overdamped spring converges without overshoot", () => {
		const config: SpringConfig = {
			stiffness: 100,
			damping: 200,
			mass: 1,
			restDelta: 0.0005,
			restSpeed: 0.015,
		};
		const s = createSpringState();
		stepSpringValue(s, 0, 16, config);

		let maxValue = 0;
		for (let i = 0; i < 1000; i++) {
			stepSpringValue(s, 1, 16, config);
			if (s.value > maxValue) maxValue = s.value;
		}

		// Overdamped should not overshoot
		expect(maxValue).toBeLessThanOrEqual(1.001);
		// Should still converge (overdamped converges slowly)
		expect(s.value).toBeCloseTo(1, 2);
	});

	it("critically damped spring converges without oscillation", () => {
		// ζ = c / (2√(km)) = 1  →  c = 2√(km)
		const stiffness = 200;
		const mass = 1;
		const criticalDamping = 2 * Math.sqrt(stiffness * mass);

		const config: SpringConfig = {
			stiffness,
			damping: criticalDamping,
			mass,
			restDelta: 0.0005,
			restSpeed: 0.015,
		};
		const s = createSpringState();
		stepSpringValue(s, 0, 16, config);

		for (let i = 0; i < 300; i++) {
			stepSpringValue(s, 1, 16, config);
		}

		expect(s.value).toBeCloseTo(1, 2);
	});
});
