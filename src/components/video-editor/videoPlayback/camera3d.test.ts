import { describe, expect, it } from "vitest";
import {
	CAMERA_3D_PRESETS,
	applyCamera3DTransform,
	computeCamera3DTransform,
	createCamera3DContainer,
	resolveCamera3DState,
	resolveRegion3DState,
	ZERO_CAMERA_3D_STATE,
} from "./camera3d";

const STAGE = { width: 1920, height: 1080 };

describe("resolveCamera3DState", () => {
	it("returns the zero state for preset 'none'", () => {
		expect(resolveCamera3DState("none")).toEqual(ZERO_CAMERA_3D_STATE);
	});

	it("gives a horizontal tilt a Y rotation and no X rotation", () => {
		const left = resolveCamera3DState("tilt-left");
		const right = resolveCamera3DState("tilt-right");
		expect(left.rotateY).toBeLessThan(0);
		expect(right.rotateY).toBeGreaterThan(0);
		expect(Math.abs(left.rotateY)).toBe(Math.abs(right.rotateY));
		expect(left.rotateX).toBe(0);
	});

	it("mirrors vertical tilts about the X axis", () => {
		const up = resolveCamera3DState("tilt-up");
		const down = resolveCamera3DState("tilt-down");
		expect(up.rotateX).toBeLessThan(0);
		expect(down.rotateX).toBeGreaterThan(0);
		expect(Math.abs(up.rotateX)).toBe(Math.abs(down.rotateX));
	});

	it("keeps every preset tilt within a readable angle", () => {
		for (const preset of Object.keys(CAMERA_3D_PRESETS) as Array<keyof typeof CAMERA_3D_PRESETS>) {
			const state = resolveCamera3DState(preset);
			expect(Math.abs(state.rotateX)).toBeLessThanOrEqual(12);
			expect(Math.abs(state.rotateY)).toBeLessThanOrEqual(12);
		}
	});
});

describe("resolveRegion3DState", () => {
	it("treats a missing move as no tilt", () => {
		expect(resolveRegion3DState(undefined)).toEqual(ZERO_CAMERA_3D_STATE);
		expect(resolveRegion3DState(null)).toEqual(ZERO_CAMERA_3D_STATE);
	});

	it("treats preset 'none' as no tilt", () => {
		expect(resolveRegion3DState({ preset: "none" })).toEqual(ZERO_CAMERA_3D_STATE);
	});

	it("treats zero intensity as no tilt", () => {
		expect(resolveRegion3DState({ preset: "tilt-left", intensity: 0 })).toEqual(
			ZERO_CAMERA_3D_STATE,
		);
	});

	it("defaults intensity to 1 when omitted", () => {
		expect(resolveRegion3DState({ preset: "tilt-left" })).toEqual(
			resolveCamera3DState("tilt-left"),
		);
	});

	it("scales the tilt linearly with intensity", () => {
		const full = resolveRegion3DState({ preset: "tilt-right" });
		const half = resolveRegion3DState({ preset: "tilt-right", intensity: 0.5 });
		expect(half.rotateY).toBeCloseTo(full.rotateY * 0.5, 6);
		expect(half.perspective).toBeCloseTo(full.perspective * 0.5, 6);
	});

	it("clamps intensity above 1 rather than amplifying past the preset", () => {
		expect(resolveRegion3DState({ preset: "tilt-right", intensity: 5 })).toEqual(
			resolveCamera3DState("tilt-right"),
		);
	});
});

describe("computeCamera3DTransform", () => {
	it("is the identity for the zero state", () => {
		expect(computeCamera3DTransform(ZERO_CAMERA_3D_STATE, STAGE)).toEqual({
			skewX: 0,
			skewY: 0,
			scale: 1,
		});
	});

	it("is the identity for a degenerate stage", () => {
		const tilt = resolveCamera3DState("tilt-left");
		expect(computeCamera3DTransform(tilt, { width: 0, height: 0 })).toEqual({
			skewX: 0,
			skewY: 0,
			scale: 1,
		});
	});

	it("skews on X for a horizontal tilt and leaves Y alone", () => {
		const { skewX, skewY } = computeCamera3DTransform(resolveCamera3DState("tilt-left"), STAGE);
		expect(skewX).not.toBe(0);
		expect(skewY).toBe(0);
	});

	it("skews on Y for a vertical tilt and leaves X alone", () => {
		const { skewX, skewY } = computeCamera3DTransform(resolveCamera3DState("tilt-up"), STAGE);
		expect(skewX).toBe(0);
		expect(skewY).not.toBe(0);
	});

	it("opposes left and right tilts", () => {
		const left = computeCamera3DTransform(resolveCamera3DState("tilt-left"), STAGE);
		const right = computeCamera3DTransform(resolveCamera3DState("tilt-right"), STAGE);
		expect(left.skewX).toBeCloseTo(-right.skewX, 6);
	});

	it("keeps skew within the affine-safe range", () => {
		for (const preset of Object.keys(CAMERA_3D_PRESETS) as Array<keyof typeof CAMERA_3D_PRESETS>) {
			const { skewX, skewY } = computeCamera3DTransform(resolveCamera3DState(preset), STAGE);
			expect(Math.abs(skewX)).toBeLessThanOrEqual(1);
			expect(Math.abs(skewY)).toBeLessThanOrEqual(1);
		}
	});

	it("scales up slightly so a tilted frame still fills the stage", () => {
		expect(computeCamera3DTransform(resolveCamera3DState("tilt-left"), STAGE).scale).toBeGreaterThan(1);
		// A pure dolly tilts nothing, so it must not inflate the frame either.
		expect(computeCamera3DTransform(resolveCamera3DState("dolly"), STAGE).scale).toBe(1);
	});

	/**
	 * Regression: the original mapping divided the angle by 90 and passed the
	 * result straight through, giving an 8-degree preset a skew of 0.037. On a
	 * 1080px stage that shifts the frame edge by ~20px out of 960 — visually
	 * indistinguishable from no tilt, which the render verification caught by
	 * measuring the rendered pixels rather than the returned numbers.
	 *
	 * These bounds pin the skew to a range that is actually visible.
	 */
	it("produces a visibly perceptible shear, not a negligible one", () => {
		for (const preset of ["tilt-left", "tilt-right"] as const) {
			const { skewX } = computeCamera3DTransform(resolveCamera3DState(preset), STAGE);
			// Visible: at least ~10% of the stage height.
			expect(Math.abs(skewX)).toBeGreaterThan(0.1);
			// Tasteful: not a full quarter of the frame.
			expect(Math.abs(skewX)).toBeLessThan(0.3);
		}
	});

	it("keeps every preset's rendered edge displacement within a readable range", () => {
		// A skew of s displaces the frame edge by s * stageHeight.
		for (const preset of Object.keys(CAMERA_3D_PRESETS) as Array<keyof typeof CAMERA_3D_PRESETS>) {
			// "dolly" is a pure forward push with no rotation, so it correctly
			// produces no shear; only the tilt presets are bounded here.
			if (preset === "dolly") continue;
			const { skewX, skewY } = computeCamera3DTransform(resolveCamera3DState(preset), STAGE);
			const displacementPx = (Math.abs(skewX) + Math.abs(skewY)) * STAGE.height;
			expect(displacementPx).toBeGreaterThan(40);
			expect(displacementPx).toBeLessThan(320);
		}
	});
});

describe("applyCamera3DTransform", () => {
	it("centres the pivot on the stage", () => {
		const container = createCamera3DContainer();
		applyCamera3DTransform(container, resolveCamera3DState("tilt-left"), STAGE);
		expect(container.pivot.x).toBe(STAGE.width / 2);
		expect(container.pivot.y).toBe(STAGE.height / 2);
		expect(container.position.x).toBe(STAGE.width / 2);
		expect(container.position.y).toBe(STAGE.height / 2);
	});

	it("writes no residual transform for the zero state", () => {
		const container = createCamera3DContainer();
		// Dirty it first, as a previous tilted frame would have.
		applyCamera3DTransform(container, resolveCamera3DState("tilt-right"), STAGE);
		applyCamera3DTransform(container, ZERO_CAMERA_3D_STATE, STAGE);

		expect(container.skew.x).toBe(0);
		expect(container.skew.y).toBe(0);
		expect(container.scale.x).toBe(1);
		expect(container.scale.y).toBe(1);
	});

	it("applies the same numbers as computeCamera3DTransform", () => {
		const state = resolveCamera3DState("tilt-up");
		const container = createCamera3DContainer();
		applyCamera3DTransform(container, state, STAGE);
		const expected = computeCamera3DTransform(state, STAGE);

		expect(container.skew.x).toBeCloseTo(expected.skewX, 6);
		expect(container.skew.y).toBeCloseTo(expected.skewY, 6);
		expect(container.scale.x).toBeCloseTo(expected.scale, 6);
	});
});